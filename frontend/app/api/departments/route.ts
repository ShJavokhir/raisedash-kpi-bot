import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON, type Department } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/departments - List all departments for the company
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();

    const departments = db.prepare(`
      SELECT * FROM departments
      WHERE company_id = ?
      ORDER BY name ASC
    `).all(session.companyId) as Department[];

    return NextResponse.json({
      departments: departments.map(dept => {
        const rawMetadata = parseJSON(dept.metadata, {} as Record<string, any>);
        const metadata = {
          ...rawMetadata,
          restricted_to_department_members: !!rawMetadata.restricted_to_department_members,
        };

        // Count members for this department
        const memberCountResult = db.prepare(`
          SELECT COUNT(*) as member_count
          FROM department_members
          WHERE department_id = ?
        `).get(dept.department_id) as { member_count: number };

        return {
          department_id: dept.department_id,
          company_id: dept.company_id,
          name: dept.name,
          metadata,
          created_at: dept.created_at,
          updated_at: dept.updated_at,
          member_count: memberCountResult.member_count || 0,
        };
      }),
    });
  } catch (error) {
    console.error('Get departments error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/departments - Create a new department
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const body = await request.json();

    const { name, metadata } = body;
    const normalizedMetadata = {
      ...(metadata || {}),
      restricted_to_department_members: !!metadata?.restricted_to_department_members,
    };

    if (!name) {
      return NextResponse.json(
        { error: 'Department name is required' },
        { status: 400 }
      );
    }

    // Check if department already exists
    const existing = db.prepare(`
      SELECT department_id FROM departments
      WHERE company_id = ? AND name = ?
    `).get(session.companyId, name);

    if (existing) {
      return NextResponse.json(
        { error: 'Department already exists' },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO departments (company_id, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      session.companyId,
      name,
      JSON.stringify(normalizedMetadata),
      now,
      now
    );

    return NextResponse.json({
      success: true,
      department_id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error('Create department error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
