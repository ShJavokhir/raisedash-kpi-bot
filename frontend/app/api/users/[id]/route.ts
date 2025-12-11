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
    const idNum = Number(id);

    const user = db.prepare(`
      SELECT * FROM users WHERE user_id = ?
    `).get(id) as User & { manager_user_id?: number | null; manager_label?: string | null };

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Resolve manager details (if any)
    let manager: any = null;
    if (user.manager_user_id) {
      manager = db.prepare(`
        SELECT user_id, username, telegram_handle, first_name, last_name
        FROM users
        WHERE user_id = ?
      `).get(user.manager_user_id);
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
      manager_user_id: user.manager_user_id ?? null,
      manager_label: user.manager_label ?? null,
      manager: manager
        ? {
            user_id: manager.user_id,
            username: manager.username,
            telegram_handle: manager.telegram_handle,
            first_name: manager.first_name,
            last_name: manager.last_name,
          }
        : null,
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
    const idNum = Number(id);

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const user = db.prepare("SELECT user_id, manager_user_id, manager_label FROM users WHERE user_id = ?").get(id);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const updates: string[] = [];
    const paramsToSet: any[] = [];

    let normalizedTags: string | null = null;

    // Tags update (optional)
    if (body.tags !== undefined) {
      if (typeof body.tags !== 'string') {
        return NextResponse.json(
          { error: 'tags must be a string' },
          { status: 400 }
        );
      }
      normalizedTags = body.tags.replace(/\s+/g, ' ').trim();
      if (normalizedTags && normalizedTags.length > 500) {
        return NextResponse.json(
          { error: 'tags must be 500 characters or fewer' },
          { status: 400 }
        );
      }
      updates.push('tags = ?');
      paramsToSet.push(normalizedTags);
    }

    // Manager update (optional)
    if (body.manager_user_id !== undefined || body.manager_label !== undefined) {
      const newManager = body.manager_user_id;
      const newLabelRaw = body.manager_label;

      // Reject only when both are provided and both are non-null (conflicting intent)
      if (newManager !== undefined && newLabelRaw !== undefined && newManager !== null && newLabelRaw !== null) {
        return NextResponse.json(
          { error: 'Provide only one of manager_user_id or manager_label' },
          { status: 400 }
        );
      }

      if (newManager !== undefined && newManager !== null && typeof newManager !== 'number') {
        return NextResponse.json(
          { error: 'manager_user_id must be a number or null' },
          { status: 400 }
        );
      }
      if (newManager === idNum) {
        return NextResponse.json(
          { error: 'User cannot be their own manager' },
          { status: 400 }
        );
      }
      if (newManager !== undefined && newManager !== null) {
        const managerRow = db.prepare("SELECT user_id, manager_user_id FROM users WHERE user_id = ?").get(newManager) as { user_id: number; manager_user_id: number | null } | undefined;
        if (!managerRow) {
          return NextResponse.json(
            { error: 'Manager user not found' },
            { status: 404 }
          );
        }
        // Cycle detection
        let cursor: number | null = managerRow.manager_user_id;
        const visited = new Set<number>([idNum]);
        let depth = 0;
        while (cursor) {
          if (visited.has(cursor)) {
            return NextResponse.json(
              { error: 'Manager assignment would create a cycle' },
              { status: 400 }
            );
          }
          visited.add(cursor);
          const nextRow = db.prepare("SELECT manager_user_id FROM users WHERE user_id = ?").get(cursor) as { manager_user_id: number | null } | undefined;
          cursor = nextRow?.manager_user_id ?? null;
          depth += 1;
          if (depth > 1000) {
            return NextResponse.json(
              { error: 'Cycle detection limit exceeded' },
              { status: 400 }
            );
          }
        }
      }

      let normalizedLabel: string | null = null;
      if (newLabelRaw !== undefined) {
        if (newLabelRaw === null) {
          normalizedLabel = null;
        } else if (typeof newLabelRaw !== 'string') {
          return NextResponse.json(
            { error: 'manager_label must be a string or null' },
            { status: 400 }
          );
        } else {
          normalizedLabel = newLabelRaw.trim();
          if (normalizedLabel.length === 0) {
            normalizedLabel = null;
          } else if (normalizedLabel.length > 100) {
            return NextResponse.json(
              { error: 'manager_label must be 100 characters or fewer' },
              { status: 400 }
            );
          }
        }
      }

      // Apply intent:
      // - If manager_user_id specified: set it and clear label
      if (newManager !== undefined) {
        updates.push('manager_user_id = ?');
        paramsToSet.push(newManager);
        updates.push('manager_label = NULL');
      }
      // - If label specified (even null): set label; if non-null, clear user manager; if null, leave manager as-is unless above cleared it
      if (newLabelRaw !== undefined) {
        updates.push('manager_label = ?');
        paramsToSet.push(normalizedLabel);
        if (normalizedLabel !== null) {
          updates.push('manager_user_id = NULL');
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    paramsToSet.push(now, id);

    const setClause = updates.join(', ');
    db.prepare(`
      UPDATE users
      SET ${setClause}
      WHERE user_id = ?
    `).run(...paramsToSet);

    // Return fresh row to avoid stale echoes
    const updated = db.prepare(`SELECT manager_user_id, manager_label, tags FROM users WHERE user_id = ?`).get(id) as { manager_user_id: number | null; manager_label: string | null; tags: string | null };
    const tagsValue = updated?.tags ?? normalizedTags ?? (typeof body.tags === 'string' ? body.tags : null);

    return NextResponse.json({
      success: true,
      tags: tagsValue,
      manager_user_id: updated?.manager_user_id ?? null,
      manager_label: updated?.manager_label ?? null,
    });
  } catch (error) {
    console.error('Update user tags error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
