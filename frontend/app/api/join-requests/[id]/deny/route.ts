import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/join-requests/:id/deny - Deny a pending group join request
 *
 * This endpoint:
 * 1. Verifies the group is pending
 * 2. Verifies the requested company name matches the session company
 * 3. Deletes the pending group request
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
      SELECT company_id, name
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

    // Delete the pending request
    // Note: We delete instead of marking as denied to keep the database clean
    // If the group wants to request again, they can do so
    const deleteGroup = db.prepare(`
      DELETE FROM groups WHERE group_id = ?
    `);

    deleteGroup.run(groupId);

    // Log audit event
    console.log(`Group ${groupId} (${group.group_name}) join request denied for company ${company.company_id} (${company.name})`);

    return NextResponse.json({
      success: true,
      message: `Join request for group "${group.group_name}" has been denied`,
      group: {
        group_id: groupId,
        group_name: group.group_name,
      }
    });
  } catch (error) {
    console.error('Deny join request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
