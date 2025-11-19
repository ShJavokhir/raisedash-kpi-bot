"""
Configuration module for loading environment variables and settings.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Config:
    """Application configuration loaded from environment variables."""

    # Telegram Bot Token (required)
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

    # Supabase connection (required for persistence)
    SUPABASE_URL = os.getenv('SUPABASE_URL')
    SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    # Platform administrators (comma-separated Telegram user IDs)
    _RAW_PLATFORM_ADMIN_IDS = os.getenv('PLATFORM_ADMIN_IDS', '')
    PLATFORM_ADMIN_IDS = [
        int(part.strip()) for part in _RAW_PLATFORM_ADMIN_IDS.split(',')
        if part.strip()
    ]

    # SLA Timers (in minutes)
    SLA_UNCLAIMED_NUDGE_MINUTES = int(os.getenv('SLA_UNCLAIMED_NUDGE_MINUTES', '10'))
    SLA_ESCALATION_NUDGE_MINUTES = int(os.getenv('SLA_ESCALATION_NUDGE_MINUTES', '15'))

    # Background task interval
    REMINDER_CHECK_INTERVAL_MINUTES = int(os.getenv('REMINDER_CHECK_INTERVAL_MINUTES', '5'))

    # Logging
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

    @classmethod
    def validate(cls):
        """Validate that required configuration is present."""
        if not cls.TELEGRAM_BOT_TOKEN:
            raise ValueError(
                "TELEGRAM_BOT_TOKEN is required. "
                "Please set it in your .env file or environment variables."
            )
        if not cls.SUPABASE_URL or not cls.SUPABASE_SERVICE_ROLE_KEY:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. "
                "These credentials are needed to persist incidents in Supabase."
            )
        if not cls.PLATFORM_ADMIN_IDS:
            raise ValueError(
                "PLATFORM_ADMIN_IDS is required. "
                "Provide a comma-separated list of Telegram user IDs."
            )

    @classmethod
    def get_sla_unclaimed_seconds(cls) -> int:
        """Get SLA unclaimed threshold in seconds."""
        return cls.SLA_UNCLAIMED_NUDGE_MINUTES * 60

    @classmethod
    def get_sla_escalation_seconds(cls) -> int:
        """Get SLA escalation threshold in seconds."""
        return cls.SLA_ESCALATION_NUDGE_MINUTES * 60

    @classmethod
    def get_reminder_interval_seconds(cls) -> int:
        """Get reminder check interval in seconds."""
        return cls.REMINDER_CHECK_INTERVAL_MINUTES * 60
