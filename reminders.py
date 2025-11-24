"""
Reminder module for automated SLA nudges and notifications.
"""

import logging
from typing import Dict
from telegram import Bot
from telegram.error import TelegramError
from telegram.constants import ParseMode

from database import Database
from message_builder import MessageBuilder
from config import Config
from time_utils import minutes_since
from sentry_config import SentryConfig

logger = logging.getLogger(__name__)


class ReminderService:
    """Service for checking and sending automated reminders."""

    def __init__(self, db: Database, bot: Bot):
        self.db = db
        self.bot = bot
        self.message_builder = MessageBuilder()

        # Track which incidents we've already sent reminders for
        # to avoid spamming the same reminder multiple times
        # Maps incident_id -> t_department_assigned snapshot
        self._unclaimed_reminded: Dict[str, str] = {}

    async def check_and_send_reminders(self):
        """Check for incidents that need reminders and send them."""
        logger.debug("Starting reminder check cycle")
        try:
            unclaimed_count = await self._check_unclaimed_reminders()
            timeout_count = await self._check_summary_timeouts()
            logger.debug(f"Reminder check complete: {unclaimed_count} unclaimed reminders, {timeout_count} summary timeouts")
        except Exception as e:
            logger.error(f"Error in reminder check: {e}", exc_info=True)
            SentryConfig.capture_exception(e, task="reminder_service")

    async def _check_unclaimed_reminders(self):
        """Check for unclaimed incidents that need reminders."""
        unclaimed_incidents = self.db.get_unclaimed_incidents(
            Config.SLA_UNCLAIMED_NUDGE_MINUTES
        )

        if unclaimed_incidents:
            logger.info(f"Found {len(unclaimed_incidents)} unclaimed incidents requiring reminders")

        reminder_count = 0
        for incident in unclaimed_incidents:
            incident_id = incident['incident_id']

            last_assigned = incident.get('t_department_assigned')
            if not last_assigned:
                continue

            # Skip if we've already sent a reminder for this department assignment
            if self._unclaimed_reminded.get(incident_id) == last_assigned:
                continue

            try:
                membership = self.db.get_company_membership(incident['group_id'])
                if not membership or not membership.get('group'):
                    logger.warning(f"No group membership found for incident {incident_id}")
                    continue
                if not membership.get('is_active'):
                    logger.info(f"Skipping unclaimed reminder for inactive group {incident['group_id']}")
                    continue

                # Calculate how long it's been unclaimed
                anchor_time = incident.get('t_department_assigned') or incident['t_created']
                minutes_unclaimed = minutes_since(anchor_time)

                department_name = None
                if incident.get('department_id'):
                    dept = self.db.get_department(incident['department_id'])
                    department_name = dept['name'] if dept else None

                # Build and send reminder
                reminder_text = self.message_builder.build_unclaimed_reminder(
                    incident_id,
                    minutes_unclaimed,
                    department_name
                )

                # Send as reply to the pinned message
                await self.bot.send_message(
                    chat_id=incident['group_id'],
                    text=reminder_text,
                    reply_to_message_id=incident['pinned_message_id']
                )

                # Mark as reminded
                self._unclaimed_reminded[incident_id] = last_assigned
                reminder_count += 1
                logger.info(f"Sent unclaimed reminder for {incident_id} (total sent: {reminder_count})")

            except TelegramError as e:
                logger.error(f"Error sending unclaimed reminder for {incident_id}: {e}")
                SentryConfig.capture_exception(e, incident_id=incident_id, reminder_type="unclaimed")
            except Exception as e:
                logger.error(f"Unexpected error processing unclaimed incident {incident_id}: {e}")
                SentryConfig.capture_exception(e, incident_id=incident_id, reminder_type="unclaimed")

        return reminder_count

    async def _check_summary_timeouts(self):
        """Auto-close incidents that have waited too long for a summary."""
        awaiting_summaries = self.db.get_awaiting_summary_incidents(
            Config.SLA_SUMMARY_TIMEOUT_MINUTES
        )

        if awaiting_summaries:
            logger.info(f"Found {len(awaiting_summaries)} incidents awaiting summary timeout")

        timeout_count = 0
        for incident in awaiting_summaries:
            incident_id = incident['incident_id']

            try:
                pending_handle = self.db.get_user_handle_or_fallback(
                    incident.get('pending_resolution_by_user_id')
                )

                closing_summary = (
                    f"Auto-closed after waiting {Config.SLA_SUMMARY_TIMEOUT_MINUTES} minutes "
                    f"for a resolution summary from {pending_handle}. No response received."
                )

                success, msg = self.db.auto_close_incident(
                    incident_id,
                    closing_summary,
                    reason="summary_timeout"
                )

                if not success:
                    logger.warning(f"Skipping auto-close for {incident_id}: {msg}")
                    continue

                updated_incident = self.db.get_incident(incident_id)
                if not updated_incident:
                    logger.warning(f"Incident {incident_id} not found after auto-close")
                    continue

                closed_text, _ = self.message_builder.build_closed_message(
                    updated_incident,
                    pending_handle,
                    "No resolution summary received"
                )

                pinned_message_id = incident.get('pinned_message_id')
                if pinned_message_id:
                    try:
                        await self.bot.edit_message_text(
                            chat_id=incident['group_id'],
                            message_id=pinned_message_id,
                            text=closed_text,
                            parse_mode=ParseMode.HTML
                        )
                    except TelegramError as e:
                        logger.error(f"Error updating pinned message for {incident_id}: {e}")

                    try:
                        await self.bot.unpin_chat_message(
                            chat_id=incident['group_id'],
                            message_id=pinned_message_id
                        )
                    except TelegramError as e:
                        logger.warning(f"Could not unpin closed incident {incident_id}: {e}")
                else:
                    try:
                        await self.bot.send_message(
                            chat_id=incident['group_id'],
                            text=closed_text,
                            parse_mode=ParseMode.HTML
                        )
                    except TelegramError as e:
                        logger.error(f"Error sending closed message for {incident_id}: {e}")

                notice_text = self.message_builder.build_auto_close_notice(
                    incident_id,
                    pending_handle,
                    Config.SLA_SUMMARY_TIMEOUT_MINUTES
                )

                send_kwargs = {
                    "chat_id": incident['group_id'],
                    "text": notice_text
                }
                if pinned_message_id:
                    send_kwargs["reply_to_message_id"] = pinned_message_id

                await self.bot.send_message(**send_kwargs)

                # Clear any reminder tracking now that the incident is closed
                self.clear_reminder_for_incident(incident_id)

                timeout_count += 1
                logger.info(f"Auto-closed incident {incident_id} after summary timeout (total closed: {timeout_count})")

            except TelegramError as e:
                logger.error(f"Telegram error during auto-close for {incident_id}: {e}")
                SentryConfig.capture_exception(e, incident_id=incident_id, reminder_type="auto_close")
            except Exception as e:
                logger.error(f"Unexpected error during auto-close for {incident_id}: {e}")
                SentryConfig.capture_exception(e, incident_id=incident_id, reminder_type="auto_close")

        return timeout_count

    def clear_reminder_for_incident(self, incident_id: str):
        """Clear reminder flags when an incident is claimed/resolved."""
        self._unclaimed_reminded.pop(incident_id, None)

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
