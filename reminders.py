"""
Reminder module for automated SLA nudges and notifications.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Set
from telegram import Bot
from telegram.error import TelegramError

from database import Database
from message_builder import MessageBuilder
from config import Config

logger = logging.getLogger(__name__)


class ReminderService:
    """Service for checking and sending automated reminders."""

    def __init__(self, db: Database, bot: Bot):
        self.db = db
        self.bot = bot
        self.message_builder = MessageBuilder()

        # Track which incidents we've already sent reminders for
        # to avoid spamming the same reminder multiple times
        self._unclaimed_reminded: Set[str] = set()
        self._escalation_reminded: Set[str] = set()

    async def check_and_send_reminders(self):
        """Check for incidents that need reminders and send them."""
        try:
            await self._check_unclaimed_reminders()
            await self._check_escalation_reminders()
        except Exception as e:
            logger.error(f"Error in reminder check: {e}", exc_info=True)

    async def _check_unclaimed_reminders(self):
        """Check for unclaimed incidents that need reminders."""
        unclaimed_incidents = self.db.get_unclaimed_incidents(
            Config.SLA_UNCLAIMED_NUDGE_MINUTES
        )

        for incident in unclaimed_incidents:
            incident_id = incident['incident_id']

            # Skip if we've already sent a reminder for this incident
            if incident_id in self._unclaimed_reminded:
                continue

            try:
                # Calculate how long it's been unclaimed
                t_created = datetime.fromisoformat(incident['t_created'])
                minutes_unclaimed = int((datetime.now() - t_created).total_seconds() / 60)

                # Build and send reminder
                reminder_text = self.message_builder.build_unclaimed_reminder(
                    incident_id,
                    minutes_unclaimed
                )

                # Send as reply to the pinned message
                await self.bot.send_message(
                    chat_id=incident['group_id'],
                    text=reminder_text,
                    reply_to_message_id=incident['pinned_message_id']
                )

                # Mark as reminded
                self._unclaimed_reminded.add(incident_id)
                logger.info(f"Sent unclaimed reminder for {incident_id}")

            except TelegramError as e:
                logger.error(f"Error sending unclaimed reminder for {incident_id}: {e}")
            except Exception as e:
                logger.error(f"Unexpected error processing unclaimed incident {incident_id}: {e}")

    async def _check_escalation_reminders(self):
        """Check for unclaimed escalations that need reminders."""
        unclaimed_escalations = self.db.get_unclaimed_escalations(
            Config.SLA_ESCALATION_NUDGE_MINUTES
        )

        for incident in unclaimed_escalations:
            incident_id = incident['incident_id']

            # Skip if we've already sent a reminder for this escalation
            if incident_id in self._escalation_reminded:
                continue

            try:
                # Get group info for manager handles
                group = self.db.get_group(incident['group_id'])
                if not group:
                    logger.warning(f"No group found for incident {incident_id}")
                    continue

                manager_handles = group['manager_handles']
                if not manager_handles:
                    logger.warning(f"No managers configured for group {incident['group_id']}")
                    continue

                # Calculate how long it's been escalated
                t_escalated = datetime.fromisoformat(incident['t_escalated'])
                minutes_escalated = int((datetime.now() - t_escalated).total_seconds() / 60)

                # Build and send reminder
                reminder_text = self.message_builder.build_escalation_reminder(
                    incident_id,
                    minutes_escalated,
                    manager_handles
                )

                # Send as reply to the pinned message
                await self.bot.send_message(
                    chat_id=incident['group_id'],
                    text=reminder_text,
                    reply_to_message_id=incident['pinned_message_id']
                )

                # Mark as reminded
                self._escalation_reminded.add(incident_id)
                logger.info(f"Sent escalation reminder for {incident_id}")

            except TelegramError as e:
                logger.error(f"Error sending escalation reminder for {incident_id}: {e}")
            except Exception as e:
                logger.error(f"Unexpected error processing escalated incident {incident_id}: {e}")

    def clear_reminder_for_incident(self, incident_id: str):
        """Clear reminder flags when an incident is claimed/resolved."""
        self._unclaimed_reminded.discard(incident_id)
        self._escalation_reminded.discard(incident_id)

    def cleanup_old_reminders(self, max_age_hours: int = 24):
        """
        Clean up reminder tracking for old incidents.
        This prevents the sets from growing unbounded.
        """
        # In a production system, you'd want to:
        # 1. Query the database for resolved/closed incidents
        # 2. Remove them from the tracking sets
        # For now, we'll just clear very old entries periodically

        # This is a simple implementation - in production you'd want
        # to track timestamps and clean up more intelligently
        if len(self._unclaimed_reminded) > 1000:
            logger.info("Clearing unclaimed reminder cache (size limit reached)")
            self._unclaimed_reminded.clear()

        if len(self._escalation_reminded) > 1000:
            logger.info("Clearing escalation reminder cache (size limit reached)")
            self._escalation_reminded.clear()
