# KPI Report Types

Context: SQLite data is UTC ISO strings. Compute `:window_start_utc` and `:window_end_utc` in code (e.g., weekly window ending the `.env` weekday at 11:59pm America/New_York, then converted to UTC). All queries use those parameters to avoid timezone math in SQLite.

Defensive notes
- Wrap divisions with NULL checks; SQLite `AVG` ignores NULLs (safe for missing timestamps).
- Use `COALESCE` for handles; keep empty result sets okay (no rows → no crash).
- For week-over-week comparisons, run the same query twice with `:prev_window_start_utc` / `:prev_window_end_utc`.

## 1) Weekly KPI Packet (run end-of-week 11:59pm ET)
Incident throughput, closure mix, and speed.
```sql
WITH window_incidents AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  COUNT(*) AS created,
  SUM(CASE WHEN status IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS closed,
  SUM(CASE WHEN status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS still_open,
  ROUND(AVG(CASE WHEN t_claimed_tier1 IS NOT NULL
                 THEN (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 END),1) AS avg_seconds_to_first_claim,
  ROUND(AVG(CASE WHEN t_resolved IS NOT NULL
                 THEN (julianday(t_resolved) - julianday(t_created)) * 86400 END),1) AS avg_seconds_to_resolution
FROM window_incidents;
```

## 2) Solver Leaderboard (dispatchers/managers)
Rank everyone who touched incidents by Tier, with time spent and resolutions credited.
```sql
WITH window_participants AS (
  SELECT p.*, i.company_id, i.group_id
  FROM incident_participants p
  JOIN incidents i ON i.incident_id = p.incident_id
  WHERE datetime(i.t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  p.tier,
  p.user_id,
  COALESCE(u.telegram_handle, 'User_' || p.user_id) AS handle,
  COUNT(*) AS incidents_touched,
  SUM(CASE WHEN p.status = 'resolved_self' THEN 1 ELSE 0 END) AS resolved_self_count,
  SUM(CASE WHEN p.status = 'resolved_other' THEN 1 ELSE 0 END) AS team_resolved_count,
  SUM(p.total_active_seconds) AS total_active_seconds,
  ROUND(AVG(NULLIF(p.total_active_seconds,0)),1) AS avg_active_seconds_per_incident
FROM window_participants p
LEFT JOIN users u ON u.user_id = p.user_id
GROUP BY p.user_id, p.tier
ORDER BY p.tier, resolved_self_count DESC, total_active_seconds DESC;
```

## 3) Who escalated, who claimed escalations, and speed
Pipeline from Tier 1 escalation to Tier 2 claim and resolution.
```sql
WITH win AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
), escalated AS (
  SELECT *
  FROM win
  WHERE t_escalated IS NOT NULL
)
SELECT
  COUNT(*) AS escalations,
  SUM(CASE WHEN t_claimed_tier2 IS NOT NULL THEN 1 ELSE 0 END) AS claimed_by_tier2,
  ROUND(AVG(CASE WHEN t_escalated IS NOT NULL AND t_claimed_tier2 IS NOT NULL
                 THEN (julianday(t_claimed_tier2) - julianday(t_escalated)) * 86400 END),1) AS avg_seconds_escalation_to_claim,
  ROUND(AVG(CASE WHEN t_escalated IS NOT NULL AND t_resolved IS NOT NULL
                 THEN (julianday(t_resolved) - julianday(t_escalated)) * 86400 END),1) AS avg_seconds_escalation_to_resolve,
  COUNT(CASE WHEN escalated_by_user_id IS NOT NULL THEN 1 END) AS escalated_by_someone
FROM escalated;
```

