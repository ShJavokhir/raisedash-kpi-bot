"""
Test script to verify Sentry integration is working correctly.

This script tests:
1. Sentry initialization
2. Error capture
3. Breadcrumb tracking
4. Context setting
5. User context tracking
"""

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from sentry_config import SentryConfig

def test_sentry_integration():
    """Test Sentry integration."""
    print("=" * 60)
    print("Testing Sentry Integration")
    print("=" * 60)

    # Test 1: Initialize Sentry
    print("\n1. Testing Sentry Initialization...")
    dsn = os.getenv('SENTRY_DSN')
    if not dsn:
        print("   ⚠️  SENTRY_DSN not configured - Sentry will be disabled")
        print("   ℹ️  Set SENTRY_DSN in .env to enable Sentry")
        return

    SentryConfig.initialize(
        dsn=dsn,
        environment=os.getenv('SENTRY_ENVIRONMENT', 'development'),
        traces_sample_rate=1.0,  # 100% for testing
        profiles_sample_rate=1.0,
        enable_profiling=True
    )
    print("   ✓ Sentry initialized successfully")

    # Test 2: Set user context
    print("\n2. Testing User Context...")
    SentryConfig.set_user_context(
        user_id=12345,
        username="test_user",
        role="Dispatcher",
        first_name="Test",
        last_name="User"
    )
    print("   ✓ User context set")

    # Test 3: Add breadcrumbs
    print("\n3. Testing Breadcrumbs...")
    SentryConfig.add_breadcrumb(
        message="Test breadcrumb - user clicked button",
        category="user_action",
        level="info",
        data={"button": "test_button", "incident_id": "TEST-001"}
    )
    print("   ✓ Breadcrumb added")

    # Test 4: Set custom context
    print("\n4. Testing Custom Context...")
    SentryConfig.set_context("test_incident", {
        "incident_id": "TEST-001",
        "status": "Claimed_T1",
        "created_at": "2025-01-01T00:00:00Z"
    })
    SentryConfig.set_tag("test_mode", "true")
    print("   ✓ Custom context set")

    # Test 5: Capture a test message
    print("\n5. Testing Message Capture...")
    SentryConfig.capture_message(
        "Sentry integration test - this is a test message",
        level="info",
        test="true"
    )
    print("   ✓ Test message captured")

    # Test 6: Capture a test exception
    print("\n6. Testing Exception Capture...")
    try:
        # Intentionally raise an exception
        raise ValueError("This is a test exception for Sentry integration verification")
    except Exception as e:
        SentryConfig.capture_exception(e, test="true", test_type="integration_test")
        print("   ✓ Test exception captured")

    # Test 7: Performance monitoring
    print("\n7. Testing Performance Monitoring...")
    transaction = SentryConfig.start_transaction(
        name="test_transaction",
        op="test"
    )
    if transaction:
        with transaction:
            # Simulate some work
            import time
            with SentryConfig.start_span(op="test.operation", description="Test operation"):
                time.sleep(0.1)
        print("   ✓ Performance transaction completed")
    else:
        print("   ⚠️  Performance monitoring not available")

    print("\n" + "=" * 60)
    print("✓ All tests completed successfully!")
    print("=" * 60)
    print("\nℹ️  Check your Sentry dashboard at https://sentry.io")
    print("   You should see:")
    print("   - 1 test message")
    print("   - 1 test exception")
    print("   - 1 performance transaction")
    print("   - User context (test_user)")
    print("   - Breadcrumb trail")
    print("=" * 60)

if __name__ == "__main__":
    test_sentry_integration()
