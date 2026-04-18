# School Timetable Builder

A web-based timetable builder with live constraint validation for school administrators. The system maintains a live master grid and automatically enforces teacher availability and scheduling rules.

## Overview

This application allows school administrators to create weekly timetables for multiple classes (JSS1-JSS3, SS1-SS3) while automatically preventing:
- Teacher clashes (same teacher in multiple classes simultaneously)
- Teacher fatigue (more than 5 consecutive teaching periods)
- Break violations (double periods crossing breaks)
- Schedule conflicts and rule violations

## Project Structure

```
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── timetable/    # Timetable-specific components
│   │   │   │   ├── timetable-grid.tsx      # Main grid display
│   │   │   │   ├── timetable-cell.tsx      # Individual cell component
│   │   │   │   ├── placement-dialog.tsx    # Subject scheduling dialog
│   │   │   │   ├── teacher-sidebar.tsx     # Teacher workload display
│   │   │   │   ├── subject-tracker.tsx     # Weekly allocation tracker
│   │   │   │   ├── action-history.tsx      # Undo/redo history
│   │   │   │   ├── stats-header.tsx        # Statistics display
│   │   │   │   └── auto-generate-dialog.tsx # Auto-generation dialog
│   │   │   ├── app-sidebar.tsx             # Navigation sidebar
│   │   │   └── theme-toggle.tsx            # Dark/light mode toggle
│   │   ├── hooks/
│   │   │   └── use-auth.ts                 # Authentication hook
│   │   ├── lib/
│   │   │   └── timetable-utils.ts          # Validation & utility functions
│   │   └── pages/
│   │       ├── home.tsx                    # Main timetable builder
│   │       ├── landing.tsx                 # Landing page for logged-out users
│   │       ├── teachers.tsx                # Teacher management
│   │       ├── dashboard.tsx               # Analytics & reports
│   │       ├── settings.tsx                # Configuration
│   │       └── help.tsx                    # Documentation
├── server/                    # Express backend
│   ├── db.ts                  # Database connection (Drizzle + PostgreSQL)
│   ├── routes.ts              # API endpoints (protected by auth)
│   ├── storage.ts             # DatabaseStorage implementation
│   └── replit_integrations/   # Replit integration modules
│       └── auth/              # Authentication via Replit OpenID Connect
└── shared/
    ├── schema.ts              # Shared TypeScript types & database schema
    └── models/
        └── auth.ts            # User type definitions
```

## Authentication

