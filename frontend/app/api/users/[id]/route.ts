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
      SELECT d.*, dm.added_at FROM departments d
      JOIN department_members dm ON d.department_id = dm.department_id
      WHERE dm.user_id = ? AND d.company_id = ?
      ORDER BY d.name
    `).all(id, session.companyId);

    // Get user's groups (active groups they're connected to)
    const groups = db.prepare(`
      SELECT g.* FROM groups g, json_each(?) AS gc
      WHERE gc.value = g.group_id
        AND g.company_id = ?
        AND g.status = 'active'
      ORDER BY g.group_name
    `).all(user.group_connections || '[]', session.companyId);

    // Get user's incident stats
    const createdStats = db.prepare(`
      SELECT
        COUNT(*) as total_created,
        COUNT(CASE WHEN status = 'Resolved' OR status = 'Closed' THEN 1 END) as created_resolved,
        COUNT(CASE WHEN status NOT IN ('Resolved', 'Closed') THEN 1 END) as created_active
      FROM incidents
      WHERE created_by_id = ? AND company_id = ?
    `).get(id, session.companyId) as any;

    const claimedStats = db.prepare(`
      SELECT
        COUNT(DISTINCT ic.incident_id) as total_claimed,
        COUNT(DISTINCT CASE WHEN i.status = 'Resolved' OR i.status = 'Closed' THEN ic.incident_id END) as claimed_resolved,
        COUNT(DISTINCT CASE WHEN i.status NOT IN ('Resolved', 'Closed') THEN ic.incident_id END) as claimed_active
      FROM incident_claims ic
      JOIN incidents i ON ic.incident_id = i.incident_id
      WHERE ic.user_id = ? AND i.company_id = ?
    `).get(id, session.companyId) as any;

    const resolvedByStats = db.prepare(`
      SELECT COUNT(*) as resolved_by_count
      FROM incidents
      WHERE resolved_by_user_id = ? AND company_id = ?
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
      tags: user.tags || '',
      created_at: user.created_at,
      updated_at: user.updated_at,
      departments,
      groups,
      stats: {
        incidents_created: createdStats.total_created || 0,
        incidents_created_resolved: createdStats.created_resolved || 0,
        incidents_created_active: createdStats.created_active || 0,
        incidents_claimed: claimedStats.total_claimed || 0,
        incidents_claimed_resolved: claimedStats.claimed_resolved || 0,
        incidents_claimed_active: claimedStats.claimed_active || 0,
        incidents_resolved_by: resolvedByStats.resolved_by_count || 0,
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

/**
 * PATCH /api/users/:id - Update user tags
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const db = getDatabase();
    const { id } = await params;

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (typeof body.tags !== 'string') {
      return NextResponse.json(
        { error: 'tags must be a string' },
        { status: 400 }
      );
    }

    const normalizedTags = body.tags.replace(/\s+/g, ' ').trim();
    if (normalizedTags.length > 500) {
      return NextResponse.json(
        { error: 'tags must be 500 characters or fewer' },
        { status: 400 }
      );
    }

    const user = db.prepare("SELECT user_id FROM users WHERE user_id = ?").get(id);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users
      SET tags = ?, updated_at = ?
      WHERE user_id = ?
    `).run(normalizedTags, now, id);

    return NextResponse.json({ success: true, tags: normalizedTags });
  } catch (error) {
    console.error('Update user tags error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