## 4) Dispatcher escalation behavior
Which dispatchers escalate most, and how fast they escalate relative to creation.
```sql
WITH escalations AS (
  SELECT *
  FROM incidents
  WHERE t_escalated IS NOT NULL
    AND datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  escalated_by_user_id AS dispatcher_id,
  COALESCE(u.telegram_handle, 'User_' || escalated_by_user_id) AS handle,
  COUNT(*) AS escalations_made,
  ROUND(AVG((julianday(t_escalated) - julianday(t_created)) * 86400),1) AS avg_seconds_to_escalate
FROM escalations
LEFT JOIN users u ON u.user_id = escalated_by_user_id
GROUP BY escalated_by_user_id
ORDER BY escalations_made DESC;
```

## 5) Time-to-first-claim SLA compliance
Percent of incidents acknowledged by Tier 1 within SLA (use `.env` minutes → seconds).
```sql
WITH win AS (
  SELECT *
  FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  COUNT(*) AS total_incidents,
  SUM(CASE WHEN t_claimed_tier1 IS NOT NULL
               AND (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 <= :sla_claim_seconds
           THEN 1 ELSE 0 END) AS met_sla,
  ROUND(
    100.0 * SUM(CASE WHEN t_claimed_tier1 IS NOT NULL
                         AND (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 <= :sla_claim_seconds
                     THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1
  ) AS pct_met
FROM win;
```

## 6) Escalation response SLA (T2 claim speed)
```sql
WITH esc AS (
  SELECT *
  FROM incidents
  WHERE t_escalated IS NOT NULL
    AND datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  COUNT(*) AS escalations,
  SUM(CASE WHEN t_claimed_tier2 IS NOT NULL
               AND (julianday(t_claimed_tier2) - julianday(t_escalated)) * 86400 <= :sla_escalation_seconds
           THEN 1 ELSE 0 END) AS met_sla,
  ROUND(
    100.0 * SUM(CASE WHEN t_claimed_tier2 IS NOT NULL
                         AND (julianday(t_claimed_tier2) - julianday(t_escalated)) * 86400 <= :sla_escalation_seconds
                     THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1
  ) AS pct_met
FROM esc;
```

## 7) Resolution time SLA
Resolution speed for all incidents; split escalated vs not.
```sql
WITH win AS (
  SELECT *,
         (julianday(t_resolved) - julianday(t_created)) * 86400 AS seconds_to_resolve,
         (julianday(t_escalated) - julianday(t_created)) * 86400 AS seconds_to_escalate
  FROM incidents
  WHERE t_resolved IS NOT NULL
    AND datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  COUNT(*) AS resolved,
  ROUND(AVG(seconds_to_resolve),1) AS avg_seconds_to_resolve,
  ROUND(AVG(CASE WHEN t_escalated IS NULL THEN seconds_to_resolve END),1) AS avg_seconds_non_escalated,
  ROUND(AVG(CASE WHEN t_escalated IS NOT NULL THEN seconds_to_resolve END),1) AS avg_seconds_escalated,
  SUM(CASE WHEN seconds_to_resolve <= :sla_resolution_seconds THEN 1 ELSE 0 END) AS met_sla,
  ROUND(100.0 * SUM(CASE WHEN seconds_to_resolve <= :sla_resolution_seconds THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0),1) AS pct_met
FROM win;
```

## 8) Open backlog and aging
What is still open and how old it is.
```sql
SELECT
  incident_id,
  status,
  group_id,
  COALESCE(company_id, -1) AS company_id,
  datetime(t_created) AS created_at,
  CAST((julianday('now') - julianday(t_created)) * 24 AS INT) AS age_hours
FROM incidents
WHERE status NOT IN ('Resolved','Closed')
ORDER BY age_hours DESC;
```

## 9) Auto-closed / missing summary compliance
Track incidents closed without a human summary (bad quality).
```sql
WITH win AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  COUNT(*) AS closed_total,
  SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS auto_closed,
  ROUND(100.0 * SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0),1) AS pct_auto_closed
FROM win;
```

