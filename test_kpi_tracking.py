#!/usr/bin/env python3
"""
Smoke test for KPI participation tracking.
Validates multi-dispatcher claims, durations, and event logging.
"""

import os
import sys
import tempfile
from datetime import datetime, timedelta

from database import Database


DB_PATH = os.path.join(tempfile.gettempdir(), "kpi_metrics_test.db")


def run_kpi_tracking_test() -> bool:
    print("=" * 60)
    print("Testing KPI participation tracking")
    print("=" * 60)

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    db = Database(DB_PATH)

    dispatcher_1 = 101
    dispatcher_2 = 202

    print("\n1) Creating incident...")
    incident_id = db.create_incident(
        group_id=-42,
        created_by_id=999,
        created_by_handle="@creator",
        description="Blown tire on I-90"
    )
    print(f"   ✓ Incident {incident_id} created")

    print("\n2) Two dispatchers claim the incident...")
    ok, msg = db.claim_tier1(incident_id, dispatcher_1)
    assert ok, msg
    ok, msg = db.claim_tier1(incident_id, dispatcher_2)
    assert ok, msg
    print("   ✓ Claims recorded")

    # Push active_since backward to get meaningful durations
    ten_minutes_ago = (datetime.now() - timedelta(minutes=10)).isoformat()
    five_minutes_ago = (datetime.now() - timedelta(minutes=5)).isoformat()
    with db.get_connection() as conn:
        conn.execute("""
            UPDATE incident_participants
            SET active_since = ?
            WHERE incident_id = ? AND user_id = ?
        """, (ten_minutes_ago, incident_id, dispatcher_1))
        conn.execute("""
            UPDATE incident_participants
            SET active_since = ?
            WHERE incident_id = ? AND user_id = ?
        """, (five_minutes_ago, incident_id, dispatcher_2))

    print("\n3) Dispatcher 2 leaves, Dispatcher 1 resolves...")
    ok, msg = db.release_tier1_claim(incident_id, dispatcher_2)
    assert ok, msg
    ok, msg = db.request_resolution(incident_id, dispatcher_1)
    assert ok, msg
    ok, msg = db.resolve_incident(incident_id, dispatcher_1, "Replaced tire and cleared lane")
    assert ok, msg
    print("   ✓ Resolution recorded")

    incident = db.get_incident(incident_id)
    assert incident["resolved_by_user_id"] == dispatcher_1
    assert incident["resolved_by_tier"] == 1

    participants = {p["user_id"]: p for p in db.get_incident_participants(incident_id)}
    assert participants[dispatcher_1]["status"] == "resolved_self"
    assert participants[dispatcher_1]["is_active"] == 0
    assert participants[dispatcher_1]["total_active_seconds"] >= 600

    assert participants[dispatcher_2]["status"] == "released"
    assert participants[dispatcher_2]["is_active"] == 0
    assert participants[dispatcher_2]["total_active_seconds"] >= 300

    events = {event["event_type"] for event in db.get_incident_events(incident_id)}
    expected_events = {"create", "claim_t1", "release_t1", "resolution_requested", "resolve"}
    assert expected_events.issubset(events)

    print("\n✓ KPI tracking test passed")
    print("=" * 60)
    return True


if __name__ == "__main__":
    success = False
    try:
        success = run_kpi_tracking_test()
    finally:
        # Best-effort cleanup of temporary database
        if os.path.exists(DB_PATH):
            try:
                os.remove(DB_PATH)
            except OSError:
                pass
    sys.exit(0 if success else 1)
