# Sentry Integration Documentation

## Overview

This Telegram bot now includes **enterprise-grade Sentry integration** for comprehensive error tracking, performance monitoring, and application observability. The integration provides:

- **Automatic error tracking** with rich context
- **Performance monitoring** for database operations and critical paths
- **User context tracking** for all interactions
- **Breadcrumb trails** for debugging user flows
- **Intelligent error filtering** to avoid spam
- **Release tracking** for deployments

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

This will install `sentry-sdk==2.18.0` along with other dependencies.

### 2. Configure Sentry

Add your Sentry DSN to your `.env` file:

```bash
# Sentry Error Tracking
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_ENVIRONMENT=production  # or staging, development
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1  # 10% profiling
```

**Important**: If `SENTRY_DSN` is not set or is empty, Sentry will be disabled (no errors will be thrown).

### 3. Environment-Specific Configuration

#### Production
```bash
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% sampling to reduce costs
SENTRY_PROFILES_SAMPLE_RATE=0.1
```

#### Staging
```bash
SENTRY_ENVIRONMENT=staging
SENTRY_TRACES_SAMPLE_RATE=0.5  # 50% sampling for better debugging
SENTRY_PROFILES_SAMPLE_RATE=0.5
```

#### Development
```bash
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=1.0  # 100% sampling for complete visibility
SENTRY_PROFILES_SAMPLE_RATE=1.0
```

## Features

### 1. Error Tracking

All exceptions are automatically captured with:
- Full stack traces
- User context (Telegram user ID, username, role)
- Incident context (incident ID, status, group)
- Database operation context
- Breadcrumb trails showing user actions

### 2. Performance Monitoring

Critical database operations are automatically instrumented:
- `create_incident` - Track incident creation performance
- `get_incident` - Monitor query performance
- `assign_incident_department` - Monitor department selection/transfer
- `claim_incident` - Track claim operations
- `resolve_incident` - Track resolution operations

### 3. User Context

Every user interaction is tracked with:
- Telegram user ID
- Username (if available)
- User role (Driver, Dispatcher, OpsManager)
- First/last name
- Language code
- Group ID where interaction occurred

### 4. Breadcrumb Trails

Sentry captures breadcrumbs for:
- Incident creation
- Department assignments/changes
- Claims and releases
- Resolutions
- Callback button clicks
- Command executions

### 5. Intelligent Error Filtering

