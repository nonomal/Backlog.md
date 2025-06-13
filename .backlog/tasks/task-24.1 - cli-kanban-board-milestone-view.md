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
- Tasks are mapped to their `milestone` field when this flag is used.
- Introduced `generateMilestoneBoard` helper in `src/board.ts` and tests for milestone grouping.
- Updated README with usage example.
