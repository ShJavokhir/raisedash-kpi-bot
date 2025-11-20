import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON, type Group } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/groups - List all groups for the company
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();

    const groups = db.prepare(`
      SELECT * FROM groups
      WHERE company_id = ?
      ORDER BY group_name ASC
    `).all(session.companyId) as Group[];

    const formattedGroups = groups.map(group => ({
      group_id: group.group_id,
      group_name: group.group_name,
      manager_handles: parseJSON(group.manager_handles, []),
      manager_user_ids: parseJSON(group.manager_user_ids, []),
      dispatcher_user_ids: parseJSON(group.dispatcher_user_ids, []),
      company_id: group.company_id,
      status: group.status,
      registration_message_id: group.registration_message_id,
      requested_by_user_id: group.requested_by_user_id,
      requested_by_handle: group.requested_by_handle,
      requested_company_name: group.requested_company_name,
    }));

    return NextResponse.json({ groups: formattedGroups });
  } catch (error) {
    console.error('Get groups error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
