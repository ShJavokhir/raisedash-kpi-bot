"""
Handlers module for Telegram bot commands and callbacks.
"""

import logging
from typing import Optional
from telegram import Update, Chat
from telegram.ext import ContextTypes
from telegram.error import TelegramError

from database import Database
from message_builder import MessageBuilder

logger = logging.getLogger(__name__)


class BotHandlers:
    """Handles all bot commands and callback queries."""

    def __init__(self, db: Database):
        self.db = db
        self.message_builder = MessageBuilder()

    def _get_user_handle(self, user) -> str:
        """Get user's handle with @ prefix."""
        if user.username:
            return f"@{user.username}"
        return f"User_{user.id}"

    def _is_group_chat(self, chat: Chat) -> bool:
        """Check if the chat is a group or supergroup."""
        return chat.type in ['group', 'supergroup']

    async def _send_error_message(self, update: Update, message: str):
        """Send an error message to the user."""
        if update.message:
            await update.message.reply_text(f"❌ {message}")
        elif update.callback_query:
            await update.callback_query.answer(message, show_alert=True)

    # ==================== Command Handlers ====================

    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /start and /help commands."""
        welcome_message = (
            "👋 Welcome to the Enterprise Incident Management Bot!\n\n"
            "This bot helps manage incidents in your team. Here's how to use it:\n\n"
            "📋 Commands:\n"
            "/start - Show this help message\n"
            "/configure_managers @user1 @user2 - Configure managers for this group (Admin only)\n"
            "/add_dispatcher @user - Add a dispatcher to this group (Admin only)\n"
            "/register_driver - Register yourself as a driver\n"
            "/new_issue <description> - Create a new incident\n\n"
            "🔧 Features:\n"
            "- Button-based workflow (no more typing commands!)\n"
            "- Automatic SLA reminders\n"
            "- Race condition protection\n"
            "- Per-group isolation\n\n"
            "Start by configuring managers with /configure_managers!"
        )
        await update.message.reply_text(welcome_message)

    async def configure_managers_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /configure_managers command."""
        if not self._is_group_chat(update.effective_chat):
            await self._send_error_message(update, "This command only works in groups.")
            return

        # Check if user is admin
        user = update.effective_user
        chat = update.effective_chat
        member = await context.bot.get_chat_member(chat.id, user.id)

        if member.status not in ['creator', 'administrator']:
            await self._send_error_message(update, "Only group admins can configure managers.")
            return

        # Parse manager handles from command
        if not context.args:
            await update.message.reply_text(
                "Usage: /configure_managers @manager1 @manager2 ...\n"
                "Example: /configure_managers @alice @bob"
            )
            return

        manager_handles = []
        for arg in context.args:
            if arg.startswith('@'):
                manager_handles.append(arg)
            else:
                manager_handles.append(f"@{arg}")

        if not manager_handles:
            await self._send_error_message(update, "Please provide at least one manager handle.")
            return

        # Get or create group configuration
        group_name = chat.title or f"Group_{chat.id}"
        self.db.upsert_group(
            group_id=chat.id,
            group_name=group_name,
            manager_handles=manager_handles
        )

        managers_text = ", ".join(manager_handles)
        await update.message.reply_text(
            f"✅ Managers configured for this group:\n{managers_text}\n\n"
            f"Note: These users need to interact with the bot to be fully registered."
        )
        logger.info(f"Configured managers for group {chat.id}: {manager_handles}")

    async def add_dispatcher_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /add_dispatcher command."""
        if not self._is_group_chat(update.effective_chat):
            await self._send_error_message(update, "This command only works in groups.")
            return

        # Check if user is admin
        user = update.effective_user
        chat = update.effective_chat
        member = await context.bot.get_chat_member(chat.id, user.id)

        if member.status not in ['creator', 'administrator']:
            await self._send_error_message(update, "Only group admins can add dispatchers.")
            return

        # Check if group is configured
        group = self.db.get_group(chat.id)
        if not group:
            await self._send_error_message(
                update,
                "Please configure managers first with /configure_managers"
            )
            return

        # Parse dispatcher mention
        if not context.args:
            await update.message.reply_text(
                "Usage: /add_dispatcher @username\n"
                "Example: /add_dispatcher @john"
            )
            return

        # Get mentioned user from entities (more reliable than parsing text)
        dispatcher_id = None
        dispatcher_handle = None

        if update.message.entities:
            for entity in update.message.entities:
                if entity.type == "text_mention":
                    # User doesn't have a username
                    dispatcher_id = entity.user.id
                    dispatcher_handle = f"@User_{entity.user.id}"
                    break
                elif entity.type == "mention":
                    # Extract username from message
                    dispatcher_handle = context.args[0]
                    if not dispatcher_handle.startswith('@'):
                        dispatcher_handle = f"@{dispatcher_handle}"

        if not dispatcher_handle:
            dispatcher_handle = context.args[0]
            if not dispatcher_handle.startswith('@'):
                dispatcher_handle = f"@{dispatcher_handle}"

        # If we got the ID from text_mention, add them now
        if dispatcher_id:
            self.db.add_dispatcher_to_group(chat.id, dispatcher_id)
            self.db.upsert_user(dispatcher_id, dispatcher_handle, 'Dispatcher')
            await update.message.reply_text(
                f"✅ Added {dispatcher_handle} as a dispatcher for this group."
            )
        else:
            await update.message.reply_text(
                f"⚠️ Added {dispatcher_handle} to the dispatcher list.\n"
                f"They will be fully registered when they interact with the bot."
            )

    async def register_driver_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /register_driver command."""
        user = update.effective_user
        user_handle = self._get_user_handle(user)

        self.db.upsert_user(user.id, user_handle, 'Driver')

        await update.message.reply_text(
            f"✅ You have been registered as a Driver!\n"
            f"You can now report incidents using /new_issue"
        )
        logger.info(f"Registered driver: {user.id} ({user_handle})")

    async def new_issue_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /new_issue command - creates a new incident."""
        if not self._is_group_chat(update.effective_chat):
            await self._send_error_message(update, "This command only works in groups.")
            return

        user = update.effective_user
        chat = update.effective_chat

        # Check if group is configured
        group = self.db.get_group(chat.id)
        if not group:
            await self._send_error_message(
                update,
                "This group is not configured. Please ask an admin to run /configure_managers first."
            )
            return

        # Parse issue description
        if not context.args:
            await update.message.reply_text(
                "Usage: /new_issue <description>\n"
                "Example: /new_issue Truck 123 has a flat tire"
            )
            return

        description = " ".join(context.args)

        # Validate description length (Telegram message limit is 4096 chars)
        # Reserve space for the message template, so limit description to 3000 chars
        MAX_DESCRIPTION_LENGTH = 3000
        if len(description) > MAX_DESCRIPTION_LENGTH:
            await self._send_error_message(
                update,
                f"Description too long. Maximum {MAX_DESCRIPTION_LENGTH} characters allowed."
            )
            return

        if len(description.strip()) < 5:
            await self._send_error_message(
                update,
                "Description too short. Please provide more details (at least 5 characters)."
            )
            return

        user_handle = self._get_user_handle(user)

        # Register user as driver if not already registered
        existing_user = self.db.get_user(user.id)
        if not existing_user:
            self.db.upsert_user(user.id, user_handle, 'Driver')

        # Create incident in database (without message_id first)
        incident_id = self.db.create_incident(
            group_id=chat.id,
            created_by_id=user.id,
            created_by_handle=user_handle,
            description=description
        )

        # Get the incident to build the message
        incident = self.db.get_incident(incident_id)

        # Build and send the interactive message
        text, keyboard = self.message_builder.build_unclaimed_message(incident)

        try:
            # Send the message
            sent_message = await update.message.reply_text(
                text,
                reply_markup=keyboard
            )

            # Update incident with message ID
            self.db.update_incident_message_id(incident_id, sent_message.message_id)

            # Pin the message
            await context.bot.pin_chat_message(
                chat_id=chat.id,
                message_id=sent_message.message_id,
                disable_notification=False
            )

            logger.info(f"Created and pinned incident {incident_id} in group {chat.id}")

        except TelegramError as e:
            logger.error(f"Error creating incident message: {e}")
            await self._send_error_message(
                update,
                f"Created incident {incident_id} but couldn't pin the message. "
                f"Make sure the bot has pin message permissions."
            )

    # ==================== Callback Query Handlers ====================

    async def callback_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle all inline button callbacks."""
        query = update.callback_query
        await query.answer()  # Acknowledge the callback

        callback_data = query.data
        user = update.effective_user
        chat = update.effective_chat

        logger.info(f"Callback: {callback_data} from user {user.id} in chat {chat.id}")

        try:
            # Parse callback data
            action, incident_id = callback_data.split(':', 1)

            # Route to appropriate handler
            if action == 'claim_t1':
                await self._handle_claim_t1(query, user, chat, incident_id)
            elif action == 'release_t1':
                await self._handle_release_t1(query, user, chat, incident_id)
            elif action == 'escalate':
                await self._handle_escalate(query, user, chat, incident_id, context)
            elif action == 'claim_t2':
                await self._handle_claim_t2(query, user, chat, incident_id)
            elif action == 'resolve_t1':
                await self._handle_resolve_t1(query, user, chat, incident_id, context)
            elif action == 'resolve_t2':
                await self._handle_resolve_t2(query, user, chat, incident_id, context)
            else:
                await query.answer("Unknown action", show_alert=True)

        except ValueError:
            logger.error(f"Invalid callback data format: {callback_data}")
            await query.answer("Invalid button data", show_alert=True)
        except Exception as e:
            logger.error(f"Error handling callback: {e}", exc_info=True)
            await query.answer("An error occurred. Please try again.", show_alert=True)

    async def _handle_claim_t1(self, query, user, chat, incident_id: str):
        """Handle Tier 1 claim button."""
        # Check authorization
        group = self.db.get_group(chat.id)
        if not group:
            await query.answer("Group not configured", show_alert=True)
            return

        # Auto-register user as dispatcher if they claim
        existing_user = self.db.get_user(user.id)
        if not existing_user:
            user_handle = self._get_user_handle(user)
            self.db.upsert_user(user.id, user_handle, 'Dispatcher')
            self.db.add_dispatcher_to_group(chat.id, user.id)

        # Check if user is authorized dispatcher
        if user.id not in group['dispatcher_user_ids']:
            await query.answer(
                "You are not authorized to claim issues. Please ask an admin to add you as a dispatcher.",
                show_alert=True
            )
            return

        # Attempt atomic claim
        success, message = self.db.claim_tier1(incident_id, user.id)

        if success:
            # Update the message
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, keyboard = self.message_builder.build_claimed_t1_message(incident, user_handle)

            try:
                await query.edit_message_text(text, reply_markup=keyboard)
                await query.answer("Incident claimed successfully!")
            except TelegramError as e:
                logger.error(f"Error editing message for {incident_id}: {e}")
                await query.answer("Claimed, but couldn't update message. Please refresh.", show_alert=True)
        else:
            await query.answer(message, show_alert=True)

    async def _handle_release_t1(self, query, user, chat, incident_id: str):
        """Handle Leave Claim button."""
        success, message = self.db.release_tier1_claim(incident_id, user.id)

        if success:
            # Update the message back to unclaimed state
            incident = self.db.get_incident(incident_id)
            text, keyboard = self.message_builder.build_unclaimed_message(incident)

            try:
                await query.edit_message_text(text, reply_markup=keyboard)
                await query.answer("Claim released")
            except TelegramError as e:
                logger.error(f"Error editing message for {incident_id}: {e}")
                await query.answer("Released, but couldn't update message.", show_alert=True)
        else:
            await query.answer(message, show_alert=True)

    async def _handle_escalate(self, query, user, chat, incident_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Handle Escalate button."""
        success, message = self.db.escalate_incident(incident_id, user.id)

        if success:
            # Update the message to escalated state
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, keyboard = self.message_builder.build_escalated_message(incident, user_handle)

            await query.edit_message_text(text, reply_markup=keyboard)

            # Send notification to managers
            group = self.db.get_group(chat.id)
            if group and group['manager_handles']:
                notification = self.message_builder.build_escalation_notification(
                    incident_id,
                    group['manager_handles']
                )
                await context.bot.send_message(
                    chat_id=chat.id,
                    text=notification,
                    reply_to_message_id=query.message.message_id
                )

            await query.answer("Incident escalated to managers")
        else:
            await query.answer(message, show_alert=True)

    async def _handle_claim_t2(self, query, user, chat, incident_id: str):
        """Handle Tier 2 (Manager) claim button."""
        # Check authorization
        group = self.db.get_group(chat.id)
        if not group:
            await query.answer("Group not configured", show_alert=True)
            return

        # Auto-register user as manager if they claim
        existing_user = self.db.get_user(user.id)
        user_handle = self._get_user_handle(user)

        if not existing_user:
            self.db.upsert_user(user.id, user_handle, 'OpsManager')
            self.db.add_manager_to_group(chat.id, user.id, user_handle)

        # Check if user is authorized manager
        if user.id not in group['manager_user_ids']:
            await query.answer(
                "You are not authorized to claim escalations. Please ask an admin to add you as a manager.",
                show_alert=True
            )
            return

        # Attempt atomic claim
        success, message = self.db.claim_tier2(incident_id, user.id)

        if success:
            # Update the message
            incident = self.db.get_incident(incident_id)
            text, keyboard = self.message_builder.build_claimed_t2_message(incident, user_handle)

            await query.edit_message_text(text, reply_markup=keyboard)
            await query.answer("Escalation claimed successfully!")
        else:
            await query.answer(message, show_alert=True)

    async def _handle_resolve_t1(self, query, user, chat, incident_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Handle Resolve button for Tier 1."""
        success, message = self.db.request_resolution(incident_id, user.id)

        if success:
            # Update the message to awaiting summary state
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, _ = self.message_builder.build_awaiting_summary_message(incident, user_handle)

            await query.edit_message_text(text)

            # Send request for resolution summary
            request_message = self.message_builder.build_resolution_request(
                incident_id,
                user_handle
            )
            await context.bot.send_message(
                chat_id=chat.id,
                text=request_message,
                reply_to_message_id=query.message.message_id
            )

            # Store the bot's message ID in context for later verification
            await query.answer("Please reply to the bot's message with your summary")
        else:
            await query.answer(message, show_alert=True)

    async def _handle_resolve_t2(self, query, user, chat, incident_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Handle Resolve button for Tier 2."""
        success, message = self.db.request_resolution(incident_id, user.id)

        if success:
            # Update the message to awaiting summary state
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, _ = self.message_builder.build_awaiting_summary_message(incident, user_handle)

            await query.edit_message_text(text)

            # Send request for resolution summary
            request_message = self.message_builder.build_resolution_request(
                incident_id,
                user_handle
            )
            await context.bot.send_message(
                chat_id=chat.id,
                text=request_message,
                reply_to_message_id=query.message.message_id
            )

            await query.answer("Please reply to the bot's message with your summary")
        else:
            await query.answer(message, show_alert=True)

    # ==================== Message Handler for Resolution Summary ====================

    async def message_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle regular messages (specifically for resolution summaries)."""
        message = update.message

        # Only process replies
        if not message.reply_to_message:
            return

        # Check if replying to bot's message
        if message.reply_to_message.from_user.id != context.bot.id:
            return

        # Check if the bot's message is requesting a resolution
        bot_message_text = message.reply_to_message.text
        if not bot_message_text or "resolution summary" not in bot_message_text.lower():
            return

        # Extract incident_id from the bot's message
        incident_id = None
        for word in bot_message_text.split():
            if word.startswith('TKT-'):
                incident_id = word.rstrip('.,')
                break

        if not incident_id:
            logger.warning(f"Could not extract incident_id from bot message: {bot_message_text}")
            return

        # Get the incident
        incident = self.db.get_incident(incident_id)
        if not incident:
            await message.reply_text(f"❌ Incident {incident_id} not found.")
            return

        # Verify status and user authorization
        if incident['status'] != 'Awaiting_Summary':
            await message.reply_text(f"❌ Incident {incident_id} is not awaiting a summary.")
            return

        user = update.effective_user
        if incident['pending_resolution_by_user_id'] != user.id:
            await message.reply_text(
                f"❌ You are not authorized to resolve this incident. "
                f"It's waiting for a summary from another user."
            )
            return

        # Get the resolution summary
        resolution_summary = message.text

        # Mark as resolved
        success, msg = self.db.resolve_incident(incident_id, user.id, resolution_summary)

        if success:
            # Update the pinned message
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, _ = self.message_builder.build_resolved_message(incident, user_handle)

            try:
                await context.bot.edit_message_text(
                    chat_id=message.chat_id,
                    message_id=incident['pinned_message_id'],
                    text=text
                )

                # Unpin the message
                await context.bot.unpin_chat_message(
                    chat_id=message.chat_id,
                    message_id=incident['pinned_message_id']
                )

                await message.reply_text(f"✅ {incident_id} has been marked as resolved!")
                logger.info(f"Resolved incident {incident_id}")

            except TelegramError as e:
                logger.error(f"Error updating resolved message: {e}")
                await message.reply_text(
                    f"✅ {incident_id} marked as resolved, but couldn't update the pinned message."
                )
        else:
            await message.reply_text(f"❌ {msg}")
