# Quick Start Guide

Get your incident management bot running in 5 minutes!

## Step 1: Get a Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Choose a name (e.g., "My Incident Bot")
4. Choose a username (e.g., "my_incident_bot")
5. Copy the bot token (looks like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

## Step 2: Configure the Bot

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file and add your bot token
# On Linux/Mac:
nano .env

# On Windows:
notepad .env

# Add your token and platform admins:
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
PLATFORM_ADMIN_IDS=123456789,987654321
```

## Step 3: Install Dependencies

```bash
# Make sure you have Python 3.8+ installed
python3 --version

# Install dependencies
pip3 install -r requirements.txt
```

## Step 4: Run the Bot

```bash
# On Linux/Mac:
chmod +x run.sh
./run.sh

# Or directly with Python:
python3 bot.py
```

## Step 5: Add to Your Group

1. Create a Telegram group or use an existing one
2. Add your bot to the group
3. Make the bot an **administrator** with these permissions:
   - Send messages
   - Pin messages
   - Delete messages (optional)

## Step 6: Register the Group with a Company

When the bot joins a group it immediately posts:

> Please reply company name to this message to activate KPI bot in this group.

1. Reply to that message with the company name that owns the group.
2. Every user ID listed in `PLATFORM_ADMIN_IDS` receives a DM containing the group ID, group title, requester, and requested company name.
3. A platform admin must approve the connection from a private chat:

   ```
   /add_group <company_id> <group_id>
   ```

   This copies the company's dispatcher/manager settings into the group, marks it active, and sends a confirmation inside the group.

Until approval is complete, all workflow commands/buttons respond with a “pending activation” notice.

> Company records are provisioned via internal tooling or scripts using `Database.create_company`. Make sure the company exists before approving a group.

Once a group is active, run `/configure_managers @alice @bob` inside any of the company's groups to update the company-wide escalation contacts.

## Step 7: Test It Out!

```
/new_issue Test incident - truck breakdown
```

You should see a pinned message with buttons. Click "✅ Claim" to claim the incident!

## Common Issues

### "TELEGRAM_BOT_TOKEN is required"
- Make sure you created the `.env` file
- Make sure you added your token without quotes

### "This group is not configured"
- Run `/configure_managers @username` first
- Make sure you're a group admin

### Bot doesn't pin messages
- Make the bot an administrator in the group
- Enable "Pin messages" permission

### Bot doesn't respond
- Check if the bot is running (look for "Bot initialized successfully" in logs)
- Check your internet connection
- Try `/start` in a private chat with the bot first

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for technical details
- Set up automated reminders by configuring SLA timers in `.env`

## Support

If you encounter issues:
1. Check the logs (set `LOG_LEVEL=DEBUG` in `.env`)
2. Read the troubleshooting section in README.md
3. Review the implementation notes

## Quick Reference - Commands

| Command | Description |
|---------|-------------|
| `/start` or `/help` | Show help |
| `/configure_managers @user1 @user2` | Set managers (admin only) |
| `/add_dispatcher @user` | Add dispatcher (admin only) |
| `/register_driver` | Register as driver |
| `/new_issue <description>` | Create incident |
| `/add_group <company_id> <group_id>` | Platform admin: activate group |

## Quick Reference - Workflow

1. **Driver** creates incident → Bot pins message
2. **Dispatcher** clicks "Claim" → Takes ownership
3. **Dispatcher** works on it → Can escalate if needed
4. **Dispatcher** clicks "Resolve" → Bot asks for summary
5. **Dispatcher** replies with summary → Incident resolved!

Enjoy your new incident management system! 🚀
