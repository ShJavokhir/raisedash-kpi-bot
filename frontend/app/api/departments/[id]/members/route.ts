import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, type DepartmentMember, type User } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/departments/:id/members - List all members of a department
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;

    // Verify department belongs to company
    const department = db.prepare(`
      SELECT department_id FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(id, session.companyId);

    if (!department) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404 }
      );
    }

    // Get members with user details
    const members = db.prepare(`
      SELECT
        dm.department_id,
        dm.user_id,
        dm.added_at,
        u.telegram_handle,
        u.username,
        u.first_name,
        u.last_name,
        u.team_role
      FROM department_members dm
      LEFT JOIN users u ON dm.user_id = u.user_id
      WHERE dm.department_id = ?
      ORDER BY dm.added_at DESC
    `).all(id);

    return NextResponse.json({ members });
  } catch (error) {
    console.error('Get department members error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/departments/:id/members - Add a member to a department
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;
    const body = await request.json();

    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Verify department belongs to company
    const department = db.prepare(`
      SELECT department_id FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(id, session.companyId);

    if (!department) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404 }
      );
    }

    // Check if user exists
    const user = db.prepare(`
      SELECT user_id FROM users WHERE user_id = ?
    `).get(user_id);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if already a member
    const existing = db.prepare(`
      SELECT 1 FROM department_members
      WHERE department_id = ? AND user_id = ?
    `).get(id, user_id);

    if (existing) {
      return NextResponse.json(
        { error: 'User is already a member of this department' },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO department_members (department_id, user_id, added_at)
      VALUES (?, ?, ?)
    `).run(id, user_id, now);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Add department member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/departments/:id/members/:userId - Remove a member from a department
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Verify department belongs to company
    const department = db.prepare(`
      SELECT department_id FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(id, session.companyId);

    if (!department) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404 }
      );
    }

    db.prepare(`
      DELETE FROM department_members
      WHERE department_id = ? AND user_id = ?
    `).run(id, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove department member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