## 10) Participation fairness per incident (“swarm share”)
Share of active time per participant; highlights overload vs spectators.
```sql
WITH win AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
), totals AS (
  SELECT p.incident_id, SUM(p.total_active_seconds) AS total_seconds
  FROM incident_participants p
  JOIN win i ON i.incident_id = p.incident_id
  GROUP BY p.incident_id
)
SELECT
  p.incident_id,
  p.tier,
  COALESCE(u.telegram_handle, 'User_' || p.user_id) AS handle,
  p.total_active_seconds,
  ROUND(100.0 * p.total_active_seconds / NULLIF(t.total_seconds,0),1) AS pct_of_incident_time,
  p.status
FROM incident_participants p
JOIN win i ON i.incident_id = p.incident_id
JOIN totals t ON t.incident_id = p.incident_id
LEFT JOIN users u ON u.user_id = p.user_id
ORDER BY p.incident_id, p.total_active_seconds DESC;
```

## 11) Workload by hour/day
Heatmap-ready volume to spot staffing gaps (localize in app if needed).
```sql
SELECT
  strftime('%w', t_created) AS dow_0_sunday,
  strftime('%H', t_created) AS hour_24h,
  COUNT(*) AS incidents_created
FROM incidents
WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
GROUP BY dow_0_sunday, hour_24h
ORDER BY dow_0_sunday, hour_24h;
```

## 12) Group / company adoption
Which groups/companies are active; useful for rollout monitoring.
```sql
WITH win AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  COALESCE(i.company_id, -1) AS company_id,
  g.group_id,
  g.group_name,
  COUNT(*) AS incidents_created,
  SUM(CASE WHEN i.status IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS incidents_closed
FROM win i
LEFT JOIN groups g ON g.group_id = i.group_id
GROUP BY g.group_id, i.company_id
ORDER BY incidents_created DESC;
```

## 13) Driver-created incident feed
Who is reporting the most (source-side quality/volume).
```sql
WITH win AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  created_by_id AS reporter_id,
  COALESCE(u.telegram_handle, created_by_handle) AS reporter_handle,
  COUNT(*) AS incidents_reported
FROM win
LEFT JOIN users u ON u.user_id = created_by_id
GROUP BY created_by_id
ORDER BY incidents_reported DESC;
```

## 14) Incident lifecycle detail (for drilldown / comparison vs last week)
Per-incident timings to compare week-over-week outliers.
```sql
WITH win AS (
  SELECT * FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
)
SELECT
  incident_id,
  status,
  (julianday(t_claimed_tier1) - julianday(t_created)) * 86400 AS seconds_to_first_claim,
  (julianday(t_escalated) - julianday(t_created)) * 86400 AS seconds_to_escalate,
  (julianday(t_claimed_tier2) - julianday(t_escalated)) * 86400 AS seconds_escalated_to_claim,
  (julianday(t_resolved) - julianday(t_created)) * 86400 AS seconds_to_resolve,
  resolved_by_user_id,
  resolved_by_tier
FROM win
ORDER BY t_created;
```

## 15) Week-over-week header metrics
Template to compare this week vs last week in one query (set both windows in code).
```sql
WITH curr AS (
  SELECT COUNT(*) AS cnt, AVG((julianday(t_resolved) - julianday(t_created)) * 86400) AS avg_resolve
  FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:window_start_utc) AND datetime(:window_end_utc)
    AND t_resolved IS NOT NULL
), prev AS (
  SELECT COUNT(*) AS cnt, AVG((julianday(t_resolved) - julianday(t_created)) * 86400) AS avg_resolve
  FROM incidents
  WHERE datetime(t_created) BETWEEN datetime(:prev_window_start_utc) AND datetime(:prev_window_end_utc)
    AND t_resolved IS NOT NULL
)
SELECT
  curr.cnt AS this_week_resolved,
  prev.cnt AS last_week_resolved,
  curr.cnt - prev.cnt AS delta_resolved,
  ROUND(curr.avg_resolve,1) AS this_week_avg_seconds_to_resolve,
  ROUND(prev.avg_resolve,1) AS last_week_avg_seconds_to_resolve,
  ROUND(curr.avg_resolve - prev.avg_resolve,1) AS delta_seconds_to_resolve
FROM curr, prev;
```
