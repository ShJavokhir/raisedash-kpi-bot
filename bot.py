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

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=getattr(logging, Config.LOG_LEVEL.upper(), logging.INFO)
)
logger = logging.getLogger(__name__)


class IncidentBot:
    """Main bot application class."""

    def __init__(self):
        """Initialize the bot application."""
        # Validate configuration
        Config.validate()

        # Initialize Sentry for error tracking and performance monitoring
        SentryConfig.initialize(
            dsn=Config.SENTRY_DSN,
            environment=Config.SENTRY_ENVIRONMENT,
            traces_sample_rate=Config.SENTRY_TRACES_SAMPLE_RATE,
            profiles_sample_rate=Config.SENTRY_PROFILES_SAMPLE_RATE,
            enable_profiling=True
        )

        # Set application context in Sentry
        SentryConfig.set_context("application", {
            "name": "raisedash-kpi-bot",
            "database_path": Config.DATABASE_PATH,
            "environment": Config.SENTRY_ENVIRONMENT,
        })

        # Initialize database
        self.db = Database(Config.DATABASE_PATH)
        logger.info(f"Database initialized at {Config.DATABASE_PATH}")

        # Build application
        self.application = Application.builder().token(Config.TELEGRAM_BOT_TOKEN).build()

        # Initialize handlers
        self.bot_handlers = BotHandlers(
            self.db,
            platform_admin_ids=Config.PLATFORM_ADMIN_IDS
        )

        # Initialize reminder service
        self.reminder_service = None  # Will be initialized after app is built

        # Register handlers
        self._register_handlers()

        logger.info("Bot initialized successfully")

    def _register_handlers(self):
        """Register all command and callback handlers."""
        app = self.application

        # Command handlers
        app.add_handler(CommandHandler("start", self.bot_handlers.start_command))
        app.add_handler(CommandHandler("help", self.bot_handlers.start_command))  # Alias for /start
        app.add_handler(CommandHandler("report", self.bot_handlers.report_command))
        app.add_handler(CommandHandler("add_group", self.bot_handlers.add_group_command))
        app.add_handler(CommandHandler("add_department", self.bot_handlers.add_department_command))
        app.add_handler(CommandHandler("list_departments", self.bot_handlers.list_departments_command))
        app.add_handler(CommandHandler("add_department_member", self.bot_handlers.add_department_member_command))
        app.add_handler(CommandHandler("new_issue", self.bot_handlers.new_issue_command))

        # Chat member updates (bot invited/removed)
        app.add_handler(ChatMemberHandler(
            self.bot_handlers.chat_member_update_handler,
            chat_member_types=ChatMemberHandler.MY_CHAT_MEMBER
        ))

        # Callback query handler (for all inline buttons)
        app.add_handler(CallbackQueryHandler(self.bot_handlers.callback_handler))

        # Message handler (for resolution summaries)
        # This should be last to catch replies
        app.add_handler(MessageHandler(
            filters.TEXT & ~filters.COMMAND & filters.ChatType.GROUPS,
            self.bot_handlers.message_handler
        ))

        logger.info("Handlers registered")

    async def _reminder_task(self):
        """Background task for checking and sending reminders."""
        logger.info("Reminder task started")

        # Initialize reminder service with the bot instance
        self.reminder_service = ReminderService(self.db, self.application.bot)

        interval = Config.get_reminder_interval_seconds()

        while True:
            try:
                logger.debug("Running reminder check...")
                await self.reminder_service.check_and_send_reminders()

                # Periodic cleanup
                if utc_now().minute == 0:  # Once per hour (UTC)
                    self.reminder_service.cleanup_old_reminders()

            except Exception as e:
                logger.error(f"Error in reminder task: {e}", exc_info=True)
                SentryConfig.capture_exception(e, task="reminder_check")

            # Wait for next interval
            await asyncio.sleep(interval)

    async def _post_init(self, application: Application):
        """Post-initialization callback to start background tasks."""
        logger.info("Starting background tasks...")
        bot_user_id = getattr(application.bot, "id", None)
        if bot_user_id:
            self.bot_handlers.set_bot_user_id(bot_user_id)

        # Start the reminder task
        asyncio.create_task(self._reminder_task())

    async def _post_stop(self, application: Application):
        """Post-stop callback for cleanup."""
        logger.info("Stopping background tasks...")

    def run(self):
        """Run the bot with long polling."""
        logger.info("Starting bot...")

        # Add post-init and post-stop callbacks
        self.application.post_init = self._post_init
        self.application.post_stop = self._post_stop

        # Start the bot
        self.application.run_polling(
            allowed_updates=['message', 'callback_query', 'chat_member', 'my_chat_member']
        )


def main():
    """Main entry point."""
    try:
        bot = IncidentBot()
        bot.run()
    except KeyboardInterrupt:
        logger.info("Bot stopped by user")
        SentryConfig.capture_message("Bot stopped by user", level="info")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        SentryConfig.capture_exception(e, fatal=True)
        raise


if __name__ == '__main__':
    main()
