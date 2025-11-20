# Reporting Recipes (Department Model)

Sample SQL snippets for ad-hoc analysis using the new department workflow.

## Time to Claim & Resolve

```sql
SELECT
  COUNT(*) AS total,
  AVG((julianday(t_first_claimed) - julianday(COALESCE(t_department_assigned, t_created))) * 86400) AS avg_seconds_to_claim,
  AVG((julianday(t_resolved) - julianday(COALESCE(t_department_assigned, t_created))) * 86400) AS avg_seconds_to_resolve
FROM incidents
WHERE company_id = :company_id
  AND datetime(t_created) BETWEEN :start AND :end;
```

## Department Throughput

```sql
SELECT
  d.name AS department,
  COUNT(*) AS incidents,
  SUM(CASE WHEN i.status IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS closed,
  AVG((julianday(i.t_first_claimed) - julianday(COALESCE(i.t_department_assigned, i.t_created))) * 86400) AS avg_to_claim_seconds
FROM incidents i
LEFT JOIN incident_department_sessions s ON s.incident_id = i.incident_id AND s.status = 'resolved'
LEFT JOIN departments d ON d.department_id = COALESCE(i.department_id, s.department_id)
WHERE i.company_id = :company_id
  AND datetime(i.t_created) BETWEEN :start AND :end
GROUP BY d.name;
```

## Participant Leaderboard

```sql
SELECT
  p.user_id,
  COALESCE(u.telegram_handle, 'User_' || p.user_id) AS handle,
  COALESCE(d.name, 'Unassigned') AS department,
  COUNT(*) AS incidents_touched,
  SUM(p.total_active_seconds) AS total_active_seconds,
  SUM(CASE WHEN p.status = 'resolved_self' THEN 1 ELSE 0 END) AS resolved_self
FROM incident_participants p
JOIN incidents i ON i.incident_id = p.incident_id
LEFT JOIN users u ON u.user_id = p.user_id
LEFT JOIN departments d ON d.department_id = p.department_id
WHERE i.company_id = :company_id
  AND datetime(i.t_created) BETWEEN :start AND :end
GROUP BY p.user_id, p.department_id
ORDER BY resolved_self DESC, total_active_seconds DESC;
```
