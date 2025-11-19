# Enhanced User Tracking Implementation

## Overview

This document describes the comprehensive user tracking feature that has been implemented in the raisedash-kpi-bot. The system now automatically captures detailed information about all users who interact with the bot, regardless of whether they have assigned roles.

## What Was Implemented

### 1. Expanded Users Table Schema

The `users` table now includes the following fields:

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `user_id` | INTEGER | Telegram user ID (Primary Key) | Yes |
| `telegram_handle` | TEXT | Handle with @ prefix (e.g., @username or User_123) | No |
| `username` | TEXT | Raw Telegram username without @ | No |
| `first_name` | TEXT | User's first name | No |
| `last_name` | TEXT | User's last name | No |
| `language_code` | TEXT | User's language preference (e.g., "en", "es") | No |
| `is_bot` | INTEGER | Boolean flag (0 or 1) indicating if user is a bot | Yes (default: 0) |
| `team_role` | TEXT | Team role: Driver, Dispatcher, or OpsManager | No |
| `group_connections` | TEXT | JSON array of group IDs where user was seen | Yes (default: []) |
| `created_at` | TEXT | ISO 8601 timestamp when user was first tracked | No |
| `updated_at` | TEXT | ISO 8601 timestamp when user was last updated | No |

### 2. Database Migration

The migration system automatically adds new columns to existing databases without data loss:

- **Backward compatible**: Existing data is preserved
- **Automatic backfill**: Timestamps are backfilled for existing records
- **No downtime**: Migration runs on bot startup

**File**: `database.py:189-220`

### 3. Comprehensive User Tracking Function

#### `Database.track_user()` - database.py:628-719

This is the primary function for tracking users. It captures all available Telegram user data and maintains group connections.

**Features**:
- Upserts user data (INSERT or UPDATE)
- Preserves existing data when optional fields are not provided
- Tracks all groups where a user has been seen
- Role preservation: Won't downgrade existing roles
- Returns complete user information after tracking

**Example Usage**:
```python
user = db.track_user(
    user_id=123456789,
    username="john_doe",
    first_name="John",
    last_name="Doe",
    language_code="en",
    is_bot=False,
    group_id=-1001234567890,
    team_role="Driver"
)
```

#### `BotHandlers._track_user_interaction()` - handlers.py:40-79

Universal wrapper function in handlers that extracts user data from Telegram Update objects and calls `db.track_user()`.

**Features**:
- Automatically extracts all available fields from Telegram User object
- Handles missing/optional fields gracefully
- Error handling with logging
- Returns tracked user data or None on error

**Example Usage**:
```python
# In any handler
user = update.effective_user
chat = update.effective_chat
self._track_user_interaction(user, group_id=chat.id, team_role="Dispatcher")
```

### 4. Automatic User Tracking Integration

User tracking is now automatically triggered in the following scenarios:

#### A. Message Handler (handlers.py:1048-1052)
**Tracks**: ANY user who sends a message in a group
```python
# Track user interaction (capture all users sending messages)
if message and message.from_user:
    chat = message.chat
    group_id = chat.id if chat and self._is_group_chat(chat) else None
    self._track_user_interaction(message.from_user, group_id=group_id)
```

#### B. Callback Handler (handlers.py:806-809)
**Tracks**: ANY user who clicks inline buttons
```python
# Track user interaction (capture all users clicking buttons)
if user:
    group_id = chat.id if chat and self._is_group_chat(chat) else None
    self._track_user_interaction(user, group_id=group_id)
```

#### C. Command Handlers

**register_driver_command** (handlers.py:703-704)
```python
# Track user with Driver role
self._track_user_interaction(user, group_id=group_id, team_role='Driver')
```

**new_issue_command** (handlers.py:754-755)
```python
# Track user creating the incident (captures comprehensive user data)
self._track_user_interaction(user, group_id=chat.id)
```

**add_dispatcher_command** (handlers.py:516-519)
```python
# Use comprehensive tracking if we have the full user object
if dispatcher_user_object:
    self._track_user_interaction(dispatcher_user_object, group_id=chat.id, team_role='Dispatcher')
```

**chat_member_update_handler** (handlers.py:256-258)
```python
# Track the user who invited the bot to the group
if inviter:
    self._track_user_interaction(inviter, group_id=group_id)
```

### 5. Group Connections Tracking

The `group_connections` field stores a JSON array of all group IDs where a user has been observed.

**Features**:
- Automatically tracks new group appearances
- Deduplicates group IDs
- Persists across all user interactions
- Useful for understanding user activity across multiple groups

**Example**:
```json
[-1001234567890, -1009876543210, -1001111222333]
```

### 6. Backward Compatibility

The legacy `upsert_user()` function (database.py:721-753) has been updated to:
- Work with the new schema
- Preserve enhanced fields
- Maintain existing behavior for old code

**File**: `database.py:721-753`

## Testing

Comprehensive tests have been implemented in `test_user_tracking.py` covering:

