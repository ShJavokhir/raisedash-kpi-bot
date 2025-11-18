"""
Message builder module for constructing incident messages and inline keyboards.
"""

from typing import Dict, Any, Optional
from telegram import InlineKeyboardButton, InlineKeyboardMarkup


class MessageBuilder:
    """Builds formatted messages and inline keyboards for incident states."""

    @staticmethod
    def build_unclaimed_message(incident: Dict[str, Any]) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for unclaimed incident (State 1)."""
        text = (
            f"🚨 NEW INCIDENT: {incident['incident_id']}\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Issue: {incident['description']}\n"
            f"Status: 🔥 UNCLAIMED"
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Claim", callback_data=f"claim_t1:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_claimed_t1_message(incident: Dict[str, Any], claimer_handle: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for Tier 1 claimed incident (State 2)."""
        text = (
            f"🚨 INCIDENT: {incident['incident_id']}\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Issue: {incident['description']}\n"
            f"Status: 🛠️ IN PROGRESS (Claimed by {claimer_handle})"
        )

        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("❌ Leave Claim", callback_data=f"release_t1:{incident['incident_id']}"),
                InlineKeyboardButton("⬆️ Escalate", callback_data=f"escalate:{incident['incident_id']}")
            ],
            [InlineKeyboardButton("🏁 Resolve", callback_data=f"resolve_t1:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_escalated_message(incident: Dict[str, Any], escalated_by_handle: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for escalated incident (State 3)."""
        text = (
            f"🚨 INCIDENT: {incident['incident_id']}\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Issue: {incident['description']}\n"
            f"Status: 🆘 ESCALATED - Awaiting Manager\n"
            f"(Previously owned by {escalated_by_handle})"
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🛡️ Claim Escalation", callback_data=f"claim_t2:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_claimed_t2_message(incident: Dict[str, Any], claimer_handle: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for Tier 2 claimed incident (State 4)."""
        text = (
            f"🚨 INCIDENT: {incident['incident_id']}\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Issue: {incident['description']}\n"
            f"Status: 🛠️ IN PROGRESS (Handled by {claimer_handle})"
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🏁 Resolve", callback_data=f"resolve_t2:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_awaiting_summary_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for awaiting summary state (State 5)."""
        text = (
            f"🚨 INCIDENT: {incident['incident_id']}\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Issue: {incident['description']}\n"
            f"Status: ⌛ AWAITING SUMMARY\n"
            f"(Waiting for {resolver_handle} to reply)"
        )

        # No buttons in this state
        return text, None

    @staticmethod
    def build_resolved_message(incident: Dict[str, Any], resolver_handle: str) -> tuple[str, Optional[InlineKeyboardMarkup]]:
        """Build message for resolved incident (State 6)."""
        text = (
            f"✅ RESOLVED: {incident['incident_id']}\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Issue: {incident['description']}\n"
            f"Status: ✅ RESOLVED\n"
            f"Resolved by: {resolver_handle}\n"
            f"Summary: {incident['resolution_summary']}"
        )

        # Could add a Re-Open button here if needed
        return text, None

    @staticmethod
    def build_escalation_notification(incident_id: str, manager_handles: list[str]) -> str:
        """Build notification message for managers when incident is escalated."""
        managers_text = ", ".join(manager_handles)
        return f"🔔 {incident_id} requires manager attention. Paging: {managers_text}"

    @staticmethod
    def build_resolution_request(incident_id: str, user_handle: str) -> str:
        """Build message requesting resolution summary."""
        return f"{user_handle}, please reply to this message with the resolution summary for {incident_id}."

    @staticmethod
    def build_unclaimed_reminder(incident_id: str, minutes: int) -> str:
        """Build reminder message for unclaimed incident."""
        return f"🔔 {incident_id} has been unclaimed for {minutes} minutes. Dispatchers please review."

    @staticmethod
    def build_escalation_reminder(incident_id: str, minutes: int, manager_handles: list[str]) -> str:
        """Build reminder message for unclaimed escalation."""
        managers_text = ", ".join(manager_handles)
        return f"🔔 {incident_id} has been awaiting a manager for {minutes} minutes. Paging: {managers_text}"
