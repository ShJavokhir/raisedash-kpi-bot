import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const MINUTES_PER_DAY = 24 * 60;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

type DaySchedule = {
  day: number;
  enabled: boolean;
  start_minute: number;
  end_minute: number;
};

type ApiDaySchedule = {
  day: string;
  enabled: boolean;
  start_time: string;
  end_time: string;
};

function parseHHMM(value: unknown): number | null {
  if (!value || typeof value !== 'string') return null;
  const parts = value.trim().split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatMinutes(minutes: number): string {
  if (minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new Error('Minutes must be between 0 and 1439');
  }
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function parseDay(value: unknown): number | null {
  if (typeof value === 'number' && value >= 0 && value <= 6) return value;
  if (typeof value === 'string') {
    const idx = WEEKDAYS.indexOf(value.trim().toLowerCase() as (typeof WEEKDAYS)[number]);
    if (idx !== -1) return idx;
  }
  return null;
}

function normalizeSchedule(schedule: unknown): DaySchedule[] | null {
  if (!Array.isArray(schedule)) return null;
  const normalized: Record<number, DaySchedule> = {};

  for (const entry of schedule) {
    const day = parseDay((entry as any)?.day);
    if (day === null) return null;
    if (normalized[day]) return null; // duplicate day

    const enabled = Boolean((entry as any)?.enabled);
    let start_minute = 0;
    let end_minute = 0;
    if (enabled) {
      const start = parseHHMM((entry as any)?.start_time ?? (entry as any)?.start_minute);
      const end = parseHHMM((entry as any)?.end_time ?? (entry as any)?.end_minute);
      if (
        start === null ||
        end === null ||
        start < 0 ||
        start >= MINUTES_PER_DAY ||
        end < 0 ||
        end >= MINUTES_PER_DAY ||
        start === end
      ) {
        return null;
      }
      start_minute = start;
      end_minute = end;
    }

    normalized[day] = { day, enabled, start_minute, end_minute };
  }

  // Fill missing days as disabled
  for (let i = 0; i < 7; i++) {
    if (!normalized[i]) {
      normalized[i] = { day: i, enabled: false, start_minute: 0, end_minute: 0 };
    }
  }

  return WEEKDAYS.map((_, idx) => normalized[idx]);
}

function serializeSchedule(schedule: DaySchedule[]): string {
  return JSON.stringify(schedule);
}

function apiScheduleFromRow(scheduleJson: string): ApiDaySchedule[] {
  let parsed: any[] = [];
  try {
    parsed = JSON.parse(scheduleJson || '[]');
  } catch (e) {
    parsed = [];
  }
  return WEEKDAYS.map((name, idx) => {
    const entry = parsed.find((item) => item.day === idx) || {};
    const enabled = Boolean(entry.enabled);
    return {
      day: name,
      enabled,
      start_time: enabled ? formatMinutes(entry.start_minute ?? 0) : '00:00',
      end_time: enabled ? formatMinutes(entry.end_minute ?? 0) : '00:00',
    };
  });
}

/**
 * GET /api/group-members?user_id=123
 * Returns group-to-department availability assignments for the user scoped to the company.
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
        gm.schedule,
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
    `).all(userId, session.companyId, session.companyId) as Array<{
      group_id: number;
      department_id: number;
      user_id: number;
      schedule: string;
      added_at: string;
      group_name: string;
      department_name: string;
    }>;

    const mapped = assignments.map((row) => ({
      group_id: row.group_id,
      department_id: row.department_id,
      user_id: row.user_id,
      added_at: row.added_at,
      group_name: row.group_name,
      department_name: row.department_name,
      schedule: apiScheduleFromRow(row.schedule),
    }));

    return NextResponse.json({ assignments: mapped });
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
 * Body: { user_id, group_id, department_id, schedule: [{ day, enabled, start_time, end_time }] }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const body = await request.json();

    const userId = body.user_id;
    const groupId = body.group_id;
    const departmentId = body.department_id;
    const schedule = normalizeSchedule(body.schedule);

    if (!userId || !groupId || !departmentId || !schedule) {
      return NextResponse.json(
        { error: 'user_id, group_id, department_id, and schedule (7-day entries) are required' },
        { status: 400 }
      );
    }

    if (!schedule.some((s) => s.enabled)) {
      return NextResponse.json(
        { error: 'At least one day must be enabled in the schedule' },
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
      WHERE group_id = ? AND department_id = ? AND user_id = ?
    `).get(groupId, departmentId, userId);

    if (existing) {
      return NextResponse.json(
        { error: 'User is already assigned to this group/department. Remove before re-adding.' },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO group_members (group_id, department_id, user_id, schedule, added_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(groupId, departmentId, userId, serializeSchedule(schedule), now);

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
 * PATCH /api/group-members
 * Body: { user_id, schedule: [{ day, enabled, start_time, end_time }] }
 * Updates schedule for all assignments of the user within the company.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const body = await request.json();

    const userId = body.user_id;
    const schedule = normalizeSchedule(body.schedule);

    if (!userId || !schedule) {
      return NextResponse.json(
        { error: 'user_id and schedule (7-day entries) are required' },
        { status: 400 }
      );
    }

    if (!schedule.some((s) => s.enabled)) {
      return NextResponse.json(
        { error: 'At least one day must be enabled in the schedule' },
        { status: 400 }
      );
    }

    // Ensure the user exists
    const user = db.prepare(`
      SELECT user_id FROM users WHERE user_id = ?
    `).get(userId);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Ensure the user has assignments scoped to the company
    const assignmentCountRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.group_id
      JOIN departments d ON gm.department_id = d.department_id
      WHERE gm.user_id = ?
        AND g.company_id = ?
        AND d.company_id = ?
    `).get(userId, session.companyId, session.companyId) as { count: number };

    if (!assignmentCountRow || assignmentCountRow.count === 0) {
      return NextResponse.json(
        { error: 'No assignments found for this user in your company' },
        { status: 404 }
      );
    }

    const serialized = serializeSchedule(schedule);
    const update = db.prepare(`
      UPDATE group_members
      SET schedule = ?
      WHERE user_id = ?
        AND group_id IN (SELECT group_id FROM groups WHERE company_id = ?)
        AND department_id IN (SELECT department_id FROM departments WHERE company_id = ?)
    `).run(serialized, userId, session.companyId, session.companyId);

    return NextResponse.json({ success: true, updated: update.changes });
  } catch (error) {
    console.error('Patch group members error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/group-members?user_id=1&group_id=2&department_id=3
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    const userId = searchParams.get('user_id');
    const groupId = searchParams.get('group_id');
    const departmentId = searchParams.get('department_id');

    if (!userId || !groupId || !departmentId) {
      return NextResponse.json(
        { error: 'user_id, group_id, and department_id are required' },
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
        AND g.company_id = ?
        AND d.company_id = ?
    `).get(userId, groupId, departmentId, session.companyId, session.companyId);

    if (!existing) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    db.prepare(`
      DELETE FROM group_members
      WHERE user_id = ? AND group_id = ? AND department_id = ?
    `).run(userId, groupId, departmentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete group member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
