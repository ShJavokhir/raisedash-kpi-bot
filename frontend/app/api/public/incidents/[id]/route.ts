import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, parseJSON } from '@/lib/db';

/**
 * GET /api/public/incidents/:id - Get detailed incident information (public, no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDatabase();
    const { id } = await params;

    // Get incident details - note: no company_id filter for public access
    const incident = db.prepare(`
      SELECT
        i.*,
        d.name as department_name,
        g.group_name,
        u_created.username as created_by_username,
        u_created.first_name as created_by_first_name,
        u_created.last_name as created_by_last_name,
        u_resolved.username as resolved_by_username,
        u_resolved.first_name as resolved_by_first_name,
        u_resolved.last_name as resolved_by_last_name
      FROM incidents i
      LEFT JOIN departments d ON i.department_id = d.department_id
      LEFT JOIN groups g ON i.group_id = g.group_id
      LEFT JOIN users u_created ON i.created_by_id = u_created.user_id
      LEFT JOIN users u_resolved ON i.resolved_by_user_id = u_resolved.user_id
      WHERE i.incident_id = ?
    `).get(id) as any;

    if (!incident) {
      return NextResponse.json(
        { error: 'Incident not found' },
        { status: 404 }
      );
    }

    // Get incident events (timeline)
    const events = db.prepare(`
      SELECT
        e.*,
        u.username,
        u.first_name,
        u.last_name
      FROM incident_events e
      LEFT JOIN users u ON e.actor_user_id = u.user_id
      WHERE e.incident_id = ?
      ORDER BY e.at ASC
    `).all(id) as any[];

    // Get participants
    const participants = db.prepare(`
      SELECT
        p.*,
        u.username,
        u.first_name,
        u.last_name,
        u.telegram_handle,
        d.name as department_name
      FROM incident_participants p
      LEFT JOIN users u ON p.user_id = u.user_id
      LEFT JOIN departments d ON p.department_id = d.department_id
      WHERE p.incident_id = ?
      ORDER BY p.first_claimed_at ASC
    `).all(id) as any[];

    // Get active claims
    const claims = db.prepare(`
      SELECT
        c.*,
        u.username,
        u.first_name,
        u.last_name,
        d.name as department_name
      FROM incident_claims c
      LEFT JOIN users u ON c.user_id = u.user_id
      LEFT JOIN departments d ON c.department_id = d.department_id
      WHERE c.incident_id = ?
      ORDER BY c.claimed_at DESC
    `).all(id) as any[];

    // Get department sessions
    const departmentSessions = db.prepare(`
      SELECT
        s.*,
        d.name as department_name,
        u.username as assigned_by_username
      FROM incident_department_sessions s
      LEFT JOIN departments d ON s.department_id = d.department_id
      LEFT JOIN users u ON s.assigned_by_user_id = u.user_id
      WHERE s.incident_id = ?
      ORDER BY s.assigned_at ASC
    `).all(id) as any[];

    return NextResponse.json({
      incident,
      events: events.map(e => ({
        ...e,
        metadata: parseJSON(e.metadata, {}),
      })),
      participants,
      claims,
      departmentSessions: departmentSessions.map(s => ({
        ...s,
        metadata: parseJSON(s.metadata, {}),
      })),
    });
  } catch (error) {
    console.error('Get public incident error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
