"""
Database module for managing SQLite database operations.
Implements the three-table schema: Groups, Users, Incidents.
"""

import sqlite3
import json
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from contextlib import contextmanager
from threading import Lock

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
                team_role TEXT CHECK(team_role IN ('Driver', 'Dispatcher', 'OpsManager'))
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
                    'Unclaimed',
                    'Claimed_T1',
                    'Escalated_Unclaimed_T2',
                    'Claimed_T2',
                    'Awaiting_Summary',
                    'Resolved',
                    'Closed'
                )),
                created_by_id INTEGER NOT NULL,
                created_by_handle TEXT NOT NULL,
                description TEXT NOT NULL,
                resolution_summary TEXT,
                claimed_by_t1_id INTEGER,
                claimed_by_t2_id INTEGER,
                pending_resolution_by_user_id INTEGER,
                t_created TEXT NOT NULL,
                t_claimed_tier1 TEXT,
                t_escalated TEXT,
                t_claimed_tier2 TEXT,
                t_resolution_requested TEXT,
                t_resolved TEXT,
                FOREIGN KEY (group_id) REFERENCES groups(group_id),
                FOREIGN KEY (company_id) REFERENCES companies(company_id)
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

        ensure_column('groups', 'company_id', "INTEGER")
        ensure_column('groups', 'status', "TEXT NOT NULL DEFAULT 'pending'")
        ensure_column('groups', 'registration_message_id', "INTEGER")
        ensure_column('groups', 'requested_by_user_id', "INTEGER")
        ensure_column('groups', 'requested_by_handle', "TEXT")
        ensure_column('groups', 'requested_company_name', "TEXT")

        ensure_column('incidents', 'company_id', "INTEGER")

        # Enhanced user tracking migration - Add comprehensive user fields
        ensure_column('users', 'username', "TEXT")  # Raw username without @
        ensure_column('users', 'first_name', "TEXT")
        ensure_column('users', 'last_name', "TEXT")
        ensure_column('users', 'language_code', "TEXT")
        ensure_column('users', 'is_bot', "INTEGER NOT NULL DEFAULT 0")
        ensure_column('users', 'group_connections', "TEXT NOT NULL DEFAULT '[]'")  # JSON array
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
        """, (datetime.now().isoformat(), datetime.now().isoformat()))

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
        timestamp = datetime.now().isoformat()
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
        params.append(datetime.now().isoformat())
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
        Comprehensive user tracking function.
        Captures all available Telegram user data and tracks group connections.

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
            timestamp = datetime.now().isoformat()

            with self.get_connection() as conn:
                cursor = conn.cursor()

                # Get existing user data
                cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
                existing_row = cursor.fetchone()

                # Prepare telegram_handle (for backward compatibility)
                telegram_handle = f"@{username}" if username else f"User_{user_id}"

                # Determine group_connections
                group_connections = []
                if existing_row:
                    existing_connections = json.loads(existing_row['group_connections'] or '[]')
                    group_connections = list(set(existing_connections))  # Remove duplicates

                # Add new group connection if provided
                if group_id is not None and group_id not in group_connections:
                    group_connections.append(group_id)

                # Determine final team_role (preserve higher-ranked roles)
                final_team_role = None
                if existing_row and existing_row['team_role']:
                    final_team_role = existing_row['team_role']
                if team_role:
                    # Only update role if new role is provided and non-null
                    final_team_role = team_role

                # Determine created_at timestamp
                created_at = existing_row['created_at'] if existing_row and existing_row['created_at'] else timestamp

                # Perform upsert with all fields
                cursor.execute("""
                    INSERT INTO users (
                        user_id, telegram_handle, username, first_name, last_name,
                        language_code, is_bot, team_role, group_connections,
                        created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        telegram_handle = excluded.telegram_handle,
                        username = COALESCE(excluded.username, username),
                        first_name = COALESCE(excluded.first_name, first_name),
                        last_name = COALESCE(excluded.last_name, last_name),
                        language_code = COALESCE(excluded.language_code, language_code),
                        is_bot = excluded.is_bot,
                        team_role = COALESCE(excluded.team_role, team_role),
                        group_connections = excluded.group_connections,
                        updated_at = excluded.updated_at
                """, (
                    user_id, telegram_handle, username, first_name, last_name,
                    language_code, 1 if is_bot else 0, final_team_role,
                    json.dumps(group_connections), created_at, timestamp
                ))

                logger.info(
                    f"Tracked user {user_id} ({telegram_handle}) "
                    f"[first_name={first_name}, last_name={last_name}, "
                    f"role={final_team_role}, groups={len(group_connections)}]"
                )

        # Return updated user data (outside the lock context)
        return self.get_user(user_id)

    def upsert_user(self, user_id: int, telegram_handle: str, team_role: str):
        """
        Legacy user upsert function (maintained for backward compatibility).
        Prefer using track_user() for new code.
        """
        # Extract username from telegram_handle if it has @
        username = telegram_handle[1:] if telegram_handle.startswith('@') else None

        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                timestamp = datetime.now().isoformat()

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
                        """, (json.dumps(connections), datetime.now().isoformat(), user_id))
                        logger.info(f"Added group {group_id} to user {user_id}'s connections")
                else:
                    # User doesn't exist, create minimal record with group connection
                    timestamp = datetime.now().isoformat()
                    cursor.execute("""
                        INSERT INTO users (
                            user_id, telegram_handle, group_connections,
                            created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?)
                    """, (user_id, f"User_{user_id}", json.dumps([group_id]),
                          timestamp, timestamp))
                    logger.info(f"Created user {user_id} with group {group_id} connection")

    # ==================== Incident Management ====================

    def generate_incident_id(self) -> str:
        """Generate next incident ID in format TKT-YYYY-NNNN."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            current_year = datetime.now().year

            # Get the latest incident ID for current year
            cursor.execute("""
                SELECT incident_id FROM incidents
                WHERE incident_id LIKE ?
                ORDER BY incident_id DESC LIMIT 1
            """, (f"TKT-{current_year}-%",))

            row = cursor.fetchone()
            if row:
                # Extract number from TKT-YYYY-NNNN
                last_num = int(row['incident_id'].split('-')[-1])
                new_num = last_num + 1
            else:
                new_num = 1

            return f"TKT-{current_year}-{new_num:04d}"

    def create_incident(self, group_id: int, created_by_id: int,
                       created_by_handle: str, description: str,
                       pinned_message_id: int = None,
                       company_id: Optional[int] = None) -> str:
        """Create a new incident and return its ID."""
        with self._lock:
            incident_id = self.generate_incident_id()
            t_created = datetime.now().isoformat()
            company_id_to_use = company_id

            if company_id_to_use is None:
                group = self.get_group(group_id)
                company_id_to_use = group['company_id'] if group else None

            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO incidents
                    (incident_id, group_id, company_id, pinned_message_id, status,
                     created_by_id, created_by_handle, description, t_created)
                    VALUES (?, ?, ?, ?, 'Unclaimed', ?, ?, ?, ?)
                """, (incident_id, group_id, company_id_to_use, pinned_message_id,
                      created_by_id, created_by_handle, description, t_created))

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

    def claim_tier1(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """
        Atomically claim an unclaimed incident at Tier 1.
        Returns (success: bool, message: str).
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_claimed = datetime.now().isoformat()

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Claimed_T1',
                        claimed_by_t1_id = ?,
                        t_claimed_tier1 = ?
                    WHERE incident_id = ? AND status = 'Unclaimed'
                """, (user_id, t_claimed, incident_id))

                if cursor.rowcount > 0:
                    logger.info(f"Incident {incident_id} claimed by dispatcher {user_id}")
                    return True, "Claim successful"
                else:
                    logger.warning(f"Failed to claim {incident_id} - already claimed")
                    return False, "Sorry, this incident has already been claimed."

    def release_tier1_claim(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """
        Release a Tier 1 claim if the user is the current owner.
        Returns (success: bool, message: str).
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Unclaimed',
                        claimed_by_t1_id = NULL,
                        t_claimed_tier1 = NULL
                    WHERE incident_id = ?
                      AND status = 'Claimed_T1'
                      AND claimed_by_t1_id = ?
                """, (incident_id, user_id))

                if cursor.rowcount > 0:
                    logger.info(f"Incident {incident_id} released by dispatcher {user_id}")
                    return True, "Claim released successfully"
                else:
                    return False, "You cannot release this claim."

    def escalate_incident(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """
        Escalate an incident from Tier 1 to Tier 2.
        Only the current T1 owner can escalate.
        Returns (success: bool, message: str).
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_escalated = datetime.now().isoformat()

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Escalated_Unclaimed_T2',
                        t_escalated = ?
                    WHERE incident_id = ?
                      AND status = 'Claimed_T1'
                      AND claimed_by_t1_id = ?
                """, (t_escalated, incident_id, user_id))

                if cursor.rowcount > 0:
                    logger.info(f"Incident {incident_id} escalated by dispatcher {user_id}")
                    return True, "Incident escalated successfully"
                else:
                    return False, "You cannot escalate this incident."

    def claim_tier2(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """
        Atomically claim an escalated incident at Tier 2.
        Returns (success: bool, message: str).
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_claimed = datetime.now().isoformat()

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Claimed_T2',
                        claimed_by_t2_id = ?,
                        t_claimed_tier2 = ?
                    WHERE incident_id = ? AND status = 'Escalated_Unclaimed_T2'
                """, (user_id, t_claimed, incident_id))

                if cursor.rowcount > 0:
                    logger.info(f"Incident {incident_id} claimed by manager {user_id}")
                    return True, "Escalation claimed successfully"
                else:
                    logger.warning(f"Failed to claim escalation {incident_id}")
                    return False, "Sorry, this escalation has already been claimed."

    def request_resolution(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        """
        Request resolution summary from the current owner.
        Works for both Tier 1 and Tier 2 claims.
        Returns (success: bool, message: str).
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_resolution_requested = datetime.now().isoformat()

                # Check if user is T1 owner
                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Awaiting_Summary',
                        pending_resolution_by_user_id = ?,
                        t_resolution_requested = ?
                    WHERE incident_id = ?
                      AND status = 'Claimed_T1'
                      AND claimed_by_t1_id = ?
                """, (user_id, t_resolution_requested, incident_id, user_id))

                if cursor.rowcount > 0:
                    logger.info(f"Resolution requested for {incident_id} from T1 user {user_id}")
                    return True, "Resolution requested successfully"

                # Check if user is T2 owner
                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Awaiting_Summary',
                        pending_resolution_by_user_id = ?,
                        t_resolution_requested = ?
                    WHERE incident_id = ?
                      AND status = 'Claimed_T2'
                      AND claimed_by_t2_id = ?
                """, (user_id, t_resolution_requested, incident_id, user_id))

                if cursor.rowcount > 0:
                    logger.info(f"Resolution requested for {incident_id} from T2 user {user_id}")
                    return True, "Resolution requested successfully"

                return False, "You cannot resolve this incident."

    def resolve_incident(self, incident_id: str, user_id: int,
                        resolution_summary: str) -> Tuple[bool, str]:
        """
        Mark incident as resolved with a summary.
        Only the user who was asked for the summary can resolve.
        Returns (success: bool, message: str).
        """
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                t_resolved = datetime.now().isoformat()

                cursor.execute("""
                    UPDATE incidents
                    SET status = 'Resolved',
                        resolution_summary = ?,
                        t_resolved = ?,
                        pending_resolution_by_user_id = NULL
                    WHERE incident_id = ?
                      AND status = 'Awaiting_Summary'
                      AND pending_resolution_by_user_id = ?
                """, (resolution_summary, t_resolved, incident_id, user_id))

                if cursor.rowcount > 0:
                    logger.info(f"Incident {incident_id} resolved by user {user_id}")
                    return True, "Incident resolved successfully"
                else:
                    return False, "You cannot resolve this incident or it's not awaiting summary."

    # ==================== Query Functions for Reminders ====================

    def get_unclaimed_incidents(self, minutes_threshold: int) -> List[Dict[str, Any]]:
        """Get incidents that have been unclaimed for more than the threshold."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            threshold_time = datetime.now().timestamp() - (minutes_threshold * 60)

            cursor.execute("""
                SELECT * FROM incidents
                WHERE status = 'Unclaimed'
                  AND datetime(t_created) <= datetime(?, 'unixepoch')
            """, (threshold_time,))

            return [dict(row) for row in cursor.fetchall()]

    def get_unclaimed_escalations(self, minutes_threshold: int) -> List[Dict[str, Any]]:
        """Get escalations that have been unclaimed for more than the threshold."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            threshold_time = datetime.now().timestamp() - (minutes_threshold * 60)

            cursor.execute("""
                SELECT * FROM incidents
                WHERE status = 'Escalated_Unclaimed_T2'
                  AND datetime(t_escalated) <= datetime(?, 'unixepoch')
            """, (threshold_time,))

            return [dict(row) for row in cursor.fetchall()]
