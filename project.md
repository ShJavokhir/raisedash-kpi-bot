# RaiseDash KPI Bot

## Overview
Enterprise-grade Telegram incident management bot for operational teams. Provides structured workflow for reporting, triaging, escalating, and resolving incidents through Telegram group chats with button-based interactions.

## Core Purpose
Enable logistics/operations teams to manage incidents efficiently with a two-tier support system (Dispatchers → Operations Managers) while preventing race conditions and ensuring accountability.

## Key Features

### Incident Management
- **Two-Tier System**: Tier 1 (Dispatchers) handle standard issues, Tier 2 (Ops Managers) handle escalations
- **Interactive Workflow**: Button-based interface (Claim → Work → Escalate/Resolve)
- **Unique Incident IDs**: Format TKT-YYYY-NNNN for tracking
- **Message Pinning**: Auto-pin active incidents, unpin when resolved

### Safety & Reliability
- **Race Condition Protection**: Atomic database operations prevent multiple claims
- **Per-Group Isolation**: Independent configurations per Telegram group
- **Role-Based Access**: Driver, Dispatcher, OpsManager authorization
- **Persistent Storage**: Supabase/PostgreSQL with normalized roles and multi-assignee support

### Automation
- **SLA Reminders**: Background task monitors unclaimed incidents (10 min) and escalations (15 min)
- **Auto-Registration**: Users auto-registered on first claim for convenience
- **State Management**: Enforced state machine with 6 incident states

## Incident Lifecycle

1. **Unclaimed** → Driver creates incident with `/new_issue <description>`
2. **Claimed_T1** → Dispatcher claims and works on it
3. **Escalated_Unclaimed_T2** → If complex, escalate to managers
4. **Claimed_T2** → Manager claims escalation
5. **Awaiting_Summary** → User clicks Resolve, provides summary
6. **Resolved** → Incident closed with resolution notes

## Tech Stack

- **Python 3.8+** with asyncio
- **python-telegram-bot v22.5** for Telegram API
- **Supabase/PostgreSQL** for persistence (service role key only, no RLS reliance for bot process)
- **supabase-py** client
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

## Database Schema (Supabase)

- **companies**: id (uuid), name (unique), metadata
- **groups**: id (telegram group), company_id (FK), status, registration/request metadata
- **telegram_users**: id, handle/username, profile fields, global_role
- **company_roles / group_roles**: normalized dispatcher/manager assignments (user_id or handle)
- **incidents**: id (TKT-YYYY-NNNN via DB function), lifecycle fields, timestamps, metadata
- **incident_assignments**: active participants per incident tier (supports multiple assignees)
- **incident_events**: audit log of state changes
- **incident_counters**: yearly ticket counter backing the ID generator

## Commands

- `/new_issue <description>` - Create incident
- `/configure_managers @user1 @user2` - Set managers (admin only)
- `/add_dispatcher @user` - Add dispatcher (admin only)
- `/register_driver` - Self-register as driver
- `/start` or `/help` - Show help

## Configuration (.env)

- `TELEGRAM_BOT_TOKEN` - Bot token (required)
- `SUPABASE_URL` - Supabase project URL (required)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (required for server-side writes)
- `SLA_UNCLAIMED_NUDGE_MINUTES` - Unclaimed reminder (default: 10)
- `SLA_ESCALATION_NUDGE_MINUTES` - Escalation reminder (default: 15)
- `REMINDER_CHECK_INTERVAL_MINUTES` - Check frequency (default: 5)
- `LOG_LEVEL` - Logging level (default: INFO)

## Status

Production-ready for MVP/small teams. Well-architected with separation of concerns, atomic operations, comprehensive logging, and clear documentation.
