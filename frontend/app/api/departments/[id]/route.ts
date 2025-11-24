import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON, type Department } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/departments/:id - Get a specific department
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;

    const department = db.prepare(`
      SELECT * FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(id, session.companyId) as Department;

    if (!department) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404 }
      );
    }

    const rawMetadata = parseJSON(department.metadata, {} as Record<string, any>);
    const metadata = {
      ...rawMetadata,
      restricted_to_department_members: !!rawMetadata.restricted_to_department_members,
    };

    return NextResponse.json({
      department_id: department.department_id,
      company_id: department.company_id,
      name: department.name,
      metadata,
      created_at: department.created_at,
      updated_at: department.updated_at,
    });
  } catch (error) {
    console.error('Get department error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/departments/:id - Update a department
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;
    const body = await request.json();

    const { name, metadata } = body;
    const normalizedMetadata = metadata
      ? {
          ...metadata,
          restricted_to_department_members: !!metadata.restricted_to_department_members,
        }
      : null;

    // Verify department belongs to company
    const existing = db.prepare(`
      SELECT department_id FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(id, session.companyId);

    if (!existing) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404 }
      );
    }

    db.prepare(`
      UPDATE departments
      SET
        name = COALESCE(?, name),
        metadata = COALESCE(?, metadata),
        updated_at = datetime('now')
      WHERE department_id = ?
    `).run(name, normalizedMetadata ? JSON.stringify(normalizedMetadata) : null, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update department error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/departments/:id - Delete a department
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { id } = await params;

    // Verify department belongs to company
    const existing = db.prepare(`
      SELECT department_id FROM departments
      WHERE department_id = ? AND company_id = ?
    `).get(id, session.companyId);

    if (!existing) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404 }
      );
    }

    // Check if department has active incidents
    const activeIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE department_id = ? AND status NOT IN ('Resolved', 'Closed')
    `).get(id) as { count: number };

    if (activeIncidents.count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete department with active incidents' },
        { status: 400 }
      );
    }

    // Delete department members first
    db.prepare(`
      DELETE FROM department_members WHERE department_id = ?
    `).run(id);

    // Delete department
    db.prepare(`
      DELETE FROM departments WHERE department_id = ?
    `).run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete department error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
