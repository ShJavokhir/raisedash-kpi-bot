# Enterprise Incident Management Bot

A production-ready Telegram bot for managing incidents in trucking operations with a modern, interactive, button-based workflow.

## Features

- **Interactive Button-Based Workflow**: No more typing commands - just click buttons!
- **Pinned Message System**: Each incident has one pinned message that serves as the "Single Source of Truth"
- **Race Condition Protection**: Atomic database operations prevent double-claiming
- **Per-Group Isolation**: Each Telegram group has its own configuration and incidents
- **Automated SLA Reminders**: Get nudged when incidents are unclaimed too long
- **Role-Based Authorization**: Dispatchers and Managers have different permissions
- **Comprehensive Logging**: Track all actions for audit purposes
- **SQLite Database**: Reliable, file-based storage with no external dependencies

## Architecture

### Technology Stack

- **Frontend**: Telegram Bot API with Inline Keyboards
- **Backend**: Python with python-telegram-bot library
- **Database**: SQLite with three-table schema

### Database Schema

**Groups Table**: Stores per-group configuration
- `group_id`: Telegram Chat ID (Primary Key)
- `group_name`: Human-readable group name
- `manager_handles`: JSON array of manager @handles
- `manager_user_ids`: JSON array of authorized manager user IDs
- `dispatcher_user_ids`: JSON array of authorized dispatcher user IDs

**Users Table**: Master list of all users
- `user_id`: Telegram User ID (Primary Key)
- `telegram_handle`: @username
- `team_role`: 'Driver', 'Dispatcher', or 'OpsManager'

**Incidents Table**: All incident records
- `incident_id`: Format TKT-YYYY-NNNN (Primary Key)
- `status`: Unclaimed, Claimed_T1, Escalated_Unclaimed_T2, Claimed_T2, Awaiting_Summary, Resolved
- `pinned_message_id`: The ID of the interactive message
- Timestamps for each state transition
- Foreign keys to users and groups

## Installation

### Prerequisites

- Python 3.8 or higher
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

### Setup Steps

1. **Clone or download this repository**

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Create environment file**:
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` and add your bot token**:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```

5. **Run the bot**:
   ```bash
   python bot.py
   ```

## Configuration

All configuration is done via environment variables (`.env` file):

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | **Required** |
| `DATABASE_PATH` | Path to SQLite database file | `incidents.db` |
| `SLA_UNCLAIMED_NUDGE_MINUTES` | Minutes before reminding about unclaimed incidents | `10` |
| `SLA_ESCALATION_NUDGE_MINUTES` | Minutes before reminding about unclaimed escalations | `15` |
| `REMINDER_CHECK_INTERVAL_MINUTES` | How often to check for reminders | `5` |
| `LOG_LEVEL` | Logging level (DEBUG, INFO, WARNING, ERROR) | `INFO` |

## Usage

### Initial Setup (One-Time)

1. **Add the bot to your Telegram group**

2. **Make the bot an administrator** (required for pinning messages)

3. **Configure managers** (Admin only):
   ```
   /configure_managers @alice @bob @charlie
   ```

4. **Add dispatchers** (Admin only):
   ```
   /add_dispatcher @john
   ```

### Daily Operations

#### For Drivers

1. **Register as a driver** (one-time):
   ```
   /register_driver
   ```

2. **Report an incident**:
   ```
   /new_issue Truck 123 has a flat tire on I-95
   ```

   The bot will:
   - Create a unique incident ID (e.g., `TKT-2024-0001`)
   - Post an interactive message with buttons
   - Pin the message to the chat

#### For Dispatchers (Tier 1)

1. **Claim an incident**: Click the `✅ Claim` button on the pinned message

2. **Work on the incident**: The message updates to show you own it

3. **Options while working**:
   - `❌ Leave Claim`: Release the incident back to unclaimed
   - `⬆️ Escalate`: Send to managers (Tier 2)
   - `🏁 Resolve`: Mark as resolved (requires summary)

4. **Resolve the incident**:
   - Click `🏁 Resolve`
   - Reply to the bot's message with your resolution summary
   - Example: "Replaced tire with spare. Truck is back on the road."

#### For Managers (Tier 2)

1. **Claim an escalation**: Click the `🛡️ Claim Escalation` button

2. **Resolve the escalation**:
   - Click `🏁 Resolve`
   - Reply to the bot's message with your resolution summary

### Complete Workflow Example

```
Driver: /new_issue Truck 456 engine overheating
Bot: 🚨 NEW INCIDENT: TKT-2024-0042
     Status: 🔥 UNCLAIMED
     [✅ Claim]

Dispatcher John clicks [✅ Claim]

Bot: 🚨 INCIDENT: TKT-2024-0042
     Status: 🛠️ IN PROGRESS (Claimed by @john)
     [❌ Leave Claim] [⬆️ Escalate] [🏁 Resolve]

John clicks [⬆️ Escalate]

Bot: 🚨 INCIDENT: TKT-2024-0042
     Status: 🆘 ESCALATED - Awaiting Manager
     [🛡️ Claim Escalation]

Bot: 🔔 TKT-2024-0042 requires manager attention. Paging: @alice, @bob

Manager Alice clicks [🛡️ Claim Escalation]

Bot: 🚨 INCIDENT: TKT-2024-0042
     Status: 🛠️ IN PROGRESS (Handled by @alice)
     [🏁 Resolve]

Alice clicks [🏁 Resolve]

Bot: 🚨 INCIDENT: TKT-2024-0042
     Status: ⌛ AWAITING SUMMARY

Bot: @alice, please reply to this message with the resolution summary for TKT-2024-0042.

Alice replies: "Mechanic dispatched. Coolant leak fixed. Truck operational."

Bot: ✅ RESOLVED: TKT-2024-0042
     Resolved by: @alice
     Summary: Mechanic dispatched. Coolant leak fixed. Truck operational.
```

