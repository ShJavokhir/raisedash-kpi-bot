import Database from 'better-sqlite3';
import path from 'path';

// Path to the SQLite database (parent directory)
const DB_PATH = path.join(process.cwd(), '..', 'incidents.db');

let dbInstance: Database.Database | null = null;

/**
 * Get or create a singleton database connection
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH, {
      readonly: false,
      fileMustExist: true,
    });

    // Enable WAL mode for better concurrency
    dbInstance.pragma('journal_mode = WAL');

    console.log('Database connection established:', DB_PATH);
  }

  return dbInstance;
}

/**
 * Close the database connection
 */
export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Type definitions matching the Python database schema

export interface Company {
  company_id: number;
  name: string;
  manager_handles: string; // JSON array
  manager_user_ids: string; // JSON array
  dispatcher_user_ids: string; // JSON array
  metadata: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CompanyAccessKey {
  access_key_id: number;
  company_id: number;
  access_key: string;
  description: string | null;
  created_at: string;
  created_by_user_id: number | null;
  expires_at: string | null;
  is_active: number; // SQLite boolean (0 or 1)
  last_used_at: string | null;
  metadata: string; // JSON object
}

export interface Group {
  group_id: number; // Telegram chat ID
  group_name: string;
  manager_handles: string; // JSON array
  manager_user_ids: string; // JSON array
  dispatcher_user_ids: string; // JSON array
  company_id: number | null;
  status: 'pending' | 'active';
  registration_message_id: number | null;
  requested_by_user_id: number | null;
  requested_by_handle: string | null;
  requested_company_name: string | null;
}

export interface User {
  user_id: number; // Telegram user ID
  telegram_handle: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_bot: number; // SQLite boolean
  team_role: 'Driver' | 'Dispatcher' | 'OpsManager' | null;
  group_connections: string; // JSON array
  created_at: string | null;
  updated_at: string | null;
}

export interface Department {
  department_id: number;
  company_id: number;
  name: string;
  metadata: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface DepartmentMember {
  department_id: number;
  user_id: number;
  added_at: string;
}

export interface Incident {
  incident_id: string; // Sequential: 0001, 0002...
  group_id: number;
  company_id: number | null;
  pinned_message_id: number | null;
  source_message_id: number | null;
  status: 'Awaiting_Department' | 'Awaiting_Claim' | 'In_Progress' | 'Awaiting_Summary' | 'Resolved' | 'Closed';
  created_by_id: number;
  created_by_handle: string | null;
  description: string;
  resolution_summary: string | null;
  department_id: number | null;
  pending_resolution_by_user_id: number | null;
  resolved_by_user_id: number | null;
  t_created: string;
  t_department_assigned: string | null;
  t_first_claimed: string | null;
  t_last_claimed: string | null;
  t_resolution_requested: string | null;
  t_resolved: string | null;
  current_department_session_id: number | null;
}

export interface IncidentClaim {
  claim_id: number;
  incident_id: string;
  user_id: number;
  department_id: number | null;
  claimed_at: string;
  released_at: string | null;
  is_active: number; // SQLite boolean
}

export interface IncidentParticipant {
  participant_id: number;
  incident_id: string;
  user_id: number;
  department_id: number | null;
  first_claimed_at: string | null;
  last_claimed_at: string | null;
  last_released_at: string | null;
  active_since: string | null;
  is_active: number; // SQLite boolean
  total_active_seconds: number | null;
  join_count: number;
  status: 'active' | 'released' | 'resolved_self' | 'resolved_other' | 'transferred' | 'closed';
  outcome_detail: string | null;
  resolved_at: string | null;
}

export interface IncidentEvent {
  event_id: number;
  incident_id: string;
  event_type: 'create' | 'department_assigned' | 'claim' | 'release' | 'resolution_requested' | 'resolve' | 'auto_closed';
  actor_user_id: number | null;
  at: string;
  metadata: string; // JSON object
}

export interface IncidentDepartmentSession {
  session_id: number;
  incident_id: string;
  department_id: number;
  assigned_at: string;
  assigned_by_user_id: number | null;
  claimed_at: string | null;
  released_at: string | null;
  status: 'active' | 'transferred' | 'resolved' | 'closed';
  metadata: string; // JSON object
}

// Helper functions for parsing JSON fields

export function parseJSON<T = any>(jsonString: string | null, defaultValue: T = [] as T): T {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString) as T;
  } catch (e) {
    console.error('Failed to parse JSON:', jsonString, e);
    return defaultValue;
  }
}

export function serializeJSON(obj: any): string {
  return JSON.stringify(obj);
}