Self-hosted authentication (no Replit dependency). Two methods:
- **Google OAuth 2.0** via `passport-google-oauth20` (requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`).
- **Email + password** via `passport-local`, with bcrypt-hashed passwords (`bcryptjs`, 12 rounds).

Sessions are stored in PostgreSQL via `connect-pg-simple` and signed with `SESSION_SECRET`.
The `users` table has `passwordHash` (nullable) and `googleId` (nullable, unique) columns; users may be linked to either or both providers via email matching.

Auth endpoints:
- `POST /api/auth/register` — create a new email/password account and log in.
- `POST /api/auth/login` — sign in with email/password.
- `GET /api/auth/google` — start Google OAuth flow.
- `GET /api/auth/google/callback` — Google OAuth callback.
- `GET /api/login` — legacy redirect to `/api/auth/google`.
- `GET|POST /api/logout` — clears session.
- `GET /api/auth/user` — returns current user.

All data is user-scoped — each user has isolated timetables, teachers, and settings.

See `DEPLOYMENT.md` for self-hosting instructions (VPS, Nginx, Postgres, TLS).

New users start with an empty workspace — no preset subjects, quotas, or sample teachers. Everything is created by the user from the Settings and Teachers pages.

## Database Schema

PostgreSQL with Drizzle ORM. Tables:
- `users` - User accounts (managed by auth)
- `sessions` - Session storage (managed by auth)
- `teachers` - Teacher profiles with subjects, classes, unavailability (user-scoped)
- `timetable_slots` - Individual period assignments (user-scoped)
- `timetable_actions` - Action history for audit (user-scoped)
- `subject_quotas` - Period allocations per subject (user-scoped)
- `subjects` - Custom subject definitions with per-class quotas (user-scoped)
- `user_settings` - User preferences including fatigue limit (user-scoped)

## Key Features

### Schedule Configuration
- **Classes**: JSS1, JSS2, JSS3, SS1, SS2, SS3
- **Days & Periods**:
  - Monday/Wednesday/Thursday: P1-P9
  - Tuesday: P1-P7
  - Friday: P1-P6
- **Breaks**: After P4 (all days), After P7 (Mon-Thu)

### Validation Rules
1. **Teacher Clash Prevention**: A teacher cannot teach two classes simultaneously
2. **Fatigue Limit**: Configurable max consecutive teaching periods per teacher per day (default: 5, range: 1-10)
3. **Break Enforcement**: Double periods cannot cross breaks
4. **No Doubles in P8/P9**: Double periods restricted to earlier slots
5. **Period Quotas**: Tracks weekly allocation per subject
6. **Subject-Class Mapping**: Teachers can be assigned to teach specific subjects to specific classes only
7. **Daily Occurrence Rule**: Each subject can only appear once per day per class

### Subjects
Users create and manage all subjects in the Settings page with:
- Subject name (must be unique)
- Per-class-level period quotas (JSS, SS1, SS2/SS3)
- Every subject is fully editable and deletable
- Subjects sync with subject quotas for timetable validation

### Slash Subjects
Paired subjects that share a single timetable slot (scheduled simultaneously). Slash pairings are user-configurable from the Settings page — toggle "Slash subject" on a subject and pick its partner from the dropdown. Pairings are mirrored bidirectionally and exclusively in a single transaction (changing or deleting one side automatically clears the partner's back-pointer). No subject pairs are hardcoded.

For users already running an earlier version, run `scripts/seed-default-slash-pairs.sql` once after deploying to restore the legacy Physics/Literature, Chemistry/Government, and Agric/CRS pairings (idempotent; only touches users who haven't customized their pairings).

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI
- **Backend**: Express.js, Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Replit Auth (OpenID Connect)
- **State Management**: React useState/useCallback, TanStack Query
- **Routing**: Wouter
- **Charts**: Recharts (for dashboard analytics)

## Development

The application runs with `npm run dev` which starts both the Express backend and Vite frontend on port 5000.

### Database Commands
- `npm run db:push` - Sync schema to database

### API Endpoints

All API endpoints require authentication (except `/api/login`, `/api/logout`, `/api/auth/user`).

**Auth:**
- `GET /api/auth/user` - Get current user info
- `GET /api/login` - Redirect to login page
- `GET /api/logout` - Log out and redirect to home

**Teachers:**
- `GET /api/teachers` - List all teachers (user-scoped)
- `POST /api/teachers` - Create a teacher
- `PATCH /api/teachers/:id` - Update a teacher
- `DELETE /api/teachers/:id` - Delete a teacher

**Timetable:**
- `GET /api/timetable` - Get full timetable (user-scoped)
- `POST /api/timetable/validate` - Validate a placement
- `POST /api/timetable/place` - Place a subject
- `DELETE /api/timetable/:day/:class/:period` - Remove a subject
- `POST /api/timetable/autogenerate` - Auto-generate timetable

**Quotas:**
- `GET /api/quotas` - Get subject period quotas (user-scoped)
- `PATCH /api/quotas/:subject` - Update a subject's quota

**History:**
- `GET /api/actions` - Get action history (user-scoped)

### Undo/Redo
Undo/redo functionality is implemented on the frontend for session-based state management. The backend tracks actions for audit purposes but does not provide undo/redo endpoints since the frontend maintains authoritative state for immediate user feedback.

## User Preferences

- Dark mode toggle available in header
- User profile menu with avatar and logout
- Sidebar navigation for different sections
- Collapsible teacher cards for workload details
- Data persists across sessions (stored in database)
