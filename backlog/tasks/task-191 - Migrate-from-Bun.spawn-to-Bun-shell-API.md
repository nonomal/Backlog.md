---
id: task-191
title: Migrate from Bun.spawn to Bun shell API
status: To Do
assignee: []
created_date: '2025-07-15'
labels:
  - refactoring
  - developer-experience
dependencies: []
priority: medium
---

## Description

The codebase currently uses Bun.spawn for executing shell commands, particularly in git operations and test utilities. Bun's shell API offers a cleaner, more maintainable approach with better cross-platform support and simplified error handling.

## Acceptance Criteria

- [ ] All Bun.spawn usage replaced with Bun.$ shell API
- [ ] Git operations work correctly with the new implementation
- [ ] Tests pass with the new implementation
- [ ] Error handling maintains current behavior
- [ ] Cross-platform compatibility is preserved
