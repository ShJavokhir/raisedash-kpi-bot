"""Message builder module for constructing incident messages and inline keyboards."""

import html
from typing import Dict, Any, Optional, List
from telegram import InlineKeyboardButton, InlineKeyboardMarkup


class MessageBuilder:
    """Builds formatted messages and inline keyboards for incident states."""

    @staticmethod
    def _escape_text(value: Any) -> str:
        if value is None:
            return ""
        return html.escape(str(value))

    @classmethod
    def _format_description(cls, description: Any) -> str:
        return f"<i>{cls._escape_text(description)}</i>"

    @staticmethod
    def _chunk_buttons(buttons: List[InlineKeyboardButton], per_row: int = 2) -> List[List[InlineKeyboardButton]]:
        return [buttons[i:i + per_row] for i in range(0, len(buttons), per_row)]

    def build_department_selection(self, incident: Dict[str, Any],
                                   departments: List[Dict[str, Any]],
                                   prompt: str,
                                   callback_prefix: str,
                                   back_callback_data: Optional[str] = None) -> tuple[str, InlineKeyboardMarkup]:
        """Build message prompting for department selection."""
        incident_id = self._escape_text(incident['incident_id'])
        reported_by = self._escape_text(incident['created_by_handle'])
        description = self._format_description(incident['description'])
        prompt_text = self._escape_text(prompt)
        text = (
            "🚨 NEW TICKET\n"
            "------------------------------\n"
            f"ID: {incident_id}\n"
            "Status: 🗂️ Choose department\n"
            "------------------------------\n"
            f"Reported by: {reported_by}\n"
            "Ticket:\n"
            f"{description}\n"
            "------------------------------\n"
            f"{prompt_text}"
        )

        buttons: List[InlineKeyboardButton] = []
        for dept in departments:
            label = dept['name']
            if (dept.get('metadata') or {}).get('restricted_to_department_members'):
                label = f"🔒 {label}"
            buttons.append(
                InlineKeyboardButton(
                    label,
                    callback_data=f"{callback_prefix}:{incident['incident_id']}:{dept['department_id']}"
                )
            )
        rows = self._chunk_buttons(buttons, per_row=2)

        if back_callback_data:
            rows.append([InlineKeyboardButton("⬅️ Back", callback_data=back_callback_data)])

        keyboard = InlineKeyboardMarkup(rows)
        return text, keyboard

    def build_unclaimed_message(self, incident: Dict[str, Any], department_name: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for unclaimed incident within a department."""
        incident_id = self._escape_text(incident['incident_id'])
        dept_name = self._escape_text(department_name)
        reported_by = self._escape_text(incident['created_by_handle'])
        description = self._format_description(incident['description'])
        text = (
            "🚨 WAITING FOR DEPARTMENT\n"
            "------------------------------\n"
            f"ID: {incident_id}\n"
            f"Department: {dept_name}\n"
            "Status: 🔔 Awaiting response from department\n"
            "------------------------------\n"
            f"Reported by: {reported_by}\n"
            "Ticket:\n"
            f"{description}\n"
            "------------------------------\n"
            "Tap Join if you're taking this. You can still change the department if it belongs elsewhere."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Join", callback_data=f"claim:{incident['incident_id']}")],
            [InlineKeyboardButton("🔀 Change department", callback_data=f"change_department:{incident['incident_id']}")]
        ])

        return text, keyboard

    def build_claimed_message(self, incident: Dict[str, Any], claimer_handles: List[str],
                              department_name: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for claimed incident."""
        incident_id = self._escape_text(incident['incident_id'])
        dept_name = self._escape_text(department_name)
        responders = self._escape_text(", ".join(claimer_handles) if claimer_handles else "—")
        reported_by = self._escape_text(incident['created_by_handle'])
        description = self._format_description(incident['description'])
        text = (
            "🚨 INCIDENT IN PROGRESS\n"
            "------------------------------\n"
            f"ID: {incident_id}\n"
            f"Department: {dept_name}\n"
            "Status: 🛠️ In progress\n"
            f"Active: {responders}\n"
            "------------------------------\n"
            f"Reported by: {reported_by}\n"
            "Ticket:\n"
            f"{description}\n"
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
        incident_id = MessageBuilder._escape_text(incident['incident_id'])
        resolver = MessageBuilder._escape_text(resolver_handle)
        reported_by = MessageBuilder._escape_text(incident['created_by_handle'])
        description = MessageBuilder._format_description(incident['description'])
        text = (
            "📄 INCIDENT AWAITING RESOLUTION SUMMARY\n"
            "------------------------------\n"
            f"ID: {incident_id}\n"
            f"Resolver: {resolver}\n"
            "Status: ⌛ Awaiting summary\n"
            "------------------------------\n"
            f"Reported by: {reported_by}\n"
            "Ticket:\n"
            f"{description}\n"
            "------------------------------\n"
            f"{resolver}, please reply to this message with a short resolution summary (1–3 sentences)."
        )
        return text, None

    @staticmethod
    def build_resolved_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for resolved incident."""
        incident_id = MessageBuilder._escape_text(incident['incident_id'])
        resolver = MessageBuilder._escape_text(resolver_handle)
        reported_by = MessageBuilder._escape_text(incident['created_by_handle'])
        description = MessageBuilder._format_description(incident['description'])
        summary = MessageBuilder._escape_text(incident.get('resolution_summary', ''))
        text = (
            "✅ INCIDENT RESOLVED\n"
            "------------------------------\n"
            f"ID: {incident_id}\n"
            "Status: ✅ Resolved\n"
            f"Resolved by: {resolver}\n"
            "------------------------------\n"
            f"Reported by: {reported_by}\n"
            "Ticket:\n"
            f"{description}\n"
            "------------------------------\n"
            "Resolution summary:\n"
            f"{summary}"
        )
        return text, None

    @staticmethod
    def build_closed_message(incident: Dict[str, Any], closed_by: Optional[str], reason: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for auto-closed incident (no summary provided)."""
        incident_id = MessageBuilder._escape_text(incident['incident_id'])
        closed_by_text = MessageBuilder._escape_text(closed_by or "System")
        closed_reason = MessageBuilder._escape_text(reason)
        reported_by = MessageBuilder._escape_text(incident['created_by_handle'])
        description = MessageBuilder._format_description(incident['description'])
        summary = MessageBuilder._escape_text(incident.get('resolution_summary', 'No summary provided.'))
        text = (
            "❌ INCIDENT CLOSED\n"
            "------------------------------\n"
            f"ID: {incident_id}\n"
            "Status: ❌ Closed\n"
            f"Closed by: {closed_by_text}\n"
            f"Reason: {closed_reason}\n"
            "------------------------------\n"
            f"Reported by: {reported_by}\n"
            "Ticket:\n"
            f"{description}\n"
            "------------------------------\n"
            "Resolution summary:\n"
            f"{summary}"
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
            "⏰ Unassigned ticket reminder\n"
            "------------------------------\n"
            f"Incident: {incident_id}\n"
            f"{department_line}"
            f"Unassigned for: {minutes} minutes\n"
            "------------------------------\n"
            "Please review the pinned ticket message and join if you are taking ownership."
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
            f"Please review ticket {incident_id} and join if you are taking ownership."
        )
