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

    # Platform administrators (comma-separated Telegram user IDs)
    _RAW_PLATFORM_ADMIN_IDS = os.getenv('PLATFORM_ADMIN_IDS', '')
    PLATFORM_ADMIN_IDS = [
        int(part.strip()) for part in _RAW_PLATFORM_ADMIN_IDS.split(',')
        if part.strip()
    ]

    # Database settings
    DATABASE_PATH = os.getenv('DATABASE_PATH', 'incidents.db')

    # SLA Timers (in minutes)
    SLA_UNCLAIMED_NUDGE_MINUTES = int(os.getenv('SLA_UNCLAIMED_NUDGE_MINUTES', '10'))
    SLA_ESCALATION_NUDGE_MINUTES = int(os.getenv('SLA_ESCALATION_NUDGE_MINUTES', '15'))
    SLA_SUMMARY_TIMEOUT_MINUTES = int(os.getenv('SLA_SUMMARY_TIMEOUT_MINUTES', '10'))

    # Shift boundaries (local server time)
    SHIFT_DAY_START_HOUR = int(os.getenv('SHIFT_DAY_START_HOUR', '7'))
    SHIFT_NIGHT_START_HOUR = int(os.getenv('SHIFT_NIGHT_START_HOUR', '19'))

    # Issue context capture window (in minutes)
    ISSUE_CONTEXT_WINDOW_MINUTES = int(os.getenv('ISSUE_CONTEXT_WINDOW_MINUTES', '3'))
    ISSUE_CONTEXT_MESSAGE_LIMIT = int(os.getenv('ISSUE_CONTEXT_MESSAGE_LIMIT', '3'))

    # Background task interval
    REMINDER_CHECK_INTERVAL_MINUTES = int(os.getenv('REMINDER_CHECK_INTERVAL_MINUTES', '5'))

    # Reporting
    REPORT_TIMEZONE = os.getenv('REPORT_TIMEZONE', 'America/New_York')
    REPORT_WEEK_END_DAY = os.getenv('REPORT_WEEK_END_DAY', 'Sunday')  # Sunday|Monday|...|Saturday
    REPORT_TEMPLATE_PATH = os.getenv('REPORT_TEMPLATE_PATH', 'assets/report_template.html')

    # Logging
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

    # Sentry Configuration
    SENTRY_DSN = os.getenv('SENTRY_DSN')  # Optional, if not set Sentry won't initialize
    SENTRY_ENVIRONMENT = os.getenv('SENTRY_ENVIRONMENT', 'production')
    SENTRY_TRACES_SAMPLE_RATE = float(os.getenv('SENTRY_TRACES_SAMPLE_RATE', '0.1'))
    SENTRY_PROFILES_SAMPLE_RATE = float(os.getenv('SENTRY_PROFILES_SAMPLE_RATE', '0.1'))

    @classmethod
    def validate(cls):
        """Validate that required configuration is present."""
        if not cls.TELEGRAM_BOT_TOKEN:
            raise ValueError(
                "TELEGRAM_BOT_TOKEN is required. "
                "Please set it in your .env file or environment variables."
            )
        if not cls.PLATFORM_ADMIN_IDS:
            raise ValueError(
                "PLATFORM_ADMIN_IDS is required. "
                "Provide a comma-separated list of Telegram user IDs."
            )
        cls._validate_shift_hours()

    @classmethod
    def _validate_shift_hours(cls):
        """Ensure shift hours are sane to prevent invalid tagging windows."""
        for name, value in (
            ("SHIFT_DAY_START_HOUR", cls.SHIFT_DAY_START_HOUR),
            ("SHIFT_NIGHT_START_HOUR", cls.SHIFT_NIGHT_START_HOUR),
        ):
            if value < 0 or value > 23:
                raise ValueError(f"{name} must be between 0 and 23. Current value: {value}")
        if cls.SHIFT_DAY_START_HOUR == cls.SHIFT_NIGHT_START_HOUR:
            raise ValueError("SHIFT_DAY_START_HOUR and SHIFT_NIGHT_START_HOUR cannot be the same.")

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

    @classmethod
    def get_summary_timeout_seconds(cls) -> int:
        """Get resolution summary timeout window in seconds."""
        return cls.SLA_SUMMARY_TIMEOUT_MINUTES * 60

    @classmethod
    def get_report_week_end_index(cls) -> int:
        """Return weekday index (0=Monday ... 6=Sunday) for report windows."""
        mapping = {
            'monday': 0,
            'tuesday': 1,
            'wednesday': 2,
            'thursday': 3,
            'friday': 4,
            'saturday': 5,
            'sunday': 6
        }
        return mapping.get(cls.REPORT_WEEK_END_DAY.lower(), 6)

    @classmethod
    def get_issue_context_window_seconds(cls) -> int:
        """Get the recent message capture window in seconds."""
        return cls.ISSUE_CONTEXT_WINDOW_MINUTES * 60
