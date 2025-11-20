# KPI Dashboard - Frontend

A robust Next.js web interface for managing the Telegram bot's incident tracking system with company-based access control.

## Features

- **Company-Scoped Access**: Each company gets secure access via unique access keys
- **Full CRUD Operations**: Manage departments, users, groups, and incidents
- **Real-time Dashboard**: View KPIs, SLA metrics, and performance statistics
- **Incident Management**: Track incidents with timeline, participants, and detailed history
- **Department Management**: Create departments and manage team members
- **User Management**: View all users and their roles across the organization
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices

## Tech Stack

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first CSS framework
- **better-sqlite3** - Fast SQLite database access
- **jose** - JWT authentication and session management
- **Lucide React** - Beautiful icon library

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- The parent Telegram bot project with SQLite database

### Installation

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env.local
```

3. Edit `.env.local` and set a secure JWT secret:

```env
JWT_SECRET=your-secure-random-string-here
NODE_ENV=development
```

4. Run the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Creating Access Keys

Access keys must be created by platform administrators via the Python database. Here's how:

### Method 1: Python Script

Create a script `create_access_key.py` in the parent directory:

```python
from database import Database
import secrets
import string

def generate_access_key(length=32):
    """Generate a secure random access key."""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

db = Database('incidents.db')

# List companies
companies = db.list_companies()
for company in companies:
    print(f"ID: {company['company_id']}, Name: {company['name']}")

# Create access key for a company
company_id = int(input("Enter company ID: "))
description = input("Enter description (optional): ") or "Dashboard Access"

access_key = generate_access_key()
access_key_id = db.create_access_key(
    company_id=company_id,
    access_key=access_key,
    description=description
)

print(f"\n✅ Access key created successfully!")
print(f"Access Key ID: {access_key_id}")
print(f"Access Key: {access_key}")
print(f"\n⚠️  Save this key securely - it won't be shown again!")
```

Run it:

```bash
python create_access_key.py
```

## Project Structure

```
frontend/
├── app/
│   ├── api/              # API routes
│   ├── dashboard/        # Protected dashboard pages
│   ├── login/            # Login page
│   └── page.tsx          # Root redirect
├── lib/
│   ├── db.ts             # Database connection & types
│   ├── auth.ts           # Authentication utilities
│   └── utils.ts          # Helper functions
├── middleware.ts         # Route protection
└── README.md
```

## Authentication Flow

1. User enters access key on login page
2. System validates key against `company_access_keys` table
3. JWT session token created and stored in HTTP-only cookie
4. Middleware protects all dashboard routes
5. All API requests scoped to user's company

## API Endpoints

- **Auth**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`
- **Companies**: `/api/companies`
- **Departments**: `/api/departments`, `/api/departments/:id`, `/api/departments/:id/members`
- **Users**: `/api/users`, `/api/users/:id`
- **Groups**: `/api/groups`
- **Incidents**: `/api/incidents`, `/api/incidents/:id`
- **Stats**: `/api/stats`

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type check
npx tsc --noEmit
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | Secret for JWT signing | Yes |
| `NODE_ENV` | Environment mode | No |

## Troubleshooting

**Database not found**: Ensure the path in `lib/db.ts` points to the correct SQLite database location.

**Access key invalid**: Check if the key exists, is active, and hasn't expired in the `company_access_keys` table.

**Session issues**: Clear cookies and verify `JWT_SECRET` is set in `.env.local`.

## License

Proprietary - Internal use only
