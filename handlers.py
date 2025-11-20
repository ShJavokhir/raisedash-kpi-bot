"""
Handlers module for Telegram bot commands and callbacks.
"""

import logging
import re
from typing import Optional, List, Dict, Any
from telegram import Update, Chat
from telegram.ext import ContextTypes
from telegram.error import TelegramError

from database import Database
from message_builder import MessageBuilder
from config import Config
from reporting import KPIReportGenerator, html_to_bytes

logger = logging.getLogger(__name__)


class BotHandlers:
    """Handles all bot commands and callback queries."""

    ROLE_PRIORITY = {
        'Driver': 1,
        'Dispatcher': 2,
        'OpsManager': 3
    }

    def __init__(self, db: Database,
                 platform_admin_ids: Optional[List[int]] = None,
                 bot_user_id: Optional[int] = None):
        self.db = db
        self.message_builder = MessageBuilder()
        self.platform_admin_ids = set(platform_admin_ids or [])
        self.bot_user_id = bot_user_id
        self.report_generator = KPIReportGenerator(
            db,
            Config.REPORT_TIMEZONE,
            Config.get_report_week_end_index(),
            Config.REPORT_TEMPLATE_PATH,
            Config.get_sla_unclaimed_seconds(),
            Config.get_sla_escalation_seconds(),
            Config.get_summary_timeout_seconds()
        )

    def _get_user_handle(self, user) -> str:
        """Get user's handle with @ prefix."""
        if user.username:
            return f"@{user.username}"
        return f"User_{user.id}"

    def _track_user_interaction(self, user, group_id: Optional[int] = None,
                                team_role: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Universal user tracking function.
        Captures comprehensive user data from any Telegram interaction.

        Args:
            user: Telegram User object from update.effective_user or similar
            group_id: Optional group ID where interaction occurred
            team_role: Optional team role to assign/preserve

        Returns:
            Dict containing user's complete information, or None if user is invalid
        """
        if not user:
            return None

        try:
            # Extract all available user data from Telegram User object
            user_id = user.id
            username = user.username if hasattr(user, 'username') and user.username else None
            first_name = user.first_name if hasattr(user, 'first_name') and user.first_name else None
            last_name = user.last_name if hasattr(user, 'last_name') and user.last_name else None
            language_code = user.language_code if hasattr(user, 'language_code') and user.language_code else None
            is_bot = user.is_bot if hasattr(user, 'is_bot') else False

            # Track user with all available data
            return self.db.track_user(
                user_id=user_id,
                username=username,
                first_name=first_name,
                last_name=last_name,
                language_code=language_code,
                is_bot=is_bot,
                group_id=group_id,
                team_role=team_role
            )
        except Exception as e:
            logger.error(f"Error tracking user interaction: {e}", exc_info=True)
            return None

    def _role_rank(self, role: Optional[str]) -> int:
        """Return numeric rank for a role (higher is more privileged)."""
        if not role:
            return 0
        return self.ROLE_PRIORITY.get(role, 0)

    def _ensure_user_role(self, user_id: int, desired_role: str,
                          handle_hint: Optional[str] = None):
        """
        Persist the desired role only if it does not demote an existing record.
        """
        desired_rank = self._role_rank(desired_role)
        if desired_rank == 0:
            return

        existing_user = self.db.get_user(user_id)
        current_rank = self._role_rank(existing_user['team_role']) if existing_user else 0
        if current_rank >= desired_rank:
            return

        handle = (
            existing_user.get('telegram_handle')
            if existing_user and existing_user.get('telegram_handle')
            else handle_hint or f"User_{user_id}"
        )
        self.db.upsert_user(user_id, handle, desired_role)

    def set_bot_user_id(self, bot_user_id: int):
        """Persist the bot user's Telegram ID."""
        self.bot_user_id = bot_user_id
        logger.info(f"Bot user ID cached: {bot_user_id}")

    def _get_bot_user_id(self, context: ContextTypes.DEFAULT_TYPE) -> Optional[int]:
        """Retrieve the cached bot user ID, fallback to the runtime context."""
        if self.bot_user_id:
            return self.bot_user_id
        return context.bot.id if context and context.bot else None

    def _is_platform_admin(self, user_id: Optional[int]) -> bool:
        """Return True if the user is a platform-level administrator."""
        return bool(user_id and user_id in self.platform_admin_ids)

    @staticmethod
    def _is_int_argument(value: Optional[str]) -> bool:
        """Utility to test whether a string can be cast to int."""
        if value is None:
            return False
        try:
            int(value)
            return True
        except (TypeError, ValueError):
            return False

    def _is_platform_dispatcher_command(self, args: List[str]) -> bool:
        """Detect the hidden /add_dispatcher <company_id> <user_id> format."""
        return len(args) >= 2 and all(self._is_int_argument(arg) for arg in args[:2])

    def _log_audit_event(self, event: str, **payload: Any):
        """Log structured audit events for sensitive operations."""
        logger.info("AUDIT %s | %s", event, payload)

    async def _notify_pending_activation(self, update: Update, context: ContextTypes.DEFAULT_TYPE,
                                         membership: Dict[str, Any]):
        """Inform the group that activation is still pending."""
        group = membership.get('group') or {}
        requested_name = group.get('requested_company_name')
        info_line = (
            "This group is pending activation. "
            "Please reply to the registration prompt so Platform Admin can attach it to a company."
        )
        if requested_name:
            info_line += f"\n\nRequested company: {requested_name}"

        if update.callback_query:
            await update.callback_query.answer(info_line, show_alert=True)
        elif update.message:
            await update.message.reply_text(info_line)

    async def _require_active_group(self, update: Update, context: ContextTypes.DEFAULT_TYPE,
                                    chat: Optional[Chat] = None) -> Optional[Dict[str, Any]]:
        """Ensure the current chat is an active, company-attached group."""
        chat = chat or (update.effective_chat if update else None)
        if not chat or not self._is_group_chat(chat):
            await self._send_error_message(update, "This action only works inside a Telegram group.")
            return None

        membership = self.db.get_company_membership(chat.id)
        if not membership or not membership.get('group'):
            await self._send_error_message(
                update,
                "This group is not registered yet. Please invite the bot and complete activation first."
            )
            return None

        if not membership.get('is_active'):
            await self._notify_pending_activation(update, context, membership)
            return None

        return membership

    def _collect_dispatcher_ids(self, membership: Dict[str, Any]) -> List[int]:
        """Combine dispatcher IDs from group and company metadata."""
        ids: List[int] = []
        seen = set()
        for source in (membership.get('company'), membership.get('group')):
            if not source:
                continue
            for dispatcher_id in source.get('dispatcher_user_ids', []):
                if dispatcher_id is None or dispatcher_id in seen:
                    continue
                seen.add(dispatcher_id)
                ids.append(dispatcher_id)
        return ids

    def _collect_manager_ids(self, membership: Dict[str, Any]) -> List[int]:
        """Combine manager IDs from group and company metadata."""
        ids: List[int] = []
        seen = set()
        for source in (membership.get('company'), membership.get('group')):
            if not source:
                continue
            for manager_id in source.get('manager_user_ids', []):
                if manager_id is None or manager_id in seen:
                    continue
                seen.add(manager_id)
                ids.append(manager_id)
        return ids

    def _collect_manager_handles(self, membership: Dict[str, Any]) -> List[str]:
        """Combine manager handles from group and company metadata."""
        handles: List[str] = []
        seen = set()
        for source in (membership.get('company'), membership.get('group')):
            if not source:
                continue
            for handle in source.get('manager_handles', []):
                if not handle or handle in seen:
                    continue
                seen.add(handle)
                handles.append(handle)
        return handles

    def _is_group_chat(self, chat: Chat) -> bool:
        """Check if the chat is a group or supergroup."""
        return chat.type in ['group', 'supergroup']

    async def _send_error_message(self, update: Update, message: str):
        """Send an error message to the user."""
        user_id = update.effective_user.id if update.effective_user else 'unknown'
        logger.warning(f"User {user_id} received error: {message}")
        if update.message:
            await update.message.reply_text(f"❌ {message}")
        elif update.callback_query:
            await update.callback_query.answer(message, show_alert=True)

    # ==================== Registration Workflow ====================

    async def chat_member_update_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle bot invites to groups and kick off registration workflow."""
        chat_member_update = update.my_chat_member
        if not chat_member_update:
            return

        chat = chat_member_update.chat
        if not self._is_group_chat(chat):
            return

        new_status = chat_member_update.new_chat_member.status
        if new_status not in ['member', 'administrator']:
            return

        group_id = chat.id
        group_name = chat.title or f"Group_{group_id}"
        inviter = chat_member_update.from_user

        # Track the user who invited the bot to the group
        if inviter:
            self._track_user_interaction(inviter, group_id=group_id)

        inviter_handle = self._get_user_handle(inviter) if inviter else "Unknown"

        group = self.db.get_group(group_id)
        if group and group.get('status') == 'active':
            logger.info(f"Group {group_id} already active; no registration prompt needed")
            return

        if group and group.get('status') == 'pending' and group.get('registration_message_id'):
            logger.info(f"Group {group_id} already pending activation; prompt exists")
            return

        try:
            prompt_message = await context.bot.send_message(
                chat_id=group_id,
                text="Please reply company name to this message to activate KPI bot in this group."
            )
        except TelegramError as exc:
            logger.error(f"Failed to send registration prompt to group {group_id}: {exc}")
            return

        self.db.record_group_request(
            group_id=group_id,
            group_name=group_name,
            registration_message_id=prompt_message.message_id,
            requested_by_user_id=inviter.id if inviter else None,
            requested_by_handle=inviter_handle
        )

        self._log_audit_event(
            "group_registration_prompt_sent",
            group_id=group_id,
            group_name=group_name,
            invited_by_id=inviter.id if inviter else None,
            invited_by_handle=inviter_handle
        )

    async def _handle_registration_reply(self, message, context: ContextTypes.DEFAULT_TYPE, group: Dict[str, Any]):
        """Process replies to the registration prompt."""
        requested_name = (message.text or "").strip()
        if len(requested_name) < 2:
            await message.reply_text("Please provide a valid company name so I can activate this group.")
            return

        existing_name = (group.get('requested_company_name') or "").strip().lower()
        normalized_new = requested_name.strip().lower()

        if existing_name and existing_name == normalized_new:
            await message.reply_text(
                "Thanks! I already have this request on file. "
                "Group will be activated soon and I will notify when it's activated."
            )
            return

        requester = message.from_user
        requester_handle = self._get_user_handle(requester)

        self.db.update_group_request_details(
            group_id=group['group_id'],
            requested_company_name=requested_name,
            requested_by_user_id=requester.id,
            requested_by_handle=requester_handle
        )

        admin_notification = (
            "🚨 New KPI Bot activation request\n"
            f"Group: {group['group_name']} ({group['group_id']})\n"
            f"Company: {requested_name}\n"
            f"Requested by: {requester_handle} ({requester.id})"
        )

        for admin_id in self.platform_admin_ids:
            try:
                await context.bot.send_message(chat_id=admin_id, text=admin_notification)
            except TelegramError as exc:
                logger.error(f"Failed to notify platform admin {admin_id}: {exc}")

        await message.reply_text("Group will be activated soon and I will notify when it's activated.")

        self._log_audit_event(
            "group_activation_requested",
            group_id=group['group_id'],
            requested_company=requested_name,
            requested_by_id=requester.id,
            requested_by_handle=requester_handle
        )

    # ==================== Command Handlers ====================

    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /start and /help commands."""
        welcome_message = (
            "👋 Welcome to the Raisedash KPI Bot!\n\n"
            "This bot helps manage incidents in your team. Here's how to use it:\n\n"
            "📋 Commands:\n"
                
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

    async def report_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /report <company_id> <day|week|month> (platform admins only)."""
        user = update.effective_user
        args = context.args or []

        if not self._is_platform_admin(user.id if user else None):
            await self._send_error_message(update, "Only platform admins can generate reports.")
            return

        if len(args) < 2 or not self._is_int_argument(args[0]):
            await self._send_error_message(
                update,
                "Usage: /report <company_id> <day|week|month>"
            )
            return

        company_id = int(args[0])
        period = args[1].lower()
        if period not in ("day", "week", "month"):
            await self._send_error_message(update, "Period must be one of: day, week, month.")
            return

        company = self.db.get_company_by_id(company_id)
        if not company:
            await self._send_error_message(update, f"Company {company_id} does not exist.")
            return

        await update.effective_message.reply_text(
            f"⏳ Building KPI report for {company['name']} ({period})..."
        )

        try:
            report_data, html = self.report_generator.build_report(company, period)
        except Exception as exc:
            logger.error(f"Failed to build report for company {company_id}: {exc}", exc_info=True)
            await self._send_error_message(update, "Failed to generate report. Please try again.")
            return

        filename = (
            f"kpi_report_company{company_id}_{period}_"
            f"{report_data['meta']['window_end'][:10]}.html"
        )

        await update.effective_message.reply_document(
            document=html_to_bytes(html, filename),
            filename=filename,
            caption=(
                f"KPI report for {company['name']} ({report_data['meta']['period_label']}, "
                f"{period})"
            )
        )

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

        membership = await self._require_active_group(update, context)
        if not membership:
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

        group_info = membership['group']
        company_info = membership.get('company')

        if company_info:
            self.db.update_company_roles(
                company_id=company_info['company_id'],
                manager_handles=manager_handles
            )
            # Sync group cache with the latest company roles
            self.db.attach_group_to_company(
                group_id=group_info['group_id'],
                group_name=group_info['group_name'],
                company_id=company_info['company_id'],
                status='active'
            )
        else:
            # Legacy fallback: update group-only configuration
            self.db.upsert_group(
                group_id=chat.id,
                group_name=group_info['group_name'],
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
        user = update.effective_user
        chat = update.effective_chat

        if self._is_platform_admin(user.id) and (
            not chat or not self._is_group_chat(chat) or self._is_platform_dispatcher_command(context.args)
        ):
            await self._handle_platform_add_dispatcher(update, context)
            return

        if not chat or not self._is_group_chat(chat):
            await self._send_error_message(update, "This command only works in groups.")
            return

        member = await context.bot.get_chat_member(chat.id, user.id)

        if member.status not in ['creator', 'administrator']:
            await self._send_error_message(update, "Only group admins can add dispatchers.")
            return

        membership = await self._require_active_group(update, context)
        if not membership:
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
        dispatcher_user_object = None  # Store full user object if available

        if update.message.entities:
            for entity in update.message.entities:
                if entity.type == "text_mention":
                    # User doesn't have a username - we have full User object
                    dispatcher_user_object = entity.user
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

        group_info = membership['group']
        company_info = membership.get('company')

        # If we got the ID from text_mention, add them now
        if dispatcher_id:
            if company_info:
                updated_dispatchers = list(company_info.get('dispatcher_user_ids', []))
                if dispatcher_id not in updated_dispatchers:
                    updated_dispatchers.append(dispatcher_id)
                self.db.update_company_roles(
                    company_id=company_info['company_id'],
                    dispatcher_user_ids=updated_dispatchers
                )
                self.db.attach_group_to_company(
                    group_id=group_info['group_id'],
                    group_name=group_info['group_name'],
                    company_id=company_info['company_id'],
                    status='active'
                )
            else:
                self.db.add_dispatcher_to_group(chat.id, dispatcher_id)

            # Use comprehensive tracking if we have the full user object
            if dispatcher_user_object:
                self._track_user_interaction(dispatcher_user_object, group_id=chat.id, team_role='Dispatcher')
            else:
                self.db.upsert_user(dispatcher_id, dispatcher_handle, 'Dispatcher')

            await update.message.reply_text(
                f"✅ Added {dispatcher_handle} as a dispatcher for this group."
            )
        else:
            await update.message.reply_text(
                f"⚠️ Added {dispatcher_handle} to the dispatcher list.\n"
                f"They will be fully registered when they interact with the bot."
            )

    async def _handle_platform_add_dispatcher(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Hidden platform-admin command to attach a dispatcher to a company."""
        if len(context.args) < 2:
            await update.message.reply_text(
                "Usage: /add_dispatcher <company_id> <dispatcher_user_id>"
            )
            return

        try:
            company_id = int(context.args[0])
            dispatcher_user_id = int(context.args[1])
        except ValueError:
            await self._send_error_message(
                update,
                "company_id and dispatcher_user_id must be integers."
            )
            return

        company = self.db.get_company_by_id(company_id)
        if not company:
            await self._send_error_message(update, f"Company {company_id} does not exist.")
            return

        already_configured = dispatcher_user_id in company.get('dispatcher_user_ids', [])
        if not already_configured:
            self.db.add_dispatcher_to_company(company_id, dispatcher_user_id)

        self._ensure_user_role(dispatcher_user_id, 'Dispatcher')

        if already_configured:
            message = (
                f"ℹ️ User {dispatcher_user_id} is already a dispatcher for {company['name']}."
            )
        else:
            message = (
                f"✅ Added dispatcher {dispatcher_user_id} to {company['name']}."
            )

        await update.message.reply_text(message)
        self._log_audit_event(
            "platform_add_dispatcher",
            company_id=company_id,
            dispatcher_user_id=dispatcher_user_id,
            initiated_by=update.effective_user.id if update.effective_user else None,
            no_change=already_configured
        )

    async def add_manager_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Hidden platform-admin command to attach a manager to a company."""
        user = update.effective_user
        if not self._is_platform_admin(user.id):
            await self._send_error_message(update, "You are not authorized to use this command.")
            return

        if len(context.args) < 3:
            await update.message.reply_text(
                "Usage: /add_manager <company_id> <manager_user_id> <manager_handle>"
            )
            return

        try:
            company_id = int(context.args[0])
            manager_user_id = int(context.args[1])
        except ValueError:
            await self._send_error_message(
                update,
                "company_id and manager_user_id must be integers."
            )
            return

        manager_handle = " ".join(context.args[2:]).strip()
        if not manager_handle:
            await self._send_error_message(update, "manager_handle is required.")
            return
        if not manager_handle.startswith('@'):
            manager_handle = f"@{manager_handle}"

        company = self.db.get_company_by_id(company_id)
        if not company:
            await self._send_error_message(update, f"Company {company_id} does not exist.")
            return

        already_id = manager_user_id in company.get('manager_user_ids', [])
        already_handle = manager_handle in company.get('manager_handles', [])

        if not already_id or not already_handle:
            self.db.add_manager_to_company(company_id, manager_user_id, manager_handle)
            status_message = (
                f"✅ Added manager {manager_handle} (ID {manager_user_id}) to {company['name']}."
            )
        else:
            status_message = (
                f"ℹ️ Manager {manager_handle} (ID {manager_user_id}) already configured for {company['name']}."
            )

        self._ensure_user_role(manager_user_id, 'OpsManager', manager_handle)

        await update.message.reply_text(status_message)
        self._log_audit_event(
            "platform_add_manager",
            company_id=company_id,
            manager_user_id=manager_user_id,
            manager_handle=manager_handle,
            initiated_by=user.id,
            no_change=already_id and already_handle
        )

    async def add_group_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Platform-admin-only command to attach a group to a company."""
        user = update.effective_user
        if not self._is_platform_admin(user.id):
            await self._send_error_message(update, "You are not authorized to use this command.")
            return

        if len(context.args) < 2:
            await update.message.reply_text(
                "Usage: /add_group <company_id> <group_id>\n"
                "Example: /add_group 1 -1001234567890"
            )
            return

        try:
            company_id = int(context.args[0])
            target_group_id = int(context.args[1])
        except ValueError:
            await self._send_error_message(update, "company_id and group_id must be integers.")
            return

        company = self.db.get_company_by_id(company_id)
        if not company:
            await self._send_error_message(update, f"Company {company_id} does not exist.")
            return

        group_record = self.db.get_group(target_group_id)
        group_name = (
            group_record['group_name']
            if group_record and group_record.get('group_name')
            else f"Group_{target_group_id}"
        )

        if not group_record:
            try:
                chat = await context.bot.get_chat(target_group_id)
                if chat.title:
                    group_name = chat.title
            except TelegramError as exc:
                logger.warning(f"Unable to fetch chat title for {target_group_id}: {exc}")

        self.db.attach_group_to_company(
            group_id=target_group_id,
            group_name=group_name,
            company_id=company_id,
            status='active'
        )

        activation_message = (
            f"✅ KPI bot activated for {company['name']}.\n"
            f"Incidents can now be reported and triaged in this group."
        )

        notify_result = ""
        try:
            await context.bot.send_message(chat_id=target_group_id, text=activation_message)
            notify_result = "Notification sent to group."
        except TelegramError as exc:
            notify_result = f"Failed to notify group: {exc}"
            logger.error(f"Could not notify group {target_group_id} about activation: {exc}")

        await update.message.reply_text(
            f"Attached group {group_name} ({target_group_id}) to {company['name']}.\n{notify_result}"
        )

        self._log_audit_event(
            "group_activation_completed",
            company_id=company_id,
            group_id=target_group_id,
            activated_by=user.id
        )

    async def register_driver_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /register_driver command."""
        user = update.effective_user
        chat = update.effective_chat
        group_id = chat.id if chat and self._is_group_chat(chat) else None

        # Track user with Driver role
        self._track_user_interaction(user, group_id=group_id, team_role='Driver')

        await update.message.reply_text(
            f"✅ You have been registered as a Driver!\n"
            f"You can now report incidents using /new_issue"
        )
        logger.info(f"Registered driver: {user.id} ({self._get_user_handle(user)})")

    async def new_issue_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /new_issue command - creates a new incident."""
        if not self._is_group_chat(update.effective_chat):
            await self._send_error_message(update, "This command only works in groups.")
            return

        user = update.effective_user
        chat = update.effective_chat

        membership = await self._require_active_group(update, context)
        if not membership:
            return

        group_info = membership['group']

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

        # Track user creating the incident (captures comprehensive user data)
        self._track_user_interaction(user, group_id=chat.id)

        user_handle = self._get_user_handle(user)

        # Create incident in database (without message_id first)
        incident_id = self.db.create_incident(
            group_id=chat.id,
            created_by_id=user.id,
            created_by_handle=user_handle,
            description=description,
            company_id=group_info.get('company_id')
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

        callback_data = query.data
        user = update.effective_user
        chat = update.effective_chat

        # Track user interaction (capture all users clicking buttons)
        if user:
            group_id = chat.id if chat and self._is_group_chat(chat) else None
            self._track_user_interaction(user, group_id=group_id)

        logger.info(f"Callback: {callback_data} from user {user.id} in chat {chat.id}")

        try:
            membership = await self._require_active_group(update, context, chat)
            if not membership:
                return

            # Parse callback data
            action, incident_id = callback_data.split(':', 1)

            # Route to appropriate handler
            if action == 'claim_t1':
                await self._handle_claim_t1(query, user, chat, incident_id, membership)
            elif action == 'release_t1':
                await self._handle_release_t1(query, user, chat, incident_id)
            elif action == 'escalate':
                await self._handle_escalate(query, user, chat, incident_id, context, membership)
            elif action == 'claim_t2':
                await self._handle_claim_t2(query, user, chat, incident_id, membership)
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

    async def _handle_claim_t1(self, query, user, chat, incident_id: str, membership: Dict[str, Any]):
        """Handle Tier 1 claim button."""
        # Check if user is authorized dispatcher
        dispatcher_ids = self._collect_dispatcher_ids(membership)
        if user.id not in dispatcher_ids:
            logger.warning(
                f"Unauthorized T1 claim attempt on {incident_id} by user {user.id} in chat {chat.id}"
            )
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
            if not incident:
                await query.answer("Incident not found. Please refresh.", show_alert=True)
                return
            claimer_handles = self.db.get_active_claim_handles(incident_id, tier=1)
            text, keyboard = self.message_builder.build_claimed_t1_message(incident, claimer_handles)

            try:
                logger.info(
                    f"Updating incident {incident_id} message to claimed state by user {user.id}"
                )
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
            if not incident:
                await query.answer("Incident not found. Please refresh.", show_alert=True)
                return
            claimer_handles = self.db.get_active_claim_handles(incident_id, tier=1) if incident else []

            if incident and incident.get('status') == 'Claimed_T1' and claimer_handles:
                text, keyboard = self.message_builder.build_claimed_t1_message(incident, claimer_handles)
            else:
                text, keyboard = self.message_builder.build_unclaimed_message(incident)

            try:
                logger.info(
                    f"User {user.id} released T1 claim on {incident_id}, updating message"
                )
                await query.edit_message_text(text, reply_markup=keyboard)
                await query.answer("Claim released")
            except TelegramError as e:
                logger.error(f"Error editing message for {incident_id}: {e}")
                await query.answer("Released, but couldn't update message.", show_alert=True)
        else:
            logger.warning(
                f"Failed T1 release attempt on {incident_id} by user {user.id}: {message}"
            )
            await query.answer(message, show_alert=True)

    async def _handle_escalate(self, query, user, chat, incident_id: str,
                               context: ContextTypes.DEFAULT_TYPE, membership: Dict[str, Any]):
        """Handle Escalate button."""
        success, message = self.db.escalate_incident(incident_id, user.id)

        if success:
            # Update the message to escalated state
            incident = self.db.get_incident(incident_id)
            if not incident:
                await query.answer("Incident not found. Please refresh.", show_alert=True)
                return
            user_handle = self._get_user_handle(user)
            tier1_handles = self.db.get_active_claim_handles(incident_id, tier=1)
            text, keyboard = self.message_builder.build_escalated_message(incident, user_handle, tier1_handles)

            logger.info(
                f"Incident {incident_id} escalated by user {user.id}; updating message and notifying managers"
            )
            await query.edit_message_text(text, reply_markup=keyboard)

            # Send notification to managers
            manager_handles = self._collect_manager_handles(membership)
            if manager_handles:
                notification = self.message_builder.build_escalation_notification(
                    incident_id,
                    manager_handles
                )
                await context.bot.send_message(
                    chat_id=chat.id,
                    text=notification,
                    reply_to_message_id=query.message.message_id
                )

            await query.answer("Incident escalated to managers")
        else:
            logger.warning(
                f"Failed escalation attempt on {incident_id} by user {user.id}: {message}"
            )
            await query.answer(message, show_alert=True)

    async def _handle_claim_t2(self, query, user, chat, incident_id: str, membership: Dict[str, Any]):
        """Handle Tier 2 (Manager) claim button."""
        # Check if user is authorized manager
        manager_ids = self._collect_manager_ids(membership)
        if user.id not in manager_ids:
            logger.warning(
                f"Unauthorized T2 claim attempt on {incident_id} by user {user.id} in chat {chat.id}"
            )
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
            if not incident:
                await query.answer("Incident not found. Please refresh.", show_alert=True)
                return
            manager_handles = self.db.get_active_claim_handles(incident_id, tier=2)
            tier1_handles = self.db.get_active_claim_handles(incident_id, tier=1)
            text, keyboard = self.message_builder.build_claimed_t2_message(
                incident,
                manager_handles,
                tier1_handles
            )

            logger.info(
                f"Incident {incident_id} claimed by manager {user.id}; updating message"
            )
            await query.edit_message_text(text, reply_markup=keyboard)
            await query.answer("Escalation claimed successfully!")
        else:
            logger.warning(
                f"Failed T2 claim attempt on {incident_id} by user {user.id}: {message}"
            )
            await query.answer(message, show_alert=True)

    async def _handle_resolve_t1(self, query, user, chat, incident_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Handle Resolve button for Tier 1."""
        success, message = self.db.request_resolution(incident_id, user.id)

        if success:
            # Update the message to awaiting summary state
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, _ = self.message_builder.build_awaiting_summary_message(incident, user_handle)

            logger.info(
                f"T1 resolve requested by user {user.id} for {incident_id}; awaiting summary"
            )
            await query.edit_message_text(text)

            # Send request for resolution summary
            request_message = self.message_builder.build_resolution_request(
                incident_id,
                user_handle
            )
            logger.debug(
                f"Prompting user {user.id} for summary on {incident_id} via follow-up message"
            )
            await context.bot.send_message(
                chat_id=chat.id,
                text=request_message,
                reply_to_message_id=query.message.message_id
            )

            # Store the bot's message ID in context for later verification
            await query.answer("Please reply to the bot's message with your summary")
        else:
            logger.warning(
                f"Failed T1 resolve attempt on {incident_id} by user {user.id}: {message}"
            )
            await query.answer(message, show_alert=True)

    async def _handle_resolve_t2(self, query, user, chat, incident_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Handle Resolve button for Tier 2."""
        success, message = self.db.request_resolution(incident_id, user.id)

        if success:
            # Update the message to awaiting summary state
            incident = self.db.get_incident(incident_id)
            user_handle = self._get_user_handle(user)
            text, _ = self.message_builder.build_awaiting_summary_message(incident, user_handle)

            logger.info(
                f"T2 resolve requested by manager {user.id} for {incident_id}; awaiting summary"
            )
            await query.edit_message_text(text)

            # Send request for resolution summary
            request_message = self.message_builder.build_resolution_request(
                incident_id,
                user_handle
            )
            logger.debug(
                f"Prompting manager {user.id} for summary on {incident_id}"
            )
            await context.bot.send_message(
                chat_id=chat.id,
                text=request_message,
                reply_to_message_id=query.message.message_id
            )

            await query.answer("Please reply to the bot's message with your summary")
        else:
            logger.warning(
                f"Failed T2 resolve attempt on {incident_id} by user {user.id}: {message}"
            )
            await query.answer(message, show_alert=True)

    # ==================== Message Handler for Resolution Summary ====================

    async def message_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle regular messages (specifically for resolution summaries)."""
        message = update.message

        # Track user interaction (capture all users sending messages)
        if message and message.from_user:
            chat = message.chat
            group_id = chat.id if chat and self._is_group_chat(chat) else None
            self._track_user_interaction(message.from_user, group_id=group_id)

        # Only process replies
        if not message.reply_to_message:
            return

        # Check if replying to bot's message
        bot_user_id = self._get_bot_user_id(context)
        if not bot_user_id or message.reply_to_message.from_user.id != bot_user_id:
            return

        chat = message.chat
        group = self.db.get_group(chat.id) if chat and self._is_group_chat(chat) else None

        # Registration replies take precedence for pending groups
        if group and group.get('status') != 'active':
            registration_message_id = group.get('registration_message_id')
            if registration_message_id and registration_message_id == message.reply_to_message.message_id:
                await self._handle_registration_reply(message, context, group)
                return

        # Check if the bot's message is requesting a resolution
        bot_message_text = message.reply_to_message.text
        if not bot_message_text or "resolution summary" not in bot_message_text.lower():
            return

        # Extract incident_id from the bot's message
        incident_id = None

        # Prefer IDs from the formatted "ID:" line to avoid grabbing numbers from the description
        for line in bot_message_text.splitlines():
            if line.lower().startswith("id:"):
                incident_id = line.split(":", 1)[1].strip().strip('.,')
                break

        if not incident_id:
            match = re.search(r"(TKT-\d{4}-\d+|\b\d{4,}\b)", bot_message_text)
            if match:
                incident_id = match.group(1)

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
