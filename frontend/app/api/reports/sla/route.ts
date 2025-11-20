import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/reports/sla - Get SLA compliance report
 *
 * Query parameters:
 * - startDate: ISO 8601 timestamp (required)
 * - endDate: ISO 8601 timestamp (required)
 * - timezone: IANA timezone string (e.g., 'America/New_York', 'UTC')
 * - departmentIds: Comma-separated department IDs (optional, filter by departments)
 * - groupIds: Comma-separated group IDs (optional, filter by groups)
 * - claimSlaMinutes: SLA threshold for time to claim (default: 30 minutes)
 * - resolutionSlaMinutes: SLA threshold for resolution (default: 120 minutes)
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
    const claimSlaMinutes = parseInt(searchParams.get('claimSlaMinutes') || '30');
    const resolutionSlaMinutes = parseInt(searchParams.get('resolutionSlaMinutes') || '120');

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

    // 1. Overall SLA Compliance Summary
    const overallSlaCompliance = db.prepare(`
      SELECT
        COUNT(*) as total_incidents,

        -- Time to Claim SLA
        COUNT(CASE
          WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= ?
          THEN 1
        END) as claim_sla_met,

        ROUND(
          COUNT(CASE
            WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
              AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= ?
            THEN 1
          END) * 100.0 / NULLIF(COUNT(CASE WHEN i.t_first_claimed IS NOT NULL THEN 1 END), 0),
          2
        ) as claim_sla_compliance_rate,

        -- Average time to claim in minutes
        ROUND(
          AVG(
            CASE
              WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440
            END
          ),
          2
        ) as avg_time_to_claim_minutes,

        -- Median time to claim
        (
          SELECT (julianday(t_first_claimed) - julianday(t_department_assigned)) * 1440
          FROM incidents
          WHERE company_id = ?
            AND t_created BETWEEN ? AND ?
            AND t_first_claimed IS NOT NULL
            AND t_department_assigned IS NOT NULL
            ${departmentFilter}
            ${groupFilter}
          ORDER BY (julianday(t_first_claimed) - julianday(t_department_assigned))
          LIMIT 1
          OFFSET (
            SELECT COUNT(*) / 2
            FROM incidents
            WHERE company_id = ?
              AND t_created BETWEEN ? AND ?
              AND t_first_claimed IS NOT NULL
              AND t_department_assigned IS NOT NULL
              ${departmentFilter}
              ${groupFilter}
          )
        ) as median_time_to_claim_minutes,

        -- Time to Resolution SLA
        COUNT(CASE
          WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= ?
          THEN 1
        END) as resolution_sla_met,

        ROUND(
          COUNT(CASE
            WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= ?
            THEN 1
          END) * 100.0 / NULLIF(COUNT(CASE WHEN i.t_resolved IS NOT NULL THEN 1 END), 0),
          2
        ) as resolution_sla_compliance_rate,

        -- Average resolution time in minutes
        ROUND(
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
            END
          ),
          2
        ) as avg_resolution_time_minutes,

        -- Median resolution time
        (
          SELECT (julianday(t_resolved) - julianday(t_department_assigned)) * 1440
          FROM incidents
          WHERE company_id = ?
            AND t_created BETWEEN ? AND ?
            AND t_resolved IS NOT NULL
            AND t_department_assigned IS NOT NULL
            ${departmentFilter}
            ${groupFilter}
          ORDER BY (julianday(t_resolved) - julianday(t_department_assigned))
          LIMIT 1
          OFFSET (
            SELECT COUNT(*) / 2
            FROM incidents
            WHERE company_id = ?
              AND t_created BETWEEN ? AND ?
              AND t_resolved IS NOT NULL
              AND t_department_assigned IS NOT NULL
              ${departmentFilter}
              ${groupFilter}
          )
        ) as median_resolution_time_minutes,

        -- SLA violations
        COUNT(CASE
          WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 > ?
          THEN 1
        END) as claim_sla_violations,

        COUNT(CASE
          WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 > ?
          THEN 1
        END) as resolution_sla_violations

      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.status NOT IN ('Awaiting_Department')
        ${departmentFilter}
        ${groupFilter}
    `).get(
      claimSlaMinutes,
      claimSlaMinutes,
      ...baseParams,
      ...filterParams,
      ...baseParams,
      ...filterParams,
      resolutionSlaMinutes,
      resolutionSlaMinutes,
      ...baseParams,
      ...filterParams,
      ...baseParams,
      ...filterParams,
      claimSlaMinutes,
      resolutionSlaMinutes,
      ...baseParams,
      ...filterParams
    ) as any;

    // 2. SLA Compliance by Department
    const slaByDepartment = db.prepare(`
      SELECT
        d.department_id,
        d.name as department_name,
        COUNT(*) as total_incidents,

        -- Claim SLA metrics
        COUNT(CASE
          WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= ?
          THEN 1
        END) as claim_sla_met,

        ROUND(
          COUNT(CASE
            WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
              AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= ?
            THEN 1
          END) * 100.0 / NULLIF(COUNT(CASE WHEN i.t_first_claimed IS NOT NULL THEN 1 END), 0),
          2
        ) as claim_sla_compliance_rate,

        ROUND(
          AVG(
            CASE
              WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440
            END
          ),
          2
        ) as avg_time_to_claim_minutes,

        -- Resolution SLA metrics
        COUNT(CASE
          WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= ?
          THEN 1
        END) as resolution_sla_met,

        ROUND(
          COUNT(CASE
            WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= ?
            THEN 1
          END) * 100.0 / NULLIF(COUNT(CASE WHEN i.t_resolved IS NOT NULL THEN 1 END), 0),
          2
        ) as resolution_sla_compliance_rate,

        ROUND(
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
            END
          ),
          2
        ) as avg_resolution_time_minutes

      FROM departments d
      LEFT JOIN incidents i ON d.department_id = i.department_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.status NOT IN ('Awaiting_Department')
        ${groupFilter}
      WHERE d.company_id = ?
        ${departmentFilter.replace('i.department_id', 'd.department_id')}
      GROUP BY d.department_id, d.name
      HAVING total_incidents > 0
      ORDER BY claim_sla_compliance_rate DESC, resolution_sla_compliance_rate DESC
    `).all(
      claimSlaMinutes,
      claimSlaMinutes,
      resolutionSlaMinutes,
      resolutionSlaMinutes,
      ...baseParams,
      session.companyId,
      ...filterParams
    ) as any[];

    // 3. SLA Violations List (detailed)
    const slaViolations = db.prepare(`
      SELECT
        i.incident_id,
        i.status,
        i.description,
        i.t_created,
        i.t_department_assigned,
        i.t_first_claimed,
        i.t_resolved,
        d.name as department_name,
        u.username as created_by_username,
        resolver.username as resolved_by_username,

        -- Time to claim in minutes
        ROUND(
          CASE
            WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440
          END,
          2
        ) as time_to_claim_minutes,

        -- Time to resolution in minutes
        ROUND(
          CASE
            WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
          END,
          2
        ) as time_to_resolution_minutes,

        -- SLA breach indicators
        CASE
          WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 > ?
          THEN 1 ELSE 0
        END as claim_sla_breached,

        CASE
          WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 > ?
          THEN 1 ELSE 0
        END as resolution_sla_breached

      FROM incidents i
      LEFT JOIN departments d ON i.department_id = d.department_id
      LEFT JOIN users u ON i.created_by_id = u.user_id
      LEFT JOIN users resolver ON i.resolved_by_user_id = resolver.user_id
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.status NOT IN ('Awaiting_Department')
        AND (
          (i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 > ?)
          OR
          (i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 > ?)
        )
        ${departmentFilter}
        ${groupFilter}
      ORDER BY time_to_resolution_minutes DESC NULLS LAST, time_to_claim_minutes DESC
      LIMIT 100
    `).all(
      claimSlaMinutes,
      resolutionSlaMinutes,
      ...baseParams,
      claimSlaMinutes,
      resolutionSlaMinutes,
      ...filterParams
    ) as any[];

    // 4. SLA Trends Over Time (daily)
    const slaTrends = db.prepare(`
      SELECT
        DATE(i.t_created) as date,
        COUNT(*) as total_incidents,

        ROUND(
          AVG(
            CASE
              WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
                AND (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= ?
              THEN 1.0 ELSE 0.0
            END
          ) * 100,
          2
        ) as claim_sla_compliance_rate,

        ROUND(
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
                AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= ?
              THEN 1.0 ELSE 0.0
            END
          ) * 100,
          2
        ) as resolution_sla_compliance_rate,

        ROUND(
          AVG(
            CASE
              WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440
            END
          ),
          2
        ) as avg_time_to_claim_minutes,

        ROUND(
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
            END
          ),
          2
        ) as avg_resolution_time_minutes

      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.status NOT IN ('Awaiting_Department')
        ${departmentFilter}
        ${groupFilter}
      GROUP BY DATE(i.t_created)
      ORDER BY date ASC
    `).all(claimSlaMinutes, resolutionSlaMinutes, ...baseParams, ...filterParams) as any[];

    // 5. SLA Performance Distribution (histogram)
    const slaDistribution = db.prepare(`
      SELECT
        'claim' as sla_type,
        CASE
          WHEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 5 THEN '0-5min'
          WHEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 15 THEN '5-15min'
          WHEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 30 THEN '15-30min'
          WHEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 60 THEN '30-60min'
          WHEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440 <= 120 THEN '1-2hr'
          ELSE '2hr+'
        END as time_bucket,
        COUNT(*) as count
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.t_first_claimed IS NOT NULL
        AND i.t_department_assigned IS NOT NULL
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_bucket

      UNION ALL

      SELECT
        'resolution' as sla_type,
        CASE
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 30 THEN '0-30min'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 60 THEN '30-60min'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 120 THEN '1-2hr'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 240 THEN '2-4hr'
          WHEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 480 THEN '4-8hr'
          ELSE '8hr+'
        END as time_bucket,
        COUNT(*) as count
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.t_resolved IS NOT NULL
        AND i.t_department_assigned IS NOT NULL
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_bucket
      ORDER BY sla_type, time_bucket
    `).all(...baseParams, ...filterParams, ...baseParams, ...filterParams) as any[];

    // Format response
    return NextResponse.json({
      metadata: {
        startDate,
        endDate,
        timezone,
        generatedAt: new Date().toISOString(),
        slaThresholds: {
          claimSlaMinutes,
          resolutionSlaMinutes,
        },
        filters: {
          departmentIds: departmentIds || [],
          groupIds: groupIds || [],
        },
      },
      overallCompliance: overallSlaCompliance,
      complianceByDepartment: slaByDepartment,
      violations: slaViolations,
      trends: slaTrends,
      distribution: slaDistribution,
    });
  } catch (error) {
    console.error('SLA report error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
