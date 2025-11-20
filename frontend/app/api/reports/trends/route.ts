import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/reports/trends - Get incident trends and analytics report
 *
 * Query parameters:
 * - startDate: ISO 8601 timestamp (required)
 * - endDate: ISO 8601 timestamp (required)
 * - timezone: IANA timezone string (e.g., 'America/New_York', 'UTC')
 * - granularity: 'hour' | 'day' | 'week' | 'month' (default: 'day')
 * - departmentIds: Comma-separated department IDs (optional)
 * - groupIds: Comma-separated group IDs (optional)
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
    const granularity = searchParams.get('granularity') || 'day';
    const departmentIds = searchParams.get('departmentIds')?.split(',').filter(Boolean);
    const groupIds = searchParams.get('groupIds')?.split(',').filter(Boolean);

    // Validate required parameters
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    // Validate granularity
    if (!['hour', 'day', 'week', 'month'].includes(granularity)) {
      return NextResponse.json(
        { error: 'granularity must be one of: hour, day, week, month' },
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

    // Determine time grouping based on granularity
    const timeGroupingMap: Record<string, string> = {
      hour: "strftime('%Y-%m-%d %H:00:00', i.t_created)",
      day: "DATE(i.t_created)",
      week: "strftime('%Y-W%W', i.t_created)",
      month: "strftime('%Y-%m', i.t_created)",
    };
    const timeGrouping = timeGroupingMap[granularity] || timeGroupingMap['day'];

    // 1. Incident Volume Trends
    const volumeTrends = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,
        COUNT(*) as incidents_created,
        COUNT(CASE WHEN i.t_first_claimed IS NOT NULL THEN 1 END) as incidents_claimed,
        COUNT(CASE WHEN i.t_resolved IS NOT NULL THEN 1 END) as incidents_resolved,
        COUNT(CASE WHEN i.status NOT IN ('Resolved', 'Closed') THEN 1 END) as incidents_still_active
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period
      ORDER BY time_period ASC
    `).all(...baseParams, ...filterParams) as any[];

    // 2. Status Distribution Over Time
    const statusDistributionOverTime = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,
        i.status,
        COUNT(*) as count
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period, i.status
      ORDER BY time_period ASC, count DESC
    `).all(...baseParams, ...filterParams) as any[];

    // 3. Peak Activity Analysis (hour of day × day of week heatmap)
    const peakActivityHeatmap = db.prepare(`
      SELECT
        CAST(strftime('%w', i.t_created) AS INTEGER) as day_of_week,
        CAST(strftime('%H', i.t_created) AS INTEGER) as hour_of_day,
        COUNT(*) as incident_count,
        COUNT(CASE WHEN i.t_resolved IS NOT NULL THEN 1 END) as resolved_count
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY day_of_week, hour_of_day
      ORDER BY day_of_week, hour_of_day
    `).all(...baseParams, ...filterParams) as any[];

    // 4. Lifecycle Duration Trends
    const lifecycleTrends = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,

        -- Average time to claim
        AVG(
          CASE
            WHEN i.t_first_claimed IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_first_claimed) - julianday(i.t_department_assigned)) * 1440
          END
        ) as avg_time_to_claim_minutes,

        -- Average resolution time
        AVG(
          CASE
            WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
          END
        ) as avg_resolution_time_minutes,

        -- Average total lifecycle
        AVG(
          CASE
            WHEN i.t_resolved IS NOT NULL
            THEN (julianday(i.t_resolved) - julianday(i.t_created)) * 1440
          END
        ) as avg_total_lifecycle_minutes

      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period
      ORDER BY time_period ASC
    `).all(...baseParams, ...filterParams) as any[];

    // 5. Backlog Analysis (cumulative over time)
    const backlogAnalysis = db.prepare(`
      WITH date_series AS (
        SELECT DISTINCT ${timeGrouping} as time_period
        FROM incidents
        WHERE company_id = ?
          AND t_created BETWEEN ? AND ?
        ORDER BY time_period
      )
      SELECT
        ds.time_period,
        (
          SELECT COUNT(*)
          FROM incidents i
          WHERE i.company_id = ?
            AND i.t_created <= ds.time_period
            ${departmentFilter}
            ${groupFilter}
        ) as cumulative_created,
        (
          SELECT COUNT(*)
          FROM incidents i
          WHERE i.company_id = ?
            AND i.t_resolved <= ds.time_period
            ${departmentFilter}
            ${groupFilter}
        ) as cumulative_resolved,
        (
          SELECT COUNT(*)
          FROM incidents i
          WHERE i.company_id = ?
            AND i.t_created <= ds.time_period
            AND (i.t_resolved IS NULL OR i.t_resolved > ds.time_period)
            ${departmentFilter}
            ${groupFilter}
        ) as active_backlog
      FROM date_series ds
      ORDER BY ds.time_period ASC
    `).all(
      ...baseParams,
      ...baseParams, ...filterParams,
      ...baseParams, ...filterParams,
      ...baseParams, ...filterParams
    ) as any[];

    // 6. Creation vs Resolution Rate
    const creationVsResolution = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,
        COUNT(*) as created_count,
        (
          SELECT COUNT(*)
          FROM incidents i2
          WHERE i2.company_id = ?
            AND DATE(i2.t_resolved) = ${timeGrouping.replace('i.t_created', 'i.t_resolved')}
            ${departmentFilter.replace('i.', 'i2.')}
            ${groupFilter.replace('i.', 'i2.')}
        ) as resolved_count,
        (
          COUNT(*) - (
            SELECT COUNT(*)
            FROM incidents i2
            WHERE i2.company_id = ?
              AND DATE(i2.t_resolved) = ${timeGrouping.replace('i.t_created', 'i.t_resolved')}
              ${departmentFilter.replace('i.', 'i2.')}
              ${groupFilter.replace('i.', 'i2.')}
          )
        ) as net_change
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period
      ORDER BY time_period ASC
    `).all(session.companyId, session.companyId, ...baseParams, ...filterParams) as any[];

    // 7. Department Activity Trends
    const departmentActivityTrends = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,
        d.department_id,
        d.name as department_name,
        COUNT(*) as incident_count,
        COUNT(CASE WHEN i.t_resolved IS NOT NULL THEN 1 END) as resolved_count,
        AVG(
          CASE
            WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
            THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440
          END
        ) as avg_resolution_time_minutes
      FROM incidents i
      LEFT JOIN departments d ON i.department_id = d.department_id
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period, d.department_id, d.name
      ORDER BY time_period ASC, incident_count DESC
    `).all(...baseParams, ...filterParams) as any[];

    // 8. User Activity Trends
    const userActivityTrends = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,
        COUNT(DISTINCT ip.user_id) as active_users,
        COUNT(DISTINCT ip.incident_id) as incidents_with_participation,
        SUM(COALESCE(ip.total_active_seconds, 0)) as total_active_seconds
      FROM incident_participants ip
      JOIN incidents i ON ip.incident_id = i.incident_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period
      ORDER BY time_period ASC
    `).all(...baseParams, ...filterParams) as any[];

    // 9. Transfer/Escalation Trends
    const transferTrends = db.prepare(`
      SELECT
        ${timeGrouping.replace('i.t_created', 'ie.at')} as time_period,
        COUNT(*) as transfer_count,
        COUNT(DISTINCT ie.incident_id) as incidents_transferred
      FROM incident_events ie
      JOIN incidents i ON ie.incident_id = i.incident_id
        AND i.company_id = ?
      WHERE ie.event_type = 'department_assigned'
        AND ie.at BETWEEN ? AND ?
        AND EXISTS (
          SELECT 1 FROM incident_events ie2
          WHERE ie2.incident_id = ie.incident_id
            AND ie2.event_type = 'department_assigned'
            AND ie2.event_id < ie.event_id
        )
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period
      ORDER BY time_period ASC
    `).all(...baseParams, ...filterParams) as any[];

    // 10. Average Response Time Trends
    const responseTimeTrends = db.prepare(`
      SELECT
        ${timeGrouping} as time_period,
        AVG((julianday(i.t_first_claimed) - julianday(i.t_created)) * 1440) as avg_first_response_minutes,
        MIN((julianday(i.t_first_claimed) - julianday(i.t_created)) * 1440) as min_first_response_minutes,
        MAX((julianday(i.t_first_claimed) - julianday(i.t_created)) * 1440) as max_first_response_minutes
      FROM incidents i
      WHERE i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        AND i.t_first_claimed IS NOT NULL
        ${departmentFilter}
        ${groupFilter}
      GROUP BY time_period
      ORDER BY time_period ASC
    `).all(...baseParams, ...filterParams) as any[];

    // Format response
    return NextResponse.json({
      metadata: {
        startDate,
        endDate,
        timezone,
        granularity,
        generatedAt: new Date().toISOString(),
        filters: {
          departmentIds: departmentIds || [],
          groupIds: groupIds || [],
        },
      },
      volumeTrends,
      statusDistributionOverTime,
      peakActivityHeatmap,
      lifecycleTrends,
      backlogAnalysis,
      creationVsResolution,
      departmentActivityTrends,
      userActivityTrends,
      transferTrends,
      responseTimeTrends,
    });
  } catch (error) {
    console.error('Trends report error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
