import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/reports/user - Get user performance report
 *
 * Query parameters:
 * - startDate: ISO 8601 timestamp (required)
 * - endDate: ISO 8601 timestamp (required)
 * - timezone: IANA timezone string (e.g., 'America/New_York', 'UTC')
 * - userIds: Comma-separated user IDs (optional, filter specific users)
 * - departmentIds: Comma-separated department IDs (optional, filter by departments)
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
    const userIds = searchParams.get('userIds')?.split(',').filter(Boolean);
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
    const userFilter = userIds && userIds.length > 0
      ? `AND u.user_id IN (${userIds.map(() => '?').join(',')})`
      : '';

    const departmentFilter = departmentIds && departmentIds.length > 0
      ? `AND ip.department_id IN (${departmentIds.map(() => '?').join(',')})`
      : '';

    const groupFilter = groupIds && groupIds.length > 0
      ? `AND i.group_id IN (${groupIds.map(() => '?').join(',')})`
      : '';

    // Prepare query parameters array
    const baseParams = [session.companyId, startDate, endDate];
    const filterParams = [...(userIds || []), ...(departmentIds || []), ...(groupIds || [])];

    // 1. User Performance Summary with Rankings
    const userPerformanceSummary = db.prepare(`
      WITH user_metrics AS (
        SELECT
          u.user_id,
          u.username,
          u.first_name,
          u.last_name,
          u.telegram_handle,
          u.team_role,
          d.department_id,
          d.name as department_name,

          -- Total incidents participated in
          COUNT(DISTINCT ip.incident_id) as total_participated,

          -- Incidents resolved by this user
          COUNT(DISTINCT CASE WHEN ip.status = 'resolved_self' THEN ip.incident_id END) as incidents_resolved_self,

          -- Incidents resolved by others (user participated but didn't resolve)
          COUNT(DISTINCT CASE WHEN ip.status = 'resolved_other' THEN ip.incident_id END) as incidents_resolved_other,

          -- Total active time in seconds
          SUM(COALESCE(ip.total_active_seconds, 0)) as total_active_seconds,

          -- Average join count (how many times user rejoined incidents)
          ROUND(AVG(COALESCE(ip.join_count, 0)), 2) as avg_join_count,

          -- Average resolution time for incidents resolved by this user
          AVG(
            CASE
              WHEN ip.status = 'resolved_self' AND i.t_resolved IS NOT NULL AND ip.first_claimed_at IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(ip.first_claimed_at)) * 86400
              ELSE NULL
            END
          ) as avg_resolution_time_seconds,

          -- SLA compliance rate for incidents resolved by this user
          ROUND(
            AVG(
              CASE
                WHEN ip.status = 'resolved_self' AND i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
                  AND (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 1440 <= 120
                THEN 1.0
                ELSE 0.0
              END
            ) * 100, 2
          ) as sla_compliance_rate,

          -- Resolution rate (resolved_self / total_participated)
          ROUND(
            COUNT(DISTINCT CASE WHEN ip.status = 'resolved_self' THEN ip.incident_id END) * 100.0 /
            NULLIF(COUNT(DISTINCT ip.incident_id), 0),
            2
          ) as resolution_rate_percentage

        FROM users u
        LEFT JOIN incident_participants ip ON u.user_id = ip.user_id
        LEFT JOIN incidents i ON ip.incident_id = i.incident_id
          AND i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
          ${groupFilter.replace('i.group_id', 'i.group_id')}
        LEFT JOIN department_members dm ON u.user_id = dm.user_id
        LEFT JOIN departments d ON dm.department_id = d.department_id
        WHERE EXISTS (
          SELECT 1 FROM incident_participants ip2
          JOIN incidents i2 ON ip2.incident_id = i2.incident_id
          WHERE ip2.user_id = u.user_id
            AND i2.company_id = ?
            AND i2.t_created BETWEEN ? AND ?
        )
        ${userFilter}
        ${departmentFilter}
        GROUP BY u.user_id, u.username, u.first_name, u.last_name, u.telegram_handle, u.team_role, d.department_id, d.name
      ),
      ranked_users AS (
        SELECT
          *,
          -- Productivity score: weighted combination of metrics
          ROUND(
            (incidents_resolved_self * 10) +
            (total_active_seconds / 3600.0 * 2) +
            (COALESCE(sla_compliance_rate, 0) * 0.5) -
            (CASE WHEN avg_resolution_time_seconds > 7200 THEN 5 ELSE 0 END),
            2
          ) as productivity_score,
          ROW_NUMBER() OVER (ORDER BY incidents_resolved_self DESC, total_active_seconds DESC) as overall_rank,
          ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY incidents_resolved_self DESC, total_active_seconds DESC) as department_rank
        FROM user_metrics
      )
      SELECT * FROM ranked_users
      ORDER BY productivity_score DESC, incidents_resolved_self DESC
    `).all(...baseParams, ...baseParams, ...filterParams) as any[];

    // 2. User Activity Timeline (daily breakdown)
    const userActivityTimeline = db.prepare(`
      SELECT
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        DATE(i.t_created) as date,
        COUNT(DISTINCT ip.incident_id) as incidents_participated,
        COUNT(DISTINCT CASE WHEN ip.status = 'resolved_self' THEN ip.incident_id END) as incidents_resolved,
        SUM(COALESCE(ip.total_active_seconds, 0)) as daily_active_seconds
      FROM users u
      JOIN incident_participants ip ON u.user_id = ip.user_id
      JOIN incidents i ON ip.incident_id = i.incident_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${groupFilter}
      WHERE 1=1
        ${userFilter}
        ${departmentFilter}
      GROUP BY u.user_id, u.username, u.first_name, u.last_name, DATE(i.t_created)
      ORDER BY u.user_id, date ASC
    `).all(...baseParams, ...filterParams) as any[];

    // 3. Activity Heatmap Data (hour of day × day of week)
    const activityHeatmap = db.prepare(`
      SELECT
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        CAST(strftime('%w', i.t_created) AS INTEGER) as day_of_week, -- 0=Sunday, 6=Saturday
        CAST(strftime('%H', i.t_created) AS INTEGER) as hour_of_day,
        COUNT(DISTINCT ip.incident_id) as incident_count
      FROM users u
      JOIN incident_participants ip ON u.user_id = ip.user_id
      JOIN incidents i ON ip.incident_id = i.incident_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${groupFilter}
      WHERE 1=1
        ${userFilter}
        ${departmentFilter}
      GROUP BY u.user_id, u.username, u.first_name, u.last_name, day_of_week, hour_of_day
      ORDER BY u.user_id, day_of_week, hour_of_day
    `).all(...baseParams, ...filterParams) as any[];

    // 4. User Participation Patterns
    const participationPatterns = db.prepare(`
      SELECT
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        ip.status,
        COUNT(*) as count
      FROM users u
      JOIN incident_participants ip ON u.user_id = ip.user_id
      JOIN incidents i ON ip.incident_id = i.incident_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${groupFilter}
      WHERE 1=1
        ${userFilter}
        ${departmentFilter}
      GROUP BY u.user_id, u.username, u.first_name, u.last_name, ip.status
      ORDER BY u.user_id, count DESC
    `).all(...baseParams, ...filterParams) as any[];

    // 5. Collaboration Metrics (users who worked together on incidents)
    const collaborationMetrics = db.prepare(`
      SELECT
        u1.user_id as user_id,
        u1.username as username,
        u1.first_name as first_name,
        u1.last_name as last_name,
        u2.user_id as collaborated_with_user_id,
        u2.username as collaborated_with_username,
        u2.first_name as collaborated_with_first_name,
        u2.last_name as collaborated_with_last_name,
        COUNT(DISTINCT ip1.incident_id) as shared_incidents
      FROM users u1
      JOIN incident_participants ip1 ON u1.user_id = ip1.user_id
      JOIN incident_participants ip2 ON ip1.incident_id = ip2.incident_id AND ip1.user_id != ip2.user_id
      JOIN users u2 ON ip2.user_id = u2.user_id
      JOIN incidents i ON ip1.incident_id = i.incident_id
        AND i.company_id = ?
        AND i.t_created BETWEEN ? AND ?
        ${groupFilter}
      WHERE 1=1
        ${userFilter}
      GROUP BY u1.user_id, u2.user_id
      HAVING shared_incidents >= 2
      ORDER BY shared_incidents DESC
      LIMIT 100
    `).all(...baseParams, ...filterParams) as any[];

    // 6. Resolution Time Comparison (user vs department average)
    const resolutionTimeComparison = db.prepare(`
      WITH user_avg AS (
        SELECT
          u.user_id,
          AVG(
            CASE
              WHEN ip.status = 'resolved_self' AND i.t_resolved IS NOT NULL AND ip.first_claimed_at IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(ip.first_claimed_at)) * 86400
              ELSE NULL
            END
          ) as user_avg_resolution_seconds
        FROM users u
        JOIN incident_participants ip ON u.user_id = ip.user_id
        JOIN incidents i ON ip.incident_id = i.incident_id
          AND i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
        GROUP BY u.user_id
      ),
      dept_avg AS (
        SELECT
          ip.department_id,
          AVG(
            CASE
              WHEN i.t_resolved IS NOT NULL AND i.t_department_assigned IS NOT NULL
              THEN (julianday(i.t_resolved) - julianday(i.t_department_assigned)) * 86400
              ELSE NULL
            END
          ) as dept_avg_resolution_seconds
        FROM incident_participants ip
        JOIN incidents i ON ip.incident_id = i.incident_id
          AND i.company_id = ?
          AND i.t_created BETWEEN ? AND ?
        GROUP BY ip.department_id
      )
      SELECT
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        dm.department_id,
        d.name as department_name,
        ua.user_avg_resolution_seconds,
        da.dept_avg_resolution_seconds,
        ROUND(
          ((ua.user_avg_resolution_seconds - da.dept_avg_resolution_seconds) /
          NULLIF(da.dept_avg_resolution_seconds, 0)) * 100,
          2
        ) as performance_vs_dept_percentage
      FROM users u
      LEFT JOIN user_avg ua ON u.user_id = ua.user_id
      LEFT JOIN department_members dm ON u.user_id = dm.user_id
      LEFT JOIN departments d ON dm.department_id = d.department_id
      LEFT JOIN dept_avg da ON dm.department_id = da.department_id
      WHERE ua.user_avg_resolution_seconds IS NOT NULL
        ${userFilter}
      ORDER BY performance_vs_dept_percentage ASC
    `).all(...baseParams, ...baseParams, ...filterParams) as any[];

    // Format response
    return NextResponse.json({
      metadata: {
        startDate,
        endDate,
        timezone,
        generatedAt: new Date().toISOString(),
        filters: {
          userIds: userIds || [],
          departmentIds: departmentIds || [],
          groupIds: groupIds || [],
        },
      },
      summary: userPerformanceSummary,
      activityTimeline: userActivityTimeline,
      activityHeatmap,
      participationPatterns,
      collaborationMetrics,
      resolutionTimeComparison,
    });
  } catch (error) {
    console.error('User report error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
