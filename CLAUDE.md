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
2. **Start Status**: Automatically transition task to "In Progress" status (if configured)
3. **Format**: Convert JIRA data into Claude-readable markdown format with comprehensive context
4. **Branch**: Create feature branch named `feature/{task-key}`
5. **Assess**: Run optional clarity check to validate task implementability
6. **Implement**: Execute Claude Code with formatted task details and enhanced permissions
7. **Save**: Save implementation summary to local file for analysis
   - Successful: `{output-dir}/{task-key}/implementation-summary.md`
   - Incomplete: `{output-dir}/{task-key}/implementation-summary-incomplete.md`
8. **Commit**: Automatically commit changes with descriptive message
9. **Push**: Push feature branch to remote repository (when creating PRs)
10. **PR Creation**: Optionally create pull requests on GitHub or Bitbucket
11. **Status Transitions**: Automatically transition JIRA task status based on outcome (if configured)
    - Successful PR creation → configured `prStatus` (e.g., "In Review")
    - Implementation incomplete/failed → configured `todoStatus` (e.g., "To Do")
12. **Report**: Post implementation summary back to JIRA task

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

#### Initialization Command
The tool provides an `init` command to create project-specific configuration:
```bash
claude-intern init
```
This creates a `.claude-intern` folder with:
- `.env` - Project-specific configuration file with JIRA credentials
- `.env.sample` - Template with all configuration options
- `settings.json` - Per-project settings (PR status transitions, etc.)

**Automatic .gitignore Protection:** The `init` command automatically adds `.claude-intern/.env` and `.claude-intern/.env.local` to the project's `.gitignore` file (creating it if needed) to prevent credential leaks to version control.

#### Per-Project Settings (settings.json)
The `settings.json` file in `.claude-intern/` allows configuring project-specific behavior:

```json
{
  "projects": {
    "PROJ": {
      "inProgressStatus": "In Progress",
      "todoStatus": "To Do",
      "prStatus": "In Review"
    },
    "ABC": {
      "inProgressStatus": "In Development",
      "todoStatus": "Backlog",
      "prStatus": "Code Review"
    }
  }
}
```

**Status Transition Configuration**:
- `inProgressStatus`: JIRA status to transition to when starting task implementation (e.g., "In Progress", "In Development", "Implementing")
- `todoStatus`: JIRA status to transition to when implementation fails or is incomplete (e.g., "To Do", "Backlog", "Open")
- `prStatus`: JIRA status to transition to after PR creation (e.g., "In Review", "Code Review", "Ready for Review")

**Note**: Each project key can have its own status configurations. If not configured for a specific project, no status transitions will occur. This allows different JIRA projects to have different workflow statuses.

#### Configuration Loading Priority
The tool loads `.env` files from multiple locations in priority order:
1. Custom path specified with `--env-file`
2. **Project-specific** (`.claude-intern/.env` - recommended for per-project configuration)
3. Current working directory (`.env`)
4. User home directory (`~/.env`)
5. Tool installation directory

Required environment variables:
- `JIRA_BASE_URL` - Your JIRA instance URL
- `JIRA_EMAIL` - Your JIRA email address
- `JIRA_API_TOKEN` - JIRA API token for authentication

Optional environment variables for PR creation:
- **Option 1: GitHub Personal Access Token** (for individual users)
  - `GITHUB_TOKEN` - GitHub personal access token for creating PRs
    - Classic token: requires `repo` scope
    - Fine-grained token (recommended): requires `Pull requests: Read and write` + `Contents: Read`
- **Option 2: GitHub App Authentication** (for organizations)
  - `GITHUB_APP_ID` - Your GitHub App's ID
  - `GITHUB_APP_PRIVATE_KEY_PATH` - Path to the App's private key (.pem file)
  - `GITHUB_APP_PRIVATE_KEY_BASE64` - Alternative: base64-encoded private key (for CI/CD)
  - Note: Each organization creates their own GitHub App. See README.md for setup instructions.
- `BITBUCKET_TOKEN` - Bitbucket app password for creating PRs (requires `Repositories: Write`)

Optional environment variables for workflow automation:
- `CLAUDE_INTERN_OUTPUT_DIR` - Base directory for task files and attachments (default: `/tmp/claude-intern-tasks`)

