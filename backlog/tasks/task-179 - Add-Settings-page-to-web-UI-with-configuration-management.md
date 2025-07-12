---
id: task-179
title: Add Settings page to web UI with configuration management
status: To Do
assignee: []
created_date: '2025-07-12'
labels: []
dependencies: []
priority: medium
---

## Description

Add a Settings button to the bottom left corner of the side navigation menu. Create a comprehensive Settings page that displays all Backlog configuration options with appropriate input controls. Users should be able to view and modify configuration values with proper validation and feedback.

## Acceptance Criteria

- [ ] Add Settings button at the bottom left of the side navigation menu
- [ ] Create /settings route in the web UI with proper navigation
- [ ] Add GET /api/config endpoint to retrieve current configuration
- [ ] Add PUT /api/config endpoint to update configuration values
- [ ] Display all configuration options organized into logical groups
- [ ] Use toggle switches for boolean settings (autoCommit autoOpenBrowser remoteOperations)
- [ ] Use text inputs for string settings (projectName defaultEditor backlogDirectory)
- [ ] Use number inputs for numeric settings (maxColumnWidth defaultPort)
- [ ] Use select dropdowns for predefined options (dateFormat)
- [ ] Show current values for all configuration fields
- [ ] Validate input values (port ranges editor availability etc)
- [ ] Provide save and cancel functionality with user feedback
- [ ] Show success/error messages for configuration updates
- [ ] Highlight Settings in navigation when active
- [ ] Maintain consistent layout and styling with existing pages
- [ ] Handle configuration loading and saving errors gracefully

## Implementation Plan

1. Add Settings button to SideNavigation component
2. Create Settings page component with form layout
3. Organize configuration into logical groups:
   - Project Settings (name directory date format)
   - Workflow Settings (autoCommit defaultStatus defaultEditor)
   - Web UI Settings (port autoOpenBrowser)
   - Advanced Settings (remoteOperations maxColumnWidth)
4. Implement GET /api/config endpoint in server
5. Implement PUT /api/config endpoint with validation
6. Create appropriate input components for each config type
7. Add form state management and validation
8. Implement save/cancel functionality
9. Add success/error notification system
10. Update navigation routing and highlighting
11. Test all configuration changes end-to-end

## Implementation Notes

CONFIGURATION GROUPS:
Project Settings:
- projectName (text input)
- backlogDirectory (text input) 
- dateFormat (select: yyyy-mm-dd dd/mm/yyyy mm/dd/yyyy)

Workflow Settings:
- autoCommit (toggle switch)
- defaultStatus (select from statuses array)
- defaultEditor (text input with validation)

Web UI Settings:
- defaultPort (number input 1-65535)
- autoOpenBrowser (toggle switch)

Advanced Settings:
- remoteOperations (toggle switch)
- maxColumnWidth (number input)
- taskResolutionStrategy (select: most_recent most_progressed)

INPUT VALIDATION:
- Port numbers: 1-65535 range
- Editor commands: validate availability
- Directory paths: valid path format
- Project name: non-empty string

USER EXPERIENCE:
- Clear section headers and descriptions
- Inline validation with error messages
- Save/Cancel buttons with loading states
- Toast notifications for success/error
- Unsaved changes warning
- Reset to defaults option

API CONSIDERATIONS:
- Return only user-configurable fields
- Validate all input server-side
- Handle partial updates gracefully
- Maintain config file format consistency
