"""Message builder module for constructing incident messages and inline keyboards."""

from typing import Dict, Any, Optional, List
from telegram import InlineKeyboardButton, InlineKeyboardMarkup


class MessageBuilder:
    """Builds formatted messages and inline keyboards for incident states."""

    @staticmethod
    def _chunk_buttons(buttons: List[InlineKeyboardButton], per_row: int = 2) -> List[List[InlineKeyboardButton]]:
        return [buttons[i:i + per_row] for i in range(0, len(buttons), per_row)]

    def build_department_selection(self, incident: Dict[str, Any],
                                   departments: List[Dict[str, Any]],
                                   prompt: str,
                                   callback_prefix: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message prompting for department selection."""
        text = (
            "🚨 NEW ISSUE\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: 🗂️ Choose department\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            f"{prompt}"
        )

        buttons = [
            InlineKeyboardButton(dept['name'], callback_data=f"{callback_prefix}:{incident['incident_id']}:{dept['department_id']}")
            for dept in departments
        ]
        keyboard = InlineKeyboardMarkup(self._chunk_buttons(buttons, per_row=2))
        return text, keyboard

    def build_unclaimed_message(self, incident: Dict[str, Any], department_name: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for unclaimed incident within a department."""
        text = (
            "🚨 INCIDENT READY FOR CLAIM\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Department: {department_name}\n"
            "Status: 🔔 Awaiting claim\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Tap Claim if you're taking this. You can still change the department if it belongs elsewhere."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Claim", callback_data=f"claim:{incident['incident_id']}")],
            [InlineKeyboardButton("🔀 Change department", callback_data=f"change_department:{incident['incident_id']}")]
        ])

        return text, keyboard

    def build_claimed_message(self, incident: Dict[str, Any], claimer_handles: List[str],
                              department_name: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for claimed incident."""
        responders = ", ".join(claimer_handles) if claimer_handles else "—"
        text = (
            "🚨 INCIDENT IN PROGRESS\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Department: {department_name}\n"
            "Status: 🛠️ In progress\n"
            f"Active: {responders}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Others from the department can join. Resolve when you've handled it, "
            "or move it to another department if needed."
        )

        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Join", callback_data=f"claim:{incident['incident_id']}"),
                InlineKeyboardButton("❌ Leave", callback_data=f"release:{incident['incident_id']}")
            ],
            [InlineKeyboardButton("🏁 Resolve", callback_data=f"resolve:{incident['incident_id']}")],
            [InlineKeyboardButton("🔀 Change department", callback_data=f"change_department:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_awaiting_summary_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for awaiting summary state."""
        text = (
            "📄 INCIDENT AWAITING RESOLUTION SUMMARY\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Resolver: {resolver_handle}\n"
            "Status: ⌛ Awaiting summary\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            f"{resolver_handle}, please reply to this message with a short resolution summary (1–3 sentences)."
        )
        return text, None

    @staticmethod
    def build_resolved_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for resolved incident."""
        text = (
            "✅ INCIDENT RESOLVED\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: ✅ Resolved\n"
            f"Resolved by: {resolver_handle}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Resolution summary:\n"
            f"{incident['resolution_summary']}"
        )
        return text, None

    @staticmethod
    def build_closed_message(incident: Dict[str, Any], closed_by: Optional[str], reason: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for auto-closed incident (no summary provided)."""
        closed_by_text = closed_by or "System"
        text = (
            "❌ INCIDENT CLOSED\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: ❌ Closed\n"
            f"Closed by: {closed_by_text}\n"
            f"Reason: {reason}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Resolution summary:\n"
            f"{incident.get('resolution_summary', 'No summary provided.')}"
        )
        return text, None

    @staticmethod
    def build_resolution_request(incident_id: str, user_handle: str) -> str:
        """Build message requesting resolution summary."""
        return (
            f"{user_handle}, please reply to this message with a short resolution summary for {incident_id}.\n"
            "Include what you did, the root cause (if known), and any follow-up actions."
        )

    @staticmethod
    def build_unclaimed_reminder(incident_id: str, minutes: int, department_name: Optional[str]) -> str:
        """Build reminder message for unclaimed incident."""
        department_line = f"Department: {department_name}\n" if department_name else ""
        return (
            "⏰ Unclaimed incident reminder\n"
            "------------------------------\n"
            f"Incident: {incident_id}\n"
            f"{department_line}"
            f"Unclaimed for: {minutes} minutes\n"
            "------------------------------\n"
            "Please review the pinned incident message and claim it if you are taking ownership."
        )

    @staticmethod
    def build_auto_close_notice(incident_id: str, user_handle: str, minutes: int) -> str:
        """Build concise notice when summary timeout closes an incident."""
        return (
            f"Auto-closed {incident_id} after waiting {minutes} minutes for {user_handle}'s summary. "
            "Reopen manually if more details are needed."
        )

    @staticmethod
    def build_department_ping(department_handles: List[str], incident_id: str) -> str:
        """Build message tagging department members when assigned."""
        mentions = " ".join(department_handles)
        return (
            f"🔔 {mentions}\n"
            f"Please review incident {incident_id} and claim it if you are taking ownership."
        )
