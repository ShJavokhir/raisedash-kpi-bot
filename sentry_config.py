"""
Enterprise-grade Sentry configuration and integration module.

This module provides comprehensive error tracking, performance monitoring,
and context enrichment for the Telegram bot application.
"""

import logging
import os
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.threading import ThreadingIntegration
from typing import Optional, Dict, Any
from functools import wraps

logger = logging.getLogger(__name__)


class SentryConfig:
    """
    Centralized Sentry configuration and utilities for enterprise monitoring.

    Features:
    - Automatic error tracking with context enrichment
    - Performance monitoring for critical operations
    - User context tracking
    - Custom tags and breadcrumbs
    - Intelligent error filtering
    """

    _initialized = False

    @classmethod
    def initialize(cls, dsn: Optional[str] = None, environment: str = "production",
                   traces_sample_rate: float = 0.1, profiles_sample_rate: float = 0.1,
                   enable_profiling: bool = True):
        """
        Initialize Sentry SDK with enterprise-grade configuration.

        Args:
            dsn: Sentry DSN (Data Source Name)
            environment: Environment name (production, staging, development)
            traces_sample_rate: Percentage of transactions to trace (0.0 - 1.0)
            profiles_sample_rate: Percentage of transactions to profile (0.0 - 1.0)
            enable_profiling: Whether to enable profiling
        """
        if cls._initialized:
            logger.warning("Sentry already initialized, skipping")
            return

        if not dsn:
            logger.info("Sentry DSN not configured, skipping initialization")
            return

        try:
            # Configure logging integration to capture logs as breadcrumbs
            logging_integration = LoggingIntegration(
                level=logging.INFO,       # Capture INFO and above as breadcrumbs
                event_level=logging.ERROR # Send ERROR and above as events
            )

            integrations = [
                logging_integration,
                ThreadingIntegration(propagate_hub=True),
            ]

            # Initialize Sentry SDK
            sentry_sdk.init(
                dsn=dsn,
                environment=environment,
                integrations=integrations,

                # Performance Monitoring
                traces_sample_rate=traces_sample_rate,
                profiles_sample_rate=profiles_sample_rate if enable_profiling else 0.0,

                # Error filtering
                before_send=cls._before_send_filter,
                before_breadcrumb=cls._before_breadcrumb_filter,

                # Additional configuration
                send_default_pii=False,  # Don't send PII by default
                attach_stacktrace=True,
                max_breadcrumbs=100,

                # Release tracking
                release=cls._get_release_version(),

                # Performance
                _experiments={
                    "profiles_sample_rate": profiles_sample_rate if enable_profiling else 0.0,
                },
            )

            cls._initialized = True
            logger.info(f"Sentry initialized successfully for environment: {environment}")

        except Exception as e:
            logger.error(f"Failed to initialize Sentry: {e}", exc_info=True)

    @staticmethod
    def _get_release_version() -> Optional[str]:
        """
        Get the release version from environment or git.

        Returns:
            Release version string or None
        """
        # Try environment variable first
        version = os.getenv('SENTRY_RELEASE')
        if version:
            return version

        # Try to get git commit hash
        try:
            import subprocess
            result = subprocess.run(
                ['git', 'rev-parse', '--short', 'HEAD'],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                return f"raisedash-kpi-bot@{result.stdout.strip()}"
        except Exception:
            pass

        return None

    @staticmethod
    def _before_send_filter(event: Dict[str, Any], hint: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Filter events before sending to Sentry.

        This allows us to:
        - Ignore expected errors (like Telegram rate limits)
        - Scrub sensitive data
        - Add additional context

        Args:
            event: Sentry event dictionary
            hint: Additional context about the event

        Returns:
            Modified event or None to drop the event
        """
        # Get the exception info if available
        if 'exc_info' in hint:
            exc_type, exc_value, tb = hint['exc_info']

            # Ignore expected Telegram errors
            if exc_type.__name__ in ['RetryAfter', 'TimedOut', 'NetworkError']:
                # These are expected in Telegram bots, don't spam Sentry
                return None

            # Ignore specific error messages
            exc_message = str(exc_value).lower()
            ignored_messages = [
                'bot was blocked by the user',
                'chat not found',
                'message is not modified',
                'message to edit not found',
            ]

            if any(msg in exc_message for msg in ignored_messages):
                return None

        # Scrub sensitive data from event
        if 'request' in event and 'data' in event['request']:
            # Remove any potential tokens or sensitive data
            data = event['request']['data']
            if isinstance(data, dict):
                for key in ['TELEGRAM_BOT_TOKEN', 'token', 'password', 'secret']:
                    if key in data:
                        data[key] = '[Filtered]'

        return event

    @staticmethod
    def _before_breadcrumb_filter(crumb: Dict[str, Any], hint: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Filter breadcrumbs before adding to Sentry.

        Args:
            crumb: Breadcrumb dictionary
            hint: Additional context

        Returns:
            Modified breadcrumb or None to drop it
        """
        # Don't track debug-level SQL queries in production
        if crumb.get('category') == 'query' and crumb.get('level') == 'debug':
            return None

        return crumb

    @staticmethod
    def set_user_context(user_id: int, username: Optional[str] = None,
                        role: Optional[str] = None, **extra):
        """
        Set user context for Sentry events.

        Args:
            user_id: Telegram user ID
            username: Telegram username
            role: User role (Driver, Dispatcher, OpsManager)
            **extra: Additional user context
        """
        if not SentryConfig._initialized:
            return

        context = {
            "id": str(user_id),
            "telegram_id": user_id,
        }

        if username:
            context["username"] = username

        if role:
            context["role"] = role

        context.update(extra)

        sentry_sdk.set_user(context)

    @staticmethod
    def set_context(context_name: str, context_data: Dict[str, Any]):
        """
        Set custom context for Sentry events.

        Args:
            context_name: Name of the context (e.g., 'incident', 'group')
            context_data: Dictionary of context data
        """
        if not SentryConfig._initialized:
            return

        sentry_sdk.set_context(context_name, context_data)

    @staticmethod
    def set_tag(key: str, value: Any):
        """
        Set a tag for Sentry events.

        Args:
            key: Tag key
            value: Tag value
        """
        if not SentryConfig._initialized:
            return

        sentry_sdk.set_tag(key, value)

    @staticmethod
    def add_breadcrumb(message: str, category: str = "default",
                       level: str = "info", data: Optional[Dict[str, Any]] = None):
        """
        Add a breadcrumb to track user actions and application flow.

        Args:
            message: Breadcrumb message
            category: Category (e.g., 'user_action', 'database', 'telegram')
            level: Level (debug, info, warning, error)
            data: Additional data
        """
        if not SentryConfig._initialized:
            return

        sentry_sdk.add_breadcrumb(
            message=message,
            category=category,
            level=level,
            data=data or {}
        )

    @staticmethod
    def capture_exception(error: Exception, **context):
        """
        Manually capture an exception with additional context.

        Args:
            error: The exception to capture
            **context: Additional context to attach
        """
        if not SentryConfig._initialized:
            logger.error(f"Error (Sentry not initialized): {error}", exc_info=True)
            return

        # Set additional context
        for key, value in context.items():
            if isinstance(value, dict):
                SentryConfig.set_context(key, value)
            else:
                SentryConfig.set_tag(key, value)

        sentry_sdk.capture_exception(error)

    @staticmethod
    def capture_message(message: str, level: str = "info", **context):
        """
        Capture a message in Sentry.

        Args:
            message: Message to capture
            level: Level (debug, info, warning, error, fatal)
            **context: Additional context
        """
        if not SentryConfig._initialized:
            return

        for key, value in context.items():
            if isinstance(value, dict):
                SentryConfig.set_context(key, value)
            else:
                SentryConfig.set_tag(key, value)

        sentry_sdk.capture_message(message, level=level)

    @staticmethod
    def start_transaction(name: str, op: str = "task") -> Any:
        """
        Start a performance monitoring transaction.

        Args:
            name: Transaction name
            op: Operation type (e.g., 'task', 'db.query', 'http.request')

        Returns:
            Transaction object or None if Sentry not initialized
        """
        if not SentryConfig._initialized:
            return None

        return sentry_sdk.start_transaction(name=name, op=op)

    @staticmethod
    def start_span(op: str, description: Optional[str] = None) -> Any:
        """
        Start a performance monitoring span within a transaction.

        Args:
            op: Operation type
            description: Span description

        Returns:
            Span object or None
        """
        if not SentryConfig._initialized:
            return None

        return sentry_sdk.start_span(op=op, description=description)


def sentry_trace(op: str = "function", description: Optional[str] = None):
    """
    Decorator to automatically trace function execution with Sentry.

    Args:
        op: Operation type
        description: Operation description (defaults to function name)

    Example:
        @sentry_trace(op="database.query", description="Fetch incident")
        def get_incident(incident_id):
            ...
    """
    def decorator(func):
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            if not SentryConfig._initialized:
                return func(*args, **kwargs)

            desc = description or f"{func.__module__}.{func.__name__}"
            with sentry_sdk.start_span(op=op, description=desc):
                return func(*args, **kwargs)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            if not SentryConfig._initialized:
                return await func(*args, **kwargs)

            desc = description or f"{func.__module__}.{func.__name__}"
            with sentry_sdk.start_span(op=op, description=desc):
                return await func(*args, **kwargs)

        # Return appropriate wrapper based on function type
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


def safe_execute(fallback_return=None, capture_exception=True):
    """
    Decorator to safely execute functions with automatic error capture.

    Args:
        fallback_return: Value to return if function raises an exception
        capture_exception: Whether to capture the exception in Sentry

    Example:
        @safe_execute(fallback_return=False)
        async def risky_operation():
            ...
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                logger.error(f"Error in {func.__name__}: {e}", exc_info=True)
                if capture_exception:
                    SentryConfig.capture_exception(e, function=func.__name__)
                return fallback_return

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.error(f"Error in {func.__name__}: {e}", exc_info=True)
                if capture_exception:
                    SentryConfig.capture_exception(e, function=func.__name__)
                return fallback_return

        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator
