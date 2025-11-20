import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/reports/department - Get department performance report
 *
 * Query parameters:
 * - startDate: ISO 8601 timestamp (required)
 * - endDate: ISO 8601 timestamp (required)
 * - timezone: IANA timezone string (e.g., 'America/New_York', 'UTC')
 * - departmentIds: Comma-separated department IDs (optional, filter specific departments)
 * - groupIds: Comma-separated group IDs (optional, filter by groups)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const timezone = searchParams.get('timezone') || 'UTC';
    const departmentIds = searchParams.get('departmentIds')?.split(',').filter(Boolean);
    const groupIds = searchParams.get('groupIds')?.split(',').filter(Boolean);

    // Validate required parameters
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
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

    // Prepare query parameters array
    const baseParams = [session.companyId, startDate, endDate];
    const filterParams = [...(departmentIds || []), ...(groupIds || [])];

    // 1. Department Summary Metrics
    const departmentSummary = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        COUNT(DISTINCT i.incident_id) as total_incidents,
        COUNT(DISTINCT CASE WHEN i.status IN ('Resolved', 'Closed') THEN i.incident_id END) as resolved_incidents,
        COUNT(DISTINCT CASE WHEN i.status NOT IN ('Resolved', 'Closed') THEN i.incident_id END) as active_incidents,

        -- Average resolution time (from department assignment to resolution)
        AVG(
          CASE
            WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 86400
            ELSE NULL
          END
        ) as avg_resolution_time_seconds,

        -- Average time to first claim (SLA metric)
        AVG(
          CASE
            WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 86400
            ELSE NULL
          END
        ) as avg_time_to_claim_seconds,

        -- SLA compliance rates (30 min to claim, 2 hours to resolve)
        ROUND(
          AVG(
            CASE
              WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
                AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 30
              THEN 1.0
              ELSE 0.0
            END
          ) * 100, 2
        ) as claim_sla_compliance_rate,

        ROUND(
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
                AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 120
              THEN 1.0
              ELSE 0.0
            END
          ) * 100, 2
        ) as resolution_sla_compliance_rate,

        -- Workload distribution (percentage of company incidents)
        ROUND(
          COUNT(DISTINCT i.incident_id) * 100.0 /
          NULLIF((SELECT COUNT(*) FROM incidents WHERE company_id = ? AND t_created BETWEEN ? AND ?), 0),
          2
        ) as workload_percentage,

        -- Incidents transferred out (indicating escalations)
        COUNT(DISTINCT CASE WHEN ids.status = 'transferred' THEN ids.incident_id END) as transferred_out_count,

        -- Total active time across all users in this department
        SUM(COALESCE(ip.total_active_seconds, 0)) as total_active_seconds

      FROM departments d
      LEFT JOIN incidents i ON d.department_id = i.department_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      LEFT JOIN incident_department_sessions ids ON i.incident_id = ids.incident_id
        AND ids.department_id = d.department_id
      LEFT JOIN incident_participants ip ON i.incident_id = ip.incident_id
        AND ip.department_id = d.department_id
      WHERE d.company_id = ?
      GROUP BY d.department_id, d.name
      HAVING total_incidents > 0
      ORDER BY total_incidents DESC
    `).all(...baseParams, ...baseParams, ...filterParams, session.companyId) as any[];

    // 2. Department Performance Trends (daily breakdown over the period)
    const departmentTrends = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        DATE(i.t_created) as date,
        COUNT(DISTINCT i.incident_id) as incidents_created,
        COUNT(DISTINCT CASE WHEN i.t_resolved IS NOT NULL THEN i.incident_id END) as incidents_resolved
      FROM departments d
      LEFT JOIN incidents i ON d.department_id = i.department_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      WHERE d.company_id = ?
      GROUP BY d.department_id, d.name, DATE(i.t_created)
      ORDER BY d.name, date ASC
    `).all(...baseParams, ...filterParams, session.companyId) as any[];

    // 3. Top Performers by Department
    const topPerformersByDepartment = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        COUNT(DISTINCT ip.incident_id) as incidents_resolved,
        SUM(COALESCE(ip.total_active_seconds, 0)) as total_active_seconds,
        ROUND(AVG(ip.join_count), 2) as avg_join_count
      FROM departments d
      JOIN incident_participants ip ON d.department_id = ip.department_id
      JOIN users u ON ip.user_id = u.user_id
      JOIN incidents i ON ip.incident_id = i.incident_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      WHERE d.company_id = ?
        AND ip.status IN ('resolved_self', 'resolved_other')
      GROUP BY d.department_id, d.name, u.user_id
      ORDER BY d.name, incidents_resolved DESC
    `).all(...baseParams, ...filterParams, session.companyId) as any[];

    // 4. Resolution Time Distribution (histogram data)
    const resolutionTimeDistribution = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        CASE
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 60 <= 30 THEN '0-30min'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 60 <= 60 THEN '30-60min'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 60 <= 120 THEN '1-2hr'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 60 <= 240 THEN '2-4hr'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 60 <= 480 THEN '4-8hr'
          ELSE '8hr+'
        END as time_bucket,
        COUNT(*) as incident_count
      FROM departments d
      JOIN incidents i ON d.department_id = i.department_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.t_resolved IS NOT NULL
        AND i.t_department_assigned IS NOT NULL
        ${departmentFilter}
        ${groupFilter}
      WHERE d.company_id = ?
      GROUP BY d.department_id, d.name, time_bucket
      ORDER BY d.name,
        CASE time_bucket
          WHEN '0-30min' THEN 1
          WHEN '30-60min' THEN 2
          WHEN '1-2hr' THEN 3
          WHEN '2-4hr' THEN 4
          WHEN '4-8hr' THEN 5
          WHEN '8hr+' THEN 6
        END
    `).all(...baseParams, ...filterParams, session.companyId) as any[];

    // 5. Status Distribution by Department
    const statusDistribution = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        i.status,
        COUNT(*) as count
      FROM departments d
      JOIN incidents i ON d.department_id = i.department_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      WHERE d.company_id = ?
      GROUP BY d.department_id, d.name, i.status
      ORDER BY d.name, count DESC
    `).all(...baseParams, ...filterParams, session.companyId) as any[];

    // 6. Peak Activity Hours by Department
    const peakActivityHours = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        CAST(strftime('%H', i.t_created) AS INTEGER) as hour,
        COUNT(*) as incident_count
      FROM departments d
      JOIN incidents i ON d.department_id = i.department_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      WHERE d.company_id = ?
      GROUP BY d.department_id, d.name, hour
      ORDER BY d.name, hour
    `).all(...baseParams, ...filterParams, session.companyId) as any[];

    // Format response
    return NextResponse.json({
      metadata: {
        startDate,
        endDate,
        timezone,
        generatedAt: new Date().toISOString(),
        filters: {
          departmentIds: departmentIds || [],
          groupIds: groupIds || [],
        },
      },
      summary: departmentSummary,
      trends: departmentTrends,
      topPerformers: topPerformersByDepartment,
      resolutionTimeDistribution,
      statusDistribution,
      peakActivityHours,
    });
  } catch (error) {
    console.error('Department report error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
