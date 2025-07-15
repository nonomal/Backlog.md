---
id: task-195
title: Fix React Router deep linking for documentation and decisions pages
status: To Do
assignee:
  - '@kiro'
created_date: '2025-07-15'
labels:
  - bug
  - routing
  - react
  - ux
dependencies: []
---

## Description

When navigating to documentation or decisions pages through the sidebar, the pages load correctly. However, when copying the URL and opening it in a new tab or refreshing the page, the application fails to load the content and shows a blank page. This breaks deep linking functionality and makes it impossible to bookmark or share specific documentation/decision pages.

## Acceptance Criteria

- [ ] Direct URL navigation works for documentation pages
- [ ] Direct URL navigation works for decisions pages
- [ ] Page refresh maintains current content
- [ ] Bookmarking specific docs/decisions works correctly
- [ ] Shared URLs load the correct content in new tabs
- [ ] 404 handling for non-existent docs/decisions
