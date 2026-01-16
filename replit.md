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
│   │   │   │   └── stats-header.tsx        # Statistics display
│   │   │   ├── app-sidebar.tsx             # Navigation sidebar
│   │   │   └── theme-toggle.tsx            # Dark/light mode toggle
│   │   ├── lib/
│   │   │   ├── timetable-utils.ts          # Validation & utility functions
│   │   │   └── sample-data.ts              # Sample teacher data
│   │   └── pages/
│   │       ├── home.tsx                    # Main timetable builder
│   │       ├── teachers.tsx                # Teacher management
│   │       ├── dashboard.tsx               # Analytics & reports
│   │       ├── settings.tsx                # Configuration
│   │       └── help.tsx                    # Documentation
├── server/                    # Express backend
│   ├── routes.ts              # API endpoints
│   └── storage.ts             # In-memory data storage
└── shared/
    └── schema.ts              # Shared TypeScript types & constants
```

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
2. **Fatigue Limit**: Max 5 consecutive teaching periods per teacher per day
3. **Break Enforcement**: Double periods cannot cross breaks
4. **No Doubles in P8/P9**: Double periods restricted to earlier slots
5. **English-Security Rule**: Security cannot follow English immediately
6. **Period Quotas**: Tracks weekly allocation per subject

### Slash Subjects (SS2/SS3 only)
Paired subjects scheduled simultaneously:
- Physics / Literature (4 periods each)
- Chemistry / Government (4 periods each)
- Agric / CRS (3 periods each)

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI
- **Backend**: Express.js, Node.js
- **State Management**: React useState/useCallback
- **Routing**: Wouter
- **Charts**: Recharts (for dashboard analytics)

## Development

The application runs with `npm run dev` which starts both the Express backend and Vite frontend on port 5000.

### API Endpoints
- `GET /api/teachers` - List all teachers
- `POST /api/teachers` - Create a teacher
- `PATCH /api/teachers/:id` - Update a teacher (name, subjects, classes, unavailability)
- `DELETE /api/teachers/:id` - Delete a teacher
- `GET /api/timetable` - Get full timetable
- `POST /api/timetable/validate` - Validate a placement (enforces all scheduling rules)
- `POST /api/timetable/place` - Place a subject (validates before placing)
- `DELETE /api/timetable/:day/:class/:period` - Remove a subject
- `GET /api/actions` - Get action history

### Undo/Redo
Undo/redo functionality is implemented on the frontend for session-based state management. The backend tracks actions for audit purposes but does not provide undo/redo endpoints since the frontend maintains authoritative state for immediate user feedback.

## User Preferences

- Dark mode toggle available in header
- Sidebar navigation for different sections
- Collapsible teacher cards for workload details
