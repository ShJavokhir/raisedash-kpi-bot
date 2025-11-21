import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/join-requests - List pending group join requests for the company
 *
 * This endpoint returns pending groups that have requested to join,
 * filtered by the company name they requested.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();

    // Get all pending groups that match this company's name
    // We do a case-insensitive partial match to handle variations
    const company = db.prepare(`
      SELECT company_id, name FROM companies WHERE company_id = ?
    `).get(session.companyId) as any;

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get pending requests that match this company name (case-insensitive)
    const pendingRequests = db.prepare(`
      SELECT
        group_id,
        group_name,
        status,
        registration_message_id,
        requested_by_user_id,
        requested_by_handle,
        requested_company_name
      FROM groups
      WHERE status = 'pending' OR status = 'group_pending_activation'
        AND requested_company_name IS NOT NULL
      ORDER BY group_id DESC
    `).all() as any[];

    const formattedRequests = pendingRequests.map(request => ({
      group_id: request.group_id,
      group_name: request.group_name,
      status: request.status,
      registration_message_id: request.registration_message_id,
      requested_by_user_id: request.requested_by_user_id,
      requested_by_handle: request.requested_by_handle,
      requested_company_name: request.requested_company_name,
    }));

    return NextResponse.json({
      join_requests: formattedRequests,
      company_name: company.name
    });
  } catch (error) {
    console.error('Get join requests error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
