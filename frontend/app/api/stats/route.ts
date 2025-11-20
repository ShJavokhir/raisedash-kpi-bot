import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/stats - Get dashboard statistics for the company
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();

    // Get incident counts by status
    const incidentsByStatus = db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM incidents
      WHERE company_id = ?
      GROUP BY status
    `).all(session.companyId) as any[];

    // Get total incidents
    const totalIncidents = incidentsByStatus.reduce((sum, item) => sum + item.count, 0);

    // Get active incidents count
    const activeIncidents = incidentsByStatus
      .filter(item => !['Resolved', 'Closed'].includes(item.status))
      .reduce((sum, item) => sum + item.count, 0);

    // Get resolved incidents count
    const resolvedIncidents = incidentsByStatus
      .filter(item => ['Resolved', 'Closed'].includes(item.status))
      .reduce((sum, item) => sum + item.count, 0);

    // Get incidents by department
    const incidentsByDepartment = db.prepare(`
      SELECT
        d.name as department_name,
        COUNT(*) as count,
        SUM(CASE WHEN i.status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as active_count
      FROM incidents i
      LEFT JOIN departments d ON i.department_id = d.department_id
      WHERE i.company_id = ?
      GROUP BY i.department_id, d.name
      ORDER BY count DESC
    `).all(session.companyId) as any[];

    // Get recent incidents (last 7 days)
    const recentIncidents = db.prepare(`
      SELECT COUNT(*) as count
      FROM incidents
      WHERE company_id = ?
        AND t_created >= datetime('now', '-7 days')
    `).get(session.companyId) as any;

    // Get average resolution time (in seconds)
    const avgResolutionTime = db.prepare(`
      SELECT
        AVG(CAST((julianday(t_resolved) - julianday(t_created)) * 86400 AS INTEGER)) as avg_seconds
      FROM incidents
      WHERE company_id = ?
        AND t_resolved IS NOT NULL
        AND t_created IS NOT NULL
    `).get(session.companyId) as any;

    // Get top performers (users with most resolved incidents)
    const topPerformers = db.prepare(`
      SELECT
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        COUNT(*) as resolved_count
      FROM incident_participants ip
      JOIN users u ON ip.user_id = u.user_id
      JOIN incidents i ON ip.incident_id = i.incident_id
      WHERE i.company_id = ?
        AND ip.status IN ('resolved_self', 'resolved_other')
      GROUP BY ip.user_id
      ORDER BY resolved_count DESC
      LIMIT 10
    `).all(session.companyId) as any[];

    // Get incidents created over time (last 30 days, grouped by day)
    const incidentsOverTime = db.prepare(`
      SELECT
        DATE(t_created) as date,
        COUNT(*) as count
      FROM incidents
      WHERE company_id = ?
        AND t_created >= datetime('now', '-30 days')
      GROUP BY DATE(t_created)
      ORDER BY date ASC
    `).all(session.companyId) as any[];

    // Get SLA metrics
    const slaMetrics = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN (julianday(COALESCE(t_first_claimed, datetime('now'))) - julianday(t_created)) * 1440 <= 30 THEN 1 ELSE 0 END) as claimed_within_30min,
        SUM(CASE WHEN (julianday(COALESCE(t_resolved, datetime('now'))) - julianday(t_created)) * 1440 <= 120 THEN 1 ELSE 0 END) as resolved_within_2hr
      FROM incidents
      WHERE company_id = ?
        AND status NOT IN ('Awaiting_Department')
    `).get(session.companyId) as any;

    const claimSLA = slaMetrics.total > 0
      ? (slaMetrics.claimed_within_30min / slaMetrics.total * 100).toFixed(1)
      : 0;

    const resolutionSLA = slaMetrics.total > 0
      ? (slaMetrics.resolved_within_2hr / slaMetrics.total * 100).toFixed(1)
      : 0;

    return NextResponse.json({
      overview: {
        total_incidents: totalIncidents,
        active_incidents: activeIncidents,
        resolved_incidents: resolvedIncidents,
        recent_incidents: recentIncidents.count,
        avg_resolution_time_seconds: avgResolutionTime.avg_seconds || 0,
      },
      incidentsByStatus,
      incidentsByDepartment,
      topPerformers,
      incidentsOverTime,
      sla: {
        claim_rate: parseFloat(claimSLA),
        resolution_rate: parseFloat(resolutionSLA),
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
