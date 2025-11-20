"""
Message builder module for constructing incident messages and inline keyboards.
"""

from typing import Dict, Any, Optional, List
from telegram import InlineKeyboardButton, InlineKeyboardMarkup


class MessageBuilder:
    """Builds formatted messages and inline keyboards for incident states."""

    @staticmethod
    def build_unclaimed_message(incident: Dict[str, Any]) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for unclaimed incident (State 1).

        Structured layout with dividers to improve readability.
        """
        text = (
            "🚨 NEW INCIDENT\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Status: 🔥 UNCLAIMED\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Tier 1 dispatchers: Claim this incident if you are taking ownership. "
            "More than one responder can work on the same issue."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Claim", callback_data=f"claim_t1:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_claimed_t1_message(incident: Dict[str, Any],
                                 claimer_handles: List[str]) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for Tier 1 claimed incident (State 2)."""
        responders = ", ".join(claimer_handles) if claimer_handles else "—"
        text = (
            "🚨 INCIDENT IN PROGRESS (Tier 1)\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Status: 🛠️ IN PROGRESS\n"
            f"Tier 1 dispatchers: {responders}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Other Tier 1 dispatchers can join or leave as needed. "
            "Escalate to a manager only if Tier 1 needs support."
        )

        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Join", callback_data=f"claim_t1:{incident['incident_id']}"),
                InlineKeyboardButton("❌ Leave", callback_data=f"release_t1:{incident['incident_id']}"),
                InlineKeyboardButton("⬆️ Escalate", callback_data=f"escalate:{incident['incident_id']}")
            ],
            [InlineKeyboardButton("🏁 Resolve", callback_data=f"resolve_t1:{incident['incident_id']}")]
        ])

        return text, keyboard

    def build_escalated_message(self, incident: Dict[str, Any], escalated_by_handle: str,
                                tier1_handles: List[str]) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for escalated incident (State 3)."""
        responders = ", ".join(tier1_handles) if tier1_handles else "—"
        text = (
            "🚨 INCIDENT ESCALATED\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: 🆘 ESCALATED – Awaiting manager\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Escalated by: {escalated_by_handle}\n"
            f"Tier 1 dispatchers on it: {responders}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Managers: Claim this escalation if you are taking ownership. "
            "Other managers may also join to assist."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🛡️ Claim Escalation", callback_data=f"claim_t2:{incident['incident_id']}")]
        ])

        return text, keyboard

    def build_claimed_t2_message(self, incident: Dict[str, Any],
                                 manager_handles: List[str],
                                 tier1_handles: Optional[List[str]] = None) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for Tier 2 claimed incident (State 4)."""
        managers = ", ".join(manager_handles) if manager_handles else "—"
        dispatchers = ", ".join(tier1_handles or []) if tier1_handles else "—"
        text = (
            "🚨 INCIDENT IN PROGRESS (Tier 2)\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Status: 🛠️ IN PROGRESS\n"
            f"Managers: {managers}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Tier 1 dispatchers: {dispatchers}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Managers: Resolve when the issue is fully addressed. Other managers may join to assist."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Join", callback_data=f"claim_t2:{incident['incident_id']}")],
            [InlineKeyboardButton("🏁 Resolve", callback_data=f"resolve_t2:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_awaiting_summary_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for awaiting summary state (State 5)."""
        text = (
            "📄 INCIDENT AWAITING RESOLUTION SUMMARY\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Resolver: {resolver_handle}\n"
            "Status: ⌛ AWAITING SUMMARY\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            f"{resolver_handle}, please reply to this message with a short resolution summary (1–3 sentences)."
        )

        # No buttons in this state
        return text, None

    @staticmethod
    def build_resolved_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for resolved incident (State 6)."""
        text = (
            "✅ INCIDENT RESOLVED\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: ✅ RESOLVED\n"
            f"Resolved by: {resolver_handle}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Resolution summary:\n"
            f"{incident['resolution_summary']}"
        )

        # Could add a Re-Open button here if needed
        return text, None

    @staticmethod
    def build_closed_message(incident: Dict[str, Any], closed_by: Optional[str], reason: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for auto-closed incident (no summary provided)."""
        closed_by_text = closed_by or "System"
        text = (
            "❌ INCIDENT CLOSED\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: ❌ CLOSED\n"
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
    def build_auto_close_notice(incident_id: str, user_handle: str, minutes: int) -> str:
        """Build concise notice when summary timeout closes an incident."""
        return (
            f"Auto-closed {incident_id} after waiting {minutes} minutes for {user_handle}'s summary. "
            "Reopen manually if more details are needed."
        )

    @staticmethod
    def build_escalation_notification(incident_id: str, manager_handles: list[str]) -> str:
        """Build notification message for managers when incident is escalated."""
        managers_text = ", ".join(manager_handles)
        return (
            "🔔 Escalation notification\n"
            "------------------------------\n"
            f"Incident: {incident_id}\n"
            f"Managers: {managers_text}\n"
            "------------------------------\n"
            "Please review the pinned incident message and claim the escalation if you are taking ownership."
        )

    @staticmethod
    def build_resolution_request(incident_id: str, user_handle: str) -> str:
        """Build message requesting resolution summary."""
        return (
            f"{user_handle}, please reply to this message with a short resolution summary for {incident_id}.\n"
            "Include what you did, the root cause (if known), and any follow-up actions."
        )

    @staticmethod
    def build_unclaimed_reminder(incident_id: str, minutes: int) -> str:
        """Build reminder message for unclaimed incident."""
        return (
            "⏰ Unclaimed incident reminder\n"
            "------------------------------\n"
            f"Incident: {incident_id}\n"
            f"Unclaimed for: {minutes} minutes\n"
            "------------------------------\n"
            "Tier 1 dispatchers: Please review the pinned incident message and claim it if you are taking ownership."
        )

    @staticmethod
    def build_escalation_reminder(incident_id: str, minutes: int, manager_handles: list[str]) -> str:
        """Build reminder message for unclaimed escalation."""
        managers_text = ", ".join(manager_handles)
        return (
            "⏰ Escalation reminder\n"
            "------------------------------\n"
            f"Incident: {incident_id}\n"
            f"Waiting for manager claim: {minutes} minutes\n"
            f"Managers: {managers_text}\n"
            "------------------------------\n"
            "Managers: Please review the pinned incident message and claim the escalation if you are taking ownership."
        )
