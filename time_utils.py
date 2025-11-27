"""
UTC-safe time utilities for consistent timestamp handling.

All timestamp strings use ISO 8601 with an explicit +00:00 offset to avoid
local-time ambiguity when persisted or compared in SQLite.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


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

MINUTES_PER_DAY = 24 * 60


def parse_hhmm_to_minutes(value: str) -> int:
    """
    Convert an HH:MM string (00:00-23:59) to minutes since midnight.

    Raises:
        ValueError if the input is missing or malformed.
    """
    if not value or not isinstance(value, str):
        raise ValueError("Time value must be a non-empty string in HH:MM format")

    parts = value.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid time format '{value}', expected HH:MM")

    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError:
        raise ValueError(f"Invalid time components in '{value}', expected HH:MM") from None

    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        raise ValueError(f"Time '{value}' must be between 00:00 and 23:59")

    return hours * 60 + minutes


def format_minutes_as_hhmm(minutes_since_midnight: int) -> str:
    """Format a minute offset (0-1439) to HH:MM with zero padding."""
    if minutes_since_midnight < 0 or minutes_since_midnight >= MINUTES_PER_DAY:
        raise ValueError("Minutes since midnight must be between 0 and 1439")
    hours, minutes = divmod(minutes_since_midnight, 60)
    return f"{hours:02d}:{minutes:02d}"


def normalize_time_window(start_time: str, end_time: str) -> Tuple[int, int]:
    """
    Parse and validate a daily time window expressed as HH:MM strings.

    Returns:
        (start_minute, end_minute) where each is 0-1439 inclusive.

    Rules:
    - Windows may span midnight (e.g., 22:00-06:00).
    - start and end cannot be identical (00:00-23:59 should be used for 24/7).
    """
    start_minute = parse_hhmm_to_minutes(start_time)
    end_minute = parse_hhmm_to_minutes(end_time)
    if start_minute == end_minute:
        raise ValueError("Start and end times cannot be identical; use 00:00-23:59 for 24/7 availability")
    return start_minute, end_minute


def format_time_window(start_minute: int, end_minute: int) -> str:
    """Render a validated time window in HH:MM-HH:MM format."""
    return f"{format_minutes_as_hhmm(start_minute)}-{format_minutes_as_hhmm(end_minute)}"


def minute_of_day(now: Optional[datetime] = None) -> int:
    """Return the local minute of day for the provided time (default: server local time)."""
    current = now if now is not None else datetime.now().astimezone()
    return current.hour * 60 + current.minute


WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_INDEX = {name: idx for idx, name in enumerate(WEEKDAY_NAMES)}


def is_time_in_window(start_minute: int, end_minute: int, now: Optional[datetime] = None) -> bool:
    """
    Determine whether the current local time falls within the provided window.

    Windows may span midnight. Endpoints are inclusive.
    """
    minute = minute_of_day(now)
    if start_minute < 0 or start_minute >= MINUTES_PER_DAY or end_minute < 0 or end_minute >= MINUTES_PER_DAY:
        raise ValueError("Start and end minutes must be between 0 and 1439")

    if start_minute < end_minute:
        return start_minute <= minute <= end_minute
    # Overnight span (e.g., 22:00-06:00)
    return minute >= start_minute or minute <= end_minute


def weekday_index(now: Optional[datetime] = None) -> int:
    """Return weekday index (0=Monday ... 6=Sunday) for the provided time."""
    current = now if now is not None else datetime.now().astimezone()
    return current.weekday()


def normalize_weekday(value: Any) -> int:
    """
    Normalize a weekday identifier to 0-6 (Monday=0).

    Accepts integers 0-6 or weekday names (case-insensitive).
    """
    if isinstance(value, int):
        if 0 <= value <= 6:
            return value
        raise ValueError("Weekday index must be between 0 (Monday) and 6 (Sunday)")

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in WEEKDAY_INDEX:
            return WEEKDAY_INDEX[normalized]
    raise ValueError(f"Invalid weekday value: {value!r}")


def normalize_week_schedule(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Normalize a weekly schedule.

    Input entries: list of dicts with keys:
      - day: int 0-6 or weekday name
      - enabled: bool
      - start_time/end_time: HH:MM strings OR start_minute/end_minute ints (required when enabled)

    Returns: list of 7 dicts (Monday..Sunday) with keys:
      day (0-6), enabled (bool), start_minute, end_minute
    """
    if not isinstance(entries, list):
        raise ValueError("schedule must be provided as a list of day entries")

    normalized: Dict[int, Dict[str, Any]] = {}
    for entry in entries:
        day = normalize_weekday(entry.get("day"))
        if day in normalized:
            raise ValueError(f"Duplicate schedule entry for day {day}")

        enabled = bool(entry.get("enabled", False))
        if enabled:
            start_raw = entry.get("start_minute")
            end_raw = entry.get("end_minute")
            if start_raw is not None and end_raw is not None:
                try:
                    start_minute = int(start_raw)
                    end_minute = int(end_raw)
                except (TypeError, ValueError) as exc:
                    raise ValueError("start_minute/end_minute must be integers") from exc
                if start_minute < 0 or start_minute >= MINUTES_PER_DAY or end_minute < 0 or end_minute >= MINUTES_PER_DAY:
                    raise ValueError("start_minute/end_minute must be between 0 and 1439")
                if start_minute == end_minute:
                    raise ValueError("Start and end times cannot be identical; use 00:00-23:59 for 24/7 availability")
            else:
                start_raw = entry.get("start_time")
                end_raw = entry.get("end_time")
                start_minute, end_minute = normalize_time_window(str(start_raw), str(end_raw))
        else:
            start_minute = end_minute = 0

        normalized[day] = {
            "day": day,
            "enabled": enabled,
            "start_minute": start_minute,
            "end_minute": end_minute,
        }

    # Fill missing days as disabled
    for idx in range(7):
        if idx not in normalized:
            normalized[idx] = {
                "day": idx,
                "enabled": False,
                "start_minute": 0,
                "end_minute": 0,
            }

    return [normalized[idx] for idx in range(7)]


def is_now_in_schedule(schedule: List[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    """Return True if the provided schedule is active for the given time."""
    if not schedule:
        return False
    current_day = weekday_index(now)
    for entry in schedule:
        if entry.get("day") != current_day:
            continue
        if not entry.get("enabled"):
            return False
        return is_time_in_window(entry.get("start_minute", -1), entry.get("end_minute", -1), now)
    return False
