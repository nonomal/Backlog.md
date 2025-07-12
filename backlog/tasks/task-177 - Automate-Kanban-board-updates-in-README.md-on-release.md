---
id: task-177
title: Automate Kanban board updates in README.md on release
status: To Do
assignee: []
created_date: '2025-07-12'
labels: []
dependencies: []
priority: medium
---

## Description

Create a GitHub Action that automatically updates the main README.md file with the current Kanban board status when a new release is created. The board content should be inserted in a dedicated section above the License section, replacing any previous board content.

## Acceptance Criteria

- [ ] Workflow triggers on release created events
- [ ] Workflow runs backlog board export to generate board content
- [ ] Add --readme flag to board export command for README integration
- [ ] Find and replace content between <\!-- BOARD_START --> and <\!-- BOARD_END --> markers in README.md
- [ ] Create section above License if markers don't exist
- [ ] Commit updated README.md back to repository using github-actions bot
- [ ] Handle edge cases like missing markers or malformed README
- [ ] Add documentation explaining automated README updates
- [ ] Ensure no conflicts with existing README content

## Implementation Plan

1. Extend board export command with --readme flag
2. Implement README section detection and replacement logic  
3. Add marker-based content injection (<\!-- BOARD_START --> / <\!-- BOARD_END -->)
4. Handle positioning above License section
5. Add new job to existing .github/workflows/release.yml workflow  
6. Configure job to run after build completion
7. Setup Bun environment and dependencies
8. Configure github-actions bot for commits
9. Add error handling for edge cases
10. Update project documentation

## Implementation Notes

IMPLEMENTATION APPROACH:
- Extend board export command rather than post-processing in workflow
- Use HTML comment markers for reliable section detection
- Position board section above License for better visibility
- Trigger on release creation instead of every push to reduce noise
- Use github-actions[bot] for automated commits

TECHNICAL CONSIDERATIONS:
- Need robust README parsing to avoid corrupting existing content
- Handle cases where License section doesn't exist
- Ensure markers are properly formatted and detectable
- Consider README encoding and line ending compatibility
- Add safeguards against infinite commit loops

WORKFLOW INTEGRATION:
- Add new job to existing .github/workflows/release.yml (triggers on tag pushes)  
- Reuse existing Bun setup and dependencies
- Run after build job completes (needs: build)
- Leverage existing permissions and environment
- Keep release-related automation in single workflow