**Note**: JIRA PR status transitions are configured per-project in `settings.json`, not as environment variables.

### CLI Options and Features

- **Initialization**: `claude-intern init` to create project-specific configuration
  - Creates `.claude-intern` folder with `.env` and `.env.sample`
  - Provides guided setup for new projects
  - Automatically adds `.claude-intern/.env` to `.gitignore` for security
- **Batch Processing**: Process multiple tasks sequentially
  - Multiple task keys: `claude-intern PROJ-123 PROJ-124 PROJ-125`
  - JQL queries: `--jql "project = PROJ AND status = 'To Do'"`
- **Task Processing**: `--no-claude` to skip Claude execution
- **Git Integration**: `--no-git` to skip branch creation
- **Clarity Assessment**: `--skip-clarity-check` to bypass feasibility analysis
- **Commit Control**: `--no-auto-commit` to skip automatic commits
- **PR Creation**: `--create-pr` to automatically create pull requests after implementation
- **PR Configuration**: `--pr-target-branch` to specify target branch (default: main)
- **Testing Options**:
  - `--skip-jira-comments` to skip posting all comments to JIRA (for testing)
    - Skips feasibility assessment comments (success/failure)
    - Skips implementation summary comments
    - Skips assessment failure warnings
    - Skips JIRA status transitions after PR creation
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

### Output File Structure
Each task creates a dedicated directory with all related files:
```
{CLAUDE_INTERN_OUTPUT_DIR}/{task-key}/
├── task-details.md                         # Formatted task for Claude implementation
├── feasibility-assessment.md               # Formatted assessment results (includes JSON)
├── feasibility-assessment-failed.txt       # Raw output when parsing fails
├── implementation-summary.md               # Claude's output (successful)
├── implementation-summary-incomplete.md    # Claude's output (incomplete/failed)
└── attachments/                            # Downloaded JIRA attachments
    ├── image1.png
    └── document.pdf
```
- Default output directory: `/tmp/claude-intern-tasks/`
- Customizable via `CLAUDE_INTERN_OUTPUT_DIR` environment variable
- All assessment and implementation files saved for debugging
- Assessment results formatted as readable markdown with embedded JSON
- Summaries contain raw Claude output without JIRA formatting
- Assessment files preserved for analysis and troubleshooting
- Assessment input uses temporary file (cleaned up automatically)

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

The project uses Bun's native test runner for automated testing:

**Running Tests:**
- `bun test` - Run all tests across the test suite
- `bun test tests/lock-manager.test.ts` - Run specific test file
- `bun test --watch` - Run tests in watch mode

**Test Structure:**
- Tests are located in the `tests/` directory
- Uses Bun's native `bun:test` API with `describe()`, `test()`, and `expect()`
- Tests use isolated temporary directories to enable parallel execution
- All 35 tests (8 settings, 6 lock manager, 21 CLI) pass consistently

**Writing New Tests:**
When adding tests, use Bun's native test API:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("MyFeature", () => {
  test("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

**Test Isolation:**
- Use temporary directories for tests that create files or acquire locks
- Use `beforeEach()` to set up isolated state
- Use `afterEach()` to clean up resources
- This enables parallel test execution without conflicts

## Global Usage Pattern

This tool can be installed globally via npm or used directly with npx from any project directory:

### Installation Options
```bash
# Install globally
npm install -g claude-intern

# Or use directly with npx (no installation needed)
npx claude-intern PROJ-123
```

### Project Setup
```bash
# Initialize project-specific configuration
claude-intern init

# This creates .claude-intern/.env (automatically added to .gitignore)
# Edit with your JIRA credentials and start using claude-intern
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

### Testing and Development Options
```bash
# Test workflow without posting to JIRA (all implementation locally)
claude-intern PROJ-123 --skip-jira-comments

# Test without creating PR (commits stay local, no push to remote)
claude-intern PROJ-123 --skip-jira-comments

# Test batch processing without affecting JIRA
claude-intern --jql "project = PROJ AND status = 'To Do'" --skip-jira-comments

# Test end-to-end workflow locally with all safety flags
claude-intern PROJ-123 --skip-jira-comments --skip-clarity-check
```

The tool will use JIRA credentials from `.env` files (prioritizing `.claude-intern/.env` for project-specific configuration) and execute Claude in the current working directory, making it flexible for use across multiple projects.