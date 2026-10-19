# Telegram task lookup — October 16, 2026

## Failure

The bot received the question “nay có việc nào chưa hoàn thành vậy”, but treated it as generic chat. The classifier's prompt had no task data. Its generated reply claimed there was no task data even though the reminder endpoint had read three open tasks earlier that day. `/today` and `/overdue` were also placeholders rather than database reads.

## Change

- A shared read-only task query router now serves Telegram and web chat.
- `/today`, `/tasks`, `/overdue`, `/tomorrow`, `/week`, `/doing`, `/done` and common Vietnamese task questions read D1 directly. No LLM call, Inbox insertion, schema mutation or task status change is needed.
- Today includes tasks planned or due today, overdue tasks and currently doing tasks. Unscheduled/future tasks remain available through `/tasks`; empty Today replies explain this distinction.
- Date and completion selection use Asia/Ho_Chi_Minh. Past deadlines are labeled overdue; an empty query result is distinct from a database error.
- All reads bind the authenticated web owner or configured Telegram owner. Project joins enforce owner equality. Telegram chat ID is checked inside the shared handler, including polling callers. An ambiguous multi-owner fallback fails closed rather than selecting the first owner.
- Results include current status, deadline/planned date and project, with exact totals and a bounded reply suitable for Telegram.
- Capture instructions, completion statements and general definitions remain outside this read-only router.

## Validation

`scripts/check-task-assistant.cjs` exercises the reported question through the actual Telegram and web handlers with a D1 test double. It covers accent-insensitive questions, commands, capture exclusions, statuses, deleted tasks, Vietnam midnight and timezone offsets, overdue dates, legacy completed tasks, reply length, owner/chat isolation, unauthenticated web access and database failure. It asserts no outbound LLM fetch and no database writes.

The live database was inspected read-only: the three non-deleted tasks in the screenshot remained `todo`. Recent Worker error logs were empty, consistent with a logic defect rather than a failed webhook request. No test messages were sent to Telegram. End-to-end delivery after deployment requires a new incoming Telegram message.
