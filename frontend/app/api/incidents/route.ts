import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, type Incident } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/incidents - List all incidents for the company with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const departmentId = searchParams.get('department_id');
    const groupId = searchParams.get('group_id');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = `
      SELECT
        i.*,
        d.name as department_name,
        g.group_name,
        u_created.username as created_by_username,
        u_created.first_name as created_by_first_name,
        u_resolved.username as resolved_by_username,
        u_resolved.first_name as resolved_by_first_name
      FROM incidents i
      LEFT JOIN departments d ON i.department_id = d.department_id
      LEFT JOIN groups g ON i.group_id = g.group_id
      LEFT JOIN users u_created ON i.created_by_id = u_created.user_id
      LEFT JOIN users u_resolved ON i.resolved_by_user_id = u_resolved.user_id
      WHERE i.company_id = ?
    `;

    const params: any[] = [session.companyId];

    if (status) {
      query += ` AND i.status = ?`;
      params.push(status);
    }

    if (departmentId) {
      query += ` AND i.department_id = ?`;
      params.push(parseInt(departmentId));
    }

    if (groupId) {
      query += ` AND i.group_id = ?`;
      params.push(parseInt(groupId));
    }

    query += ` ORDER BY i.t_created DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const incidents = db.prepare(query).all(...params) as any[];

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total FROM incidents i
      WHERE i.company_id = ?
    `;
    const countParams: any[] = [session.companyId];

    if (status) {
      countQuery += ` AND i.status = ?`;
      countParams.push(status);
    }

    if (departmentId) {
      countQuery += ` AND i.department_id = ?`;
      countParams.push(parseInt(departmentId));
    }

    if (groupId) {
      countQuery += ` AND i.group_id = ?`;
      countParams.push(parseInt(groupId));
    }

    const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({
      incidents,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + incidents.length < total,
      },
    });
  } catch (error) {
    console.error('Get incidents error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
