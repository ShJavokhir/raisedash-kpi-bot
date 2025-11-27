"""
Reminder module for automated SLA nudges and notifications.
"""

import logging
from datetime import datetime, timedelta
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
        # Track shift-start pings to avoid duplicates within the same start event
        self._shift_start_pings: set[str] = set()
        self._last_shift_check = None

    async def check_and_send_reminders(self):
        """Check for incidents that need reminders and send them."""
        logger.debug("Starting reminder check cycle")
        try:
            shift_ping_count = await self._check_shift_start_pings()
            unclaimed_count = await self._check_unclaimed_reminders()
            timeout_count = await self._check_summary_timeouts()
            logger.debug(
                "Reminder check complete: %s shift pings, %s unclaimed reminders, %s summary timeouts",
                shift_ping_count,
                unclaimed_count,
                timeout_count
            )
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

    async def _check_shift_start_pings(self):
        """
        Ping newly active schedules for unclaimed incidents.

        Runs on the reminder cadence; detects schedule start times that occurred
        since the last check (defaulting to the last interval) and tags the
        relevant members once per start event.
        """
        now_local = datetime.now().astimezone()
        window_start = self._last_shift_check or (now_local - timedelta(minutes=Config.REMINDER_CHECK_INTERVAL_MINUTES))
        window_end = now_local
        self._last_shift_check = now_local

        incidents = self.db.get_current_unclaimed_incidents()
        if not incidents:
            return 0

        ping_count = 0
        for incident in incidents:
            incident_id = incident['incident_id']
            department_id = incident.get('department_id')
            group_id = incident.get('group_id')
            if not department_id or not group_id:
                continue

            membership = self.db.get_company_membership(group_id)
            if not membership or not membership.get('group') or not membership.get('is_active'):
                continue

            members = self.db.get_group_department_members(group_id, department_id)
            if not members:
                continue

            handles_to_ping = set()
            for member in members:
                schedule = member.get('schedule') or []
                events = self._iter_schedule_start_events(schedule, window_start, window_end)
                for event_dt in events:
                    key = f"{incident_id}:{member['user_id']}:{event_dt.isoformat()}"
                    if key in self._shift_start_pings:
                        continue
                    self._shift_start_pings.add(key)

                    handle = member.get('telegram_handle') or (
                        f"@{member['username']}" if member.get('username') else None
                    ) or f"User_{member['user_id']}"
                    handles_to_ping.add(handle)

            if not handles_to_ping:
                continue

            note = f"Shift start ping at {now_local.strftime('%H:%M')} {now_local.strftime('%A')} (server time)."
            ping_messages = self.message_builder.build_department_ping(
                list(handles_to_ping),
                incident_id,
                note
            )
            for ping in ping_messages:
                try:
                    await self.bot.send_message(
                        chat_id=group_id,
                        text=ping,
                        reply_to_message_id=incident.get('pinned_message_id')
                    )
                    ping_count += 1
                except TelegramError as e:
                    logger.error(f"Error sending shift start ping for {incident_id}: {e}")
                    SentryConfig.capture_exception(e, incident_id=incident_id, reminder_type="shift_start")

        if len(self._shift_start_pings) > 5000:
            self._shift_start_pings = set(list(self._shift_start_pings)[-2500:])

        return ping_count

    @staticmethod
    def _iter_schedule_start_events(schedule, window_start: datetime, window_end: datetime):
        """
        Yield datetimes for schedule start times that fall within [window_start, window_end].
        """
        if window_end <= window_start:
            return []

        results = []
        tz = window_start.tzinfo
        # Cover all days spanned by the window
        day_count = (window_end.date() - window_start.date()).days
        candidate_dates = [window_start.date() + timedelta(days=i) for i in range(day_count + 1)]

        for entry in schedule:
            if not entry.get('enabled'):
                continue
            entry_day = entry.get('day')
            try:
                entry_day_int = int(entry_day)
            except Exception:
                continue

            start_minute = entry.get('start_minute')
            if start_minute is None:
                continue
            try:
                start_minute_int = int(start_minute)
            except Exception:
                continue

            for candidate_date in candidate_dates:
                if candidate_date.weekday() != entry_day_int:
                    continue
                event_dt = datetime(
                    candidate_date.year,
                    candidate_date.month,
                    candidate_date.day,
                    start_minute_int // 60,
                    start_minute_int % 60,
                    tzinfo=tz
                )
                if window_start <= event_dt <= window_end:
                    results.append(event_dt)

        return results

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
