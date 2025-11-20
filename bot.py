"""
Main entry point for the Enterprise Incident Management Bot.
"""

import logging
import asyncio

from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ChatMemberHandler,
    filters
)

from config import Config
from sentry_config import SentryConfig
from database import Database
from handlers import BotHandlers
from reminders import ReminderService
from time_utils import utc_now
from logging_config import setup_logging

# Configure logging with structured formatting
setup_logging(Config.LOG_LEVEL)
logger = logging.getLogger(__name__)


class IncidentBot:
    """Main bot application class."""

    def __init__(self):
        """Initialize the bot application."""
        logger.info("=" * 60)
        logger.info("STARTING BOT INITIALIZATION")
        logger.info("=" * 60)

        # Validate configuration
        logger.info("Validating configuration...")
        Config.validate()
        logger.info(f"Configuration validated successfully")
        logger.info(f"Platform admin IDs: {Config.PLATFORM_ADMIN_IDS}")
        logger.info(f"Database path: {Config.DATABASE_PATH}")
        logger.info(f"SLA settings - Unclaimed: {Config.SLA_UNCLAIMED_NUDGE_MINUTES}min, "
                   f"Escalation: {Config.SLA_ESCALATION_NUDGE_MINUTES}min, "
                   f"Summary timeout: {Config.SLA_SUMMARY_TIMEOUT_MINUTES}min")

        # Initialize Sentry for error tracking and performance monitoring
        logger.info("Initializing Sentry monitoring...")
        SentryConfig.initialize(
            dsn=Config.SENTRY_DSN,
            environment=Config.SENTRY_ENVIRONMENT,
            traces_sample_rate=Config.SENTRY_TRACES_SAMPLE_RATE,
            profiles_sample_rate=Config.SENTRY_PROFILES_SAMPLE_RATE,
            enable_profiling=True
        )
        logger.info(f"Sentry initialized for environment: {Config.SENTRY_ENVIRONMENT}")

        # Set application context in Sentry
        SentryConfig.set_context("application", {
            "name": "raisedash-kpi-bot",
            "database_path": Config.DATABASE_PATH,
            "environment": Config.SENTRY_ENVIRONMENT,
        })

        # Initialize database
        logger.info(f"Initializing database at: {Config.DATABASE_PATH}")
        self.db = Database(Config.DATABASE_PATH)
        logger.info(f"Database initialized successfully")

        # Build application
        logger.info("Building Telegram application...")
        self.application = Application.builder().token(Config.TELEGRAM_BOT_TOKEN).build()
        logger.info("Telegram application built successfully")

        # Initialize handlers
        logger.info("Initializing bot handlers...")
        self.bot_handlers = BotHandlers(
            self.db,
            platform_admin_ids=Config.PLATFORM_ADMIN_IDS
        )
        logger.info(f"Bot handlers initialized with {len(Config.PLATFORM_ADMIN_IDS)} platform admins")

        # Initialize reminder service
        self.reminder_service = None  # Will be initialized after app is built

        # Register handlers
        self._register_handlers()

        logger.info("=" * 60)
        logger.info("BOT INITIALIZATION COMPLETE")
        logger.info("=" * 60)

    def _register_handlers(self):
        """Register all command and callback handlers."""
        logger.info("Registering command and callback handlers...")
        app = self.application

        # Command handlers
        logger.debug("Registering command handlers...")
        commands = [
            ("start", self.bot_handlers.start_command),
            ("help", self.bot_handlers.start_command),
            ("report", self.bot_handlers.report_command),
            ("add_group", self.bot_handlers.add_group_command),
            ("add_department", self.bot_handlers.add_department_command),
            ("list_departments", self.bot_handlers.list_departments_command),
            ("new_issue", self.bot_handlers.new_issue_command),
        ]

        for cmd_name, handler in commands:
            app.add_handler(CommandHandler(cmd_name, handler))
            logger.debug(f"Registered command handler: /{cmd_name}")

        logger.info(f"Registered {len(commands)} command handlers")

        # Chat member updates (bot invited/removed)
        logger.debug("Registering chat member update handler...")
        app.add_handler(ChatMemberHandler(
            self.bot_handlers.chat_member_update_handler,
            chat_member_types=ChatMemberHandler.MY_CHAT_MEMBER
        ))
        logger.info("Registered chat member update handler")

        # Callback query handler (for all inline buttons)
        logger.debug("Registering callback query handler...")
        app.add_handler(CallbackQueryHandler(self.bot_handlers.callback_handler))
        logger.info("Registered callback query handler for inline buttons")

        # Message handler (for resolution summaries)
        # This should be last to catch replies
        logger.debug("Registering message handler...")
        app.add_handler(MessageHandler(
            filters.TEXT & ~filters.COMMAND & filters.ChatType.GROUPS,
            self.bot_handlers.message_handler
        ))
        logger.info("Registered message handler for group messages")

        logger.info("All handlers registered successfully")

    async def _reminder_task(self):
        """Background task for checking and sending reminders."""
        logger.info("=" * 60)
        logger.info("REMINDER SERVICE STARTING")
        logger.info("=" * 60)

        # Initialize reminder service with the bot instance
        logger.info("Initializing reminder service...")
        self.reminder_service = ReminderService(self.db, self.application.bot)

        interval = Config.get_reminder_interval_seconds()
        logger.info(f"Reminder check interval: {interval} seconds ({Config.REMINDER_CHECK_INTERVAL_MINUTES} minutes)")
        logger.info("Reminder service initialized and running")

        check_count = 0
        while True:
            try:
                check_count += 1
                logger.debug(f"Running reminder check #{check_count}...")
                start_time = utc_now()

                await self.reminder_service.check_and_send_reminders()

                elapsed = (utc_now() - start_time).total_seconds()
                logger.debug(f"Reminder check #{check_count} completed in {elapsed:.2f}s")

                # Periodic cleanup
                if utc_now().minute == 0:  # Once per hour (UTC)
                    logger.info("Running hourly reminder cleanup...")
                    self.reminder_service.cleanup_old_reminders()
                    logger.info("Hourly cleanup completed")

            except Exception as e:
                logger.error(f"Error in reminder task (check #{check_count}): {e}", exc_info=True)
                SentryConfig.capture_exception(e, task="reminder_check")

            # Wait for next interval
            logger.debug(f"Waiting {interval}s until next reminder check...")
            await asyncio.sleep(interval)

    async def _post_init(self, application: Application):
        """Post-initialization callback to start background tasks."""
        logger.info("=" * 60)
        logger.info("POST-INITIALIZATION STARTING")
        logger.info("=" * 60)

        bot_user_id = getattr(application.bot, "id", None)
        if bot_user_id:
            logger.info(f"Bot user ID: {bot_user_id}")
            self.bot_handlers.set_bot_user_id(bot_user_id)
        else:
            logger.warning("Bot user ID not available")

        # Start the reminder task
        logger.info("Creating reminder task...")
        asyncio.create_task(self._reminder_task())
        logger.info("Background tasks started successfully")

    async def _post_stop(self, application: Application):
        """Post-stop callback for cleanup."""
        logger.info("=" * 60)
        logger.info("STOPPING BACKGROUND TASKS")
        logger.info("=" * 60)
        logger.info("Cleanup completed")

    def run(self):
        """Run the bot with long polling."""
        logger.info("=" * 60)
        logger.info("STARTING BOT POLLING")
        logger.info("=" * 60)

        # Add post-init and post-stop callbacks
        self.application.post_init = self._post_init
        self.application.post_stop = self._post_stop

        # Start the bot
        logger.info("Starting long polling...")
        logger.info("Allowed updates: message, callback_query, chat_member, my_chat_member")
        self.application.run_polling(
            allowed_updates=['message', 'callback_query', 'chat_member', 'my_chat_member']
        )
        logger.info("Polling stopped")


def main():
    """Main entry point."""
    logger.info("=" * 60)
    logger.info("INCIDENT BOT STARTING")
    logger.info("=" * 60)

    try:
        bot = IncidentBot()
        bot.run()
    except KeyboardInterrupt:
        logger.info("=" * 60)
        logger.info("BOT STOPPED BY USER (Ctrl+C)")
        logger.info("=" * 60)
        SentryConfig.capture_message("Bot stopped by user", level="info")
    except Exception as e:
        logger.critical("=" * 60)
        logger.critical("FATAL ERROR OCCURRED")
        logger.critical("=" * 60)
        logger.critical(f"Fatal error: {e}", exc_info=True)
        SentryConfig.capture_exception(e, fatal=True)
        raise
    finally:
        logger.info("Application shutdown complete")


if __name__ == '__main__':
    main()
