---
id: task-203
title: Show meaningful description in web kanban
status: To Do
assignee: []
created_date: '2025-07-25'
labels:
  - frontend
  - enhancement
dependencies: []
priority: medium
---

## Description

Improve the web kanban board's task preview by removing the raw '## Description' header and displaying the actual task description content instead. This enhancement will make the web kanban view more informative and less cluttered.

Related to: https://github.com/MrLesk/Backlog.md/issues/233

## Acceptance Criteria

- [ ] Raw '## Description' header is stripped from task preview in web kanban view
- [ ] Actual task description content is displayed in web kanban cards
- [ ] Task preview shows meaningful context (first ~100-150 characters of description)
- [ ] Preview text is properly truncated with ellipsis if needed
- [ ] Web kanban view maintains clean visual appearance
