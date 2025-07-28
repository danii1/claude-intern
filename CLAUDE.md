# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is "Claude Intern" - an AI intern tool for automatically implementing JIRA tasks using Claude Code. It supports both single task processing and batch processing of multiple tasks through JQL queries or explicit task lists. The tool fetches JIRA task details, formats them for Claude, and automates the implementation workflow including git branch management and result posting back to JIRA.

## Development Commands

### Running
- `bun start [TASK-KEYS...]` - Run directly with Bun (single or multiple tasks)
- `bun run dev [TASK-KEYS...]` - Same as start (development mode)
- `bun start --jql "JQL_QUERY"` - Run with JQL query for batch processing
- `bun run build` - Build bundled version to `dist/` directory for distribution
- `bun run typecheck` - Type check the codebase without compilation
- `bun run clean` - Remove dist directory
- `bun test` - Run tests (when available)

### Installation and Distribution

#### NPM Installation (Recommended)
- `npm install -g claude-intern` - Install globally from npm
- `npx claude-intern [TASK-KEYS...]` - Run directly without installing
- `npm uninstall -g claude-intern` - Remove global installation

#### Local Development Setup
- `git clone https://github.com/danii1/claude-intern.git` - Clone repository
- `cd claude-intern` - Enter project directory
- `bun install` - Install dependencies
- `bun run build` - Build the project
- `bun start [TASK-KEYS...]` - Run directly with Bun
- `bun run install-global` - Build and install development version globally
- `bun run uninstall-global` - Remove development global installation
- `npm link` - Alternative: Create local symlink for testing npm distribution

## Architecture Overview

The application follows a modular TypeScript architecture optimized for Bun runtime during development and Node.js for distribution:

### Core Components

1. **Main Entry Point** (`src/index.ts`)
   - Bun shebang for direct execution
   - CLI argument parsing with Commander.js (supports variadic arguments and JQL queries)
   - Environment configuration loading from multiple locations
   - Orchestrates single task or batch processing workflows: fetch → format → git → claude → commit → jira

2. **JIRA Integration** (`src/lib/jira-client.ts`)
   - `JiraClient` class handles all JIRA API interactions
   - Supports JQL search queries for batch task discovery
   - Fetches issues, comments, attachments, and related work items
   - Posts implementation results and clarity assessments back to JIRA
   - Converts JIRA's Atlassian Document Format to readable text
   - Handles authentication with API tokens

3. **Claude Formatting** (`src/lib/claude-formatter.ts`)
   - `ClaudeFormatter` static class formats JIRA data for Claude consumption
   - Converts HTML and Atlassian Document Format to Markdown
   - Creates structured prompts with task context, related issues, and linked resources
   - Generates clarity assessment prompts for feasibility checking

4. **Utilities** (`src/lib/utils.ts`)
   - Git operations for branch creation and commit automation
   - Various helper functions for file handling and process management

5. **Type Definitions** (`src/types/`)
   - Comprehensive TypeScript interfaces for JIRA API responses
   - Internal data structures for formatted task details
   - Type safety throughout the application

### Key Workflow

1. **Fetch**: Retrieve JIRA task details including description, comments, linked resources, and related work items
2. **Format**: Convert JIRA data into Claude-readable markdown format with comprehensive context
3. **Branch**: Create feature branch named `feature/{task-key}`
4. **Assess**: Run optional clarity check to validate task implementability
5. **Implement**: Execute Claude Code with formatted task details and enhanced permissions
6. **Commit**: Automatically commit changes with descriptive message
7. **Push**: Push feature branch to remote repository (when creating PRs)
8. **PR Creation**: Optionally create pull requests on GitHub or Bitbucket
9. **Status Transition**: Automatically transition JIRA task status after successful PR creation (if configured)
10. **Report**: Post implementation summary back to JIRA task

### Batch Processing Workflow

For multiple tasks, the tool processes them sequentially with enhanced error handling:

1. **Task Discovery**: Use JQL queries or multiple task keys to identify work items
2. **Sequential Processing**: Each task follows the standard workflow above
3. **Error Isolation**: Failures in one task don't stop processing of remaining tasks
4. **Dynamic File Naming**: Output files are named uniquely for each task (e.g., `task-details-proj-123.md`)
5. **Progress Reporting**: Real-time progress updates with task indexing ([1/5], [2/5], etc.)
6. **Batch Summary**: Final report showing successful and failed tasks with error details

#### Batch Processing Features

- **JQL Query Support**: Full JIRA Query Language support with complex conditions
  - Custom fields: `cf[10016] <= 3`
  - Multiple values: `labels IN (FrontEnd, MobileApp)`
  - Status filtering: `status = "To Do"`
  - Project scoping: `project = "My Project"`
  - User assignments: `assignee = currentUser()`
  
- **Error Handling**: Robust error isolation and reporting
  - Failed tasks don't block remaining work
  - Detailed error messages for each failure
  - Continue-on-error strategy for batch operations
  - Comprehensive final summary with success/failure breakdown

- **File Management**: Smart output file handling
  - Dynamic naming prevents file conflicts
  - Separate files for each task enable parallel review
  - Consistent naming pattern: `{base-name}-{task-key-lowercase}.md`

- **Progress Tracking**: Real-time batch progress visibility
  - Task index indicators: `[3/10] Processing PROJ-456`
  - Individual task completion status
  - Overall batch completion statistics

### Environment Configuration

The tool loads `.env` files from multiple locations in priority order:
1. Custom path specified with `--env-file`
2. Current working directory
3. User home directory
4. Tool installation directory

Required environment variables:
- `JIRA_BASE_URL` - Your JIRA instance URL
- `JIRA_EMAIL` - Your JIRA email address  
- `JIRA_API_TOKEN` - JIRA API token for authentication

