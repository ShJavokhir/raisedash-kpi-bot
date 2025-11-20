"""
Centralized logging configuration with structured context support.

This module provides enhanced logging capabilities with context tracking
for chatId, userId, incidentId, and other important identifiers.
"""

import logging
import sys
from typing import Optional, Dict, Any
from contextvars import ContextVar

# Context variables for tracking across async operations
_log_context: ContextVar[Dict[str, Any]] = ContextVar('log_context', default={})


class ContextFilter(logging.Filter):
    """Filter that injects context variables into log records."""

    def filter(self, record):
        context = _log_context.get({})
        for key, value in context.items():
            setattr(record, key, value)
        return True


class StructuredFormatter(logging.Formatter):
    """Formatter that includes structured context in log messages."""

    def format(self, record):
        # Build context string from available context fields
        context_parts = []

        # Add standard context fields if present
        if hasattr(record, 'chat_id'):
            context_parts.append(f"chatId={record.chat_id}")
        if hasattr(record, 'user_id'):
            context_parts.append(f"userId={record.user_id}")
        if hasattr(record, 'username'):
            context_parts.append(f"username={record.username}")
        if hasattr(record, 'incident_id'):
            context_parts.append(f"incidentId={record.incident_id}")
        if hasattr(record, 'group_id'):
            context_parts.append(f"groupId={record.group_id}")
        if hasattr(record, 'company_id'):
            context_parts.append(f"companyId={record.company_id}")
        if hasattr(record, 'department_id'):
            context_parts.append(f"departmentId={record.department_id}")

        # Add context to message if present
        if context_parts:
            context_str = ' | '.join(context_parts)
            record.msg = f"[{context_str}] {record.msg}"

        return super().format(record)


def setup_logging(log_level: str = 'INFO'):
    """
    Set up application-wide logging with structured formatting.

    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
    # Create formatter
    formatter = StructuredFormatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(ContextFilter())

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
    root_logger.addHandler(console_handler)

    # Set levels for specific loggers
    logging.getLogger('telegram').setLevel(logging.WARNING)  # Reduce telegram library noise
    logging.getLogger('httpx').setLevel(logging.WARNING)     # Reduce HTTP noise
    logging.getLogger('httpcore').setLevel(logging.WARNING)


def set_log_context(**kwargs):
    """
    Set logging context for the current async context.

    Example:
        set_log_context(chat_id=123456, user_id=789012, username='john')
    """
    current = _log_context.get({})
    updated = {**current, **kwargs}
    _log_context.set(updated)


def clear_log_context():
    """Clear all logging context."""
    _log_context.set({})


def get_log_context() -> Dict[str, Any]:
    """Get current logging context."""
    return _log_context.get({})


class LogContext:
    """Context manager for temporary logging context."""

    def __init__(self, **kwargs):
        self.context = kwargs
        self.previous_context = None

    def __enter__(self):
        self.previous_context = _log_context.get({})
        updated = {**self.previous_context, **self.context}
        _log_context.set(updated)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        _log_context.set(self.previous_context)


def log_user_action(logger: logging.Logger, action: str,
                   chat_id: Optional[int] = None,
                   user_id: Optional[int] = None,
                   username: Optional[str] = None,
                   **extra_context):
    """
    Log a user action with context.

    Args:
        logger: Logger instance
        action: Description of the action
        chat_id: Chat ID
        user_id: User ID
        username: Username
        **extra_context: Additional context fields
    """
    context = {}
    if chat_id is not None:
        context['chat_id'] = chat_id
    if user_id is not None:
        context['user_id'] = user_id
    if username is not None:
        context['username'] = username
    context.update(extra_context)

    # Temporarily set context
    with LogContext(**context):
        logger.info(action)


def log_database_operation(logger: logging.Logger, operation: str,
                          table: Optional[str] = None,
                          **extra_context):
    """
    Log a database operation with context.

    Args:
        logger: Logger instance
        operation: Description of the operation
        table: Database table name
        **extra_context: Additional context fields
    """
    context = {}
    if table is not None:
        context['table'] = table
    context.update(extra_context)

    with LogContext(**context):
        logger.debug(operation)


def log_state_transition(logger: logging.Logger,
                        from_state: str,
                        to_state: str,
                        incident_id: Optional[int] = None,
                        **extra_context):
    """
    Log a state transition with context.

    Args:
        logger: Logger instance
        from_state: Previous state
        to_state: New state
        incident_id: Incident ID
        **extra_context: Additional context fields
    """
    context = {'from_state': from_state, 'to_state': to_state}
    if incident_id is not None:
        context['incident_id'] = incident_id
    context.update(extra_context)

    with LogContext(**context):
        logger.info(f"State transition: {from_state} -> {to_state}")


def log_error_with_context(logger: logging.Logger, error: Exception,
                          operation: str,
                          **extra_context):
    """
    Log an error with full context.

    Args:
        logger: Logger instance
        error: Exception instance
        operation: Operation that failed
        **extra_context: Additional context fields
    """
    with LogContext(**extra_context):
        logger.error(f"Error in {operation}: {str(error)}", exc_info=True)
