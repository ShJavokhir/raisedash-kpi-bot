"""
Database module for managing SQLite database operations.
Implements the three-table schema: Groups, Users, Incidents.
"""

import sqlite3
import json
import logging
import re
from datetime import timedelta
from typing import Optional, List, Dict, Any, Tuple
from contextlib import contextmanager
from threading import Lock

from time_utils import parse_timestamp, utc_iso_now, utc_now
from sentry_config import SentryConfig, sentry_trace

logger = logging.getLogger(__name__)


class Database:
    """Thread-safe SQLite database manager for incident tracking."""

    def __init__(self, db_path: str = "incidents.db"):
        self.db_path = db_path
        self._lock = Lock()
        self._init_database()

    @contextmanager
    def get_connection(self):
        """Context manager for database connections with proper error handling."""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row  # Enable column access by name
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {e}")
            SentryConfig.capture_exception(e, db_operation="connection", db_path=self.db_path)
            raise
        finally:
            conn.close()

    def _init_database(self):
        """Initialize database schema and apply lightweight migrations."""
        with self.get_connection() as conn:
            cursor = conn.cursor()

            # Enable WAL mode for better concurrency
            cursor.execute("PRAGMA journal_mode=WAL")
            logger.info("Enabled WAL mode for SQLite")

            self._create_tables(cursor)
            self._apply_migrations(cursor)

            conn.commit()
            logger.info("Database initialized successfully")

    def _create_tables(self, cursor):
        """Create base tables if they do not exist."""
        # Companies table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS companies (
                company_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                manager_handles TEXT NOT NULL DEFAULT '[]',
                manager_user_ids TEXT NOT NULL DEFAULT '[]',
                dispatcher_user_ids TEXT NOT NULL DEFAULT '[]',
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Groups table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS groups (
                group_id INTEGER PRIMARY KEY,
                group_name TEXT NOT NULL,
                manager_handles TEXT NOT NULL DEFAULT '[]',
                manager_user_ids TEXT NOT NULL DEFAULT '[]',
                dispatcher_user_ids TEXT NOT NULL DEFAULT '[]',
                company_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                registration_message_id INTEGER,
                requested_by_user_id INTEGER,
                requested_by_handle TEXT,
                requested_company_name TEXT,
                FOREIGN KEY (company_id) REFERENCES companies(company_id)
            )
        """)

        # Users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                telegram_handle TEXT,
                team_role TEXT CHECK(team_role IN ('Driver', 'Dispatcher', 'OpsManager')),
                metadata TEXT NOT NULL DEFAULT '{}'
            )
        """)

        # Departments table (per company)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS departments (
                department_id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(company_id, name),
                FOREIGN KEY (company_id) REFERENCES companies(company_id)
            )
        """)

        # Department membership table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS department_members (
                department_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (department_id, user_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)

        # Incidents table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                incident_id TEXT PRIMARY KEY,
                group_id INTEGER NOT NULL,
                company_id INTEGER,
                pinned_message_id INTEGER,
                status TEXT NOT NULL CHECK(status IN (
                    'Awaiting_Department',
                    'Awaiting_Claim',
                    'In_Progress',
                    'Awaiting_Summary',
                    'Resolved',
                    'Closed'
                )),
                created_by_id INTEGER NOT NULL,
                created_by_handle TEXT NOT NULL,
                description TEXT NOT NULL,
                resolution_summary TEXT,
                department_id INTEGER,
                pending_resolution_by_user_id INTEGER,
                resolved_by_user_id INTEGER,
                t_created TEXT NOT NULL,
                t_department_assigned TEXT,
                t_first_claimed TEXT,
                t_last_claimed TEXT,
                t_resolution_requested TEXT,
                t_resolved TEXT,
                source_message_id INTEGER,
                current_department_session_id INTEGER,
                FOREIGN KEY (group_id) REFERENCES groups(group_id),
                FOREIGN KEY (company_id) REFERENCES companies(company_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)

        # Incident claims table (supports multiple concurrent claimants per department)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS incident_claims (
                claim_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                department_id INTEGER,
                claimed_at TEXT NOT NULL,
                released_at TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)

        # Incident participant rollups (one row per user/department/incident)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS incident_participants (
                participant_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                department_id INTEGER,
                first_claimed_at TEXT NOT NULL,
                last_claimed_at TEXT NOT NULL,
                last_released_at TEXT,
                active_since TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                total_active_seconds INTEGER NOT NULL DEFAULT 0,
                join_count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
                    'active',
                    'released',
                    'resolved_self',
                    'resolved_other',
                    'transferred',
                    'closed'
                )),
                outcome_detail TEXT,
                resolved_at TEXT,
                UNIQUE(incident_id, user_id, department_id),
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)

        # Incident department sessions (track time per department assignment)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS incident_department_sessions (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                department_id INTEGER NOT NULL,
                assigned_at TEXT NOT NULL,
                assigned_by_user_id INTEGER,
                claimed_at TEXT,
                released_at TEXT,
                status TEXT NOT NULL CHECK(status IN ('active', 'transferred', 'resolved', 'closed')),
                metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)

        # Immutable event log for downstream reporting
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS incident_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                actor_user_id INTEGER,
                at TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
            )
        """)

        # Create indices for better query performance
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_incidents_status
            ON incidents(status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_incidents_group
            ON incidents(group_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_incidents_created
            ON incidents(t_created)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_incidents_status_created
            ON incidents(status, t_created)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_groups_status
            ON groups(status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_groups_company
            ON groups(company_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_incidents_company
            ON incidents(company_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_incidents_department
            ON incidents(department_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_claims_incident
            ON incident_claims(incident_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_claims_active_new
            ON incident_claims(incident_id, department_id)
            WHERE is_active = 1
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_claim_new
            ON incident_claims(incident_id, user_id, department_id)
            WHERE is_active = 1
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_participants_incident
            ON incident_participants(incident_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_participants_incident_user
            ON incident_participants(incident_id, user_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_participants_incident_department
            ON incident_participants(incident_id, department_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_incident
            ON incident_events(incident_id, at)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_department_members_user
            ON department_members(user_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_department_sessions_incident
            ON incident_department_sessions(incident_id)
        """)

    def _apply_migrations(self, cursor):
        """Apply lightweight migrations for existing deployments."""
        def get_columns(table_name: str) -> set:
            cursor.execute(f"PRAGMA table_info({table_name})")
            return {row[1] for row in cursor.fetchall()}

        def ensure_column(table_name: str, column_name: str, definition: str):
            columns = get_columns(table_name)
            if column_name not in columns:
                cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
                logger.info(f"Added column {column_name} to {table_name}")

        # Ensure companies table exists (older versions may not have it)
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'")
        if not cursor.fetchone():
            logger.info("Creating companies table for legacy database")
            self._create_tables(cursor)  # Will no-op for existing tables
            return

        ensure_column('groups', 'company_id', "INTEGER")
        ensure_column('groups', 'status', "TEXT NOT NULL DEFAULT 'pending'")
        ensure_column('groups', 'registration_message_id', "INTEGER")
        ensure_column('groups', 'requested_by_user_id', "INTEGER")
        ensure_column('groups', 'requested_by_handle', "TEXT")
        ensure_column('groups', 'requested_company_name', "TEXT")

        # Ensure new department-centric tables exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS departments (
                department_id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(company_id, name),
                FOREIGN KEY (company_id) REFERENCES companies(company_id)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS department_members (
                department_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (department_id, user_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS incident_department_sessions (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                department_id INTEGER NOT NULL,
                assigned_at TEXT NOT NULL,
                assigned_by_user_id INTEGER,
                claimed_at TEXT,
                released_at TEXT,
                status TEXT NOT NULL CHECK(status IN ('active', 'transferred', 'resolved', 'closed')),
                metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)

        # Enhanced user tracking migration - Add comprehensive user fields
        ensure_column('users', 'username', "TEXT")  # Raw username without @
        ensure_column('users', 'first_name', "TEXT")
        ensure_column('users', 'last_name', "TEXT")
        ensure_column('users', 'language_code', "TEXT")
        ensure_column('users', 'is_bot', "INTEGER NOT NULL DEFAULT 0")
        ensure_column('users', 'group_connections', "TEXT NOT NULL DEFAULT '[]'")  # JSON array
        ensure_column('users', 'metadata', "TEXT NOT NULL DEFAULT '{}'")  # JSON blob for audit changes
        ensure_column('users', 'created_at', "TEXT")
        ensure_column('users', 'updated_at', "TEXT")

        # Backfill defaults
        cursor.execute("""
            UPDATE groups
            SET status = COALESCE(status, 'active')
            WHERE status IS NULL OR TRIM(status) = ''
        """)

        cursor.execute("""
            UPDATE incidents
            SET company_id = (
                SELECT company_id FROM groups WHERE groups.group_id = incidents.group_id
            )
            WHERE company_id IS NULL
        """)

        # Backfill user timestamps for existing records
        cursor.execute("""
            UPDATE users
            SET created_at = ?,
                updated_at = ?
            WHERE created_at IS NULL OR updated_at IS NULL
        """, (utc_iso_now(), utc_iso_now()))

        # Rebuild core tables to drop tiered constraints and add department context
        self._migrate_incidents_table(cursor, get_columns)
        self._migrate_incident_claims(cursor, get_columns)
        self._migrate_incident_participants(cursor, get_columns)
        self._migrate_incident_events(cursor, get_columns)

        # Seed default departments for legacy companies
        self._seed_default_departments(cursor)

        # Create company_access_keys table for web UI authentication
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS company_access_keys (
                access_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                access_key TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL,
                created_by_user_id INTEGER,
                expires_at TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                last_used_at TEXT,
                metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (company_id) REFERENCES companies(company_id)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_company_access_keys_company
            ON company_access_keys(company_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_company_access_keys_active
            ON company_access_keys(is_active, expires_at)
        """)

    def _migrate_incidents_table(self, cursor, get_columns):
        """Rebuild incidents table with department-aware schema."""
        columns = get_columns('incidents')
        needed = {
            'department_id',
            't_department_assigned',
            't_first_claimed',
            't_last_claimed',
            'source_message_id',
            'current_department_session_id'
        }
        legacy_markers = {'claimed_by_t1_id', 'claimed_by_t2_id', 't_claimed_tier1', 't_claimed_tier2', 't_escalated', 'resolved_by_tier'}
        if needed.issubset(columns) and not (legacy_markers & columns):
            return

        logger.info("Rebuilding incidents table for department workflow")
        cursor.execute("ALTER TABLE incidents RENAME TO incidents_old")
        self._create_tables(cursor)

        default_assigned = utc_iso_now()
        cursor.execute("""
            INSERT INTO incidents (
                incident_id,
                group_id,
                company_id,
                pinned_message_id,
                status,
                created_by_id,
                created_by_handle,
                description,
                resolution_summary,
                department_id,
                pending_resolution_by_user_id,
                resolved_by_user_id,
                t_created,
                t_department_assigned,
                t_first_claimed,
                t_last_claimed,
                t_resolution_requested,
                t_resolved,
                source_message_id,
                current_department_session_id
            )
            SELECT
                incident_id,
                group_id,
                company_id,
                pinned_message_id,
                CASE status
                    WHEN 'Unclaimed' THEN 'Awaiting_Claim'
                    WHEN 'Claimed_T1' THEN 'In_Progress'
                    WHEN 'Escalated_Unclaimed_T2' THEN 'Awaiting_Claim'
                    WHEN 'Claimed_T2' THEN 'In_Progress'
                    ELSE COALESCE(status, 'Awaiting_Claim')
                END AS status,
                created_by_id,
                created_by_handle,
                description,
                resolution_summary,
                NULL AS department_id,
                pending_resolution_by_user_id,
                resolved_by_user_id,
                t_created,
                COALESCE(t_created, ?) AS t_department_assigned,
                COALESCE(t_claimed_tier1, t_claimed_tier2) AS t_first_claimed,
                COALESCE(t_claimed_tier2, t_claimed_tier1) AS t_last_claimed,
                t_resolution_requested,
                t_resolved,
                NULL AS source_message_id,
                NULL AS current_department_session_id
            FROM incidents_old
        """, (default_assigned,))
        cursor.execute("DROP TABLE incidents_old")

    def _migrate_incident_claims(self, cursor, get_columns):
        """Rebuild claims table to attach department_id and drop tier checks."""
        columns = get_columns('incident_claims')
        if 'department_id' in columns and 'tier' not in columns:
            return

        logger.info("Rebuilding incident_claims table")
        cursor.execute("ALTER TABLE incident_claims RENAME TO incident_claims_old")
        cursor.execute("""
            CREATE TABLE incident_claims (
                claim_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                department_id INTEGER,
                claimed_at TEXT NOT NULL,
                released_at TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)
        cursor.execute("""
            INSERT INTO incident_claims (incident_id, user_id, department_id, claimed_at, released_at, is_active)
            SELECT incident_id, user_id, NULL, claimed_at, released_at, is_active
            FROM incident_claims_old
        """)
        cursor.execute("DROP TABLE incident_claims_old")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_claims_incident ON incident_claims(incident_id)")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_claims_active_new
            ON incident_claims(incident_id, department_id)
            WHERE is_active = 1
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_claim_new
            ON incident_claims(incident_id, user_id, department_id)
            WHERE is_active = 1
        """)

    def _migrate_incident_participants(self, cursor, get_columns):
        """Rebuild participants table with department context."""
        columns = get_columns('incident_participants')
        if 'department_id' in columns and 'tier' not in columns:
            return

        logger.info("Rebuilding incident_participants table")
        cursor.execute("ALTER TABLE incident_participants RENAME TO incident_participants_old")
        cursor.execute("""
            CREATE TABLE incident_participants (
                participant_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                department_id INTEGER,
                first_claimed_at TEXT NOT NULL,
                last_claimed_at TEXT NOT NULL,
                last_released_at TEXT,
                active_since TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                total_active_seconds INTEGER NOT NULL DEFAULT 0,
                join_count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
                    'active',
                    'released',
                    'resolved_self',
                    'resolved_other',
                    'transferred',
                    'closed'
                )),
                outcome_detail TEXT,
                resolved_at TEXT,
                UNIQUE(incident_id, user_id, department_id),
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id),
                FOREIGN KEY (department_id) REFERENCES departments(department_id)
            )
        """)
        cursor.execute("""
            INSERT INTO incident_participants (
                incident_id, user_id, department_id,
                first_claimed_at, last_claimed_at, last_released_at,
                active_since, is_active, total_active_seconds, join_count,
                status, outcome_detail, resolved_at
            )
            SELECT
                incident_id,
                user_id,
                NULL,
                first_claimed_at,
                last_claimed_at,
                last_released_at,
                active_since,
                is_active,
                total_active_seconds,
                join_count,
                CASE status WHEN 'escalated' THEN 'transferred' ELSE status END,
                outcome_detail,
                resolved_at
            FROM incident_participants_old
        """)
        cursor.execute("DROP TABLE incident_participants_old")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_participants_incident
            ON incident_participants(incident_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_participants_incident_user
            ON incident_participants(incident_id, user_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_participants_incident_department
            ON incident_participants(incident_id, department_id)
        """)

    def _migrate_incident_events(self, cursor, get_columns):
        """Align incident_events schema to drop tier column if present."""
        columns = get_columns('incident_events')
        if 'tier' not in columns and 'metadata' in columns:
            return

        logger.info("Rebuilding incident_events table without tier column")
        cursor.execute("ALTER TABLE incident_events RENAME TO incident_events_old")
        cursor.execute("""
            CREATE TABLE incident_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                actor_user_id INTEGER,
                at TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
            )
        """)
        cursor.execute("""
            INSERT INTO incident_events (incident_id, event_type, actor_user_id, at, metadata)
            SELECT incident_id, event_type, actor_user_id, at, COALESCE(metadata, '{}')
            FROM incident_events_old
        """)
        cursor.execute("DROP TABLE incident_events_old")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_incident
            ON incident_events(incident_id, at)
        """)

    def _seed_default_departments(self, cursor):
        """Bootstrap default departments for legacy companies."""
        cursor.execute("SELECT company_id, dispatcher_user_ids, manager_user_ids FROM companies")
        companies = cursor.fetchall()
        for row in companies:
            company_id = row['company_id']
            cursor.execute(
                "SELECT 1 FROM departments WHERE company_id = ? LIMIT 1",
                (company_id,)
            )
            if cursor.fetchone():
                continue

            now = utc_iso_now()
            dispatcher_ids = json.loads(row['dispatcher_user_ids'] or '[]')
            manager_ids = json.loads(row['manager_user_ids'] or '[]')

            # Create a dispatcher department if legacy data exists
            if dispatcher_ids:
                cursor.execute("""
                    INSERT INTO departments (company_id, name, metadata, created_at, updated_at)
                    VALUES (?, ?, '{}', ?, ?)
                """, (company_id, "Dispatchers", now, now))
                dept_id = cursor.lastrowid
                for uid in dispatcher_ids:
                    cursor.execute("""
                        INSERT OR IGNORE INTO department_members (department_id, user_id, added_at)
                        VALUES (?, ?, ?)
                    """, (dept_id, uid, now))

            # Migrate managers into an Operations department to avoid losing access
            extra_manager_ids = [uid for uid in manager_ids if uid not in dispatcher_ids]
            if extra_manager_ids:
                cursor.execute("""
                    INSERT INTO departments (company_id, name, metadata, created_at, updated_at)
                    VALUES (?, ?, '{}', ?, ?)
                """, (company_id, "Operations", now, now))
                dept_id = cursor.lastrowid
                for uid in extra_manager_ids:
                    cursor.execute("""
                        INSERT OR IGNORE INTO department_members (department_id, user_id, added_at)
                        VALUES (?, ?, ?)
                    """, (dept_id, uid, now))

    # ==================== Company Management ====================

    def _serialize_company_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            'company_id': row['company_id'],
            'name': row['name'],
            'manager_handles': json.loads(row['manager_handles'] or '[]'),
            'manager_user_ids': json.loads(row['manager_user_ids'] or '[]'),
            'dispatcher_user_ids': json.loads(row['dispatcher_user_ids'] or '[]'),
            'metadata': json.loads(row['metadata'] or '{}'),
            'created_at': row['created_at'],
            'updated_at': row['updated_at']
        }

    def create_company(self, name: str,
                       manager_handles: Optional[List[str]] = None,
                       manager_user_ids: Optional[List[int]] = None,
                       dispatcher_user_ids: Optional[List[int]] = None,
                       metadata: Optional[Dict[str, Any]] = None) -> int:
        """Create a new company record."""
        timestamp = utc_iso_now()
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO companies (
                        name,
                        manager_handles,
                        manager_user_ids,
                        dispatcher_user_ids,
                        metadata,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    name,
                    json.dumps(manager_handles or []),
                    json.dumps(manager_user_ids or []),
                    json.dumps(dispatcher_user_ids or []),
                    json.dumps(metadata or {}),
                    timestamp,
                    timestamp
                ))

                company_id = cursor.lastrowid
                logger.info(f"Created company {company_id} ({name})")
                return company_id

    def get_company_by_id(self, company_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a company by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM companies WHERE company_id = ?", (company_id,))
            row = cursor.fetchone()
            if row:
                return self._serialize_company_row(row)
            return None

    def get_company_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Fetch a company by its unique name."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM companies WHERE name = ?", (name,))
            row = cursor.fetchone()
            if row:
                return self._serialize_company_row(row)
            return None

    def list_companies(self) -> List[Dict[str, Any]]:
        """Return all companies."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM companies ORDER BY name ASC")
            rows = cursor.fetchall()
            return [self._serialize_company_row(row) for row in rows]

    def update_company_roles(self, company_id: int,
                             manager_handles: Optional[List[str]] = None,
                             manager_user_ids: Optional[List[int]] = None,
                             dispatcher_user_ids: Optional[List[int]] = None):
        """Update company-level role configuration."""
        updates = []
        params: List[Any] = []

        if manager_handles is not None:
            updates.append("manager_handles = ?")
            params.append(json.dumps(manager_handles or []))

        if manager_user_ids is not None:
            updates.append("manager_user_ids = ?")
            params.append(json.dumps(manager_user_ids or []))

        if dispatcher_user_ids is not None:
            updates.append("dispatcher_user_ids = ?")
            params.append(json.dumps(dispatcher_user_ids or []))

        if not updates:
            return

        updates.append("updated_at = ?")
        params.append(utc_iso_now())
        params.append(company_id)

        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    f"UPDATE companies SET {', '.join(updates)} WHERE company_id = ?",
                    params
                )
                logger.info(f"Updated role configuration for company {company_id}")

    def add_dispatcher_to_company(self, company_id: int, user_id: int):
        """Add a dispatcher to the company-level list."""
        company = self.get_company_by_id(company_id)
        if not company:
            raise ValueError(f"Company {company_id} not found")

        dispatcher_ids = company.get('dispatcher_user_ids', [])
        if user_id in dispatcher_ids:
            return

        dispatcher_ids.append(user_id)
        self.update_company_roles(company_id, dispatcher_user_ids=dispatcher_ids)
        logger.info(f"Added dispatcher {user_id} to company {company_id}")

    def add_manager_to_company(self, company_id: int, user_id: int, handle: Optional[str] = None):
        """Add a manager to the company-level list."""
        company = self.get_company_by_id(company_id)
        if not company:
            raise ValueError(f"Company {company_id} not found")

        manager_ids = company.get('manager_user_ids', [])
        manager_handles = company.get('manager_handles', [])

        updated = False

        if user_id not in manager_ids:
            manager_ids.append(user_id)
            updated = True

        if handle and handle not in manager_handles:
            manager_handles.append(handle)
            updated = True

        if updated:
            self.update_company_roles(
                company_id,
                manager_user_ids=manager_ids,
                manager_handles=manager_handles
            )
            logger.info(f"Added manager {user_id} to company {company_id}")

    def attach_group_to_company(self, group_id: int, group_name: str,
                                company_id: int, status: str = 'active'):
        """
        Attach a Telegram group to a company and mark it active/pending.
        Copies company role configuration into the group record.
        """
        company = self.get_company_by_id(company_id)
        if not company:
            raise ValueError(f"Company {company_id} does not exist")

        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO groups (
                        group_id,
                        group_name,
                        manager_handles,
                        manager_user_ids,
                        dispatcher_user_ids,
                        company_id,
                        status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(group_id) DO UPDATE SET
                        group_name = excluded.group_name,
                        manager_handles = excluded.manager_handles,
                        manager_user_ids = excluded.manager_user_ids,
                        dispatcher_user_ids = excluded.dispatcher_user_ids,
                        company_id = excluded.company_id,
                        status = excluded.status,
                        registration_message_id = NULL,
                        requested_by_user_id = NULL,
                        requested_by_handle = NULL,
                        requested_company_name = NULL
                """, (
                    group_id,
                    group_name,
                    json.dumps(company['manager_handles']),
                    json.dumps(company['manager_user_ids']),
                    json.dumps(company['dispatcher_user_ids']),
                    company_id,
                    status
                ))
                logger.info(f"Group {group_id} attached to company {company_id} with status {status}")

    def record_group_request(
        self,
        group_id: int,
        group_name: str,
        registration_message_id: int,
        requested_by_user_id: int,
        requested_by_handle: str,
        requested_company_name: Optional[str] = None
    ):
        """Record or update a pending group registration request."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO groups (
                        group_id,
                        group_name,
                        status,
                        registration_message_id,
                        requested_by_user_id,
                        requested_by_handle,
                        requested_company_name,
                        company_id
                    )
                    VALUES (?, ?, 'pending', ?, ?, ?, ?, NULL)
                    ON CONFLICT(group_id) DO UPDATE SET
                        group_name = excluded.group_name,
                        status = 'pending',
                        registration_message_id = excluded.registration_message_id,
                        requested_by_user_id = excluded.requested_by_user_id,
                        requested_by_handle = excluded.requested_by_handle,
                        requested_company_name = COALESCE(
                            excluded.requested_company_name,
                            requested_company_name
                        ),
                        company_id = NULL
                """, (
                    group_id,
                    group_name,
                    registration_message_id,
                    requested_by_user_id,
                    requested_by_handle,
                    requested_company_name
                ))
                logger.info(f"Recorded registration request for group {group_id}")

    def update_group_request_details(
        self,
        group_id: int,
        requested_company_name: Optional[str] = None,
        requested_by_user_id: Optional[int] = None,
        requested_by_handle: Optional[str] = None
    ):
        """Update the stored registration metadata for a pending group."""
        updates = []
        params: List[Any] = []

        if requested_company_name is not None:
            updates.append("requested_company_name = ?")
            params.append(requested_company_name)

        if requested_by_user_id is not None:
            updates.append("requested_by_user_id = ?")
            params.append(requested_by_user_id)

        if requested_by_handle is not None:
            updates.append("requested_by_handle = ?")
            params.append(requested_by_handle)

        if not updates:
            return

        params.append(group_id)

        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    f"UPDATE groups SET {', '.join(updates)} WHERE group_id = ?",
                    params
                )
                logger.info(f"Updated registration details for group {group_id}")

    def get_pending_groups(self) -> List[Dict[str, Any]]:
        """Return all groups awaiting activation."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM groups WHERE status = 'pending' ORDER BY group_id ASC")
            rows = cursor.fetchall()
            pending = []
            for row in rows:
                pending.append({
                    'group_id': row['group_id'],
                    'group_name': row['group_name'],
                    'registration_message_id': row['registration_message_id'],
                    'requested_by_user_id': row['requested_by_user_id'],
                    'requested_by_handle': row['requested_by_handle'],
                    'requested_company_name': row['requested_company_name']
                })
            return pending

    def get_company_membership(self, group_id: int) -> Optional[Dict[str, Any]]:
        """Return combined group/company information for a group."""
        group = self.get_group(group_id)
        if not group:
            return None

        company = self.get_company_by_id(group['company_id']) if group['company_id'] else None
        return {
            'group': group,
            'company': company,
            'is_active': group['status'] == 'active'
        }

    # ==================== Company Access Keys Management ====================

    @sentry_trace("create_access_key")
    def create_access_key(self, company_id: int, access_key: str,
                          description: str = None, created_by_user_id: int = None,
                          expires_at: str = None) -> int:
        """Create a new access key for a company.

        Args:
            company_id: The company to grant access to
            access_key: The secret access key (should be generated securely)
            description: Optional description (e.g., "Admin Dashboard Access")
            created_by_user_id: Optional platform admin who created this key
            expires_at: Optional expiration timestamp (ISO format)

        Returns:
            access_key_id
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                now = utc_iso_now()
                cursor.execute("""
                    INSERT INTO company_access_keys
                    (company_id, access_key, description, created_at,
                     created_by_user_id, expires_at, is_active, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, 1, '{}')
                """, (company_id, access_key, description, now, created_by_user_id, expires_at))
                access_key_id = cursor.lastrowid
                logger.info(f"Created access key {access_key_id} for company {company_id}")
                return access_key_id

    @sentry_trace("validate_access_key")
    def validate_access_key(self, access_key: str) -> Optional[Dict[str, Any]]:
        """Validate an access key and return company info if valid.

        Args:
            access_key: The access key to validate

        Returns:
            Dict with company_id, company_name, access_key_id if valid, None otherwise
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT
                    ak.access_key_id,
                    ak.company_id,
                    ak.is_active,
                    ak.expires_at,
                    c.name as company_name
                FROM company_access_keys ak
                JOIN companies c ON ak.company_id = c.company_id
                WHERE ak.access_key = ?
            """, (access_key,))
            row = cursor.fetchone()

            if not row:
                logger.warning(f"Access key validation failed: key not found")
                return None

            if not row['is_active']:
                logger.warning(f"Access key validation failed: key is inactive")
                return None

            # Check expiration
            if row['expires_at']:
                from datetime import datetime
                expires_at = datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00'))
                if utc_now() > expires_at:
                    logger.warning(f"Access key validation failed: key expired")
                    return None

            # Update last_used_at
            self._update_access_key_last_used(row['access_key_id'])

            logger.info(f"Access key validated successfully for company {row['company_id']}")
            return {
                'access_key_id': row['access_key_id'],
                'company_id': row['company_id'],
                'company_name': row['company_name']
            }

    def _update_access_key_last_used(self, access_key_id: int):
        """Update the last_used_at timestamp for an access key."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE company_access_keys
                    SET last_used_at = ?
                    WHERE access_key_id = ?
                """, (utc_iso_now(), access_key_id))

    @sentry_trace("list_company_access_keys")
    def list_company_access_keys(self, company_id: int) -> List[Dict[str, Any]]:
        """List all access keys for a company."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT
                    access_key_id,
                    company_id,
                    access_key,
                    description,
                    created_at,
                    created_by_user_id,
                    expires_at,
                    is_active,
                    last_used_at,
                    metadata
                FROM company_access_keys
                WHERE company_id = ?
                ORDER BY created_at DESC
            """, (company_id,))
            return [dict(row) for row in cursor.fetchall()]

    @sentry_trace("revoke_access_key")
    def revoke_access_key(self, access_key_id: int):
        """Revoke (deactivate) an access key."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE company_access_keys
                    SET is_active = 0
                    WHERE access_key_id = ?
                """, (access_key_id,))
                logger.info(f"Revoked access key {access_key_id}")

    @sentry_trace("delete_access_key")
    def delete_access_key(self, access_key_id: int):
        """Permanently delete an access key."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    DELETE FROM company_access_keys
                    WHERE access_key_id = ?
                """, (access_key_id,))
                logger.info(f"Deleted access key {access_key_id}")

    # ==================== Group Management ====================

    def upsert_group(self, group_id: int, group_name: str,
                     manager_handles: List[str] = None,
                     manager_user_ids: List[int] = None,
                     dispatcher_user_ids: List[int] = None):
        """Insert or update group configuration."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                manager_handles_json = json.dumps(manager_handles or [])
                manager_user_ids_json = json.dumps(manager_user_ids or [])
                dispatcher_user_ids_json = json.dumps(dispatcher_user_ids or [])

                cursor.execute("""
                    INSERT INTO groups
                    (group_id, group_name, manager_handles, manager_user_ids, dispatcher_user_ids)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(group_id) DO UPDATE SET
                        group_name = excluded.group_name,
                        manager_handles = excluded.manager_handles,
                        manager_user_ids = excluded.manager_user_ids,
                        dispatcher_user_ids = excluded.dispatcher_user_ids
                """, (group_id, group_name, manager_handles_json,
                      manager_user_ids_json, dispatcher_user_ids_json))

                logger.info(f"Group {group_id} ({group_name}) configuration updated")

    def get_group(self, group_id: int) -> Optional[Dict[str, Any]]:
        """Get group configuration by group_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
            row = cursor.fetchone()

            if row:
                return {
                    'group_id': row['group_id'],
                    'group_name': row['group_name'],
                    'manager_handles': json.loads(row['manager_handles'] or '[]'),
                    'manager_user_ids': json.loads(row['manager_user_ids'] or '[]'),
                    'dispatcher_user_ids': json.loads(row['dispatcher_user_ids'] or '[]'),
                    'company_id': row['company_id'],
                    'status': row['status'] or 'active',
                    'registration_message_id': row['registration_message_id'],
                    'requested_by_user_id': row['requested_by_user_id'],
                    'requested_by_handle': row['requested_by_handle'],
                    'requested_company_name': row['requested_company_name']
                }
            return None

    def add_dispatcher_to_group(self, group_id: int, user_id: int):
        """Add a dispatcher to a group's authorized list."""
        with self._lock:
            group = self.get_group(group_id)
            if group:
                dispatcher_ids = group['dispatcher_user_ids']
                if user_id not in dispatcher_ids:
                    dispatcher_ids.append(user_id)
                    with self.get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE groups
                            SET dispatcher_user_ids = ?
                            WHERE group_id = ?
                        """, (json.dumps(dispatcher_ids), group_id))
                        logger.info(f"Added dispatcher {user_id} to group {group_id}")

    def add_manager_to_group(self, group_id: int, user_id: int, handle: str):
        """Add a manager to a group's authorized list."""
        with self._lock:
            group = self.get_group(group_id)
            if group:
                manager_ids = group['manager_user_ids']
                manager_handles = group['manager_handles']

                if user_id not in manager_ids:
                    manager_ids.append(user_id)
                    if handle not in manager_handles:
                        manager_handles.append(handle)

                    with self.get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE groups
                            SET manager_user_ids = ?, manager_handles = ?
                            WHERE group_id = ?
                        """, (json.dumps(manager_ids), json.dumps(manager_handles), group_id))
                        logger.info(f"Added manager {user_id} ({handle}) to group {group_id}")

    # ==================== User Management ====================

    def track_user(self, user_id: int, username: Optional[str] = None,
                   first_name: Optional[str] = None, last_name: Optional[str] = None,
                   language_code: Optional[str] = None, is_bot: bool = False,
                   group_id: Optional[int] = None, team_role: Optional[str] = None):
        """
        Comprehensive user tracking function with change detection.
        Captures all available Telegram user data and only writes when something changed.

        Args:
            user_id: Telegram user ID (required)
            username: Telegram username without @ (optional)
            first_name: User's first name (optional, but usually available)
            last_name: User's last name (optional)
            language_code: User's language preference (optional)
            is_bot: Whether the user is a bot (default: False)
            group_id: Group ID where user was seen (optional, adds to group_connections)
            team_role: User's team role if applicable (optional, preserves higher roles)

        Returns:
            Dict containing the user's complete information after upsert
        """
        with self._lock:
            timestamp = utc_iso_now()

            with self.get_connection() as conn:
                cursor = conn.cursor()

                cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
                existing_row = cursor.fetchone()

                # Preserve existing handles when no username is provided
                existing_handle = existing_row['telegram_handle'] if existing_row else None
                telegram_handle = (
                    f"@{username}" if username else existing_handle or f"User_{user_id}"
                )

                # Deduplicate and normalize group connections
                existing_connections = json.loads(existing_row['group_connections'] or '[]') if existing_row else []
                group_connections = set(existing_connections)
                if group_id is not None:
                    group_connections.add(group_id)
                group_connections_json = json.dumps(sorted(group_connections))

                # Load metadata for change history
                metadata = json.loads(existing_row['metadata'] or '{}') if existing_row else {}
                account_changes = metadata.get('accountChanges', [])

                # Preserve existing role unless a new one is provided
                final_team_role = existing_row['team_role'] if existing_row and existing_row['team_role'] else None
                if team_role:
                    final_team_role = team_role

                created_at = existing_row['created_at'] if existing_row and existing_row['created_at'] else timestamp

                if not existing_row:
                    cursor.execute("""
                        INSERT INTO users (
                            user_id, telegram_handle, username, first_name, last_name,
                            language_code, is_bot, team_role, group_connections,
                            metadata, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        user_id, telegram_handle, username, first_name, last_name,
                        language_code, 1 if is_bot else 0, final_team_role,
                        group_connections_json, json.dumps({"accountChanges": []}), created_at, timestamp
                    ))
                    logger.info(
                        f"Tracked user {user_id} ({telegram_handle}) "
                        f"[first_name={first_name}, last_name={last_name}, "
                        f"role={final_team_role}, groups={len(group_connections)}]"
                    )
                else:
                    changes = {}
                    change_details = {}

                    def record_change(column: str, new_value):
                        if new_value is None:
                            return
                        if existing_row[column] != new_value:
                            changes[column] = new_value
                            change_details[column] = {
                                "old": existing_row[column],
                                "new": new_value
                            }

                    record_change('telegram_handle', telegram_handle)
                    record_change('username', username or existing_row['username'])
                    record_change('first_name', first_name or existing_row['first_name'])
                    record_change('last_name', last_name or existing_row['last_name'])
                    record_change('language_code', language_code or existing_row['language_code'])
                    record_change('is_bot', 1 if is_bot else 0)
                    record_change('team_role', final_team_role or existing_row['team_role'])
                    record_change('group_connections', group_connections_json)
                    if not existing_row['created_at']:
                        changes['created_at'] = created_at

                    if changes:
                        # Append change audit entry
                        account_changes.append({
                            "at": timestamp,
                            "changes": change_details
                        })
                        metadata['accountChanges'] = account_changes[-100:]  # cap history to keep payload bounded
                        changes['metadata'] = json.dumps(metadata)

                        changes['updated_at'] = timestamp
                        set_clause = ", ".join(f"{col} = ?" for col in changes.keys())
                        params = list(changes.values()) + [user_id]
                        cursor.execute(f"UPDATE users SET {set_clause} WHERE user_id = ?", params)
                        logger.info(
                            f"Updated user {user_id} ({telegram_handle}); fields changed: {sorted(changes.keys())}"
                        )
                    else:
                        logger.debug(f"No user field changes detected for {user_id}; skipping update")

        # Return updated user data (outside the lock context)
        return self.get_user(user_id)

    def upsert_user(self, user_id: int, telegram_handle: str, team_role: Optional[str]):
        """
        Legacy user upsert function (maintained for backward compatibility).
        Prefer using track_user() for new code.
        """
        # Extract username from telegram_handle if it has @
        username = telegram_handle[1:] if telegram_handle.startswith('@') else None

        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                timestamp = utc_iso_now()

                # Get existing data to preserve
                cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
                existing_row = cursor.fetchone()

                group_connections = '[]'
                created_at = timestamp
                if existing_row:
                    group_connections = existing_row['group_connections'] or '[]'
                    created_at = existing_row['created_at'] or timestamp

                cursor.execute("""
                    INSERT INTO users (
                        user_id, telegram_handle, username, team_role,
                        group_connections, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        telegram_handle = excluded.telegram_handle,
                        username = COALESCE(excluded.username, username),
                        team_role = excluded.team_role,
                        updated_at = excluded.updated_at
                """, (user_id, telegram_handle, username, team_role,
                      group_connections, created_at, timestamp))

                logger.info(f"User {user_id} ({telegram_handle}) registered as {team_role}")

    def get_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get comprehensive user information by user_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()

            if row:
                return {
                    'user_id': row['user_id'],
                    'telegram_handle': row['telegram_handle'],
                    'username': row['username'],
                    'first_name': row['first_name'],
                    'last_name': row['last_name'],
                    'language_code': row['language_code'],
                    'is_bot': bool(row['is_bot']),
                    'team_role': row['team_role'],
                    'group_connections': json.loads(row['group_connections'] or '[]'),
                    'created_at': row['created_at'],
                    'updated_at': row['updated_at']
                }
            return None

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Get user information by username.

        Args:
            username: Username with or without @ prefix (e.g., 'shjavohir' or '@shjavohir')

        Returns:
            User dict if found, None otherwise
        """
        # Normalize username by removing @ if present
        normalized_username = username.lstrip('@').lower()

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM users WHERE LOWER(username) = ?",
                (normalized_username,)
            )
            row = cursor.fetchone()

            if row:
                return {
                    'user_id': row['user_id'],
                    'telegram_handle': row['telegram_handle'],
                    'username': row['username'],
                    'first_name': row['first_name'],
                    'last_name': row['last_name'],
                    'language_code': row['language_code'],
                    'is_bot': bool(row['is_bot']),
                    'team_role': row['team_role'],
                    'group_connections': json.loads(row['group_connections'] or '[]'),
                    'created_at': row['created_at'],
                    'updated_at': row['updated_at']
                }
            return None

    def get_user_handle_or_fallback(self, user_id: Optional[int]) -> str:
        """Return a readable handle for a user or a defensive fallback."""
        if not user_id:
            return "the assigned responder"

        user = self.get_user(user_id)
        handle = (user.get('telegram_handle') if user else None) or (user.get('username') if user else None)
        if handle:
            return handle
        return f"User_{user_id}"

    def add_group_connection_to_user(self, user_id: int, group_id: int):
        """
        Add a group connection to an existing user.
        Creates user record if it doesn't exist.
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                # Get existing user
                cursor.execute("SELECT group_connections FROM users WHERE user_id = ?", (user_id,))
                row = cursor.fetchone()

                if row:
                    # User exists, update group_connections
                    connections = json.loads(row['group_connections'] or '[]')
                    if group_id not in connections:
                        connections.append(group_id)
                        cursor.execute("""
                            UPDATE users
                            SET group_connections = ?,
                                updated_at = ?
                            WHERE user_id = ?
                        """, (json.dumps(connections), utc_iso_now(), user_id))
                        logger.info(f"Added group {group_id} to user {user_id}'s connections")
                else:
                    # User doesn't exist, create minimal record with group connection
                    timestamp = utc_iso_now()
                    cursor.execute("""
                        INSERT INTO users (
                            user_id, telegram_handle, group_connections,
                            created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?)
                    """, (user_id, f"User_{user_id}", json.dumps([group_id]),
                          timestamp, timestamp))
                    logger.info(f"Created user {user_id} with group {group_id} connection")

    # ==================== Department Management ====================

    def _serialize_department_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            'department_id': row['department_id'],
            'company_id': row['company_id'],
            'name': row['name'],
            'metadata': json.loads(row['metadata'] or '{}'),
            'created_at': row['created_at'],
            'updated_at': row['updated_at']
        }

    def create_department(self, company_id: int, name: str,
                          metadata: Optional[Dict[str, Any]] = None) -> int:
        """Create a department within a company."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                timestamp = utc_iso_now()
                try:
                    cursor.execute("""
                        INSERT INTO departments (company_id, name, metadata, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (company_id, name.strip(), json.dumps(metadata or {}), timestamp, timestamp))
                except sqlite3.IntegrityError as exc:
                    raise ValueError(f"Department named '{name}' already exists for this company") from exc
                department_id = cursor.lastrowid
                logger.info(f"Created department {department_id} ({name}) for company {company_id}")
                return department_id

    def list_company_departments(self, company_id: int) -> List[Dict[str, Any]]:
        """Return departments for a company ordered by name."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM departments
                WHERE company_id = ?
                ORDER BY name ASC
            """, (company_id,))
            return [self._serialize_department_row(row) for row in cursor.fetchall()]

    def get_department(self, department_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a single department by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM departments WHERE department_id = ?", (department_id,))
            row = cursor.fetchone()
            if row:
                return self._serialize_department_row(row)
            return None

    def add_member_to_department(self, department_id: int, user_id: int):
        """Add a user to a department membership list."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT OR IGNORE INTO department_members (department_id, user_id, added_at)
                    VALUES (?, ?, ?)
                """, (department_id, user_id, utc_iso_now()))
                logger.info(f"Added user {user_id} to department {department_id}")

    def remove_member_from_department(self, department_id: int, user_id: int):
        """Remove a user from a department."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    DELETE FROM department_members
                    WHERE department_id = ? AND user_id = ?
                """, (department_id, user_id))
                logger.info(f"Removed user {user_id} from department {department_id}")

    def get_department_member_ids(self, department_id: int) -> List[int]:
        """Return member IDs for a department."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT user_id FROM department_members
                WHERE department_id = ?
            """, (department_id,))
            return [int(row['user_id']) for row in cursor.fetchall()]

    def is_user_in_department(self, department_id: int, user_id: int) -> bool:
        """Check whether a user belongs to a department."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 1 FROM department_members
                WHERE department_id = ? AND user_id = ?
                LIMIT 1
            """, (department_id, user_id))
            return cursor.fetchone() is not None

    def get_department_handles(self, department_id: int) -> List[str]:
        """Return readable handles for a department's members."""
        member_ids = self.get_department_member_ids(department_id)
        handles: List[str] = []
        for user_id in member_ids:
            user = self.get_user(user_id)
            handle = (user.get('telegram_handle') if user else None) or f"User_{user_id}"
            handles.append(handle)
        return handles

    # ==================== Incident Management ====================

    def generate_incident_id(self) -> str:
        """Generate next incident ID as a zero-padded sequence (e.g., 0004)."""

        def extract_suffix(incident_id: str) -> int:
            """Return the last digit group from legacy or new IDs."""
            matches = re.findall(r"(\d+)", incident_id or "")
            return int(matches[-1]) if matches else 0

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT incident_id FROM incidents")
            rows = cursor.fetchall()

        last_num = max((extract_suffix(row['incident_id']) for row in rows), default=0)
        new_num = last_num + 1
        return f"{new_num:04d}"

    @sentry_trace(op="db.create", description="Create incident")
    def create_incident(self, group_id: int, created_by_id: int,
                        created_by_handle: str, description: str,
                        pinned_message_id: int = None,
                        company_id: Optional[int] = None,
                        source_message_id: Optional[int] = None) -> str:
        """Create a new incident and return its ID."""
        with self._lock:
            incident_id = self.generate_incident_id()
            t_created = utc_iso_now()
            company_id_to_use = company_id

            if company_id_to_use is None:
                group = self.get_group(group_id)
                company_id_to_use = group['company_id'] if group else None

            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO incidents (
                        incident_id, group_id, company_id, pinned_message_id, status,
                        created_by_id, created_by_handle, description, t_created,
                        source_message_id
                    )
                    VALUES (?, ?, ?, ?, 'Awaiting_Department', ?, ?, ?, ?, ?)
                """, (
                    incident_id,
                    group_id,
                    company_id_to_use,
                    pinned_message_id,
                    created_by_id,
                    created_by_handle,
                    description,
                    t_created,
                    source_message_id
                ))

                self._record_event(cursor, incident_id, 'create', created_by_id, metadata={
                    'group_id': group_id,
                    'company_id': company_id_to_use
                })

                logger.info(f"Created incident {incident_id} in group {group_id}")
                return incident_id

    def update_incident_message_id(self, incident_id: str, message_id: int):
        """Update the pinned message ID for an incident."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE incidents
                    SET pinned_message_id = ?
                    WHERE incident_id = ?
                """, (message_id, incident_id))

    @sentry_trace(op="db.query", description="Get incident")
    def get_incident(self, incident_id: str) -> Optional[Dict[str, Any]]:
        """Get incident details by incident_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM incidents WHERE incident_id = ?", (incident_id,))
            row = cursor.fetchone()

            if row:
                return dict(row)
            return None

    def get_incident_by_message_id(self, message_id: int) -> Optional[Dict[str, Any]]:
        """Get incident details by pinned_message_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM incidents
                WHERE pinned_message_id = ?
            """, (message_id,))
            row = cursor.fetchone()

            if row:
                return dict(row)
            return None

    # ==================== Claim Helpers ====================

    def _record_event(self, cursor, incident_id: str, event_type: str,
                      user_id: Optional[int] = None,
                      metadata: Optional[Dict[str, Any]] = None):
        """Persist a lightweight event for audit and KPIs."""
        cursor.execute("""
            INSERT INTO incident_events (incident_id, event_type, actor_user_id, at, metadata)
            VALUES (?, ?, ?, ?, ?)
        """, (
            incident_id,
            event_type,
            user_id,
            utc_iso_now(),
            json.dumps(metadata or {})
        ))

    def _get_department_name(self, cursor, department_id: Optional[int]) -> Optional[str]:
        """Fetch department name within an existing transaction."""
        if department_id is None:
            return None
        cursor.execute("SELECT name FROM departments WHERE department_id = ?", (department_id,))
        row = cursor.fetchone()
        return row['name'] if row else None

    def _start_participation(self, cursor, incident_id: str, user_id: int,
                             department_id: Optional[int], claimed_at: str):
        """Create or reactivate participant rollup for KPI calculations."""
        cursor.execute("""
            INSERT INTO incident_participants (
                incident_id, user_id, department_id,
                first_claimed_at, last_claimed_at,
                active_since, is_active, status, join_count
            )
            VALUES (?, ?, ?, ?, ?, ?, 1, 'active', 1)
            ON CONFLICT(incident_id, user_id, department_id) DO UPDATE SET
                last_claimed_at = excluded.last_claimed_at,
                active_since = excluded.active_since,
                is_active = 1,
                status = 'active',
                join_count = incident_participants.join_count + 1,
                outcome_detail = NULL,
                resolved_at = NULL
        """, (incident_id, user_id, department_id, claimed_at, claimed_at, claimed_at))

    def _finalize_participation(self, cursor, incident_id: str, user_id: int,
                                department_id: Optional[int], stop_time: str, status: str,
                                outcome_detail: Optional[str] = None,
                                mark_resolved: bool = False):
        """Close out a participant's active session and accrue time."""
        cursor.execute("""
            SELECT total_active_seconds, active_since, is_active
            FROM incident_participants
            WHERE incident_id = ?
              AND user_id = ?
              AND COALESCE(department_id, -1) = COALESCE(?, -1)
        """, (incident_id, user_id, department_id))
        row = cursor.fetchone()
        if not row:
            return

        total_seconds = int(row['total_active_seconds'] or 0)
        active_since = row['active_since']

        if row['is_active'] and active_since:
            try:
                started = parse_timestamp(active_since)
                ended = parse_timestamp(stop_time)
                delta = int(max(0, (ended - started).total_seconds()))
                total_seconds += delta
            except Exception as exc:
                logger.warning(f"Could not compute active duration for {incident_id}/{user_id}: {exc}")

        cursor.execute("""
            UPDATE incident_participants
            SET is_active = 0,
                active_since = NULL,
                last_released_at = ?,
                total_active_seconds = ?,
                status = ?,
            resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END,
            outcome_detail = COALESCE(?, outcome_detail)
            WHERE incident_id = ?
              AND user_id = ?
              AND COALESCE(department_id, -1) = COALESCE(?, -1)
        """, (
            stop_time,
            total_seconds,
            status,
            1 if mark_resolved else 0,
            stop_time,
            outcome_detail,
            incident_id,
            user_id,
            department_id
        ))

    def _finalize_active_participants(self, cursor, incident_id: str,
                                      resolved_by_user_id: int, resolved_at: str):
        """Snap the duration for all active participants when incident closes."""
        cursor.execute("""
            SELECT user_id, department_id FROM incident_participants
            WHERE incident_id = ? AND is_active = 1
        """, (incident_id,))

        for row in cursor.fetchall():
            status = 'resolved_self' if row['user_id'] == resolved_by_user_id else 'resolved_other'
            self._finalize_participation(
                cursor,
                incident_id,
                row['user_id'],
                row['department_id'],
                resolved_at,
                status,
                mark_resolved=True
            )

    def _finalize_active_participants_closed(self, cursor, incident_id: str, closed_at: str):
        """Close out active participants when an incident is auto-closed."""
        cursor.execute("""
            SELECT user_id, department_id FROM incident_participants
            WHERE incident_id = ? AND is_active = 1
        """, (incident_id,))

        for row in cursor.fetchall():
            self._finalize_participation(
                cursor,
                incident_id,
                row['user_id'],
                row['department_id'],
                closed_at,
                'closed',
                mark_resolved=True
            )

    def _close_active_claims(self, cursor, incident_id: str, closed_at: str):
        """Mark any lingering active claims as released at a specific time."""
        cursor.execute("""
            UPDATE incident_claims
            SET is_active = 0,
                released_at = COALESCE(released_at, ?)
            WHERE incident_id = ? AND is_active = 1
        """, (closed_at, incident_id))

    def _get_active_department_session_id(self, cursor, incident_id: str) -> Optional[int]:
        cursor.execute("""
            SELECT session_id FROM incident_department_sessions
            WHERE incident_id = ? AND status = 'active'
            ORDER BY assigned_at DESC
            LIMIT 1
        """, (incident_id,))
        row = cursor.fetchone()
        return int(row['session_id']) if row else None

    def _start_department_session(self, cursor, incident_id: str, department_id: int,
                                  user_id: Optional[int], assigned_at: str) -> int:
        cursor.execute("""
            INSERT INTO incident_department_sessions (
                incident_id, department_id, assigned_at, assigned_by_user_id, status
            ) VALUES (?, ?, ?, ?, 'active')
        """, (incident_id, department_id, assigned_at, user_id))
        return cursor.lastrowid

    def _end_active_department_session(self, cursor, incident_id: str, end_time: str, status: str):
        cursor.execute("""
            UPDATE incident_department_sessions
            SET status = ?,
                released_at = COALESCE(released_at, ?)
            WHERE incident_id = ? AND status = 'active'
        """, (status, end_time, incident_id))

    def _has_active_claim(self, cursor, incident_id: str, user_id: int) -> bool:
        """Return True if the user already has an active claim on the incident."""
        cursor.execute("""
            SELECT 1 FROM incident_claims
            WHERE incident_id = ? AND user_id = ? AND is_active = 1
            LIMIT 1
        """, (incident_id, user_id))
        return cursor.fetchone() is not None

    def _count_active_claims(self, cursor, incident_id: str) -> int:
        """Count how many active claims exist for an incident."""
        cursor.execute("""
            SELECT COUNT(*) AS cnt FROM incident_claims
            WHERE incident_id = ? AND is_active = 1
        """, (incident_id,))
        row = cursor.fetchone()
        return int(row['cnt']) if row and row['cnt'] is not None else 0

    def _touch_department_session_claim(self, cursor, incident_id: str, claimed_at: str):
        cursor.execute("""
            UPDATE incident_department_sessions
            SET claimed_at = COALESCE(claimed_at, ?)
            WHERE incident_id = ? AND status = 'active'
        """, (claimed_at, incident_id))

    def assign_incident_department(self, incident_id: str, department_id: int,
                                   assigned_by_user_id: int) -> Tuple[bool, str]:
        """Attach or change the department handling an incident."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                incident = self.get_incident(incident_id)
                if not incident:
                    return False, "Incident not found."
                if incident['status'] in ('Resolved', 'Closed', 'Awaiting_Summary'):
                    return False, "Department cannot be changed while the incident is closing out."
                if incident.get('department_id') == department_id and incident['status'] != 'Awaiting_Department':
                    return False, "Incident already assigned to this department."

                # Verify department belongs to the same company (if set)
                dept = self.get_department(department_id)
                if not dept:
                    return False, "Department not found."
                if incident.get('company_id') and dept['company_id'] != incident['company_id']:
                    return False, "Department does not belong to this company."

                previous_department_id = incident.get('department_id')
                previous_department_name = self._get_department_name(cursor, previous_department_id)
                new_department_name = dept['name']

                now = utc_iso_now()

                active_claims = []
                cursor.execute("""
                    SELECT user_id, department_id FROM incident_claims
                    WHERE incident_id = ? AND is_active = 1
                """, (incident_id,))
                active_claims = cursor.fetchall()

                # Finalize any active work on the previous department
                for row in active_claims:
                    self._finalize_participation(
                        cursor,
                        incident_id,
                        row['user_id'],
                        row['department_id'],
                        now,
                        'transferred'
                    )
                if active_claims:
                    self._close_active_claims(cursor, incident_id, now)

                # Close active department session if present
                self._end_active_department_session(cursor, incident_id, now, 'transferred')

                session_id = self._start_department_session(cursor, incident_id, department_id, assigned_by_user_id, now)

                cursor.execute("""
                    UPDATE incidents
                    SET department_id = ?,
                        status = 'Awaiting_Claim',
                        t_department_assigned = ?,
                        current_department_session_id = ?
                    WHERE incident_id = ?
                """, (department_id, now, session_id, incident_id))

                self._record_event(cursor, incident_id, 'department_assigned', assigned_by_user_id, metadata={
                    'department_id': department_id,
                    'department_name': new_department_name,
                    'previous_department_id': previous_department_id,
                    'previous_department_name': previous_department_name,
                    'status_before': incident['status']
                })
                logger.info(f"Incident {incident_id} assigned to department {department_id}")
                return True, "Department updated"

    @sentry_trace(op="db.update", description="Claim incident")
    def claim_incident(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """Claim or co-claim an incident for the current department."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT status, department_id FROM incidents WHERE incident_id = ?
                """, (incident_id,))
                incident = cursor.fetchone()

                if not incident:
                    return False, "Incident not found."

                if not incident['department_id']:
                    return False, "Incident does not have a department yet."

                status = incident['status']
                if status not in ('Awaiting_Claim', 'In_Progress'):
                    return False, "This incident cannot be claimed right now."

                if self._has_active_claim(cursor, incident_id, user_id):
                    return False, "You're already working on this incident."

                t_claimed = utc_iso_now()
                cursor.execute("""
                    INSERT INTO incident_claims (incident_id, user_id, department_id, claimed_at, is_active)
                    VALUES (?, ?, ?, ?, 1)
                """, (incident_id, user_id, incident['department_id'], t_claimed))

                self._start_participation(cursor, incident_id, user_id, incident['department_id'], claimed_at=t_claimed)

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'In_Progress',
                        t_first_claimed = COALESCE(t_first_claimed, ?),
                        t_last_claimed = ?,
                        pending_resolution_by_user_id = NULL
                    WHERE incident_id = ?
                """, (t_claimed, t_claimed, incident_id))

                self._touch_department_session_claim(cursor, incident_id, t_claimed)
                department_name = self._get_department_name(cursor, incident['department_id'])
                self._record_event(cursor, incident_id, 'claim', user_id, metadata={
                    'department_id': incident['department_id'],
                    'department_name': department_name,
                    'is_first_claim': incident['t_first_claimed'] is None
                })

                logger.info(f"Incident {incident_id} claimed by user {user_id}")
                return True, "Claim successful"

    def release_claim(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """Release an active claim for the requesting user."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT department_id, status FROM incidents WHERE incident_id = ?
                """, (incident_id,))
                incident = cursor.fetchone()
                if not incident:
                    return False, "Incident not found."

                if incident['status'] not in ('Awaiting_Claim', 'In_Progress'):
                    return False, "You cannot leave this incident right now."

                cursor.execute("""
                    SELECT department_id FROM incident_claims
                    WHERE incident_id = ? AND user_id = ? AND is_active = 1
                """, (incident_id, user_id))
                claim_row = cursor.fetchone()
                if not claim_row:
                    return False, "You are not part of this incident."

                t_released = utc_iso_now()
                cursor.execute("""
                    UPDATE incident_claims
                    SET is_active = 0,
                        released_at = ?
                    WHERE incident_id = ?
                      AND user_id = ?
                      AND is_active = 1
                """, (t_released, incident_id, user_id))

                self._finalize_participation(
                    cursor,
                    incident_id,
                    user_id,
                    claim_row['department_id'],
                    stop_time=t_released,
                    status='released'
                )

                remaining = self._count_active_claims(cursor, incident_id)

                if remaining == 0 and incident['status'] != 'Awaiting_Summary':
                    cursor.execute("""
                        UPDATE incidents
                        SET status = 'Awaiting_Claim'
                        WHERE incident_id = ?
                    """, (incident_id,))

                self._record_event(
                    cursor,
                    incident_id,
                    'release',
                    user_id,
                    metadata={
                        'remaining_active': remaining,
                        'department_id': claim_row['department_id'],
                        'department_name': self._get_department_name(cursor, claim_row['department_id'])
                    }
                )

                logger.info(f"Incident {incident_id} released by user {user_id}")
                return True, "Claim released successfully"

    def get_active_claims(self, incident_id: str, department_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Return active claims with handles for an incident (optionally filtered by department)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            params: List[Any] = [incident_id]
            dept_clause = ""
            if department_id is not None:
                dept_clause = "AND ic.department_id = ?"
                params.append(department_id)
            cursor.execute(f"""
                SELECT ic.user_id, ic.claimed_at, u.telegram_handle
                FROM incident_claims ic
                LEFT JOIN users u ON ic.user_id = u.user_id
                WHERE ic.incident_id = ? AND ic.is_active = 1 {dept_clause}
                ORDER BY ic.claimed_at ASC
            """, params)

            claims = []
            for row in cursor.fetchall():
                handle = row['telegram_handle'] or f"User_{row['user_id']}"
                claims.append({
                    'user_id': row['user_id'],
                    'claimed_at': row['claimed_at'],
                    'handle': handle
                })
            return claims

    def get_active_claim_handles(self, incident_id: str, department_id: Optional[int] = None) -> List[str]:
        """Return active claimer handles (deduplicated) for a given incident."""
        claims = self.get_active_claims(incident_id, department_id)
        handles = []
        seen = set()
        for claim in claims:
            handle = claim['handle']
            if handle in seen:
                continue
            seen.add(handle)
            handles.append(handle)
        return handles

    def get_incident_participants(self, incident_id: str) -> List[Dict[str, Any]]:
        """Return participant rollups for an incident (all departments)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM incident_participants
                WHERE incident_id = ?
                ORDER BY department_id ASC, user_id ASC
            """, (incident_id,))
            return [dict(row) for row in cursor.fetchall()]

    def get_incident_events(self, incident_id: str) -> List[Dict[str, Any]]:
        """Return chronological event log for an incident."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM incident_events
                WHERE incident_id = ?
                ORDER BY at ASC, event_id ASC
            """, (incident_id,))
            return [dict(row) for row in cursor.fetchall()]

    def request_resolution(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """
        Request resolution summary from the current owner.
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_resolution_requested = utc_iso_now()

                cursor.execute("""
                    SELECT status, department_id FROM incidents WHERE incident_id = ?
                """, (incident_id,))
                incident = cursor.fetchone()

                if not incident:
                    return False, "Incident not found."

                status = incident['status']
                department_id = incident['department_id']

                if status != 'In_Progress':
                    return False, "You cannot resolve this incident right now."

                if not self._has_active_claim(cursor, incident_id, user_id):
                    return False, "You need to be an active claimer to resolve."

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Awaiting_Summary',
                        pending_resolution_by_user_id = ?,
                        t_resolution_requested = ?
                    WHERE incident_id = ?
                      AND status = 'In_Progress'
                """, (user_id, t_resolution_requested, incident_id))

                if cursor.rowcount > 0:
                    self._record_event(
                        cursor,
                        incident_id,
                        'resolution_requested',
                        user_id,
                        metadata={
                            'department_id': department_id,
                            'department_name': self._get_department_name(cursor, department_id)
                        }
                    )
                    logger.info(f"Resolution requested for {incident_id} from user {user_id}")
                    return True, "Resolution requested successfully"

                return False, "You cannot resolve this incident."

    @sentry_trace(op="db.update", description="Resolve incident")
    def resolve_incident(self, incident_id: str, user_id: int,
                         resolution_summary: str) -> Tuple[bool, str]:
        """
        Mark incident as resolved with a summary.
        Only the user who was asked for the summary can resolve.
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_resolved = utc_iso_now()

                cursor.execute("""
                    SELECT department_id FROM incidents
                    WHERE incident_id = ?
                      AND status = 'Awaiting_Summary'
                      AND pending_resolution_by_user_id = ?
                """, (incident_id, user_id))
                row = cursor.fetchone()
                if not row:
                    return False, "You cannot resolve this incident or it's not awaiting summary."

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Resolved',
                        resolution_summary = ?,
                        t_resolved = ?,
                        pending_resolution_by_user_id = NULL,
                        resolved_by_user_id = ?
                    WHERE incident_id = ?
                      AND status = 'Awaiting_Summary'
                      AND pending_resolution_by_user_id = ?
                """, (resolution_summary, t_resolved, user_id, incident_id, user_id))

                if cursor.rowcount > 0:
                    self._close_active_claims(cursor, incident_id, t_resolved)
                    self._finalize_active_participants(cursor, incident_id, user_id, t_resolved)
                    self._end_active_department_session(cursor, incident_id, t_resolved, 'resolved')
                    self._record_event(
                        cursor,
                        incident_id,
                        'resolve',
                        user_id,
                        metadata={
                            'department_id': row['department_id'],
                            'department_name': self._get_department_name(cursor, row['department_id'])
                        }
                    )
                    logger.info(f"Incident {incident_id} resolved by user {user_id}")
                    return True, "Incident resolved successfully"
                else:
                    return False, "You cannot resolve this incident or it's not awaiting summary."

    def auto_close_incident(self, incident_id: str, summary: str,
                            reason: str = "Resolution summary timeout") -> Tuple[bool, str]:
        """Auto-close an incident that is stuck awaiting a summary."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_closed = utc_iso_now()

                cursor.execute("""
                    SELECT status, pending_resolution_by_user_id, department_id
                    FROM incidents
                    WHERE incident_id = ?
                """, (incident_id,))
                row = cursor.fetchone()

                if not row:
                    return False, "Incident not found."

                if row['status'] != 'Awaiting_Summary':
                    return False, "Incident is not awaiting summary."

                pending_user_id = row['pending_resolution_by_user_id']

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Closed',
                        resolution_summary = ?,
                        t_resolved = ?,
                        pending_resolution_by_user_id = NULL,
                        resolved_by_user_id = COALESCE(?, resolved_by_user_id)
                    WHERE incident_id = ?
                      AND status = 'Awaiting_Summary'
                """, (summary, t_closed, pending_user_id, incident_id))

                if cursor.rowcount == 0:
                    return False, "Incident status changed before auto-close."

                self._close_active_claims(cursor, incident_id, t_closed)
                self._finalize_active_participants_closed(cursor, incident_id, t_closed)
                self._end_active_department_session(cursor, incident_id, t_closed, 'closed')
                self._record_event(
                    cursor,
                    incident_id,
                    'auto_closed',
                    pending_user_id,
                    metadata={
                        "reason": reason,
                        "pending_user_id": pending_user_id,
                        "department_id": row['department_id'],
                        "department_name": self._get_department_name(cursor, row['department_id'])
                    }
                )
                logger.info(f"Incident {incident_id} auto-closed after summary timeout")
                return True, "Incident auto-closed."

    # ==================== Query Functions for Reminders ====================

    def get_unclaimed_incidents(self, minutes_threshold: int) -> List[Dict[str, Any]]:
        """Get incidents that have been unclaimed for more than the threshold."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            threshold_time = (utc_now() - timedelta(minutes=minutes_threshold)).isoformat()

            cursor.execute("""
                SELECT * FROM incidents
                WHERE status = 'Awaiting_Claim'
                  AND t_department_assigned IS NOT NULL
                  AND datetime(t_department_assigned) <= datetime(?)
            """, (threshold_time,))

            return [dict(row) for row in cursor.fetchall()]

    def get_awaiting_summary_incidents(self, minutes_threshold: int) -> List[Dict[str, Any]]:
        """Get incidents that have been awaiting summary longer than the threshold."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            threshold_time = (utc_now() - timedelta(minutes=minutes_threshold)).isoformat()

            cursor.execute("""
                SELECT * FROM incidents
                WHERE status = 'Awaiting_Summary'
                  AND t_resolution_requested IS NOT NULL
                  AND datetime(t_resolution_requested) <= datetime(?)
            """, (threshold_time,))

            return [dict(row) for row in cursor.fetchall()]
