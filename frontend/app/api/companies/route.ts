import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON, type Company } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/companies - Get current company information
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();

    const company = db.prepare(`
      SELECT * FROM companies WHERE company_id = ?
    `).get(session.companyId) as Company;

    if (!company) {
      return NextResponse.json(
        { error: 'Company not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      company_id: company.company_id,
      name: company.name,
      manager_handles: parseJSON(company.manager_handles, []),
      manager_user_ids: parseJSON(company.manager_user_ids, []),
      dispatcher_user_ids: parseJSON(company.dispatcher_user_ids, []),
      metadata: parseJSON(company.metadata, {}),
      created_at: company.created_at,
      updated_at: company.updated_at,
    });
  } catch (error) {
    console.error('Get company error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/companies - Update company information
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const body = await request.json();

    const { manager_handles, manager_user_ids, dispatcher_user_ids, metadata } = body;

    db.prepare(`
      UPDATE companies
      SET
        manager_handles = ?,
        manager_user_ids = ?,
        dispatcher_user_ids = ?,
        metadata = ?,
        updated_at = datetime('now')
      WHERE company_id = ?
    `).run(
      JSON.stringify(manager_handles || []),
      JSON.stringify(manager_user_ids || []),
      JSON.stringify(dispatcher_user_ids || []),
      JSON.stringify(metadata || {}),
      session.companyId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update company error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