The integration automatically filters out:
- Expected Telegram errors (RetryAfter, TimedOut, NetworkError)
- "Bot was blocked by the user" messages
- "Chat not found" errors
- "Message is not modified" errors (when message content hasn't changed)

### 6. Release Tracking

The integration automatically tracks releases using:
1. `SENTRY_RELEASE` environment variable (if set)
2. Git commit hash (if available)

Set releases explicitly:
```bash
export SENTRY_RELEASE="v1.2.3"
```

## Context Tags

Sentry automatically adds tags for filtering:
- `group_id` - Telegram group ID
- `incident_id` - Incident identifier
- `user_id` - Telegram user ID
- Additional custom tags per operation

## Usage Examples

### Manual Error Capture

```python
from sentry_config import SentryConfig

# Capture an exception with context
try:
    risky_operation()
except Exception as e:
    SentryConfig.capture_exception(e,
        operation="my_operation",
        user_id=user.id,
        incident_id=incident_id
    )
```

### Add Breadcrumbs

```python
from sentry_config import SentryConfig

SentryConfig.add_breadcrumb(
    message="User clicked resolve button",
    category="user_action",
    level="info",
    data={"incident_id": "0042", "user_id": 12345}
)
```

### Set Custom Context

```python
from sentry_config import SentryConfig

SentryConfig.set_context("payment", {
    "amount": 100.00,
    "currency": "USD",
    "method": "credit_card"
})
```

### Performance Monitoring

```python
from sentry_config import sentry_trace

@sentry_trace(op="database.query", description="Fetch user incidents")
def get_user_incidents(user_id):
    # Your code here
    pass
```

## Monitoring Best Practices

### 1. Set Alert Rules in Sentry

Configure alerts for:
- High error rates (> 10 errors/minute)
- New issues (first occurrence)
- Regression issues (previously resolved)
- Performance degradation (p95 > threshold)

### 2. Review Performance Trends

Monitor:
- Database query performance
- Incident creation time
- Resolution flow duration
- Reminder service execution time

### 3. Use Releases for Tracking

Tag releases to track:
- Which errors were introduced in which deployment
- Performance regressions between versions
- Issue resolution across releases

### 4. Filter Noise

The integration already filters common noise, but you can add more:

```python
# In sentry_config.py, modify _before_send_filter
@staticmethod
def _before_send_filter(event, hint):
    # Add custom filtering logic
    if some_condition:
        return None  # Drop the event
    return event
```

## Troubleshooting

### Sentry Not Capturing Errors

1. **Check DSN is set correctly**
   ```bash
   echo $SENTRY_DSN
   ```

2. **Verify initialization**
   Check logs for:
   ```
   INFO:sentry_config:Sentry initialized successfully for environment: production
   ```

3. **Test manually**
   ```python
   from sentry_config import SentryConfig
   SentryConfig.capture_message("Test message", level="info")
   ```

### Too Many Events

If you're hitting rate limits:

1. **Reduce sample rates** in `.env`:
   ```bash
   SENTRY_TRACES_SAMPLE_RATE=0.05  # 5%
   SENTRY_PROFILES_SAMPLE_RATE=0.05
   ```

2. **Add more filters** in `sentry_config.py`

### Missing Context

If events lack context:

1. **Ensure user tracking** is called:
   ```python
   self._track_user_interaction(user, group_id=chat.id)
   ```

2. **Add explicit context** before operations:
   ```python
   SentryConfig.set_tag("incident_id", incident_id)
   SentryConfig.set_context("incident", incident_data)
   ```

## Architecture

### Files Modified

1. **`sentry_config.py`** (NEW)
   - Core Sentry configuration
   - Helper functions for context/breadcrumbs
   - Error filtering logic
   - Decorators for performance monitoring

2. **`config.py`**
   - Added Sentry configuration variables

3. **`bot.py`**
   - Initialize Sentry on startup
   - Capture fatal errors

4. **`handlers.py`**
   - Track user context
   - Add breadcrumbs for user actions
   - Capture handler errors

5. **`database.py`**
   - Performance monitoring for queries
   - Error capture in connection manager

6. **`reminders.py`**
   - Error capture for background tasks
   - Context for reminder operations

### Data Flow

```
User Action (Telegram)
    ↓
handlers.py (track user, add breadcrumb)
    ↓
database.py (performance monitoring)
    ↓
Error occurs
    ↓
sentry_config.py (filter, enrich, send)
    ↓
Sentry Dashboard
```

## Security Considerations

1. **PII Protection**: `send_default_pii=False` prevents automatic PII collection
2. **Token Filtering**: Sensitive keys are automatically scrubbed from events
3. **Rate Limiting**: Sample rates prevent overwhelming Sentry

## Cost Optimization

Sentry pricing is based on:
- Number of errors captured
- Number of transactions (performance monitoring)
- Number of profiles

To optimize costs:
1. Use appropriate sample rates (10% in production is typical)
2. Filter expected errors aggressively
3. Use releases to identify and fix issues quickly
4. Set up proper alerts to catch issues early

## Metrics to Monitor

### Error Metrics
- Error rate (errors/minute)
- New vs. recurring errors
- Error types distribution
- Users affected

### Performance Metrics
- Database query duration (p50, p95, p99)
- Incident creation time
- Resolution flow duration
- Background task execution time

### User Metrics
- Active users
- Error rate per user
- Most common user flows
- Drop-off points

## Support

For issues with Sentry integration:
1. Check this documentation
2. Review Sentry logs in the application
3. Check Sentry dashboard for event details
4. Consult [Sentry Python SDK documentation](https://docs.sentry.io/platforms/python/)

## License

This Sentry integration follows the same license as the main project.
