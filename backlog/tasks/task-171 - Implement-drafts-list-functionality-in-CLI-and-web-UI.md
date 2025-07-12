---
id: task-171
title: Implement drafts list functionality in CLI and web UI
status: To Do
assignee: []
created_date: '2025-07-12'
labels: []
dependencies: []
---

## Description

Add draft list functionality and promote draft actions to CLI and web UI. Include /api/drafts endpoint to web server to properly display drafts from backlog/drafts/ folder and enable promoting drafts to tasks.

## Acceptance Criteria

- [ ] CLI draft list command displays all drafts from backlog/drafts/ folder
- [ ] CLI draft promote command moves draft from drafts/ to tasks/ folder
- [ ] Web UI /api/drafts endpoint returns drafts from filesystem
- [ ] Web UI /api/drafts/:id/promote endpoint promotes draft to task
- [ ] Web UI drafts page shows actual draft files with proper navigation
- [ ] Web UI drafts page includes promote action button for each draft
- [ ] Drafts are read from folder location not filtered by status field
- [ ] Promoted drafts appear in tasks list and disappear from drafts list