Optional environment variables for PR creation:
- `GITHUB_TOKEN` - GitHub personal access token for creating PRs
- `BITBUCKET_TOKEN` - Bitbucket app password for creating PRs

Optional environment variables for workflow automation:
- `JIRA_PR_STATUS` - JIRA status to transition task to after successful PR creation (e.g., "In Review", "Code Review")
- `CLAUDE_INTERN_OUTPUT_DIR` - Base directory for task files and attachments (default: `/tmp/claude-intern-tasks`)

### CLI Options and Features

- **Batch Processing**: Process multiple tasks sequentially
  - Multiple task keys: `claude-intern PROJ-123 PROJ-124 PROJ-125`
  - JQL queries: `--jql "project = PROJ AND status = 'To Do'"`
- **Task Processing**: `--no-claude` to skip Claude execution
- **Git Integration**: `--no-git` to skip branch creation
- **Clarity Assessment**: `--skip-clarity-check` to bypass feasibility analysis
- **Commit Control**: `--no-auto-commit` to skip automatic commits
- **PR Creation**: `--create-pr` to automatically create pull requests after implementation
- **PR Configuration**: `--pr-target-branch` to specify target branch (default: main)
- **Output Control**: `-v` for verbose logging
- **Claude Configuration**: `--claude-path` and `--max-turns` for customization

## Important Implementation Notes

### JIRA API Integration
- Uses JIRA REST API v3 with comprehensive error handling
- Supports both rendered HTML and Atlassian Document Format content
- Handles authentication edge cases and API token formats
- Fetches complete context including subtasks, parent tasks, epics, and linked issues

### Claude Integration
- Spawns Claude Code as subprocess with enhanced permissions (`-p --dangerously-skip-permissions`)
- Real-time output streaming to user while capturing for JIRA posting
- Detects completion status and max-turns errors
- Posts rich-text implementation summaries back to JIRA using Atlassian Document Format

### Git Automation
- Creates feature branches with consistent naming: `feature/{task-key-lowercase}`
- Handles existing branch scenarios gracefully
- Automated commit messages include task context
- Integrates with Claude Code workflow for seamless development

### Error Handling and Validation
- Comprehensive environment validation
- JIRA API authentication testing
- Claude CLI path resolution across platforms
- Graceful degradation when optional features fail

## Runtime and Dependencies

### Development & Distribution Strategy
- **Development**: Bun runtime for fast TypeScript execution without compilation
- **Distribution**: Bun bundler creates Node.js-compatible output for npm publishing
- **NPM Compatibility**: Built files run on standard Node.js for broad compatibility
- **Fast Development**: Direct TypeScript execution with Bun's native support
- **Universal Distribution**: Minified, single-file output works across Node.js environments

### Testing and Quality

Currently no automated test framework is configured. Manual testing involves:
1. Testing with various JIRA task types and configurations
2. Validating Claude integration with different task complexities
3. Verifying git operations in different repository states
4. Testing error scenarios and edge cases

## Global Usage Pattern

This tool can be installed globally via npm or used directly with npx from any project directory:

### Installation Options
```bash
# Install globally
npm install -g claude-intern

# Or use directly with npx (no installation needed)
npx claude-intern PROJ-123
```

### Single Task Processing
```bash
# Global installation
claude-intern PROJ-123  # Process single task

# With npx
npx claude-intern PROJ-123  # Process single task
```

### Multiple Task Processing
```bash
# Process multiple specific tasks
claude-intern PROJ-123 PROJ-124 PROJ-125

# Process tasks matching JQL query
claude-intern --jql "project = PROJ AND status = 'To Do'"
claude-intern --jql "project = PROJ AND sprint = 'Sprint 1' AND assignee = currentUser()"
claude-intern --jql "project = PROJ AND labels = 'backend' AND status != Done"

# Complex JQL queries with custom fields and conditions
claude-intern --jql "project = \"My Project\" AND cf[10016] <= 3 AND labels IN (FrontEnd, MobileApp)"
claude-intern --jql "assignee = currentUser() AND status = 'To Do' AND priority IN (High, Highest)"
claude-intern --jql "project = PROJ AND type = Bug AND created >= -7d"
```

### Batch Processing Options
```bash
# Skip Claude execution for batch formatting only
claude-intern --jql "project = PROJ AND status = 'To Do'" --no-claude

# Batch process (files saved to /tmp/claude-intern-tasks/{task-key}/ by default)
claude-intern PROJ-123 PROJ-124

# Batch process with PR creation and custom target branch
claude-intern --jql "assignee = currentUser() AND status = 'To Do'" --create-pr --pr-target-branch main

# High-complexity batch processing with extended Claude turns
claude-intern --jql "labels = 'refactoring' AND type = Story" --max-turns 500 --create-pr

# Batch process with skipped clarity checks for faster processing
claude-intern PROJ-101 PROJ-102 PROJ-103 --skip-clarity-check --create-pr
```

### Advanced Batch Processing Scenarios
```bash
# Process all assigned frontend bugs in current sprint
claude-intern --jql "assignee = currentUser() AND labels = 'frontend' AND type = Bug AND sprint in openSprints()"

# Process backlog items by priority
claude-intern --jql "project = PROJ AND status = 'Backlog' AND priority = High" --max-turns 300

# Process all tasks in a specific epic
claude-intern --jql "\"Epic Link\" = PROJ-100" --create-pr --pr-target-branch develop

# Process ready-for-development tasks with specific story points
claude-intern --jql "status = 'Ready for Development' AND \"Story Points\" <= 5" --create-pr
```

The tool will use JIRA credentials from `.env` files and execute Claude in the current working directory, making it flexible for use across multiple projects.