"""
Message builder module for constructing incident messages and inline keyboards.
"""

from typing import Dict, Any, Optional
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
            "Dispatchers: Use the buttons below to claim or escalate this incident."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Claim", callback_data=f"claim_t1:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_claimed_t1_message(incident: Dict[str, Any], claimer_handle: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for Tier 1 claimed incident (State 2)."""
        text = (
            "🚨 INCIDENT IN PROGRESS (Tier 1)\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Status: 🛠️ IN PROGRESS\n"
            f"Owner: {claimer_handle}\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "If you are no longer working on this, leave the claim or escalate to a manager."
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
            "🚨 INCIDENT ESCALATED\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            "Status: 🆘 ESCALATED – Awaiting manager\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            f"Previous owner: {escalated_by_handle}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Managers: Claim this escalation if you are taking ownership."
        )

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🛡️ Claim Escalation", callback_data=f"claim_t2:{incident['incident_id']}")]
        ])

        return text, keyboard

    @staticmethod
    def build_claimed_t2_message(incident: Dict[str, Any], claimer_handle: str) -> tuple[str, InlineKeyboardMarkup]:
        """Build message for Tier 2 claimed incident (State 4)."""
        text = (
            "🚨 INCIDENT IN PROGRESS (Tier 2)\n"
            "------------------------------\n"
            f"ID: {incident['incident_id']}\n"
            f"Status: 🛠️ IN PROGRESS\n"
            f"Owner: {claimer_handle} (Manager)\n"
            "------------------------------\n"
            f"Reported by: {incident['created_by_handle']}\n"
            "Issue:\n"
            f"{incident['description']}\n"
            "------------------------------\n"
            "Managers: Resolve this incident when the issue is fully addressed."
        )

        keyboard = InlineKeyboardMarkup([
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
            "Dispatchers: Please review the pinned incident message and claim it if you are taking ownership."
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
