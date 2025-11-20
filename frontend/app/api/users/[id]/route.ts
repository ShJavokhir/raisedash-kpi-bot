import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON, type User } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/users/:id - Get a specific user's details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;

    const user = db.prepare(`
      SELECT * FROM users WHERE user_id = ?
    `).get(id) as User;

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get user's departments
    const departments = db.prepare(`
      SELECT d.* FROM departments d
      JOIN department_members dm ON d.department_id = dm.department_id
      WHERE dm.user_id = ? AND d.company_id = ?
    `).all(id, session.companyId);

    // Get user's incident stats
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT CASE WHEN ip.status IN ('active', 'resolved_self', 'resolved_other') THEN i.incident_id END) as total_incidents,
        COUNT(DISTINCT CASE WHEN ip.status = 'resolved_self' THEN i.incident_id END) as resolved_incidents,
        COUNT(DISTINCT CASE WHEN ip.is_active = 1 THEN i.incident_id END) as active_incidents
      FROM incident_participants ip
      JOIN incidents i ON ip.incident_id = i.incident_id
      WHERE ip.user_id = ? AND i.company_id = ?
    `).get(id, session.companyId) as any;

    return NextResponse.json({
      user_id: user.user_id,
      telegram_handle: user.telegram_handle,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      language_code: user.language_code,
      is_bot: user.is_bot,
      team_role: user.team_role,
      group_connections: parseJSON(user.group_connections, []),
      created_at: user.created_at,
      updated_at: user.updated_at,
      departments,
      stats: {
        total_incidents: stats.total_incidents || 0,
        resolved_incidents: stats.resolved_incidents || 0,
        active_incidents: stats.active_incidents || 0,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
