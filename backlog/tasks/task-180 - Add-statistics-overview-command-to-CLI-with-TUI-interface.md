---
id: task-180
title: Add statistics overview command to CLI with TUI interface
status: To Do
assignee: []
created_date: '2025-07-12'
labels: []
dependencies: []
priority: medium
---

## Description

Create a new backlog overview command that displays project statistics including tasks in progress, priority breakdown, status distribution, and other key metrics using an interactive TUI interface.

## Acceptance Criteria

- [ ] Add new overview command to CLI (backlog overview)
- [ ] Display count of tasks in each status (To Do In Progress Done)
- [ ] Show priority breakdown (High Medium Low None)
- [ ] Display total task count and completion percentage
- [ ] Show recent activity (recently created/updated tasks)
- [ ] Use interactive TUI interface with proper formatting
- [ ] Include navigation between different stat views
- [ ] Handle empty project state gracefully
- [ ] Add command to help documentation
- [ ] Update README with overview command usage

## Implementation Plan

1. Add overview command to CLI parser
2. Create statistics calculation functions:
   - Count tasks by status
   - Count tasks by priority  
   - Calculate completion percentages
   - Find recent activity
3. Design TUI layout for statistics display
4. Implement interactive TUI interface:
   - Main stats view
   - Detailed breakdowns
   - Navigation between views
5. Add proper formatting and styling
6. Handle edge cases (no tasks empty priorities)
7. Add keyboard shortcuts and help
8. Update CLI help and README documentation
9. Add tests for statistics calculations

## Implementation Notes

STATISTICS TO DISPLAY:
Status Overview:
- To Do: X tasks
- In Progress: X tasks  
- Done: X tasks (Y% complete)
- Total: X tasks

Priority Breakdown:
- High: X tasks
- Medium: X tasks
- Low: X tasks
- None: X tasks

Recent Activity:
- Recently created (last 7 days)
- Recently updated (last 7 days)
- Most active status transitions

Project Health:
- Completion rate trend
- Average task age
- Blocked/stale tasks

TUI INTERFACE:
- Main dashboard view
- Tab navigation between sections
- Scrollable lists for detailed breakdowns
- Keyboard shortcuts (q=quit h=help arrows=navigate)
- Responsive layout for terminal size
- Color coding for different priorities/statuses

TECHNICAL APPROACH:
- Reuse existing task loading logic
- Add statistics calculation utilities
- Use blessed/bblessed for TUI rendering
- Follow existing TUI patterns from board view
- Cache calculations for performance
