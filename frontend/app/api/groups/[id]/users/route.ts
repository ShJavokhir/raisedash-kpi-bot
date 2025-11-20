import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/groups/:id/users - Get all users who have created incidents in a group
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;
    const groupId = parseInt(id);

    if (isNaN(groupId)) {
      return NextResponse.json({ error: 'Invalid group ID' }, { status: 400 });
    }

    // Verify group belongs to company
    const group = db.prepare(`
      SELECT group_id FROM groups
      WHERE group_id = ? AND company_id = ?
    `).get(groupId, session.companyId);

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Get all users who have created incidents in this group
    const users = db.prepare(`
      SELECT DISTINCT
        u.user_id,
        u.telegram_handle,
        u.first_name,
        u.last_name,
        u.username
      FROM users u
      INNER JOIN incidents i ON u.user_id = i.created_by_id
      WHERE i.group_id = ?
      ORDER BY u.first_name, u.last_name, u.telegram_handle
    `).all(groupId);

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Get group users error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
