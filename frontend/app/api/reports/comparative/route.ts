import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/reports/comparative - Get comparative analysis report (period over period)
 *
 * Query parameters:
 * - period1StartDate: ISO 8601 timestamp (required) - Start of first period
 * - period1EndDate: ISO 8601 timestamp (required) - End of first period
 * - period2StartDate: ISO 8601 timestamp (required) - Start of second period
 * - period2EndDate: ISO 8601 timestamp (required) - End of second period
 * - timezone: IANA timezone string (e.g., 'America/New_York', 'UTC')
 * - departmentIds: Comma-separated department IDs (optional)
 * - groupIds: Comma-separated group IDs (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const period1StartDate = searchParams.get('period1StartDate');
    const period1EndDate = searchParams.get('period1EndDate');
    const period2StartDate = searchParams.get('period2StartDate');
    const period2EndDate = searchParams.get('period2EndDate');
    const timezone = searchParams.get('timezone') || 'UTC';
    const departmentIds = searchParams.get('departmentIds')?.split(',').filter(Boolean);
    const groupIds = searchParams.get('groupIds')?.split(',').filter(Boolean);

    // Validate required parameters
    if (!period1StartDate || !period1EndDate || !period2StartDate || !period2EndDate) {
      return NextResponse.json(
        { error: 'All period date ranges are required' },
        { status: 400 }
      );
    }

    // Build dynamic WHERE clauses for filtering
    const departmentFilter = departmentIds && departmentIds.length > 0
      ? `AND i.department_id IN (${departmentIds.map(() => '?').join(',')})`
      : '';

    const groupFilter = groupIds && groupIds.length > 0
      ? `AND i.group_id IN (${groupIds.map(() => '?').join(',')})`
      : '';

    const filterParams = [...(departmentIds || []), ...(groupIds || [])];

    // Helper function to calculate percentage change
    const calculateChange = (current: number, previous: number): { value: number; percentage: number; direction: 'up' | 'down' | 'flat' } => {
      const value = current - previous;
      const percentage = previous !== 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
      const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
      return { value, percentage: Math.round(percentage * 100) / 100, direction };
    };

    // 1. Overall Metrics Comparison
    const getOverallMetrics = (startDate: string, endDate: string) => {
      return db.prepare(`
        SELECT
          COUNT(*) as total_incidents,
          COUNT(CASE WHEN i.status IN ('Resolved', 'Closed') THEN 1 END) as resolved_incidents,
          COUNT(CASE WHEN i.status NOT IN ('Resolved', 'Closed') THEN 1 END) as active_incidents,

          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
            END
          ) as avg_resolution_time_minutes,

          AVG(
            CASE
              WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440
            END
          ) as avg_time_to_claim_minutes,

          -- SLA compliance rates
          ROUND(
            AVG(
              CASE
                WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
                  AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 30
                THEN 1.0 ELSE 0.0
              END
            ) * 100,
            2
          ) as claim_sla_compliance_rate,

          ROUND(
            AVG(
              CASE
                WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
                  AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 120
                THEN 1.0 ELSE 0.0
              END
            ) * 100,
            2
          ) as resolution_sla_compliance_rate,

          -- User participation
          (SELECT COUNT(DISTINCT user_id) FROM incident_participants ip
           JOIN incidents i2 ON ip.incident_id = i2.incident_id
           WHERE i2.company_id = ? AND i2.t_created BETWEEN ? AND ?
             ${departmentFilter.replace('i.', 'i2.')}
             ${groupFilter.replace('i.', 'i2.')}
          ) as active_users,

          -- Total active time
          (SELECT SUM(COALESCE(total_active_seconds, 0)) FROM incident_participants ip
           JOIN incidents i2 ON ip.incident_id = i2.incident_id
           WHERE i2.company_id = ? AND i2.t_created BETWEEN ? AND ?
             ${departmentFilter.replace('i.', 'i2.')}
             ${groupFilter.replace('i.', 'i2.')}
          ) as total_active_seconds

        FROM incidents i
        WHERE i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
          ${departmentFilter}
          ${groupFilter}
      `).get(
        session.companyId, startDate, endDate, ...filterParams,
        session.companyId, startDate, endDate, ...filterParams,
        session.companyId, startDate, endDate, ...filterParams
      ) as any;
    };

    const period1Metrics = getOverallMetrics(period1StartDate, period1EndDate);
    const period2Metrics = getOverallMetrics(period2StartDate, period2EndDate);

    // Calculate changes
    const metricsComparison = {
      total_incidents: {
        period1: period1Metrics.total_incidents,
        period2: period2Metrics.total_incidents,
        change: calculateChange(period2Metrics.total_incidents, period1Metrics.total_incidents),
      },
      resolved_incidents: {
        period1: period1Metrics.resolved_incidents,
        period2: period2Metrics.resolved_incidents,
        change: calculateChange(period2Metrics.resolved_incidents, period1Metrics.resolved_incidents),
      },
      avg_resolution_time_minutes: {
        period1: Math.round(period1Metrics.avg_resolution_time_minutes * 100) / 100,
        period2: Math.round(period2Metrics.avg_resolution_time_minutes * 100) / 100,
        change: calculateChange(period2Metrics.avg_resolution_time_minutes, period1Metrics.avg_resolution_time_minutes),
      },
      avg_time_to_claim_minutes: {
        period1: Math.round(period1Metrics.avg_time_to_claim_minutes * 100) / 100,
        period2: Math.round(period2Metrics.avg_time_to_claim_minutes * 100) / 100,
        change: calculateChange(period2Metrics.avg_time_to_claim_minutes, period1Metrics.avg_time_to_claim_minutes),
      },
      claim_sla_compliance_rate: {
        period1: period1Metrics.claim_sla_compliance_rate,
        period2: period2Metrics.claim_sla_compliance_rate,
        change: calculateChange(period2Metrics.claim_sla_compliance_rate, period1Metrics.claim_sla_compliance_rate),
      },
      resolution_sla_compliance_rate: {
        period1: period1Metrics.resolution_sla_compliance_rate,
        period2: period2Metrics.resolution_sla_compliance_rate,
        change: calculateChange(period2Metrics.resolution_sla_compliance_rate, period1Metrics.resolution_sla_compliance_rate),
      },
      active_users: {
        period1: period1Metrics.active_users,
        period2: period2Metrics.active_users,
        change: calculateChange(period2Metrics.active_users, period1Metrics.active_users),
      },
      total_active_hours: {
        period1: Math.round((period1Metrics.total_active_seconds / 3600) * 100) / 100,
        period2: Math.round((period2Metrics.total_active_seconds / 3600) * 100) / 100,
        change: calculateChange(period2Metrics.total_active_seconds / 3600, period1Metrics.total_active_seconds / 3600),
      },
    };

    // 2. Department Performance Comparison
    const getDepartmentMetrics = (startDate: string, endDate: string) => {
      return db.prepare(`
        SELECT
          d.department_id,
          d.name as department_name,
          COUNT(*) as total_incidents,
          COUNT(CASE WHEN i.status IN ('Resolved', 'Closed') THEN 1 END) as resolved_incidents,
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
            END
          ) as avg_resolution_time_minutes,
          ROUND(
            AVG(
              CASE
                WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
                  AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 120
                THEN 1.0 ELSE 0.0
              END
            ) * 100,
            2
          ) as resolution_sla_compliance_rate
        FROM departments d
        LEFT JOIN incidents i ON d.department_id = i.department_id
          AND i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
          ${groupFilter}
        WHERE d.company_id = ?
          ${departmentFilter.replace('i.department_id', 'd.department_id')}
        GROUP BY d.department_id, d.name
        HAVING total_incidents > 0
        ORDER BY d.name
      `).all(session.companyId, startDate, endDate, session.companyId, ...filterParams) as any[];
    };

    const period1DepartmentMetrics = getDepartmentMetrics(period1StartDate, period1EndDate);
    const period2DepartmentMetrics = getDepartmentMetrics(period2StartDate, period2EndDate);

    // Merge department metrics
    const departmentComparison = period1DepartmentMetrics.map((dept1: any) => {
      const dept2 = period2DepartmentMetrics.find((d: any) => d.department_id === dept1.department_id) || {
        total_incidents: 0,
        resolved_incidents: 0,
        avg_resolution_time_minutes: 0,
        resolution_sla_compliance_rate: 0,
      };

      return {
        department_id: dept1.department_id,
        department_name: dept1.department_name,
        total_incidents: {
          period1: dept1.total_incidents,
          period2: dept2.total_incidents,
          change: calculateChange(dept2.total_incidents, dept1.total_incidents),
        },
        resolved_incidents: {
          period1: dept1.resolved_incidents,
          period2: dept2.resolved_incidents,
          change: calculateChange(dept2.resolved_incidents, dept1.resolved_incidents),
        },
        avg_resolution_time_minutes: {
          period1: Math.round(dept1.avg_resolution_time_minutes * 100) / 100,
          period2: Math.round(dept2.avg_resolution_time_minutes * 100) / 100,
          change: calculateChange(dept2.avg_resolution_time_minutes, dept1.avg_resolution_time_minutes),
        },
        resolution_sla_compliance_rate: {
          period1: dept1.resolution_sla_compliance_rate,
          period2: dept2.resolution_sla_compliance_rate,
          change: calculateChange(dept2.resolution_sla_compliance_rate, dept1.resolution_sla_compliance_rate),
        },
      };
    });

    // 3. Top Performers Comparison
    const getTopPerformers = (startDate: string, endDate: string) => {
      return db.prepare(`
        SELECT
          u.user_id,
          u.username,
          u.first_name,
          u.last_name,
          COUNT(DISTINCT CASE WHEN ip.status = 'resolved_self' THEN ip.incident_id END) as incidents_resolved,
          SUM(COALESCE(ip.total_active_seconds, 0)) as total_active_seconds
        FROM users u
        JOIN incident_participants ip ON u.user_id = ip.user_id
        JOIN incidents i ON ip.incident_id = i.incident_id
          AND i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
          ${departmentFilter}
          ${groupFilter}
        GROUP BY u.user_id
        HAVING incidents_resolved > 0
        ORDER BY incidents_resolved DESC, total_active_seconds DESC
        LIMIT 20
      `).all(session.companyId, startDate, endDate, ...filterParams) as any[];
    };

    const period1TopPerformers = getTopPerformers(period1StartDate, period1EndDate);
    const period2TopPerformers = getTopPerformers(period2StartDate, period2EndDate);

    // 4. Status Distribution Comparison
    const getStatusDistribution = (startDate: string, endDate: string) => {
      return db.prepare(`
        SELECT
          i.status,
          COUNT(*) as count
        FROM incidents i
        WHERE i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
          ${departmentFilter}
          ${groupFilter}
        GROUP BY i.status
        ORDER BY count DESC
      `).all(session.companyId, startDate, endDate, ...filterParams) as any[];
    };

    const period1StatusDistribution = getStatusDistribution(period1StartDate, period1EndDate);
    const period2StatusDistribution = getStatusDistribution(period2StartDate, period2EndDate);

    // 5. Daily Volume Comparison (for visualization)
    const getDailyVolume = (startDate: string, endDate: string) => {
      return db.prepare(`
        SELECT
          DATE(i.t_created) as date,
          COUNT(*) as incident_count
        FROM incidents i
        WHERE i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
          ${departmentFilter}
          ${groupFilter}
        GROUP BY DATE(i.t_created)
        ORDER BY date ASC
      `).all(session.companyId, startDate, endDate, ...filterParams) as any[];
    };

    const period1DailyVolume = getDailyVolume(period1StartDate, period1EndDate);
    const period2DailyVolume = getDailyVolume(period2StartDate, period2EndDate);

    // Format response
    return NextResponse.json({
      metadata: {
        period1: { startDate: period1StartDate, endDate: period1EndDate },
        period2: { startDate: period2StartDate, endDate: period2EndDate },
        timezone,
        generatedAt: new Date().toISOString(),
        filters: {
          departmentIds: departmentIds || [],
          groupIds: groupIds || [],
        },
      },
      overallMetrics: metricsComparison,
      departmentComparison,
      topPerformers: {
        period1: period1TopPerformers,
        period2: period2TopPerformers,
      },
      statusDistribution: {
        period1: period1StatusDistribution,
        period2: period2StatusDistribution,
      },
      dailyVolume: {
        period1: period1DailyVolume,
        period2: period2DailyVolume,
      },
    });
  } catch (error) {
    console.error('Comparative report error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
