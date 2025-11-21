"""
Handlers module for Telegram bot commands and callbacks.
"""

import logging
import re
from typing import Optional, List, Dict, Any, Tuple
from telegram import Update, Chat
from telegram.ext import ContextTypes
from telegram.error import TelegramError

from database import Database
from message_builder import MessageBuilder
from config import Config
from reporting import KPIReportGenerator, html_to_bytes
from sentry_config import SentryConfig
from logging_config import set_log_context, clear_log_context, LogContext

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
        logger.info("BotHandlers initialized")

    def _log_command_entry(self, command: str, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Log entry into a command handler with full context."""
        user = update.effective_user
        chat = update.effective_chat
        args = context.args or []

        with LogContext(
            chat_id=chat.id if chat else None,
            user_id=user.id if user else None,
            username=user.username if user else None
        ):
            logger.info(f"Command: /{command} | Args: {args} | "
                       f"ChatType: {chat.type if chat else 'unknown'}")

    def _log_callback_entry(self, callback_data: str, update: Update):
        """Log entry into a callback handler with full context."""
        user = update.effective_user
        chat = update.effective_chat

        with LogContext(
            chat_id=chat.id if chat else None,
            user_id=user.id if user else None,
            username=user.username if user else None
        ):
            logger.info(f"Callback: {callback_data}")

    def _get_user_handle(self, user) -> str:
        """Get user's handle with @ prefix."""
        if user.username:
            return f"@{user.username}"
        return f"User_{user.id}"

    def _resolve_user_mention(self, update: Update, context: ContextTypes.DEFAULT_TYPE,
                               arg_index: int = -1) -> Tuple[Optional[int], Optional[str], Optional[Any]]:
        """
        Resolve a user mention from message entities to user_id, handle, and user object.

        Handles three cases:
        1. text_mention: User without username (has full User object)
        2. mention: Username mention (requires database lookup)
        3. Numeric ID: Raw numeric user ID

        Args:
            update: Telegram Update object
            context: Bot context
            arg_index: Which argument to check (default -1 for last)

        Returns:
            Tuple of (user_id, user_handle, user_object)
            - user_id: Telegram user ID if resolved, None otherwise
            - user_handle: User handle (e.g., @username or @User_123)
            - user_object: Full Telegram User object if available (only for text_mention)
        """
        if not update.message or not context.args:
            return None, None, None

        user_id = None
        user_handle = None
        user_object = None

        # Check message entities for mentions
        if update.message.entities:
            for entity in update.message.entities:
                if entity.type == "text_mention":
                    # User doesn't have a username - we have full User object
                    user_object = entity.user
                    user_id = entity.user.id
                    user_handle = self._get_user_handle(entity.user)
                    return user_id, user_handle, user_object

                elif entity.type == "mention":
                    # Username mention - need to look up in database
                    mentioned_username = context.args[arg_index]
                    normalized_username = mentioned_username.lstrip('@')

                    # Look up user in database
                    db_user = self.db.get_user_by_username(normalized_username)
                    if db_user:
                        user_id = db_user['user_id']
                        user_handle = f"@{db_user['username']}" if db_user.get('username') else f"@User_{user_id}"
                        return user_id, user_handle, None
                    else:
                        # User mentioned but not in database
                        user_handle = f"@{normalized_username}"
                        return None, user_handle, None

        # Fallback: Try to parse as numeric ID
        if context.args:
            try:
                user_id = int(context.args[arg_index])
                user_handle = None  # Will be filled later if needed
                return user_id, user_handle, None
            except (ValueError, IndexError):
                pass

        return None, None, None

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

            # Set Sentry user context for error tracking
            SentryConfig.set_user_context(
                user_id=user_id,
                username=username,
                role=team_role,
                first_name=first_name,
                last_name=last_name,
                language_code=language_code,
                is_bot=is_bot
            )

            # Set group context if available
            if group_id:
                SentryConfig.set_tag("group_id", group_id)

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
            SentryConfig.capture_exception(e, operation="track_user_interaction")
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

    async def _handle_pending_new_issue(self, update: Update, context: ContextTypes.DEFAULT_TYPE,
                                        membership: Dict[str, Any]):
        """Track pending activation attempts when /new_issue is used."""
        chat = update.effective_chat
        user = update.effective_user
        group = membership.get('group') or {}
        group_id = group.get('group_id') or (chat.id if chat else None)

        # Track user even when activation is pending
        if user and group_id:
            self._track_user_interaction(user, group_id=group_id)

        notification_exists = False
        if group_id is not None:
            try:
                notification_exists = self.db.notification_exists(
                    group_id,
                    "group_pending_activation",
                    statuses=['pending', 'sent', 'failed']
                )
            except Exception as exc:
                logger.error(f"Failed to check pending notification state for group {group_id}: {exc}", exc_info=True)
                SentryConfig.capture_exception(exc, group_id=group_id, operation="check_pending_notification")

        created_notification = False
        if group_id is not None and not notification_exists:
            message_data = {
                "group_id": group_id,
                "group_name": group.get('group_name') or (chat.title if chat else None),
                "requested_company_name": group.get('requested_company_name'),
                "requested_by_user_id": group.get('requested_by_user_id'),
                "requested_by_handle": group.get('requested_by_handle'),
                "triggered_by_user_id": user.id if user else None,
                "triggered_by_handle": self._get_user_handle(user) if user else None,
                "triggered_by_username": user.username if user and user.username else None
            }
            try:
                self.db.record_group_pending_activation_notification(
                    group_id,
                    message_data,
                    status='sent'
                )
                created_notification = True
            except Exception as exc:
                logger.error(f"Failed to record pending activation notification for group {group_id}: {exc}", exc_info=True)
                SentryConfig.capture_exception(exc, group_id=group_id, operation="record_pending_notification")

        response = (
            "Group is Waiting for activation"
            if created_notification
            else "This group is pending activation. Please reply to the registration prompt so Platform Admin can attach it to a company."
        )

        if update.callback_query:
            await update.callback_query.answer(response, show_alert=True)
        elif update.message:
            await update.message.reply_text(response)

    async def _require_active_group(self, update: Update, context: ContextTypes.DEFAULT_TYPE,
                                    chat: Optional[Chat] = None,
                                    on_pending=None) -> Optional[Dict[str, Any]]:
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
            if on_pending:
                await on_pending(update, context, membership)
            else:
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

        # Platform admin notifications disabled - join requests are now managed via dashboard
        # Company admins can approve/deny requests through the frontend dashboard
        logger.info(
            f"Join request submitted: Group {group['group_name']} ({group['group_id']}) "
            f"requesting company '{requested_name}' by {requester_handle} ({requester.id})"
        )

        await message.reply_text(
            f"✅ Your request has been submitted!\n\n"
            f"Company: {requested_name}\n"
            f"Group: {group['group_name']}\n\n"
            f"The company administrators will review your request through their dashboard. "
            f"You will be notified once your group has been activated."
        )

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
        self._log_command_entry("start", update, context)

        welcome_message = (
            "👋 Welcome to the Raisedash KPI Bot!\n\n"
            "This bot helps manage incidents in your team. Here's how to use it:\n\n"
            "📋 Commands:\n"
            "/new_issue - Reply to an issue message with /new_issue to start a ticket\n\n"
            "🔧 Features:\n"
            "- Department-based workflow (no more tiers) managed from the dashboard\n"
            "- Button-based interactions end-to-end\n"
            "- Automatic SLA reminders\n"
            "- Race condition protection\n"
            "- Per-group isolation\n\n"
            "Make sure your group is activated and departments are set up in the dashboard before creating incidents."
        )
        await update.message.reply_text(welcome_message)
        logger.info("Sent welcome message")

    async def report_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /report <company_id> <day|week|month> (platform admins only)."""
        self._log_command_entry("report", update, context)

        user = update.effective_user
        args = context.args or []

        if not self._is_platform_admin(user.id if user else None):
            logger.warning(f"Permission denied: User {user.id if user else 'unknown'} is not a platform admin")
            await self._send_error_message(update, "Only platform admins can generate reports.")
            return

        logger.info(f"Platform admin access granted")

        if len(args) < 2 or not self._is_int_argument(args[0]):
            logger.warning(f"Invalid arguments for report command: {args}")
            await self._send_error_message(
                update,
                "Usage: /report <company_id> <day|week|month>"
            )
            return

        company_id = int(args[0])
        period = args[1].lower()

        logger.info(f"Generating report for companyId={company_id}, period={period}")

        if period not in ("day", "week", "month"):
            logger.warning(f"Invalid period: {period}")
            await self._send_error_message(update, "Period must be one of: day, week, month.")
            return

        company = self.db.get_company_by_id(company_id)
        if not company:
            logger.error(f"Company {company_id} not found")
            await self._send_error_message(update, f"Company {company_id} does not exist.")
            return

        logger.info(f"Building report for company: {company['name']}")

        await update.effective_message.reply_text(
            f"⏳ Building KPI report for {company['name']} ({period})..."
        )

        try:
            report_data, html = self.report_generator.build_report(company, period)
            logger.info(f"Report generated successfully: {len(html)} bytes")
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
        logger.info(f"Report delivered: {filename}")

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

    async def add_department_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Deprecated command now handled via the dashboard."""
        if update.message:
            await update.message.reply_text(
                "Department management is now handled in the dashboard. Please use the frontend to add departments."
            )

    async def list_departments_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Deprecated command now handled via the dashboard."""
        if update.message:
            await update.message.reply_text(
                "Department management is now handled in the dashboard. Please use the frontend to view departments."
            )

    async def new_issue_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /new_issue command - creates a new incident."""
        self._log_command_entry("new_issue", update, context)

        if not self._is_group_chat(update.effective_chat):
            logger.warning("new_issue command used outside of group chat")
            await self._send_error_message(update, "This command only works in groups.")
            return

        user = update.effective_user
        chat = update.effective_chat

        logger.info(f"Creating new incident in group {chat.id}")

        membership = await self._require_active_group(
            update,
            context,
            on_pending=self._handle_pending_new_issue
        )
        if not membership:
            logger.info(f"/new_issue blocked because group {chat.id if chat else 'unknown'} is not active.")
            return

        group_info = membership['group']
        company_id = group_info.get('company_id')
        logger.info(f"Group is active, companyId={company_id}")

        # Require the command to be a reply to the issue description
        origin_message = update.message.reply_to_message if update.message else None
        description = (origin_message.text if origin_message and origin_message.text else None) \
            or (origin_message.caption if origin_message and origin_message.caption else None)

        if not origin_message or not description:
            logger.warning("No reply message or description found")
            await self._send_error_message(
                update,
                "Please reply to the message describing the issue and run /new_issue from that reply."
            )
            return

        description = description.strip()
        MAX_DESCRIPTION_LENGTH = 3000
        if len(description) > MAX_DESCRIPTION_LENGTH:
            logger.warning(f"Description too long: {len(description)} characters")
            await self._send_error_message(
                update,
                f"Description too long. Maximum {MAX_DESCRIPTION_LENGTH} characters allowed."
            )
            return

        if len(description) < 5:
            logger.warning(f"Description too short: {len(description)} characters")
            await self._send_error_message(
                update,
                "Description too short. Please provide more details (at least 5 characters)."
            )
            return

        logger.debug(f"Description length: {len(description)} characters")

        departments = self.db.list_company_departments(company_id) if company_id else []
        if not departments:
            logger.error(f"No departments configured for companyId={company_id}")
            await self._send_error_message(
                update,
                "No departments are configured for this company yet. "
                "Please set up departments in the dashboard before creating incidents."
            )
            return

        logger.info(f"Found {len(departments)} departments for company")

        # Track user creating the incident (captures comprehensive user data)
        self._track_user_interaction(user, group_id=chat.id)

        user_handle = self._get_user_handle(user)

        # Add breadcrumb for incident creation
        SentryConfig.add_breadcrumb(
            message=f"User {user.id} creating new incident",
            category="incident",
            level="info",
            data={
                "group_id": chat.id,
                "company_id": company_id,
                "description_length": len(description)
            }
        )

        # Create incident in database (without message_id first)
        logger.info(f"Creating incident in database for user={user_handle}, companyId={company_id}")
        incident_id = self.db.create_incident(
            group_id=chat.id,
            created_by_id=user.id,
            created_by_handle=user_handle,
            description=description,
            company_id=company_id,
            source_message_id=origin_message.message_id
        )
        logger.info(f"Incident created with incidentId={incident_id}")

        # Set incident context for Sentry
        SentryConfig.set_tag("incident_id", incident_id)
        SentryConfig.set_context("incident", {
            "incident_id": incident_id,
            "group_id": chat.id,
            "company_id": company_id,
            "created_by": user_handle
        })

        # Build and send the interactive message to choose department
        incident = self.db.get_incident(incident_id)
        text, keyboard = self.message_builder.build_department_selection(
            incident,
            departments,
            prompt="Choose the department to handle this issue.",
            callback_prefix="select_department"
        )

        try:
            sent_message = await update.message.reply_text(
                text,
                reply_markup=keyboard
            )

            self.db.update_incident_message_id(incident_id, sent_message.message_id)

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

        self._log_callback_entry(callback_data, update)

        # Track user interaction (capture all users clicking buttons)
        if user:
            group_id = chat.id if chat and self._is_group_chat(chat) else None
            self._track_user_interaction(user, group_id=group_id)

        try:
            membership = await self._require_active_group(update, context, chat)
            if not membership:
                logger.warning("Group membership check failed for callback")
                return

            parts = callback_data.split(':')
            action = parts[0]
            logger.debug(f"Callback action: {action}, parts: {parts}")

            if action == 'select_department' and len(parts) == 3:
                incident_id, department_id = parts[1], int(parts[2])
                logger.info(f"Routing to select_department: incidentId={incident_id}, departmentId={department_id}")
                await self._handle_select_department(query, user, chat, context, incident_id, department_id)
            elif action == 'reassign_department' and len(parts) == 3:
                incident_id, department_id = parts[1], int(parts[2])
                logger.info(f"Routing to reassign_department: incidentId={incident_id}, departmentId={department_id}")
                await self._handle_reassign_department(query, user, chat, context, incident_id, department_id)
            elif action == 'change_department' and len(parts) == 2:
                incident_id = parts[1]
                logger.info(f"Routing to change_department: incidentId={incident_id}")
                await self._handle_change_department(query, user, chat, incident_id, membership)
            elif action == 'restore_view' and len(parts) == 2:
                incident_id = parts[1]
                logger.info(f"Routing to restore_view: incidentId={incident_id}")
                await self._handle_restore_view(query, user, incident_id)
            elif action == 'claim' and len(parts) == 2:
                incident_id = parts[1]
                logger.info(f"Routing to claim: incidentId={incident_id}")
                await self._handle_claim(query, user, chat, incident_id)
            elif action == 'release' and len(parts) == 2:
                incident_id = parts[1]
                logger.info(f"Routing to release: incidentId={incident_id}")
                await self._handle_release(query, user, chat, incident_id)
            elif action == 'resolve' and len(parts) == 2:
                incident_id = parts[1]
                logger.info(f"Routing to resolve: incidentId={incident_id}")
                await self._handle_resolve(query, user, chat, incident_id, context)
            else:
                logger.warning(f"Unknown callback action: {action}")
                await query.answer("Unknown action", show_alert=True)

        except ValueError as e:
            logger.error(f"Invalid callback data format: {callback_data}, error: {e}")
            await query.answer("Invalid button data", show_alert=True)

        except Exception as e:
            logger.error(f"Error handling callback: {e}", exc_info=True)
            SentryConfig.capture_exception(e, callback_data=callback_data)
            await query.answer("An error occurred. Please try again.", show_alert=True)

    async def _handle_select_department(self, query, user, chat, context: ContextTypes.DEFAULT_TYPE,
                                        incident_id: str, department_id: int):
        """Handle initial department selection by the ticket creator."""
        with LogContext(incident_id=incident_id, department_id=department_id):
            logger.info(f"Handling department selection")

            incident = self.db.get_incident(incident_id)
            if not incident:
                logger.error(f"Incident not found")
                await query.answer("Incident not found.", show_alert=True)
                return

            if incident['created_by_id'] != user.id:
                logger.warning(f"Permission denied: User {user.id} is not the reporter (reporter: {incident['created_by_id']})")
                await query.answer("Only the reporter can choose the department.", show_alert=True)
                return

            logger.info(f"Assigning incident to department")
            success, message = self.db.assign_incident_department(incident_id, department_id, user.id)
            if not success:
                logger.error(f"Failed to assign department: {message}")
                await query.answer(message, show_alert=True)
                return

            logger.info(f"Department assigned successfully, state transition: Awaiting_Department -> Awaiting_Claim")

            updated_incident = self.db.get_incident(incident_id)
            department = self.db.get_department(department_id)
            department_name = department['name'] if department else "Department"
            text, keyboard = self.message_builder.build_unclaimed_message(updated_incident, department_name)

            await query.edit_message_text(text, reply_markup=keyboard)
            await query.answer("Department selected")

            handles = self.db.get_department_handles(department_id)
            if handles:
                logger.info(f"Pinging {len(handles)} department members")
                ping = self.message_builder.build_department_ping(handles, incident_id)
                await context.bot.send_message(
                    chat_id=chat.id,
                    text=ping,
                    reply_to_message_id=query.message.message_id
                )
            else:
                logger.warning(f"No department members to ping")

    async def _handle_change_department(self, query, user, chat, incident_id: str, membership: Dict[str, Any]):
        """Prompt department change options."""
        incident = self.db.get_incident(incident_id)
        if not incident or not incident.get('department_id'):
            await query.answer("Set a department first.", show_alert=True)
            return

        current_department_id = incident['department_id']
        if not self.db.is_user_in_department(current_department_id, user.id):
            await query.answer("Only members of the current department can transfer this issue.", show_alert=True)
            return

        company_id = membership['group'].get('company_id')
        departments = self.db.list_company_departments(company_id)
        if not departments:
            await query.answer("No departments configured.", show_alert=True)
            return

        text, keyboard = self.message_builder.build_department_selection(
            incident,
            departments,
            prompt="Select a new department to transfer this issue.",
            callback_prefix="reassign_department",
            back_callback_data=f"restore_view:{incident_id}"
        )
        await query.edit_message_text(text, reply_markup=keyboard)
        await query.answer("Choose new department")

    async def _handle_restore_view(self, query, user, incident_id: str):
        """Return to the current incident view without changing department."""
        incident = self.db.get_incident(incident_id)
        if not incident:
            await query.answer("Incident not found.", show_alert=True)
            return

        dept_id = incident.get('department_id')
        if not dept_id:
            await query.answer("Department not set yet.", show_alert=True)
            return

        # Only members of the active department can restore the view
        if not self.db.is_user_in_department(dept_id, user.id):
            await query.answer("You are not a member of this department.", show_alert=True)
            return

        status = incident.get('status')
        if status not in ('Awaiting_Claim', 'In_Progress'):
            await query.answer("Incident updated. Please open the latest pinned message.", show_alert=True)
            return

        department = self.db.get_department(dept_id)
        dept_name = department['name'] if department else "Department"

        if status == 'In_Progress':
            claimer_handles = self.db.get_active_claim_handles(incident_id, department_id=dept_id)
            text, keyboard = self.message_builder.build_claimed_message(incident, claimer_handles, dept_name)
        else:
            text, keyboard = self.message_builder.build_unclaimed_message(incident, dept_name)

        try:
            await query.edit_message_text(text, reply_markup=keyboard)
            await query.answer("Back to incident")
        except TelegramError as e:
            logger.error(f"Error restoring view for {incident_id}: {e}")
            await query.answer("Could not restore the incident view.", show_alert=True)

    async def _handle_reassign_department(self, query, user, chat, context: ContextTypes.DEFAULT_TYPE,
                                          incident_id: str, department_id: int):
        """Handle confirmed department transfer."""
        incident = self.db.get_incident(incident_id)
        if not incident or not incident.get('department_id'):
            await query.answer("Incident not found or not yet assigned.", show_alert=True)
            return

        current_department_id = incident['department_id']
        if not self.db.is_user_in_department(current_department_id, user.id):
            await query.answer("Only members of the current department can transfer this issue.", show_alert=True)
            return

        success, message = self.db.assign_incident_department(incident_id, department_id, user.id)
        if not success:
            await query.answer(message, show_alert=True)
            return

        updated_incident = self.db.get_incident(incident_id)
        department = self.db.get_department(department_id)
        department_name = department['name'] if department else "Department"
        text, keyboard = self.message_builder.build_unclaimed_message(updated_incident, department_name)

        await query.edit_message_text(text, reply_markup=keyboard)
        await query.answer("Department updated")

        handles = self.db.get_department_handles(department_id)
        if handles:
            ping = self.message_builder.build_department_ping(handles, incident_id)
            await context.bot.send_message(
                chat_id=chat.id,
                text=ping,
                reply_to_message_id=query.message.message_id
            )

    async def _handle_claim(self, query, user, chat, incident_id: str):
        """Handle claim button."""
        with LogContext(incident_id=incident_id):
            logger.info(f"Handling incident claim")

            incident = self.db.get_incident(incident_id)
            if not incident:
                logger.error(f"Incident not found")
                await query.answer("Incident not found.", show_alert=True)
                return

            dept_id = incident.get('department_id')
            if not dept_id:
                logger.warning(f"Incident has no department assigned")
                await query.answer("Please choose a department first.", show_alert=True)
                return

            logger.debug(f"Checking department membership: departmentId={dept_id}, userId={user.id}")
            if not self.db.is_user_in_department(dept_id, user.id):
                logger.warning(f"User {user.id} is not a member of department {dept_id}")
                await query.answer("You are not a member of this department.", show_alert=True)
                return

            logger.info(f"Claiming incident for user {user.id} ({self._get_user_handle(user)})")
            success, message = self.db.claim_incident(incident_id, user.id)
            if not success:
                logger.error(f"Failed to claim incident: {message}")
                await query.answer(message, show_alert=True)
                return

            logger.info(f"Incident claimed successfully, state transition: Awaiting_Claim -> In_Progress")

            incident = self.db.get_incident(incident_id)
            claimer_handles = self.db.get_active_claim_handles(incident_id, department_id=dept_id)
            logger.info(f"Active claimers: {claimer_handles}")

            department = self.db.get_department(dept_id)
            dept_name = department['name'] if department else "Department"
            text, keyboard = self.message_builder.build_claimed_message(incident, claimer_handles, dept_name)

            try:
                await query.edit_message_text(text, reply_markup=keyboard)
                await query.answer("Incident claimed successfully!")
                logger.info(f"Message updated successfully")
            except TelegramError as e:
                logger.error(f"Error editing message for {incident_id}: {e}")
                await query.answer("Claimed, but couldn't update message. Please refresh.", show_alert=True)

    async def _handle_release(self, query, user, chat, incident_id: str):
        """Handle leave claim button."""
        with LogContext(incident_id=incident_id):
            logger.info(f"Handling claim release for user {user.id} ({self._get_user_handle(user)})")

            success, message = self.db.release_claim(incident_id, user.id)

            if success:
                logger.info(f"Claim released successfully, state transition: In_Progress -> Awaiting_Claim (if no claimers left)")

                incident = self.db.get_incident(incident_id)
                if not incident:
                    logger.error(f"Incident not found after release")
                    await query.answer("Incident not found. Please refresh.", show_alert=True)
                    return

                dept_id = incident.get('department_id')
                department = self.db.get_department(dept_id) if dept_id else None
                dept_name = department['name'] if department else "Department"
                claimer_handles = self.db.get_active_claim_handles(incident_id, department_id=dept_id) if dept_id else []

                logger.info(f"Remaining claimers: {claimer_handles}")

                if incident['status'] == 'In_Progress' and claimer_handles:
                    logger.debug(f"Incident still has claimers, keeping In_Progress state")
                    text, keyboard = self.message_builder.build_claimed_message(incident, claimer_handles, dept_name)
                else:
                    logger.debug(f"No claimers left, reverting to Awaiting_Claim state")
                    text, keyboard = self.message_builder.build_unclaimed_message(incident, dept_name)

                try:
                    await query.edit_message_text(text, reply_markup=keyboard)
                    await query.answer("Claim released")
                    logger.info(f"Message updated successfully")
                except TelegramError as e:
                    logger.error(f"Error editing message for {incident_id}: {e}")
                    await query.answer("Released, but couldn't update message.", show_alert=True)
            else:
                logger.error(f"Failed to release claim: {message}")
                await query.answer(message, show_alert=True)

    async def _handle_resolve(self, query, user, chat, incident_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Handle resolve button."""
        with LogContext(incident_id=incident_id):
            logger.info(f"Handling resolution request for user {user.id} ({self._get_user_handle(user)})")

            success, message = self.db.request_resolution(incident_id, user.id)

            if success:
                logger.info(f"Resolution requested successfully, state transition: In_Progress -> Awaiting_Summary")

                incident = self.db.get_incident(incident_id)
                user_handle = self._get_user_handle(user)
                text, _ = self.message_builder.build_awaiting_summary_message(incident, user_handle)

                await query.edit_message_text(text)
                logger.debug(f"Updated incident message to Awaiting_Summary state")

                request_message = self.message_builder.build_resolution_request(
                    incident_id,
                    user_handle
                )
                await context.bot.send_message(
                    chat_id=chat.id,
                    text=request_message,
                    reply_to_message_id=query.message.message_id
                )
                logger.info(f"Sent resolution summary request message")

                await query.answer("Please reply to the bot's message with your summary")
            else:
                logger.error(f"Failed to request resolution: {message}")
                await query.answer(message, show_alert=True)

    # ==================== Message Handler for Resolution Summary ====================

    async def message_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle regular messages (specifically for resolution summaries)."""
        message = update.message
        user = message.from_user if message else None
        chat = message.chat if message else None

        # Track user interaction (capture all users sending messages)
        if message and user:
            group_id = chat.id if chat and self._is_group_chat(chat) else None
            self._track_user_interaction(user, group_id=group_id)

        # Only process replies
        if not message.reply_to_message:
            return

        # Check if replying to bot's message
        bot_user_id = self._get_bot_user_id(context)
        if not bot_user_id or message.reply_to_message.from_user.id != bot_user_id:
            return

        logger.debug(f"Processing message reply from user {user.id if user else 'unknown'} in chat {chat.id if chat else 'unknown'}")

        group = self.db.get_group(chat.id) if chat and self._is_group_chat(chat) else None

        # Registration replies take precedence for pending groups
        if group and group.get('status') != 'active':
            registration_message_id = group.get('registration_message_id')
            if registration_message_id and registration_message_id == message.reply_to_message.message_id:
                logger.info(f"Processing registration reply for group {chat.id}")
                await self._handle_registration_reply(message, context, group)
                return

        # Check if the bot's message is requesting a resolution
        bot_message_text = message.reply_to_message.text
        if not bot_message_text or "resolution summary" not in bot_message_text.lower():
            return

        logger.info(f"Processing resolution summary from user {user.id if user else 'unknown'}")

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
            logger.warning(f"Could not extract incident_id from bot message")
            return

        with LogContext(incident_id=incident_id):
            logger.info(f"Extracted incidentId from message: {incident_id}")

            # Get the incident
            incident = self.db.get_incident(incident_id)
            if not incident:
                logger.error(f"Incident not found")
                await message.reply_text(f"❌ Incident {incident_id} not found.")
                return

            # Verify status and user authorization
            if incident['status'] != 'Awaiting_Summary':
                logger.warning(f"Incident status is {incident['status']}, not Awaiting_Summary")
                await message.reply_text(f"❌ Incident {incident_id} is not awaiting a summary.")
                return

            if incident['pending_resolution_by_user_id'] != user.id:
                logger.warning(f"User {user.id} not authorized to resolve (pending user: {incident['pending_resolution_by_user_id']})")
                await message.reply_text(
                    f"❌ You are not authorized to resolve this incident. "
                    f"It's waiting for a summary from another user."
                )
                return

            # Get the resolution summary
            resolution_summary = message.text
            logger.info(f"Received resolution summary ({len(resolution_summary)} chars)")

            # Mark as resolved
            logger.info(f"Resolving incident with summary")
            success, msg = self.db.resolve_incident(incident_id, user.id, resolution_summary)

        if success:
            with LogContext(incident_id=incident_id):
                logger.info(f"Incident resolved successfully, state transition: Awaiting_Summary -> Resolved")

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
                    logger.debug(f"Updated pinned message to Resolved state")

                    # Unpin the message
                    await context.bot.unpin_chat_message(
                        chat_id=message.chat_id,
                        message_id=incident['pinned_message_id']
                    )
                    logger.debug(f"Unpinned resolved incident message")

                    await message.reply_text(f"✅ {incident_id} has been marked as resolved!")
                    logger.info(f"Incident resolution completed successfully")

                except TelegramError as e:
                    logger.error(f"Error updating resolved message: {e}")
                    await message.reply_text(
                        f"✅ {incident_id} marked as resolved, but couldn't update the pinned message."
                    )
        else:
            await message.reply_text(f"❌ {msg}")
