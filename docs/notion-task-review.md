# Task planning review — 2026-10-13

## Reference model

Official Notion references:
- https://www.notion.com/help/views-filters-and-sorts
- https://www.notion.com/help/calendars
- https://www.notion.com/help/guides/give-your-to-dos-a-home-with-task-databases
- https://www.notion.com/help/tasks-and-dependencies

Notion uses database records, properties and views. Calendar is a view over a selected date property; board groups the same records by status. Views have filters, sort order and visible properties. Project relations connect task records to project pages. Sub-items and dependencies are additional models, not decorations.

## Loop 1: compare and implement

| Criterion | Earlier Flowdesk | Implemented |
|---|---|---|
| Shared working views | Separate Today/list/calendar components | One TaskWorkbench for Today, week, all, board and calendar |
| Calendar allocation | Month cells with limited controls; mobile plain list | Month/week grid, select day, agenda, create with selected date, desktop drag/drop |
| Mobile | No visible calendar grid | Default weekly strip, month option, status dots, selected-day agenda |
| Editing | Full task sent even when changing one property | Partial update API; inline project, priority, status and planned date |
| Completion | One-click supported only in some views | Checkbox on rows and cards; server completion stamp; undo |
| View controls | Inconsistent filter context | Project/status/priority, sort, property visibility; device-local preferences |
| Task details | Text-based checklist and no delete affordance after list replacement | Side drawer, editable checkbox steps, linked notes, history, reversible trash |

## Loop 2: detect and correct

- Fixed rolling 7-day period: week now starts Monday and ends Sunday.
- Normalized dated deadlines to Asia/Ho_Chi_Minh; explicit ISO offset dates cross midnight correctly.
- Distinguished date-only deadlines from expired time-specific deadlines.
- Preserved wall-clock time when moving a timed deadline to another day.
- Validated actual dates, including leap years; rejected nonexistent dates.
- Preserved unrelated task fields with partial edits.
- Enforced maximum 3 doing tasks using guarded SQL in partial updates and upserts.
- Added database triggers for status/planned-date history, including non-web writers; identical changes do not add duplicate history.
- Restored trash access and explicit save/error states in task details.
- Clearing a deadline now removes its previously synced Google Calendar event.
- Unscheduled tray follows the calendar's selected date property.

## Validation

- TypeScript type check.
- scripts/check-task-planning.cjs: Vietnam timezone, week boundaries, month/year rollover, leap dates, all-day/time-based overdue, rescheduling time preservation, immutable sorting, server-rendered calendar controls.
- SQLite in-memory application of all migrations; exercised actual guarded upsert SQL, completion/reopen, history deduplication, partial-field preservation and owner isolation.
- Production build and Sites deployment.

Browser-based visual and pointer/touch interaction validation remains unverified: the required managed control-browser skill is unavailable in this session. Static render checks do not replace testing on an actual Android device.

## Remaining distance from Notion

This is a focused personal task database, not full Notion parity. It has not implemented arbitrary user-created database views, advanced nested AND/OR filters, timeline durations, parent/sub-item task records, dependency-driven date shifting, assignees/team permissions or server-synced view preferences. Checklist steps are not independent task records. Desktop drag/drop has an inline date-edit alternative on mobile.

History records changes after rollout; historical daily plans are not reconstructed snapshots. Calendar shows current allocation; daily completion uses the recorded completion timestamp. Existing completed tasks without a known timestamp stay visible under All rather than inventing a completion date.
