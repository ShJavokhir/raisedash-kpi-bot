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


def get_current_shift(day_start_hour: int = 7, night_start_hour: int = 19,
                      now: Optional[datetime] = None) -> str:
    """
    Return the active shift label ("DAY" or "NIGHT") using local time.

    Args:
        day_start_hour: Hour (0-23) when day shift begins.
        night_start_hour: Hour (0-23) when night shift begins.
        now: Optional datetime override for testing.
    """
    if not (0 <= day_start_hour <= 23 and 0 <= night_start_hour <= 23):
        raise ValueError("Shift hours must be between 0 and 23")
    if day_start_hour == night_start_hour:
        raise ValueError("Day and night shift start hours cannot be the same")

    current_time = (now if now is not None else datetime.now().astimezone())
    hour = current_time.hour

    if day_start_hour < night_start_hour:
        is_day_shift = day_start_hour <= hour < night_start_hour
    else:
        # Handles overnight day start (rare but supported)
        is_day_shift = hour >= day_start_hour or hour < night_start_hour

    return "DAY" if is_day_shift else "NIGHT"
