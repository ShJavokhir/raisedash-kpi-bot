# RaiseDash KPI Bot

## Overview
Enterprise-grade Telegram incident management bot for operational teams. Provides a structured workflow for reporting, routing by department, and resolving incidents through Telegram group chats with button-based interactions.

## Core Purpose
Enable logistics/operations teams to manage incidents efficiently with department-based ownership while preventing race conditions and ensuring accountability.

## Key Features

### Incident Management
- **Department Model**: Incidents are assigned to departments; any member can claim and resolve.
- **Interactive Workflow**: Button-based interface (Choose Department → Claim → Resolve / Change Department).
- **Unique Incident IDs**: Simple sequential IDs (0001, 0002...) for tracking.
- **Message Pinning**: Auto-pin active incidents, unpin when resolved.

### Safety & Reliability
- **Race Condition Protection**: Atomic database operations prevent conflicting claims.
- **Per-Group Isolation**: Independent configurations per Telegram group.
- **Role-Based Access**: Driver opt-in plus department membership authorization.
- **Persistent Storage**: SQLite with WAL mode for concurrency.

### Automation
- **SLA Reminders**: Background task monitors unclaimed incidents and summary timeouts.
- **Auto-Registration**: Users auto-registered on first claim for convenience.
- **State Management**: Enforced state machine with department assignments and summary capture.

## Incident Lifecycle

1. **Awaiting_Department** → User replies to an issue message with `/new_issue`.
2. **Awaiting_Claim** → Reporter chooses a department; members are notified and SLA timer starts.
3. **In_Progress** → Department member(s) claim and work the issue.
4. **Change Department** → Current department can transfer the issue to another department.
5. **Awaiting_Summary** → Claimer clicks Resolve and submits a summary.
6. **Resolved/Closed** → Incident closed with resolution notes or auto-closed on timeout.

## Tech Stack

- **Python 3.8+** with asyncio
- **python-telegram-bot v22.5** for Telegram API
- **SQLite3** with WAL mode (production: recommend PostgreSQL)
- **python-dotenv** for environment management

## Architecture

```
bot.py                 # Main entry, initialization
handlers.py            # Command & callback handlers
database.py            # Database operations
message_builder.py     # Message formatting & keyboards
reminders.py           # SLA monitoring service
config.py              # Configuration management
```

## Database Schema

- **Groups**: group_id, manager_user_ids, dispatcher_user_ids (legacy compatibility)
- **Users**: user_id, telegram_handle, team_role
- **Departments**: company_id, name, metadata
- **Department Members**: department_id ⇄ user_id relationships
- **Incidents**: incident_id, status, department assignment, timestamps, descriptions

## Commands

- `/new_issue` - Reply to an issue message to create an incident
- Departments are configured in the dashboard (frontend)
- `/register_driver` - Self-register as driver
- `/start` or `/help` - Show help

## Configuration (.env)

- `TELEGRAM_BOT_TOKEN` - Bot token (required)
- `DATABASE_PATH` - DB location (default: incidents.db)
- `SLA_UNCLAIMED_NUDGE_MINUTES` - Unclaimed reminder (default: 10)
- `SLA_SUMMARY_TIMEOUT_MINUTES` - Resolution summary timeout (default: 10)
- `REMINDER_CHECK_INTERVAL_MINUTES` - Check frequency (default: 5)
- `LOG_LEVEL` - Logging level (default: INFO)

## Status

Production-ready for MVP/small teams. Well-architected with separation of concerns, atomic operations, comprehensive logging, and clear documentation.
