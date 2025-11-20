"""
Notification service for sending Telegram messages from API requests.

This service acts as a bridge between the Next.js API and the Telegram bot,
allowing the API to queue notification requests that the bot will process.
"""

import logging
from typing import Optional
from telegram import Bot
from telegram.error import TelegramError

from database import Database
from sentry_config import SentryConfig

logger = logging.getLogger(__name__)


class NotificationService:
    """Handles processing and sending queued notifications to Telegram."""

    def __init__(self, db: Database, bot: Bot):
        self.db = db
        self.bot = bot
        logger.info("NotificationService initialized")

    async def process_pending_notifications(self):
        """
        Check for pending notifications and send them via Telegram.
        This method is called periodically by the bot's background task.
        """
        try:
            # Get all pending notifications
            notifications = self.db.get_pending_notifications()

            if not notifications:
                return

            logger.info(f"Processing {len(notifications)} pending notification(s)")

            for notification in notifications:
                await self._send_notification(notification)

        except Exception as e:
            logger.error(f"Error processing pending notifications: {e}", exc_info=True)
            SentryConfig.capture_exception(e, task="notification_processing")

    async def _send_notification(self, notification: dict):
        """Send a single notification to Telegram."""
        notification_id = notification['notification_id']
        group_id = notification['group_id']
        message_type = notification['message_type']
        message_data = notification.get('message_data', {})

        try:
            logger.info(f"Sending notification {notification_id} to group {group_id}: {message_type}")

            # Build message based on type
            message_text = self._build_message(message_type, message_data)

            if not message_text:
                logger.warning(f"Unknown message type: {message_type}")
                self.db.mark_notification_failed(notification_id, "Unknown message type")
                return

            # Send message to group
            await self.bot.send_message(
                chat_id=group_id,
                text=message_text,
                parse_mode='HTML'
            )

            # Mark as sent
            self.db.mark_notification_sent(notification_id)
            logger.info(f"Notification {notification_id} sent successfully")

        except TelegramError as e:
            error_msg = str(e)
            logger.error(f"Telegram error sending notification {notification_id}: {error_msg}")
            self.db.mark_notification_failed(notification_id, error_msg)
            SentryConfig.capture_exception(e,
                notification_id=notification_id,
                group_id=group_id,
                message_type=message_type
            )
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Error sending notification {notification_id}: {error_msg}", exc_info=True)
            self.db.mark_notification_failed(notification_id, error_msg)
            SentryConfig.capture_exception(e,
                notification_id=notification_id,
                group_id=group_id,
                message_type=message_type
            )

    def _build_message(self, message_type: str, message_data: dict) -> Optional[str]:
        """Build the notification message based on type and data."""

        if message_type == 'group_approved':
            group_name = message_data.get('group_name', 'this group')
            company_name = message_data.get('company_name', 'the company')
            return (
                f"✅ <b>Group Approved!</b>\n\n"
                f"Great news! This group has been approved and activated for <b>{company_name}</b>.\n\n"
                f"🎉 The KPI bot is now fully active in this group.\n"
                f"📊 You can start creating incidents with /new_issue\n"
                f"📋 View departments with /list_departments\n"
                f"❓ Get help with /help"
            )

        elif message_type == 'group_denied':
            group_name = message_data.get('group_name', 'this group')
            company_name = message_data.get('company_name', 'the company')
            return (
                f"❌ <b>Join Request Denied</b>\n\n"
                f"The join request for <b>{company_name}</b> has been denied.\n\n"
                f"If you believe this was a mistake, please contact your company administrator "
                f"or request to join again with the correct company name."
            )

        return None
