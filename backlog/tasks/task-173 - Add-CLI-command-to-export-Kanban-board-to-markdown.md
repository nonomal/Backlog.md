---
id: task-173
title: Add CLI command to export Kanban board to markdown
status: To Do
assignee: []
created_date: '2025-07-12'
labels: []
dependencies: []
---

## Description

Provide a CLI command to export the current Kanban board to a markdown document. This enables users to easily share the board state, create reports, archive board snapshots, or store board data in version control. The exported markdown should be well-formatted and human-readable, containing all board columns and tasks with their essential metadata.

The command should handle edge cases gracefully and provide clear feedback to users about the export process.

## Acceptance Criteria

### Core Functionality
- [ ] CLI command `backlog board export [file]` successfully creates a markdown file
- [ ] Default export path is `Backlog.md` when no file argument is given
- [ ] Command completes successfully and shows confirmation message with file path

### Markdown Format
- [ ] Exported markdown uses a table format with columns representing board columns
- [ ] Table has headers: "To Do", "In Progress", "Done" (or current board columns)
- [ ] Each task appears as a table cell with format: `**task-ID** - Task Title (Assignees: X, Labels: Y)`
- [ ] Empty columns show empty table cells
- [ ] File includes header with export timestamp and project name
- [ ] Table is properly formatted with markdown table syntax (aligned columns)

### Error Handling
- [ ] Command fails gracefully with clear error message for invalid file paths
- [ ] Command warns user when attempting to overwrite existing files
- [ ] User can force overwrite with `--force` flag without confirmation
- [ ] Handles special characters in task titles without breaking markdown format

### Edge Cases
- [ ] Works correctly with empty boards (no tasks)
- [ ] Handles tasks with no assignees, labels, or other optional fields
- [ ] Processes board columns in consistent order (To Do, In Progress, Done)

Example expected output format:
```markdown
# Kanban Board Export
Generated on: 2025-07-12 14:30:25
Project: MyProject

| To Do | In Progress | Done |
|-------|-------------|------|
| **task-5** - Implement user authentication (Assignees: @john, Labels: auth, backend) | **task-2** - Add dashboard UI (Assignees: @jane, Labels: frontend, ui) | **task-1** - Setup project structure (Assignees: @john, Labels: setup) |
| **task-3** - Fix login validation (Assignees: none, Labels: bug) | | |
```
