---
id: task-24.1
title: 'CLI: Kanban board milestone view'
status: Done
assignee:
  - Codex
created_date: '2025-06-09'
labels: []
dependencies: []
parent_task_id: task-24
---

## Description

Add a backlog board view --milestones or -m to view the board based on milestones

## Acceptance Criteria

- [x] `backlog board view --milestones` or `-m` groups tasks by milestone
- [x] Documentation updated if necessary

## Implementation Notes

- Added `-m, --milestones` flag to `backlog board view` in `src/cli.ts`.
- When enabled the command maps each task's `milestone` to its `status` and then
  calls `renderBoardTui()` so the interactive blessed board works the same for
  milestones as it does for statuses.
- Introduced a small `generateMilestoneBoard` helper in `src/board.ts` (used in
  tests and export logic) that reuses `generateKanbanBoard()`.
- Updated `readme.md` with a usage example for the new option.
