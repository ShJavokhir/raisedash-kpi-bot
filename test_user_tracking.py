#!/usr/bin/env python3
"""
Smoke test for Supabase-backed user tracking.
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set.
"""

import os
import sys
from uuid import uuid4

from database import Database


def main() -> int:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run this test.")
        return 1

    db = Database(supabase_url, supabase_key)

    test_user_id = int(uuid4().int % 1_000_000_000) + 10_000_000
    group_id = -999123456789

    print(f"Tracking user {test_user_id} in group {group_id}...")
    user = db.track_user(
        user_id=test_user_id,
        username="integration_test_user",
        first_name="Integration",
        last_name="Test",
        language_code="en",
        is_bot=False,
        group_id=group_id,
        team_role="Driver"
    )
    assert user, "User record was not returned"
    assert user["user_id"] == test_user_id
    assert group_id in user.get("group_connections", [])

    print("Promoting user to Dispatcher with legacy upsert...")
    db.upsert_user(test_user_id, "@integration_test_user", "Dispatcher")
    user = db.get_user(test_user_id)
    assert user["team_role"] == "Dispatcher"

    # Clean up created records
    print("Cleaning up test records...")
    db.client.table("group_memberships").delete().eq("user_id", test_user_id).execute()
    db.client.table("telegram_users").delete().eq("id", test_user_id).execute()

    print("✅ Supabase tracking test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
