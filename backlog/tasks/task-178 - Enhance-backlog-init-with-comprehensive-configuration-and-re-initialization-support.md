---
id: task-178
title: >-
  Enhance backlog init with comprehensive configuration and re-initialization
  support
status: To Do
assignee: []
created_date: '2025-07-12'
labels: []
dependencies: []
priority: high
---

## Description

Improve the backlog init command to prompt for key configuration options and support re-initialization with pre-selected values. Currently init only prompts for project name and agent files, missing important workflow settings. Re-running init overwrites existing configuration without preserving values.

## Acceptance Criteria

- [ ] Detect if project is already initialized and load existing config values
- [ ] Add prompts for key configuration fields during init
- [ ] Pre-select existing values when re-initializing a project
- [ ] Add autoCommit prompt with clear explanation of implications
- [ ] Add defaultEditor prompt with validation
- [ ] Add remoteOperations prompt for offline mode users
- [ ] Add web UI configuration prompts (port and auto-open)
- [ ] Preserve all non-prompted config values during re-init
- [ ] Show summary of configuration before saving
- [ ] Update tests to cover all new prompts and re-init scenarios
- [ ] Document the enhanced init process in README

## Implementation Plan

1. Modify init command to check for existing config.yml
2. Load existing config values if found
3. Add configuration prompts with intelligent defaults:
   - autoCommit (default: false, current value if re-init)
   - defaultEditor (detect from env/system, validate availability)
   - remoteOperations (default: true, explain offline implications)
   - Web UI settings (port/auto-open) if user wants them
4. Pre-populate prompts with existing values during re-init
5. Show configuration summary before saving
6. Preserve non-prompted fields (statuses, labels, etc.)
7. Update config migration to handle new fields
8. Add comprehensive tests for init and re-init flows
9. Update documentation

## Implementation Notes

CRITICAL IMPROVEMENTS:
- Non-destructive re-initialization preserves existing config
- Covers all important workflow preferences upfront
- Reduces need for manual config editing after init
- Better onboarding experience for new users

PROMPT STRATEGY:
- Group related prompts (e.g., web UI settings together)
- Show current value in prompt when re-initializing
- Provide sensible defaults based on environment
- Skip optional prompts if user wants minimal setup

FIELDS TO PROMPT FOR:
1. projectName (required)
2. autoCommit (workflow preference)
3. defaultEditor (if not set in env)
4. remoteOperations (for offline users)
5. Web UI config (optional group):
   - defaultPort
   - autoOpenBrowser

VALIDATION:
- Editor command availability
- Port number range (1-65535)
- Project name requirements

BACKWARDS COMPATIBILITY:
- Existing projects work without these fields
- Config migration handles missing fields
- Tests ensure no regression
