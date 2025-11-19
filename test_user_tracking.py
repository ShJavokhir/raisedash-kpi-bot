#!/usr/bin/env python3
"""
Test script for enhanced user tracking functionality.
This script tests the database migration and user tracking features.
"""

import sys
import sqlite3
from database import Database

def test_migration_and_tracking():
    """Test that migration adds all new columns and user tracking works."""

    print("=" * 60)
    print("Testing Enhanced User Tracking Implementation")
    print("=" * 60)

    # Initialize database (will run migrations)
    print("\n1. Initializing database and running migrations...")
    db = Database("incidents.db")
    print("   ✓ Database initialized successfully")

    # Check that all new columns exist
    print("\n2. Verifying new columns in users table...")
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(users)")
        columns = {row[1] for row in cursor.fetchall()}

    expected_columns = {
        'user_id', 'telegram_handle', 'username', 'first_name', 'last_name',
        'language_code', 'is_bot', 'team_role', 'group_connections',
        'created_at', 'updated_at'
    }

    missing_columns = expected_columns - columns
    if missing_columns:
        print(f"   ✗ Missing columns: {missing_columns}")
        return False
    else:
        print(f"   ✓ All expected columns present: {expected_columns}")

    # Test creating a user with comprehensive data
    print("\n3. Testing comprehensive user tracking...")
    try:
        test_user = db.track_user(
            user_id=999888777,
            username="test_user",
            first_name="John",
            last_name="Doe",
            language_code="en",
            is_bot=False,
            group_id=-1001234567890,
            team_role="Driver"
        )
    except Exception as e:
        print(f"   ✗ Error tracking user: {e}")
        import traceback
        traceback.print_exc()
        return False

    if test_user:
        print(f"   ✓ User tracked successfully: {test_user['user_id']}")
        print(f"     - Username: {test_user['username']}")
        print(f"     - First name: {test_user['first_name']}")
        print(f"     - Last name: {test_user['last_name']}")
        print(f"     - Language: {test_user['language_code']}")
        print(f"     - Team role: {test_user['team_role']}")
        print(f"     - Group connections: {test_user['group_connections']}")
        print(f"     - Created at: {test_user['created_at']}")
    else:
        print("   ✗ Failed to track user")
        return False

    # Test adding another group connection
    print("\n4. Testing group connection tracking...")
    updated_user = db.track_user(
        user_id=999888777,
        username="test_user",
        first_name="John",
        last_name="Doe",
        group_id=-1009876543210  # Different group
    )

    if len(updated_user['group_connections']) == 2:
        print(f"   ✓ Group connections updated: {updated_user['group_connections']}")
    else:
        print(f"   ✗ Expected 2 groups, got {len(updated_user['group_connections'])}")
        return False

    # Test user without role
    print("\n5. Testing user without team role...")
    regular_user = db.track_user(
        user_id=111222333,
        username="regular_joe",
        first_name="Joe",
        last_name="Regular",
        language_code="en",
        is_bot=False,
        group_id=-1001234567890
    )

    if regular_user['team_role'] is None:
        print(f"   ✓ User without role tracked: {regular_user['user_id']}")
        print(f"     - No team role assigned (as expected)")
    else:
        print(f"   ✗ Expected no role, got {regular_user['team_role']}")
        return False

    # Test role preservation (higher role should be preserved)
    print("\n6. Testing role preservation...")
    # First set as Driver
    db.track_user(user_id=444555666, username="role_test", team_role="Driver")
    # Then try to set as Dispatcher (higher role)
    db.track_user(user_id=444555666, username="role_test", team_role="Dispatcher")
    final_user = db.get_user(444555666)

    if final_user['team_role'] == "Dispatcher":
        print(f"   ✓ Role updated from Driver to Dispatcher")
    else:
        print(f"   ✗ Expected Dispatcher, got {final_user['team_role']}")
        return False

    # Test backward compatibility with legacy upsert_user
    print("\n7. Testing backward compatibility with legacy upsert_user...")
    db.upsert_user(777888999, "@legacy_user", "OpsManager")
    legacy_user = db.get_user(777888999)

    if legacy_user and legacy_user['team_role'] == "OpsManager":
        print(f"   ✓ Legacy upsert_user still works")
        print(f"     - User ID: {legacy_user['user_id']}")
        print(f"     - Handle: {legacy_user['telegram_handle']}")
        print(f"     - Role: {legacy_user['team_role']}")
    else:
        print("   ✗ Legacy upsert_user failed")
        return False

    # Clean up test data
    print("\n8. Cleaning up test data...")
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE user_id IN (999888777, 111222333, 444555666, 777888999)")
        print(f"   ✓ Removed test users")

    print("\n" + "=" * 60)
    print("All tests passed! ✓")
    print("=" * 60)
    return True

if __name__ == "__main__":
    try:
        success = test_migration_and_tracking()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
