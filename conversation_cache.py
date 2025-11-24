"""
Lightweight in-memory cache for recent group conversations.
Maintains a time-windowed buffer of messages per group to build context
for commands like /new_issue without hitting the database.
"""

import logging
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock
from typing import Deque, Dict, List

from time_utils import utc_now

logger = logging.getLogger(__name__)


@dataclass
class CachedMessage:
    """Represents a cached group message."""
    user_id: int
    text: str
    timestamp: datetime


class ConversationCache:
    """Thread-safe, per-group cache for recent messages."""

    def __init__(self, window_seconds: int, max_messages_per_group: int = 500):
        self.window_seconds = window_seconds
        self.max_messages_per_group = max_messages_per_group
        self._messages: Dict[int, Deque[CachedMessage]] = {}
        self._lock = Lock()

    def add_message(self, group_id: int, user_id: int, text: str):
        """Add a message to the group's cache and prune old entries."""
        if not text:
            return

        now = utc_now()
        cutoff = now - timedelta(seconds=self.window_seconds)

        with self._lock:
            bucket = self._messages.setdefault(group_id, deque())
            bucket.append(CachedMessage(user_id=user_id, text=text, timestamp=now))

            # Remove messages older than the window
            while bucket and bucket[0].timestamp < cutoff:
                bucket.popleft()

            # Cap total messages per group to avoid unbounded growth
            if self.max_messages_per_group and len(bucket) > self.max_messages_per_group:
                overshoot = len(bucket) - self.max_messages_per_group
                for _ in range(overshoot):
                    bucket.popleft()

    def get_recent_messages(self, group_id: int, user_id: int, limit: int) -> List[str]:
        """Return up to `limit` recent messages for a user within the window."""
        cutoff = utc_now() - timedelta(seconds=self.window_seconds)

        with self._lock:
            bucket = self._messages.get(group_id)
            if not bucket:
                return []

            # Filter by user and time window, preserve order
            filtered = [
                msg.text for msg in bucket
                if msg.user_id == user_id and msg.timestamp >= cutoff
            ]

            return filtered[-limit:] if limit > 0 else filtered
