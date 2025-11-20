"""
Reporting utilities for generating KPI HTML reports.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from io import BytesIO
from typing import Dict, List, Tuple, Any
from zoneinfo import ZoneInfo

from database import Database

logger = logging.getLogger(__name__)


@dataclass
class ReportWindow:
    """Represents a reporting window in UTC and local time."""
    start_utc: datetime
    end_utc: datetime
    start_local: datetime
    end_local: datetime
    period_label: str


class KPIReportGenerator:
    """Aggregates KPI data and renders HTML reports."""

    def __init__(self, db: Database, tz_name: str, week_end_day: int, template_path: str,
                 sla_claim_seconds: int, sla_escalation_seconds: int, sla_resolution_seconds: int):
        self.db = db
        self.tz = self._safe_timezone(tz_name)
        self.week_end_day = max(0, min(6, week_end_day))  # clamp to weekday index
        self.template_path = template_path
        self.sla_claim_seconds = sla_claim_seconds
        self.sla_escalation_seconds = sla_escalation_seconds
        self.sla_resolution_seconds = sla_resolution_seconds

    def _safe_timezone(self, tz_name: str) -> ZoneInfo:
        """Return a ZoneInfo, defaulting to UTC on failure."""
        try:
            return ZoneInfo(tz_name)
        except Exception:
            logger.warning("Invalid timezone '%s'; falling back to UTC", tz_name)
            return ZoneInfo("UTC")

    def compute_window(self, period: str) -> ReportWindow:
        """Compute reporting window for day|week|month in local tz."""
        now_local = datetime.now(self.tz)
        if period == "day":
            start_local = datetime.combine(now_local.date(), time.min, tzinfo=self.tz)
            end_local = start_local + timedelta(days=1)
            label = start_local.strftime("%Y-%m-%d")
        elif period == "week":
            # Week ends on configured weekday at 23:59:59 local; window is 7 days
            days_since_week_end = (now_local.weekday() - self.week_end_day) % 7
            end_date = (now_local - timedelta(days=days_since_week_end)).date()
            end_local = datetime.combine(end_date, time.max, tzinfo=self.tz)
            start_local = end_local - timedelta(days=6)
            start_local = datetime.combine(start_local.date(), time.min, tzinfo=self.tz)
            label = f"Week ending {end_local.strftime('%Y-%m-%d')}"
        else:  # month (default)
            first_of_month = datetime(now_local.year, now_local.month, 1, tzinfo=self.tz)
            if now_local.month == 12:
                next_month = datetime(now_local.year + 1, 1, 1, tzinfo=self.tz)
            else:
                next_month = datetime(now_local.year, now_local.month + 1, 1, tzinfo=self.tz)
            start_local = first_of_month
            end_local = next_month
            label = start_local.strftime("%B %Y")

        return ReportWindow(
            start_utc=start_local.astimezone(ZoneInfo("UTC")),
            end_utc=end_local.astimezone(ZoneInfo("UTC")),
            start_local=start_local,
            end_local=end_local,
            period_label=label
        )

    def _execute(self, query: str, params: tuple) -> List[Dict[str, Any]]:
        """Run a read-only query and return list of dict rows."""
        with self.db.get_connection() as conn:
            cursor = conn.execute(query, params)
            cols = [desc[0] for desc in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]

    def _fetch_summary(self, company_id: int, window: ReportWindow) -> Dict[str, Any]:
        query = """
            SELECT
              COUNT(*) AS created,
              SUM(CASE WHEN status IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS closed,
              SUM(CASE WHEN status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS open,
              AVG(CASE WHEN t_claimed_tier1 IS NOT NULL
                       THEN (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 END) AS avg_claim_seconds,
              AVG(CASE WHEN t_resolved IS NOT NULL
                       THEN (julianday(t_resolved) - julianday(t_created)) * 86400 END) AS avg_resolve_seconds,
              SUM(CASE WHEN t_escalated IS NOT NULL THEN 1 ELSE 0 END) AS escalated
            FROM incidents
            WHERE company_id = ?
              AND datetime(t_created) >= datetime(?)
              AND datetime(t_created) < datetime(?)
        """
        rows = self._execute(query, (company_id, window.start_utc.isoformat(), window.end_utc.isoformat()))
        return rows[0] if rows else {}

    def _fetch_sla(self, company_id: int, window: ReportWindow) -> Dict[str, Any]:
        query = """
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN t_claimed_tier1 IS NOT NULL THEN 1 ELSE 0 END) AS claimed,
              SUM(CASE WHEN t_claimed_tier1 IS NOT NULL
                        AND (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 <= ?
                   THEN 1 ELSE 0 END) AS claim_met,
              SUM(CASE WHEN t_escalated IS NOT NULL THEN 1 ELSE 0 END) AS escalated,
              SUM(CASE WHEN t_claimed_tier2 IS NOT NULL
                        AND (julianday(t_claimed_tier2) - julianday(t_escalated)) * 86400 <= ?
                   THEN 1 ELSE 0 END) AS escalation_met,
              SUM(CASE WHEN t_resolved IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN t_resolved IS NOT NULL
                        AND (julianday(t_resolved) - julianday(t_created)) * 86400 <= ?
                   THEN 1 ELSE 0 END) AS resolve_met
            FROM incidents
            WHERE company_id = ?
              AND datetime(t_created) >= datetime(?)
              AND datetime(t_created) < datetime(?)
        """
        params = (
            self.sla_claim_seconds,
            self.sla_escalation_seconds,
            self.sla_resolution_seconds,
            company_id,
            window.start_utc.isoformat(),
            window.end_utc.isoformat()
        )
        rows = self._execute(query, params)
        return rows[0] if rows else {}

    def _fetch_escalation_details(self, company_id: int, window: ReportWindow) -> Dict[str, Any]:
        query = """
            SELECT
              COUNT(*) AS escalations,
              SUM(CASE WHEN t_claimed_tier2 IS NOT NULL THEN 1 ELSE 0 END) AS claimed_t2,
              SUM(CASE WHEN t_resolved IS NOT NULL THEN 1 ELSE 0 END) AS resolved_after_escalation,
              AVG(CASE WHEN t_escalated IS NOT NULL AND t_claimed_tier2 IS NOT NULL
                       THEN (julianday(t_claimed_tier2) - julianday(t_escalated)) * 86400 END) AS avg_seconds_to_t2_claim,
              AVG(CASE WHEN t_escalated IS NOT NULL AND t_resolved IS NOT NULL
                       THEN (julianday(t_resolved) - julianday(t_escalated)) * 86400 END) AS avg_seconds_escalation_to_resolve,
              AVG(CASE WHEN t_escalated IS NOT NULL AND t_created IS NOT NULL
                       THEN (julianday(t_escalated) - julianday(t_created)) * 86400 END) AS avg_seconds_to_escalate
            FROM incidents
            WHERE company_id = ?
              AND t_escalated IS NOT NULL
              AND datetime(t_created) >= datetime(?)
              AND datetime(t_created) < datetime(?)
        """
        rows = self._execute(query, (company_id, window.start_utc.isoformat(), window.end_utc.isoformat()))
        return rows[0] if rows else {}

    def _fetch_leaderboard(self, company_id: int, window: ReportWindow) -> List[Dict[str, Any]]:
        query = """
            SELECT
              p.tier,
              p.user_id,
              COALESCE(u.telegram_handle, 'User_' || p.user_id) AS handle,
              COUNT(*) AS incidents_touched,
              SUM(CASE WHEN p.status = 'resolved_self' THEN 1 ELSE 0 END) AS resolved_self,
              SUM(CASE WHEN p.status = 'resolved_other' THEN 1 ELSE 0 END) AS resolved_other,
              SUM(CASE WHEN p.status = 'escalated' THEN 1 ELSE 0 END) AS escalated_out,
              SUM(p.total_active_seconds) AS total_active_seconds,
              AVG(NULLIF(p.total_active_seconds,0)) AS avg_active_seconds
            FROM incident_participants p
            JOIN incidents i ON i.incident_id = p.incident_id
            LEFT JOIN users u ON u.user_id = p.user_id
            WHERE i.company_id = ?
              AND datetime(i.t_created) >= datetime(?)
              AND datetime(i.t_created) < datetime(?)
            GROUP BY p.tier, p.user_id
            ORDER BY p.tier ASC, resolved_self DESC, total_active_seconds DESC
            LIMIT 50
        """
        return self._execute(query, (company_id, window.start_utc.isoformat(), window.end_utc.isoformat()))

    def _fetch_trends(self, company_id: int, window: ReportWindow) -> List[Dict[str, Any]]:
        query = """
            WITH win AS (
              SELECT * FROM incidents
              WHERE company_id = ?
                AND datetime(t_created) >= datetime(?)
                AND datetime(t_created) < datetime(?)
            )
            SELECT
              strftime('%Y-%m-%d', t_created) AS bucket,
              COUNT(*) AS created,
              SUM(CASE WHEN status IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS closed,
              SUM(CASE WHEN t_escalated IS NOT NULL THEN 1 ELSE 0 END) AS escalated
            FROM win
            GROUP BY bucket
            ORDER BY bucket ASC
        """
        return self._execute(query, (company_id, window.start_utc.isoformat(), window.end_utc.isoformat()))

    def _fetch_backlog(self, company_id: int) -> List[Dict[str, Any]]:
        query = """
            SELECT
              incident_id,
              status,
              group_id,
              company_id,
              t_created,
              description,
              CAST((julianday('now') - julianday(t_created)) * 24 AS INT) AS age_hours
            FROM incidents
            WHERE company_id = ?
              AND status NOT IN ('Resolved','Closed')
            ORDER BY age_hours DESC
            LIMIT 50
        """
        return self._execute(query, (company_id,))

    def _fetch_incident_details(self, company_id: int, window: ReportWindow) -> List[Dict[str, Any]]:
        query = """
            SELECT
              incident_id,
              status,
              description,
              created_by_handle,
              t_created,
              t_claimed_tier1,
              t_escalated,
              t_claimed_tier2,
              t_resolved,
              (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 AS seconds_to_claim,
              (julianday(t_escalated) - julianday(t_created)) * 86400 AS seconds_to_escalate,
              (julianday(t_resolved) - julianday(t_created)) * 86400 AS seconds_to_resolve
            FROM incidents
            WHERE company_id = ?
              AND datetime(t_created) >= datetime(?)
              AND datetime(t_created) < datetime(?)
            ORDER BY t_created DESC
            LIMIT 100
        """
        return self._execute(query, (company_id, window.start_utc.isoformat(), window.end_utc.isoformat()))

    def _fmt_duration_short(self, seconds: Any) -> str:
        """Return a short human-readable duration."""
        if seconds is None:
            return "—"
        try:
            seconds = float(seconds)
        except Exception:
            return "—"
        if seconds < 60:
            return f"{int(seconds)}s"
        minutes = seconds / 60
        if minutes < 90:
            return f"{minutes:.1f}m"
        hours = minutes / 60
        return f"{hours:.1f}h"

    def _pct(self, numerator: Any, denominator: Any) -> float:
        try:
            numerator = float(numerator or 0)
            denominator = float(denominator or 0)
            if denominator == 0:
                return 0.0
            return round(100.0 * numerator / denominator, 1)
        except Exception:
            return 0.0

    def _build_cards(self, summary: Dict[str, Any], sla: Dict[str, Any]) -> List[Dict[str, str]]:
        created = summary.get("created") or 0
        closed = summary.get("closed") or 0
        open_count = summary.get("open") or 0
        escalated = summary.get("escalated") or 0

        return [
            {
                "label": "Incidents Created",
                "value": f"{int(created)}",
                "subtext": f"Closed {int(closed)} | Open {int(open_count)}",
            },
            {
                "label": "Avg Time to Claim",
                "value": self._fmt_duration_short(summary.get("avg_claim_seconds")),
                "subtext": f"SLA met {self._pct(sla.get('claim_met'), sla.get('total'))}% ({int(sla.get('claim_met') or 0)}/{int(sla.get('total') or 0)})"
            },
            {
                "label": "Avg Time to Resolve",
                "value": self._fmt_duration_short(summary.get("avg_resolve_seconds")),
                "subtext": f"SLA met {self._pct(sla.get('resolve_met'), sla.get('resolved'))}% ({int(sla.get('resolve_met') or 0)}/{int(sla.get('resolved') or 0)})"
            },
            {
                "label": "Escalation Rate",
                "value": f"{self._pct(escalated, created)}%",
                "subtext": f"Escalated {int(escalated)} of {int(created)}"
            },
        ]

    def build_report(self, company: Dict[str, Any], period: str) -> Tuple[Dict[str, Any], str]:
        """Aggregate data and render final HTML."""
        window = self.compute_window(period)
        summary = self._fetch_summary(company["company_id"], window)
        sla = self._fetch_sla(company["company_id"], window)
        escalations = self._fetch_escalation_details(company["company_id"], window)
        leaderboard = self._fetch_leaderboard(company["company_id"], window)
        trends = self._fetch_trends(company["company_id"], window)
        backlog = self._fetch_backlog(company["company_id"])
        incidents = self._fetch_incident_details(company["company_id"], window)

        cards = self._build_cards(summary, sla)

        highlights = [
            f"Created {int(summary.get('created') or 0)} incidents; closed {int(summary.get('closed') or 0)}, open {int(summary.get('open') or 0)}",
            f"Avg time to first claim: {self._fmt_duration_short(summary.get('avg_claim_seconds'))}",
            f"Avg time to resolve: {self._fmt_duration_short(summary.get('avg_resolve_seconds'))}",
            f"Escalations: {int(escalations.get('escalations') or 0)} (claimed {int(escalations.get('claimed_t2') or 0)})"
        ]

        report_data = {
            "meta": {
                "company_id": company["company_id"],
                "company_name": company["name"],
                "period": period,
                "period_label": window.period_label,
                "timezone": str(self.tz),
                "generated_at": datetime.now(ZoneInfo("UTC")).isoformat(),
                "window_start": window.start_utc.isoformat(),
                "window_end": window.end_utc.isoformat(),
            },
            "summary": summary,
            "sla": sla,
            "escalations": escalations,
            "leaderboard": leaderboard,
            "trends": trends,
            "backlog": backlog,
            "incidents": incidents,
            "cards": cards,
            "highlights": highlights,
        }

        html = self.render_html(report_data)
        return report_data, html

    def render_html(self, report_data: Dict[str, Any]) -> str:
        """Load template and inject report data JSON."""
        try:
            with open(self.template_path, "r", encoding="utf-8") as f:
                template = f.read()
        except FileNotFoundError:
            raise FileNotFoundError(f"Report template not found at {self.template_path}")

        payload = json.dumps(report_data, ensure_ascii=False)
        return template.replace("__REPORT_DATA__", payload)


def html_to_bytes(html: str, filename: str) -> BytesIO:
    """Return a BytesIO suitable for Telegram document upload."""
    bio = BytesIO(html.encode("utf-8"))
    bio.name = filename
    bio.seek(0)
    return bio