## Commands Reference

| Command | Who Can Use | Description |
|---------|-------------|-------------|
| `/start` | Everyone | Show help message |
| `/configure_managers @user1 @user2` | Group Admins | Set managers for the group |
| `/add_dispatcher @user` | Group Admins | Add a dispatcher to the group |
| `/register_driver` | Anyone | Register yourself as a driver |
| `/new_issue <description>` | Anyone | Create a new incident |

## Incident States

1. **Unclaimed** (🔥): Waiting for a dispatcher to claim
2. **Claimed_T1** (🛠️): Dispatcher is working on it
3. **Escalated_Unclaimed_T2** (🆘): Waiting for a manager to claim
4. **Claimed_T2** (🛠️): Manager is working on it
5. **Awaiting_Summary** (⌛): Waiting for resolution summary
6. **Resolved** (✅): Completed with summary

## Automated Reminders

The bot automatically sends reminders for:

- **Unclaimed Incidents**: After 10 minutes (configurable)
  - "🔔 TKT-2024-0001 has been unclaimed for 10 minutes. Dispatchers please review."

- **Unclaimed Escalations**: After 15 minutes (configurable)
  - "🔔 TKT-2024-0001 has been awaiting a manager for 15 minutes. Paging: @alice, @bob"

## Race Condition Protection

The bot uses atomic SQL operations to prevent issues like:
- Two dispatchers claiming the same incident
- Two managers claiming the same escalation

If someone else claims first, you'll see:
- "Sorry, this incident has already been claimed."

## Security Considerations

### Authorization Checks

- **Dispatchers**: Only authorized users can claim Tier 1 incidents
- **Managers**: Only authorized users can claim Tier 2 escalations
- **Admins**: Only group admins can configure managers/dispatchers

### Auto-Registration

- When a user clicks a claim button, they're automatically registered with the appropriate role
- This makes onboarding seamless while maintaining security

### Permissions Required

The bot needs these Telegram permissions:
- Send messages
- Read messages
- Pin messages
- Edit messages

## Troubleshooting

### Bot doesn't pin messages

**Solution**: Make sure the bot is an administrator in the group with "Pin messages" permission.

### "Group not configured" error

**Solution**: Run `/configure_managers @user1 @user2` first (admin only).

### Reminders not working

**Solution**: Check that:
1. The bot is running (not stopped)
2. `REMINDER_CHECK_INTERVAL_MINUTES` is set in `.env`
3. Check logs for errors

### Database errors

**Solution**:
1. Make sure the bot has write permissions to the directory
2. Check that `DATABASE_PATH` is correct
3. Delete `incidents.db` to reset (you'll lose all data)

## KPI Metrics

The database schema supports these KPIs (query examples can be added):

- **Triage Time (TT)**: `t_claimed_tier1 - t_created`
- **Tier 1 Resolution Rate**: Count of incidents resolved by dispatchers / total incidents
- **Manager Response Time**: `t_claimed_tier2 - t_escalated`
- **Total Resolution Time**: `t_resolved - t_created`

Example SQL queries can be added to extract these metrics from the database.

## Development

### Project Structure

```
.
├── bot.py                  # Main entry point
├── config.py              # Configuration management
├── database.py            # SQLite database operations
├── handlers.py            # Command and callback handlers
├── message_builder.py     # Message formatting
├── reminders.py           # Automated reminder system
├── requirements.txt       # Python dependencies
├── .env.example          # Example environment variables
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

### Adding New Features

1. **New commands**: Add to `handlers.py` and register in `bot.py`
2. **New incident states**: Update database schema and message builder
3. **New buttons**: Add to `message_builder.py` and callback handler

### Logging

The bot logs everything to console. In production, you might want to:
- Log to a file: Add a `FileHandler` to the logging config
- Use structured logging: Switch to `structlog` or similar
- Send logs to a service: Integrate with Sentry, CloudWatch, etc.

## License

This is a custom-built enterprise solution. Please check with your organization's policies.

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review the logs (set `LOG_LEVEL=DEBUG` for verbose output)
3. Check the [python-telegram-bot documentation](https://docs.python-telegram-bot.org/)

## Notes

### Implementation Decisions

1. **SQLite over PostgreSQL**: For simplicity and zero-configuration deployment
2. **Polling over Webhooks**: Easier to set up, works anywhere
3. **Thread-safe operations**: Using locks for database writes
4. **Auto-registration**: Reduces friction for users

### Production Enhancements

For a production deployment, consider:

1. **Database**: Migrate to PostgreSQL for better concurrency
2. **Webhooks**: Switch to webhook mode for better performance
3. **Monitoring**: Add health checks and metrics
4. **Backups**: Automated database backups
5. **Rate Limiting**: Prevent abuse
6. **i18n**: Multi-language support
7. **Testing**: Add unit and integration tests
8. **Docker**: Containerize for easy deployment

## Version History

- **v1.0** (2024): Initial release with core functionality
  - Button-based workflow
  - Two-tier escalation system
  - Automated reminders
  - Race condition protection
