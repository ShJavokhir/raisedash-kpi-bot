# KPI Data Model (Department-Based)

The bot captures department-centric participation data that supports fair KPI reporting when incidents move between departments or multiple members swarm a single issue.

## Key Tables

- **incidents**
  - `department_id` – current department handling the incident.
  - `t_department_assigned` – timestamp when the current department was set.
  - `t_first_claimed` / `t_last_claimed` – first and most recent claim timestamps.
  - `t_resolved` – resolution/close timestamp.
  - `status` – `Awaiting_Department`, `Awaiting_Claim`, `In_Progress`, `Awaiting_Summary`, `Resolved`, `Closed`.
- **incident_department_sessions**
  - Tracks each department assignment window with `assigned_at`, optional `claimed_at`, `released_at`, and `status` (`active`, `transferred`, `resolved`, `closed`).
- **incident_claims**
  - Multiple concurrent claimants per incident, scoped to `department_id`, with `claimed_at`, `released_at`, `is_active`.
- **incident_participants** (one row per incident/user/department)
  - Joins/leaves, total active seconds, join count, status (`active`, `released`, `resolved_self`, `resolved_other`, `transferred`, `closed`), `active_since`, `resolved_at`, `outcome_detail`.
- **incident_events**
  - Append-only log of lifecycle events (`create`, `department_assigned`, `claim`, `release`, `resolution_requested`, `resolve`, `auto_closed`) with actor and metadata.

## KPI Calculation Notes

1. **Time to Claim** – measured from `t_department_assigned` (or `t_created` fallback) to `t_first_claimed`.
2. **Active Duration per Member** – accrued in `incident_participants.total_active_seconds` whenever a user claims; multiple joins increment `join_count` and reactivate `active_since`.
3. **Attribution with Multiple Claimants**
   - Resolver receives `status=resolved_self` and keeps accrued time.
   - Other active responders closed with `status=resolved_other` at resolution time.
   - Members removed during a department transfer are marked `transferred`.
4. **Department Transfers** – active claims are finalized as `transferred`, the active department session is closed, and a new session starts with a fresh `t_department_assigned`.
5. **Auto-Close** – unresolved incidents waiting for a summary set `status=Closed`, finalize active participants, and stop SLA timers.

These records enable downstream reporting of end-to-end SLA performance, participation fairness, and department-level throughput.
