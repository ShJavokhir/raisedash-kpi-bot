"""
UTC-safe time utilities for consistent timestamp handling.

All timestamp strings use ISO 8601 with an explicit +00:00 offset to avoid
local-time ambiguity when persisted or compared in SQLite.
"""

from datetime import datetime, timezone
from typing import Optional


def utc_now() -> datetime:
    """Return the current UTC time as an aware datetime."""
    return datetime.now(timezone.utc)


def utc_iso_now() -> str:
    """Return the current UTC time in ISO 8601 format with offset."""
    return utc_now().isoformat()


def ensure_utc(dt: datetime) -> datetime:
    """
    Normalize any datetime to a UTC-aware datetime.
    Naive datetimes are treated as UTC to preserve legacy persisted values.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_timestamp(value: str) -> datetime:
    """
    Parse a timestamp string into an aware UTC datetime.
    Accepts ISO 8601 strings with optional 'Z' suffix and treats naive values as UTC.
    """
    if not value:
        raise ValueError("timestamp value is required")

    normalized = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    return ensure_utc(dt)


def minutes_since(timestamp: str) -> int:
    """Return whole minutes elapsed since the given timestamp."""
    parsed = parse_timestamp(timestamp)
    return int((utc_now() - parsed).total_seconds() // 60)


def isoformat_utc(dt: Optional[datetime]) -> str:
    """Convert a datetime to ISO 8601 with a UTC offset, treating None as now."""
    target = dt if dt is not None else utc_now()
    return ensure_utc(target).isoformat()
