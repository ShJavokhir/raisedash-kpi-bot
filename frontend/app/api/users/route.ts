import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON, type User } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/users - List all users
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();

    // Get all users and relevant department memberships, no company filter
    const users = db.prepare(`
      SELECT
        u.*,
        GROUP_CONCAT(DISTINCT dm.department_id) as department_ids
      FROM users u
      LEFT JOIN department_members dm ON u.user_id = dm.user_id
      GROUP BY u.user_id
      ORDER BY u.first_name, u.last_name
    `).all() as any[];

    const formattedUsers = users.map(user => ({
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
      department_ids: user.department_ids ? user.department_ids.split(',').map(Number) : [],
    }));

    return NextResponse.json({ users: formattedUsers });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