1. ✓ Database migration and schema verification
2. ✓ Comprehensive user tracking with all fields
3. ✓ Group connection tracking and updates
4. ✓ Users without team roles
5. ✓ Role preservation logic
6. ✓ Backward compatibility with legacy functions

**Run tests**: `source ./myenv/bin/activate && python3 test_user_tracking.py`

## Key Benefits

### 1. Complete User Visibility
- **Before**: Only users with explicit roles were tracked
- **After**: ALL users who interact with the bot are captured

### 2. Rich User Profiles
- **Before**: Only user_id, handle, and role
- **After**: First name, last name, username, language, timestamps, group connections

### 3. Group Activity Tracking
- Track which users are active in which groups
- Identify cross-group users
- Better understanding of user behavior

### 4. Enterprise-Grade Robustness
- Thread-safe operations with database locking
- Proper error handling and logging
- Automatic migration without data loss
- Backward compatibility maintained

### 5. Audit Trail
- `created_at`: When user was first seen
- `updated_at`: Last interaction timestamp
- Comprehensive logging of all tracking operations

## Database Schema Changes

### Before (Original Schema)
```sql
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    telegram_handle TEXT,
    team_role TEXT CHECK(team_role IN ('Driver', 'Dispatcher', 'OpsManager'))
)
```

### After (Enhanced Schema)
```sql
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    telegram_handle TEXT,           -- Backward compatible
    username TEXT,                   -- NEW: Raw username
    first_name TEXT,                 -- NEW: User's first name
    last_name TEXT,                  -- NEW: User's last name
    language_code TEXT,              -- NEW: Language preference
    is_bot INTEGER NOT NULL DEFAULT 0, -- NEW: Bot flag
    team_role TEXT CHECK(team_role IN ('Driver', 'Dispatcher', 'OpsManager')),
    group_connections TEXT NOT NULL DEFAULT '[]', -- NEW: JSON array of group IDs
    created_at TEXT,                 -- NEW: First seen timestamp
    updated_at TEXT                  -- NEW: Last updated timestamp
)
```

## Usage Examples

### Example 1: Track a regular user sending a message
```python
# Automatically triggered in message_handler
# User: @john_doe sends a message in group -1001234567890
# Result: User is tracked with first_name, last_name, username, etc.
```

### Example 2: Track a dispatcher being added
```python
# Admin runs: /add_dispatcher @jane_smith
# Result: User is tracked with full profile + 'Dispatcher' role
```

### Example 3: Query user information
```python
user = db.get_user(123456789)
print(f"Name: {user['first_name']} {user['last_name']}")
print(f"Username: @{user['username']}")
print(f"Active in groups: {user['group_connections']}")
print(f"Role: {user['team_role']}")
```

### Example 4: Find users active in multiple groups
```python
with db.get_connection() as conn:
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, first_name, last_name, username, group_connections
        FROM users
        WHERE json_array_length(group_connections) > 1
    """)
    multi_group_users = cursor.fetchall()
```

## Files Modified

1. **database.py**
   - Lines 189-220: Migration code for new columns
   - Lines 628-719: New `track_user()` function
   - Lines 721-753: Updated `upsert_user()` for backward compatibility
   - Lines 755-776: Enhanced `get_user()` to return all fields
   - Lines 778-814: New `add_group_connection_to_user()` helper

2. **handlers.py**
   - Lines 40-79: New `_track_user_interaction()` wrapper function
   - Lines 256-258: Track bot inviter in `chat_member_update_handler`
   - Lines 703-704: Track drivers in `register_driver_command`
   - Lines 754-755: Track issue creators in `new_issue_command`
   - Lines 472, 516-519: Track dispatchers in `add_dispatcher_command`
   - Lines 806-809: Track button clickers in `callback_handler`
   - Lines 1048-1052: Track all message senders in `message_handler`

3. **test_user_tracking.py** (NEW)
   - Comprehensive test suite for all tracking functionality

## Migration Notes

- ✓ Existing databases will be automatically migrated on next bot startup
- ✓ No data loss - all existing users are preserved
- ✓ Timestamps are backfilled for existing records
- ✓ No manual intervention required
- ✓ Migration is idempotent (safe to run multiple times)

## Performance Considerations

- **Thread-safe**: All database operations use proper locking
- **Efficient**: Single upsert operation per user interaction
- **Indexed**: Primary key on user_id ensures fast lookups
- **Minimal overhead**: Tracking happens asynchronously with bot operations

## Future Enhancements (Optional)

Potential future improvements:
- Add indices on `group_connections` for faster group-based queries
- Track interaction counts per user
- Add user activity heatmaps
- User engagement analytics
- Export user data for reporting

---

## Summary

This implementation provides enterprise-grade user tracking with:
- ✅ Automatic capture of ALL users (not just those with roles)
- ✅ Comprehensive user profiles with 11 data points
- ✅ Group connection tracking
- ✅ Backward compatibility
- ✅ Robust error handling
- ✅ Comprehensive test coverage
- ✅ Zero-downtime migration

The system is now production-ready and will automatically track every user interaction with the bot.
