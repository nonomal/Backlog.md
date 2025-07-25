---
id: task-200
title: Add Claude Code integration with workflow commands during init
status: To Do
assignee: []
created_date: '2025-07-23'
updated_date: '2025-07-23'
labels:
  - enhancement
  - developer-experience
dependencies: []
priority: medium
---

## Description

Enable users to leverage Claude Code's custom commands feature by generating a .claude directory with pre-configured workflow prompts when running 'backlog init'. This will streamline common backlog.md workflows like parsing PRDs, planning tasks, managing branches, and conducting code reviews.

Based on contribution from PR #235: https://github.com/MrLesk/Backlog.md/pull/235

## Acceptance Criteria

- [ ] Claude Code template files are stored in src/templates/claude/
- [ ] backlog init copies .claude directory to user's project with workflow commands
- [ ] Commands include: parse-prd, plan-task, suggest-next-task, daily-standup, finish-task, branch-status, cleanup-branches, milestone-review
- [ ] Generated claude.yaml references local workflow markdown files correctly
- [ ] Documentation updated to explain Claude Code integration
- [ ] init command prompts user whether to include Claude Code integration (similar to agent instructions)
- [ ] Init wizard asks user if they want to add Claude Code commands during setup
- [ ] If .claude/claude.yaml already exists, merge new commands intelligently (append new commands, preserve existing ones)

