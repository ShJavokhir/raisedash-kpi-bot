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

    # Database settings
    DATABASE_PATH = os.getenv('DATABASE_PATH', 'incidents.db')

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
