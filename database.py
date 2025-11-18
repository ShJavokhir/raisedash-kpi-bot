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
        """Initialize database schema if it doesn't exist."""
        with self.get_connection() as conn:
            cursor = conn.cursor()

            # Enable WAL mode for better concurrency
            cursor.execute("PRAGMA journal_mode=WAL")
            logger.info("Enabled WAL mode for SQLite")

            # Groups table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS groups (
                    group_id INTEGER PRIMARY KEY,
                    group_name TEXT NOT NULL,
                    manager_handles TEXT NOT NULL DEFAULT '[]',
                    manager_user_ids TEXT NOT NULL DEFAULT '[]',
                    dispatcher_user_ids TEXT NOT NULL DEFAULT '[]'
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
                    FOREIGN KEY (group_id) REFERENCES groups(group_id)
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
            # Composite index for reminder queries
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_incidents_status_created
                ON incidents(status, t_created)
            """)

            conn.commit()
            logger.info("Database initialized successfully")

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
                    'manager_handles': json.loads(row['manager_handles']),
                    'manager_user_ids': json.loads(row['manager_user_ids']),
                    'dispatcher_user_ids': json.loads(row['dispatcher_user_ids'])
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

    def upsert_user(self, user_id: int, telegram_handle: str, team_role: str):
        """Insert or update user information."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO users (user_id, telegram_handle, team_role)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        telegram_handle = excluded.telegram_handle,
                        team_role = excluded.team_role
                """, (user_id, telegram_handle, team_role))
                logger.info(f"User {user_id} ({telegram_handle}) registered as {team_role}")

    def get_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get user information by user_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()

            if row:
                return {
                    'user_id': row['user_id'],
                    'telegram_handle': row['telegram_handle'],
                    'team_role': row['team_role']
                }
            return None

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
                       pinned_message_id: int = None) -> str:
        """Create a new incident and return its ID."""
        with self._lock:
            incident_id = self.generate_incident_id()
            t_created = datetime.now().isoformat()

            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO incidents
                    (incident_id, group_id, pinned_message_id, status,
                     created_by_id, created_by_handle, description, t_created)
                    VALUES (?, ?, ?, 'Unclaimed', ?, ?, ?, ?)
                """, (incident_id, group_id, pinned_message_id,
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
