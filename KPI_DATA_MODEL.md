# KPI Data Model

This bot now captures per-user participation data that supports fair KPI reporting even when multiple dispatchers swarm a single issue.

## New/Updated Tables

- **incidents**
  - `escalated_by_user_id` – who pushed to Tier 2.
  - `resolved_by_user_id` / `resolved_by_tier` – who actually provided the resolution.
- **incident_participants** (one row per incident/user/tier)
  - Tracks joins/leaves, total active seconds, join count, and how their participation ended (`status`: `active`, `released`, `resolved_self`, `resolved_other`, `escalated`, `closed`).
  - `active_since` + `total_active_seconds` allow accurate time-in-incident even with multiple joins.
  - `resolved_at` and `outcome_detail` give attribution for the final state.
- **incident_events**
  - Append-only log of lifecycle events (`create`, `claim_t1`, `release_t1`, `escalate`, `claim_t2`, `resolution_requested`, `resolve`) with actor, tier, and timestamp for auditing and SLA math.

## How KPIs Are Derived

1. **Start time per responder** – each successful `claim_t1`/`claim_t2` inserts/activates an `incident_participants` row with `active_since` set to the claim timestamp.
2. **Active duration** – on `release_t1` or incident resolution, durations are accrued into `total_active_seconds` using `active_since`. Multiple joins increment `join_count` and continue accumulating.
3. **Attribution when many responders join**  
   - The resolver gets `status=resolved_self` and keeps all accrued time.  
   - Other active responders are closed with `status=resolved_other` at the resolution timestamp (they keep their active time but are not credited as resolver).  
   - Responders who left earlier keep `status=released`; they are not credited for the resolution.
4. **Escalation context** – `escalated_by_user_id` on the incident plus an `escalate` event provide time-to-escalate metrics per dispatcher and per ticket.

These records are intended for downstream reporting; no report generation is implemented here.
