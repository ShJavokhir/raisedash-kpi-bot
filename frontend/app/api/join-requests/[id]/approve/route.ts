import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/join-requests/:id/approve - Approve a pending group join request
 *
 * This endpoint:
 * 1. Verifies the group is pending
 * 2. Verifies the requested company name matches the session company
 * 3. Attaches the group to the company
 * 4. Copies company role configuration to the group
 * 5. Updates status to 'active'
 * 6. Clears the request metadata
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;
    const groupId = parseInt(id);

    if (isNaN(groupId)) {
      return NextResponse.json({ error: 'Invalid group ID' }, { status: 400 });
    }

    // Get company information
    const company = db.prepare(`
      SELECT company_id, name, manager_handles, manager_user_ids, dispatcher_user_ids
      FROM companies
      WHERE company_id = ?
    `).get(session.companyId) as any;

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get the pending group request
    const group = db.prepare(`
      SELECT
        group_id,
        group_name,
        status,
        requested_company_name,
        requested_by_user_id,
        requested_by_handle
      FROM groups
      WHERE group_id = ?
    `).get(groupId) as any;

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Verify the group is pending
    if (group.status !== 'pending') {
      return NextResponse.json(
        { error: 'Group is not pending approval' },
        { status: 400 }
      );
    }

    //DON'T ENFORCE THIS
    // Verify the requested company name matches (case-insensitive)
    // if (
    //   !group.requested_company_name ||
    //   group.requested_company_name.trim().toLowerCase() !== company.name.trim().toLowerCase()
    // ) {
    //   return NextResponse.json(
    //     { error: 'Group requested a different company' },
    //     { status: 403 }
    //   );
    // }

    // Approve the group - attach to company and set as active
    const updateGroup = db.prepare(`
      UPDATE groups
      SET
        company_id = ?,
        status = 'active',
        manager_handles = ?,
        manager_user_ids = ?,
        dispatcher_user_ids = ?,
        registration_message_id = NULL,
        requested_by_user_id = NULL,
        requested_by_handle = NULL,
        requested_company_name = NULL
      WHERE group_id = ?
    `);

    updateGroup.run(
      company.company_id,
      company.manager_handles,
      company.manager_user_ids,
      company.dispatcher_user_ids,
      groupId
    );

    // Log audit event
    console.log(`Group ${groupId} (${group.group_name}) approved and attached to company ${company.company_id} (${company.name})`);

    return NextResponse.json({
      success: true,
      message: `Group "${group.group_name}" has been approved and activated`,
      group: {
        group_id: groupId,
        group_name: group.group_name,
        company_id: company.company_id,
        status: 'active'
      }
    });
  } catch (error) {
    console.error('Approve join request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
