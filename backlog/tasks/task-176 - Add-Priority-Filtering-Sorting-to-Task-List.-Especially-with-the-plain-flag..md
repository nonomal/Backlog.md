---
id: task-176
title: Add Priority Filtering/Sorting to Task List. Especially with the --plain flag.
status: To Do
assignee: []
created_date: '2025-07-12'
labels:
  - enhancement
dependencies: []
---

## Description

The task list command currently supports filtering by status, assignee, and parent, but there's no way to filter or sort tasks by priority. When working with many tasks, it's difficult to quickly identify high-priority items that need immediate attention. Extend the existing backlog task list command with priority options: --priority high, --sort priority, and combine with existing filters. Also add priority indicators to the web interface's task cards and enable filtering by priority in the Kanban board view.

## Acceptance Criteria

- [ ] Add --priority filter option to task list command
- [ ] Add --sort priority option to task list command
- [ ] Support combining priority filters with existing filters
- [ ] Add priority indicators to web interface task cards
- [ ] Enable priority filtering in Kanban board view
- [ ] Works correctly with --plain flag for AI integration
