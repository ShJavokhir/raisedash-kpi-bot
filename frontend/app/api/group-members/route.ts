import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const VALID_SHIFTS = ['DAY', 'NIGHT'];

function normalizeShift(value: unknown): string | null {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  return VALID_SHIFTS.includes(normalized) ? normalized : null;
}

/**
 * GET /api/group-members?user_id=123
 * Returns group-to-department shift assignments for the user scoped to the company.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      );
    }

    const assignments = db.prepare(`
      SELECT
        gm.group_id,
        gm.department_id,
        gm.user_id,
        gm.shift,
        gm.added_at,
        g.group_name,
        d.name as department_name
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.group_id
      JOIN departments d ON gm.department_id = d.department_id
      WHERE gm.user_id = ?
        AND g.company_id = ?
        AND d.company_id = ?
      ORDER BY gm.added_at DESC
    `).all(userId, session.companyId, session.companyId);

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error('Get group members error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/group-members
 * Body: { user_id, group_id, department_id, shift }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const body = await request.json();

    const userId = body.user_id;
    const groupId = body.group_id;
    const departmentId = body.department_id;
    const shift = normalizeShift(body.shift);

    if (!userId || !groupId || !departmentId || !shift) {
      return NextResponse.json(
        { error: 'user_id, group_id, department_id, and shift are required' },
        { status: 400 }
      );
    }

    // Validate group belongs to company
    const group = db.prepare(`
      SELECT group_id FROM groups
      WHERE group_id = ? AND company_id = ?
    `).get(groupId, session.companyId);

    if (!group) {
      return NextResponse.json(
        { error: 'Group not found for this company' },
        { status: 404 }
      );
    }

    // Validate department belongs to company
    const department = db.prepare(`
      SELECT department_id FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(departmentId, session.companyId);

    if (!department) {
      return NextResponse.json(
        { error: 'Department not found for this company' },
        { status: 404 }
      );
    }

    // Validate user exists
    const user = db.prepare(`
      SELECT user_id FROM users WHERE user_id = ?
    `).get(userId);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Ensure the user is in the department before assigning to a group
    const membership = db.prepare(`
      SELECT 1 FROM department_members
      WHERE department_id = ? AND user_id = ?
    `).get(departmentId, userId);

    if (!membership) {
      return NextResponse.json(
        { error: 'User must be a member of the department before assigning to a group' },
        { status: 400 }
      );
    }

    const existing = db.prepare(`
      SELECT 1 FROM group_members
      WHERE group_id = ? AND department_id = ? AND user_id = ? AND shift = ?
    `).get(groupId, departmentId, userId, shift);

    if (existing) {
      return NextResponse.json(
        { error: 'User is already assigned to this group/department/shift' },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO group_members (group_id, department_id, user_id, shift, added_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(groupId, departmentId, userId, shift, now);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Create group member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/group-members?user_id=1&group_id=2&department_id=3&shift=DAY
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    const userId = searchParams.get('user_id');
    const groupId = searchParams.get('group_id');
    const departmentId = searchParams.get('department_id');
    const shift = normalizeShift(searchParams.get('shift'));

    if (!userId || !groupId || !departmentId || !shift) {
      return NextResponse.json(
        { error: 'user_id, group_id, department_id, and shift are required' },
        { status: 400 }
      );
    }

    // Validate that the assignment belongs to the same company scope
    const existing = db.prepare(`
      SELECT 1 FROM group_members gm
      JOIN groups g ON gm.group_id = g.group_id
      JOIN departments d ON gm.department_id = d.department_id
      WHERE gm.user_id = ?
        AND gm.group_id = ?
        AND gm.department_id = ?
        AND gm.shift = ?
        AND g.company_id = ?
        AND d.company_id = ?
    `).get(userId, groupId, departmentId, shift, session.companyId, session.companyId);

    if (!existing) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    db.prepare(`
      DELETE FROM group_members
      WHERE user_id = ? AND group_id = ? AND department_id = ? AND shift = ?
    `).run(userId, groupId, departmentId, shift);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete group member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
