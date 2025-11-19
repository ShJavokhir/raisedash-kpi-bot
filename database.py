"""
Supabase-backed persistence layer for the KPI Telegram bot.
This module replaces the previous SQLite engine with a normalized,
multi-assignee friendly schema that lives in Supabase/PostgreSQL.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client, create_client

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    """Return a timezone-aware ISO timestamp."""
    return datetime.now(timezone.utc).isoformat()


class Database:
    """Thread-safe Supabase database manager for incident tracking."""

    ROLE_PRIORITY = {
        'Driver': 1,
        'Dispatcher': 2,
        'OpsManager': 3
    }

    def __init__(self, supabase_url: str, supabase_key: str):
        if not supabase_url or not supabase_key:
            raise ValueError("Supabase URL and service role key are required.")
        self.client: Client = create_client(supabase_url, supabase_key)
        logger.info("Supabase client initialized")

    # --------------------------- Helpers ---------------------------

    def _exec(self, query, action: str) -> List[Dict[str, Any]]:
        """Execute a Supabase query and surface errors."""
        response = query.execute()
        error = getattr(response, "error", None)
        if error:
            logger.error("%s failed: %s", action, error)
            raise RuntimeError(f"{action} failed: {error}")
        return response.data or []

    def _first(self, query, action: str) -> Optional[Dict[str, Any]]:
        """Return the first row from a query or None."""
        data = self._exec(query.limit(1), action)
        return data[0] if data else None

    def _role_rank(self, role: Optional[str]) -> int:
        """Return a numeric rank for role comparisons."""
        if not role:
            return 0
        return self.ROLE_PRIORITY.get(role, 0)

    @staticmethod
    def _normalize_handle(handle: Optional[str], fallback_id: Optional[int] = None) -> Optional[str]:
        """Ensure Telegram handles always include @ prefix."""
        if handle and handle.startswith('@'):
            return handle
        if handle:
            return f"@{handle}"
        if fallback_id:
            return f"User_{fallback_id}"
        return None

    # --------------------------- Serialization ---------------------------

    def _serialize_user(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """Map Supabase row to legacy-friendly user dict."""
        return {
            'user_id': row.get('id'),
            'telegram_handle': self._normalize_handle(row.get('handle'), row.get('id')),
            'username': row.get('username'),
            'first_name': row.get('first_name'),
            'last_name': row.get('last_name'),
            'language_code': row.get('language_code'),
            'is_bot': bool(row.get('is_bot')),
            'team_role': row.get('global_role'),
            'group_connections': row.get('group_connections', []),
            'created_at': row.get('created_at'),
            'updated_at': row.get('updated_at')
        }

    def _serialize_group(self, row: Dict[str, Any], roles: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Return group dict with role aggregates for backwards compatibility."""
        roles = roles or []
        dispatcher_ids, _ = self._extract_role_lists(roles, target_role='Dispatcher')
        manager_ids, manager_handles = self._extract_role_lists(roles, target_role='OpsManager')

        return {
            'group_id': row.get('id'),
            'group_name': row.get('name'),
            'manager_handles': manager_handles,
            'manager_user_ids': manager_ids,
            'dispatcher_user_ids': dispatcher_ids,
            'company_id': row.get('company_id'),
            'status': row.get('status', 'pending'),
            'registration_message_id': row.get('registration_message_id'),
            'requested_by_user_id': row.get('requested_by_user_id'),
            'requested_by_handle': row.get('requested_by_handle'),
            'requested_company_name': row.get('requested_company_name')
        }

    def _serialize_company(self, row: Dict[str, Any], roles: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Return company dict with role aggregates."""
        roles = roles or []
        dispatcher_ids, _ = self._extract_role_lists(roles, target_role='Dispatcher')
        manager_ids, manager_handles = self._extract_role_lists(roles, target_role='OpsManager')

        return {
            'company_id': row.get('id'),
            'name': row.get('name'),
            'manager_handles': manager_handles,
            'manager_user_ids': manager_ids,
            'dispatcher_user_ids': dispatcher_ids,
            'metadata': row.get('metadata') or {},
            'created_at': row.get('created_at'),
            'updated_at': row.get('updated_at')
        }

    def _serialize_incident(self, row: Dict[str, Any], assignments: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Return incident dict with backward-compatible keys."""
        row = dict(row)
        row['incident_id'] = row.get('id')
        row['assignments'] = assignments or []
        return row

    # --------------------------- Role helpers ---------------------------

    def _extract_role_lists(
        self,
        roles: List[Dict[str, Any]],
        target_role: str
    ) -> Tuple[List[int], List[str]]:
        """Return (user_ids, handles) filtered by role."""
        ids: List[int] = []
        handles: List[str] = []
        seen_handles = set()

        for role in roles:
            if role.get('role') != target_role:
                continue

            user_id = role.get('user_id')
            handle = role.get('handle')
            user = role.get('user') or {}

            if user_id and user_id not in ids:
                ids.append(user_id)

            derived_handle = (
                self._normalize_handle(handle)
                or self._normalize_handle(user.get('handle'))
                or self._normalize_handle(user.get('username'))
            )
            if derived_handle and derived_handle not in seen_handles:
                seen_handles.add(derived_handle)
                handles.append(derived_handle)

        return ids, handles

    def _load_roles(self, scope: str, scope_id: Any) -> List[Dict[str, Any]]:
        """Fetch roles with joined user handles for a scope."""
        table = "company_roles" if scope == "company" else "group_roles"
        column = "company_id" if scope == "company" else "group_id"

        return self._exec(
            self.client.table(table)
            .select(
                "id, role, user_id, handle, source, user:telegram_users(handle, username)"
            )
            .eq(column, scope_id),
            f"load {scope} roles"
        )

    def _upsert_role(self, scope: str, scope_id: Any, role: str,
                     user_id: Optional[int] = None, handle: Optional[str] = None,
                     source: str = "manual"):
        """Insert or update a role assignment for company/group."""
        table = "company_roles" if scope == "company" else "group_roles"
        column = "company_id" if scope == "company" else "group_id"
        conflict_cols = [column, "role"]
        normalized_handle = self._normalize_handle(handle, user_id)
        if user_id is not None:
            conflict_cols.append("user_id")
        elif normalized_handle:
            conflict_cols.append("handle")
        else:
            conflict_cols.append("id")
        payload = {
            column: scope_id,
            "role": role,
            "user_id": user_id,
            "handle": normalized_handle,
            "source": source,
            "updated_at": _utcnow_iso()
        }
        # upsert ensures idempotent updates when the user already exists
        self._exec(
            self.client.table(table)
            .upsert(payload, on_conflict=",".join(conflict_cols)),
            f"upsert {scope} role {role}"
        )

    # --------------------------- Company Management ---------------------------

    def create_company(
        self,
        name: str,
        manager_handles: Optional[List[str]] = None,
        manager_user_ids: Optional[List[int]] = None,
        dispatcher_user_ids: Optional[List[int]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """Create a new company record and seed any provided roles."""
        now = _utcnow_iso()
        data = {
            "name": name,
            "metadata": metadata or {},
            "created_at": now,
            "updated_at": now
        }
        inserted = self._exec(
            self.client.table("companies").insert(data, returning="representation"),
            "create company"
        )
        if not inserted or "id" not in inserted[0]:
            raise RuntimeError("create company failed: no id returned from Supabase")
        company_id = inserted[0]["id"]

        for uid in manager_user_ids or []:
            self._upsert_role("company", company_id, "OpsManager", user_id=uid)
        for handle in manager_handles or []:
            self._upsert_role("company", company_id, "OpsManager", handle=handle)
        for uid in dispatcher_user_ids or []:
            self._upsert_role("company", company_id, "Dispatcher", user_id=uid)

        logger.info("Created company %s (%s)", company_id, name)
        return company_id

    def get_company_by_id(self, company_id: str) -> Optional[Dict[str, Any]]:
        company = self._first(
            self.client.table("companies").select("*").eq("id", company_id),
            "get company by id"
        )
        if not company:
            return None

        roles = self._load_roles("company", company_id)
        return self._serialize_company(company, roles)

    def get_company_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        company = self._first(
            self.client.table("companies").select("*").eq("name", name),
            "get company by name"
        )
        if not company:
            return None
        roles = self._load_roles("company", company["id"])
        return self._serialize_company(company, roles)

    def list_companies(self) -> List[Dict[str, Any]]:
        companies = self._exec(
            self.client.table("companies").select("*").order("name", desc=False),
            "list companies"
        )
        results = []
        for company in companies:
            roles = self._load_roles("company", company["id"])
            results.append(self._serialize_company(company, roles))
        return results

    def update_company_roles(
        self,
        company_id: str,
        manager_handles: Optional[List[str]] = None,
        manager_user_ids: Optional[List[int]] = None,
        dispatcher_user_ids: Optional[List[int]] = None
    ):
        """Synchronize role assignments for a company without dropping existing ones."""
        for uid in manager_user_ids or []:
            self._upsert_role("company", company_id, "OpsManager", user_id=uid)
        for handle in manager_handles or []:
            self._upsert_role("company", company_id, "OpsManager", handle=handle)
        for uid in dispatcher_user_ids or []:
            self._upsert_role("company", company_id, "Dispatcher", user_id=uid)

        self._exec(
            self.client.table("companies")
            .update({"updated_at": _utcnow_iso()})
            .eq("id", company_id),
            "touch company"
        )
        logger.info("Updated company roles for %s", company_id)

    def add_dispatcher_to_company(self, company_id: str, user_id: int):
        self._upsert_role("company", company_id, "Dispatcher", user_id=user_id)
        logger.info("Added dispatcher %s to company %s", user_id, company_id)

    def add_manager_to_company(self, company_id: str, user_id: int, handle: Optional[str] = None):
        self._upsert_role("company", company_id, "OpsManager", user_id=user_id, handle=handle)
        logger.info("Added manager %s to company %s", user_id, company_id)

    def attach_group_to_company(self, group_id: int, group_name: str,
                                company_id: str, status: str = 'active'):
        """Attach a Telegram group to a company and mark it active/pending."""
        payload = {
            "id": group_id,
            "name": group_name,
            "company_id": company_id,
            "status": status,
            "updated_at": _utcnow_iso()
        }
        self._exec(
            self.client.table("groups").upsert(payload, on_conflict="id"),
            "attach group to company"
        )
        logger.info("Group %s attached to company %s with status %s", group_id, company_id, status)

    # --------------------------- Group Management ---------------------------

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
        payload = {
            "id": group_id,
            "name": group_name,
            "status": "pending",
            "registration_message_id": registration_message_id,
            "requested_by_user_id": requested_by_user_id,
            "requested_by_handle": requested_by_handle,
            "requested_company_name": requested_company_name,
            "company_id": None,
            "updated_at": _utcnow_iso()
        }
        self._exec(
            self.client.table("groups").upsert(payload, on_conflict="id"),
            "record group request"
        )
        logger.info("Recorded registration request for group %s", group_id)

    def update_group_request_details(
        self,
        group_id: int,
        requested_company_name: Optional[str] = None,
        requested_by_user_id: Optional[int] = None,
        requested_by_handle: Optional[str] = None
    ):
        updates: Dict[str, Any] = {"updated_at": _utcnow_iso()}
        if requested_company_name is not None:
            updates["requested_company_name"] = requested_company_name
        if requested_by_user_id is not None:
            updates["requested_by_user_id"] = requested_by_user_id
        if requested_by_handle is not None:
            updates["requested_by_handle"] = requested_by_handle

        self._exec(
            self.client.table("groups").update(updates).eq("id", group_id),
            "update group request details"
        )
        logger.info("Updated registration details for group %s", group_id)

    def get_pending_groups(self) -> List[Dict[str, Any]]:
        """Return all groups awaiting activation."""
        rows = self._exec(
            self.client.table("groups")
            .select("*")
            .eq("status", "pending")
            .order("id", desc=False),
            "get pending groups"
        )
        pending = []
        for row in rows:
            pending.append({
                'group_id': row.get('id'),
                'group_name': row.get('name'),
                'registration_message_id': row.get('registration_message_id'),
                'requested_by_user_id': row.get('requested_by_user_id'),
                'requested_by_handle': row.get('requested_by_handle'),
                'requested_company_name': row.get('requested_company_name')
            })
        return pending

    def get_company_membership(self, group_id: int) -> Optional[Dict[str, Any]]:
        """Return combined group/company information for a group."""
        group_row = self._first(
            self.client.table("groups").select("*").eq("id", group_id),
            "get group for membership"
        )
        if not group_row:
            return None

        group_roles = self._load_roles("group", group_id)
        group = self._serialize_group(group_row, group_roles)

        company = None
        if group_row.get("company_id"):
            company_row = self._first(
                self.client.table("companies").select("*").eq("id", group_row["company_id"]),
                "get company for membership"
            )
            if company_row:
                company_roles = self._load_roles("company", group_row["company_id"])
                company = self._serialize_company(company_row, company_roles)

        return {
            'group': group,
            'company': company,
            'is_active': group['status'] == 'active'
        }

    def upsert_group(self, group_id: int, group_name: str,
                     manager_handles: List[str] = None,
                     manager_user_ids: List[int] = None,
                     dispatcher_user_ids: List[int] = None):
        """Insert or update group configuration and optional role hints."""
        payload = {
            "id": group_id,
            "name": group_name,
            "status": "active",
            "updated_at": _utcnow_iso()
        }
        self._exec(
            self.client.table("groups").upsert(payload, on_conflict="id"),
            "upsert group"
        )

        # Seed roles if provided
        for uid in manager_user_ids or []:
            self._upsert_role("group", group_id, "OpsManager", user_id=uid)
        for handle in manager_handles or []:
            self._upsert_role("group", group_id, "OpsManager", handle=handle)
        for uid in dispatcher_user_ids or []:
            self._upsert_role("group", group_id, "Dispatcher", user_id=uid)

        logger.info("Group %s configuration updated", group_id)

    def get_group(self, group_id: int) -> Optional[Dict[str, Any]]:
        row = self._first(
            self.client.table("groups").select("*").eq("id", group_id),
            "get group"
        )
        if not row:
            return None
        roles = self._load_roles("group", group_id)
        return self._serialize_group(row, roles)

    def add_dispatcher_to_group(self, group_id: int, user_id: int):
        self._upsert_role("group", group_id, "Dispatcher", user_id=user_id)
        logger.info("Added dispatcher %s to group %s", user_id, group_id)

    def add_manager_to_group(self, group_id: int, user_id: int, handle: str):
        self._upsert_role("group", group_id, "OpsManager", user_id=user_id, handle=handle)
        logger.info("Added manager %s to group %s", user_id, group_id)

    # --------------------------- User Management ---------------------------

    def track_user(self, user_id: int, username: Optional[str] = None,
                   first_name: Optional[str] = None, last_name: Optional[str] = None,
                   language_code: Optional[str] = None, is_bot: bool = False,
                   group_id: Optional[int] = None, team_role: Optional[str] = None):
        """
        Comprehensive user tracking function.
        Captures all available Telegram user data and tracks group connections.
        """
        existing = self.get_user(user_id)
        timestamp = _utcnow_iso()

        final_role = existing['team_role'] if existing else None
        if team_role and self._role_rank(team_role) >= self._role_rank(final_role):
            final_role = team_role

        user_payload = {
            "id": user_id,
            "handle": self._normalize_handle(username, user_id),
            "username": username,
            "first_name": first_name,
            "last_name": last_name,
            "language_code": language_code,
            "is_bot": bool(is_bot),
            "global_role": final_role,
            "updated_at": timestamp
        }
        self._exec(
            self.client.table("telegram_users").upsert(user_payload, on_conflict="id"),
            "upsert user"
        )

        # Track group membership if applicable
        if group_id is not None:
            membership_payload = {
                "group_id": group_id,
                "user_id": user_id,
                "last_seen_at": timestamp,
                "updated_at": timestamp
            }
            self._exec(
                self.client.table("group_memberships").upsert(
                    membership_payload,
                    on_conflict="group_id,user_id"
                ),
                "upsert group membership"
            )

        return self.get_user(user_id)

    def upsert_user(self, user_id: int, telegram_handle: str, team_role: str):
        """Legacy user upsert function (maintained for backward compatibility)."""
        username = telegram_handle[1:] if telegram_handle.startswith('@') else telegram_handle
        return self.track_user(
            user_id=user_id,
            username=username,
            team_role=team_role
        )

    def get_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        row = self._first(
            self.client.table("telegram_users").select("*").eq("id", user_id),
            "get user"
        )
        if not row:
            return None

        memberships = self._exec(
            self.client.table("group_memberships")
            .select("group_id")
            .eq("user_id", user_id),
            "get user group memberships"
        )
        row["group_connections"] = [m["group_id"] for m in memberships]

        return self._serialize_user(row)

    def add_group_connection_to_user(self, user_id: int, group_id: int):
        """Add a group connection to an existing user (idempotent)."""
        timestamp = _utcnow_iso()
        membership_payload = {
            "group_id": group_id,
            "user_id": user_id,
            "last_seen_at": timestamp,
            "updated_at": timestamp
        }
        self._exec(
            self.client.table("group_memberships")
            .upsert(membership_payload, on_conflict="group_id,user_id"),
            "add group connection"
        )
        logger.info("Added group %s to user %s connections", group_id, user_id)

    # --------------------------- Incident Management ---------------------------

    def _active_assignments(self, incident_id: str, role: Optional[str] = None) -> List[Dict[str, Any]]:
        query = (
            self.client.table("incident_assignments")
            .select("user_id, role, started_at, ended_at, user:telegram_users(handle, username)")
            .eq("incident_id", incident_id)
            .is_("ended_at", None)
        )
        if role:
            query = query.eq("role", role)
        return self._exec(query, "get active assignments")

    def create_incident(self, group_id: int, created_by_id: int,
                        created_by_handle: str, description: str,
                        pinned_message_id: int = None,
                        company_id: Optional[str] = None) -> str:
        """Create a new incident and return its ID."""
        now = _utcnow_iso()
        company_to_use = company_id
        if company_to_use is None:
            membership = self.get_company_membership(group_id)
            if membership and membership.get("group"):
                company_to_use = membership["group"].get("company_id")

        payload = {
            "group_id": group_id,
            "company_id": company_to_use,
            "pinned_message_id": pinned_message_id,
            "status": "Unclaimed",
            "created_by_id": created_by_id,
            "created_by_handle": created_by_handle,
            "description": description,
            "t_created": now,
            "updated_at": now
        }
        inserted = self._exec(
            self.client.table("incidents").insert(payload, returning="representation"),
            "create incident"
        )
        if not inserted or "id" not in inserted[0]:
            raise RuntimeError("create incident failed: no id returned from Supabase")
        incident_id = inserted[0]["id"]

        # Audit event
        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "created",
                "actor_user_id": created_by_id,
                "payload": {"group_id": group_id}
            }),
            "log incident creation"
        )

        logger.info("Created incident %s in group %s", incident_id, group_id)
        return incident_id

    def update_incident_message_id(self, incident_id: str, message_id: int):
        self._exec(
            self.client.table("incidents")
            .update({"pinned_message_id": message_id, "updated_at": _utcnow_iso()})
            .eq("id", incident_id),
            "update incident message id"
        )

    def get_incident(self, incident_id: str) -> Optional[Dict[str, Any]]:
        row = self._first(
            self.client.table("incidents")
            .select("*")
            .eq("id", incident_id),
            "get incident"
        )
        if not row:
            return None
        assignments = self._active_assignments(incident_id)
        return self._serialize_incident(row, assignments)

    def get_incident_by_message_id(self, message_id: int) -> Optional[Dict[str, Any]]:
        row = self._first(
            self.client.table("incidents")
            .select("*")
            .eq("pinned_message_id", message_id),
            "get incident by message id"
        )
        if not row:
            return None
        assignments = self._active_assignments(row["id"])
        return self._serialize_incident(row, assignments)

    def _upsert_assignment(self, incident_id: str, user_id: int, role: str):
        payload = {
            "incident_id": incident_id,
            "user_id": user_id,
            "role": role,
            "started_at": _utcnow_iso(),
            "ended_at": None,
            "updated_at": _utcnow_iso()
        }
        self._exec(
            self.client.table("incident_assignments")
            .upsert(payload, on_conflict="incident_id,user_id,role"),
            "upsert assignment"
        )

    def _close_assignment(self, incident_id: str, user_id: int, role: str) -> int:
        """Mark an assignment as ended; returns affected rows count."""
        active = self._exec(
            self.client.table("incident_assignments")
            .select("id")
            .eq("incident_id", incident_id)
            .eq("user_id", user_id)
            .eq("role", role)
            .is_("ended_at", None),
            "find assignment to close"
        )
        if not active:
            return 0

        self._exec(
            self.client.table("incident_assignments")
            .update({"ended_at": _utcnow_iso(), "updated_at": _utcnow_iso()})
            .eq("id", active[0]["id"]),
            "close assignment"
        )
        return 1

    def _update_incident_status(self, incident_id: str, status: str, extra: Optional[Dict[str, Any]] = None):
        payload = {"status": status, "updated_at": _utcnow_iso()}
        if extra:
            payload.update(extra)
        self._exec(
            self.client.table("incidents")
            .update(payload)
            .eq("id", incident_id),
            "update incident status"
        )

    def claim_tier1(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        incident = self.get_incident(incident_id)
        if not incident:
            return False, "Incident not found."
        if incident['status'] in ['Awaiting_Summary', 'Resolved', 'Closed']:
            return False, "This incident cannot be claimed right now."

        self._upsert_assignment(incident_id, user_id, "tier1")

        new_status = incident['status']
        if incident['status'] == 'Unclaimed':
            new_status = 'Claimed_T1'

        extras: Dict[str, Any] = {}
        if not incident.get('t_first_claim_tier1'):
            extras['t_first_claim_tier1'] = _utcnow_iso()

        if new_status != incident['status'] or extras:
            self._update_incident_status(incident_id, new_status, extras)

        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "claim_tier1",
                "actor_user_id": user_id
            }),
            "log claim_tier1"
        )

        logger.info("Incident %s claimed at T1 by %s", incident_id, user_id)
        return True, "Claim successful"

    def release_tier1_claim(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        incident = self.get_incident(incident_id)
        if not incident or incident['status'] not in ['Claimed_T1', 'Escalated_Unclaimed_T2', 'Claimed_T2']:
            return False, "You cannot release this claim."

        rows = self._close_assignment(incident_id, user_id, "tier1")
        if rows == 0:
            return False, "You do not own this incident."

        remaining_t1 = self._active_assignments(incident_id, role="tier1")
        if incident['status'] == 'Claimed_T1' and not remaining_t1:
            self._update_incident_status(incident_id, 'Unclaimed')

        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "release_tier1",
                "actor_user_id": user_id
            }),
            "log release_tier1"
        )
        return True, "Claim released successfully"

    def escalate_incident(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        incident = self.get_incident(incident_id)
        if not incident or incident['status'] != 'Claimed_T1':
            return False, "You cannot escalate this incident."

        active = self._active_assignments(incident_id, role="tier1")
        if not any(a.get("user_id") == user_id for a in active):
            return False, "You cannot escalate this incident."

        self._update_incident_status(
            incident_id,
            'Escalated_Unclaimed_T2',
            {"t_escalated": _utcnow_iso()}
        )

        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "escalated",
                "actor_user_id": user_id
            }),
            "log escalation"
        )
        logger.info("Incident %s escalated by %s", incident_id, user_id)
        return True, "Incident escalated successfully"

    def claim_tier2(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        incident = self.get_incident(incident_id)
        if not incident or incident['status'] not in ['Escalated_Unclaimed_T2', 'Claimed_T2']:
            return False, "Sorry, this escalation cannot be claimed right now."

        self._upsert_assignment(incident_id, user_id, "tier2")

        extras: Dict[str, Any] = {}
        if not incident.get('t_first_claim_tier2'):
            extras['t_first_claim_tier2'] = _utcnow_iso()

        self._update_incident_status(incident_id, 'Claimed_T2', extras)

        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "claim_tier2",
                "actor_user_id": user_id
            }),
            "log claim_tier2"
        )
        logger.info("Incident %s claimed at T2 by %s", incident_id, user_id)
        return True, "Escalation claimed successfully"

    def request_resolution(self, incident_id: str, user_id: int) -> Tuple[bool, str]:
        incident = self.get_incident(incident_id)
        if not incident or incident['status'] not in ['Claimed_T1', 'Claimed_T2']:
            return False, "You cannot resolve this incident."

        active = self._active_assignments(incident_id)
        if not any(a.get("user_id") == user_id for a in active):
            return False, "You cannot resolve this incident."

        self._update_incident_status(
            incident_id,
            'Awaiting_Summary',
            {
                "pending_resolution_by_user_id": user_id,
                "t_resolution_requested": _utcnow_iso()
            }
        )

        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "resolution_requested",
                "actor_user_id": user_id
            }),
            "log resolution request"
        )
        return True, "Resolution requested successfully"

    def resolve_incident(self, incident_id: str, user_id: int,
                         resolution_summary: str) -> Tuple[bool, str]:
        incident = self.get_incident(incident_id)
        if not incident or incident.get('status') != 'Awaiting_Summary':
            return False, "You cannot resolve this incident or it's not awaiting summary."
        if incident.get('pending_resolution_by_user_id') != user_id:
            return False, "You are not authorized to resolve this incident."

        now = _utcnow_iso()
        self._update_incident_status(
            incident_id,
            'Resolved',
            {
                "resolution_summary": resolution_summary,
                "t_resolved": now,
                "pending_resolution_by_user_id": None
            }
        )

        # Close any remaining active assignments
        self._exec(
            self.client.table("incident_assignments")
            .update({"ended_at": now, "updated_at": now})
            .eq("incident_id", incident_id)
            .is_("ended_at", None),
            "close assignments on resolve"
        )

        self._exec(
            self.client.table("incident_events").insert({
                "incident_id": incident_id,
                "event_type": "resolved",
                "actor_user_id": user_id
            }),
            "log resolve"
        )
        logger.info("Incident %s resolved by %s", incident_id, user_id)
        return True, "Incident resolved successfully"

    # --------------------------- Query Functions for Reminders ---------------------------

    def get_unclaimed_incidents(self, minutes_threshold: int) -> List[Dict[str, Any]]:
        threshold_time = (datetime.now(timezone.utc) - timedelta(minutes=minutes_threshold)).isoformat()
        rows = self._exec(
            self.client.table("incidents")
            .select("*")
            .eq("status", "Unclaimed")
            .lte("t_created", threshold_time),
            "get unclaimed incidents"
        )
        return [self._serialize_incident(row) for row in rows]

    def get_unclaimed_escalations(self, minutes_threshold: int) -> List[Dict[str, Any]]:
        threshold_time = (datetime.now(timezone.utc) - timedelta(minutes=minutes_threshold)).isoformat()
        rows = self._exec(
            self.client.table("incidents")
            .select("*")
            .eq("status", "Escalated_Unclaimed_T2")
            .lte("t_escalated", threshold_time),
            "get unclaimed escalations"
        )
        return [self._serialize_incident(row) for row in rows]
