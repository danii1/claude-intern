# Claude Intern Changelog

## [2.0.0] - 2025-12-24

### Breaking Changes

- **Bun Runtime Required**: The tool now requires [Bun](https://bun.sh) runtime instead of Node.js
  - Install via `bun install -g claude-intern` (not npm)
  - Run directly via `bunx claude-intern` or after global install

### Added

- **Webhook Server for Automated PR Reviews**: New `serve-webhook` command that automatically addresses PR review feedback
  - Listens for GitHub webhook events and processes `changes_requested` reviews when bot is mentioned
  - SQLite-based persistent queue (`bun:sqlite`) for crash-resilient processing with automatic recovery on restart
  - Dedicated worktree at `/tmp/claude-intern-review-worktree/` provides isolation from main repository
  - Automatically detects and installs project dependencies (supports bun, pnpm, npm, yarn, poetry, uv, pip)
  - Commits attributed to GitHub App bot account (`app-name[bot]`) for clear audit trail
  - Fetches complete review context including all comments and conversation threads
  - Posts implementation summaries as PR review replies
  - Configurable via `WEBHOOK_PORT`, `WEBHOOK_SECRET`, and other environment variables

- **Address-Review Command**: Manual PR review processing via `claude-intern address-review <pr-url>`
  - Handles single PR review on-demand without running webhook server
  - Uses same worktree isolation and dependency installation as webhook server

### Changed

- **Review Worktree Location**: Moved from `.claude-intern/review-worktree/` to `/tmp/claude-intern-review-worktree/`
  - Better isolation from main repository
  - Automatic cleanup of stale worktree registrations from old paths

- **Optimized Worktree Operations**: Improved performance for worktree preparation
  - Shallow clone with `--depth 1` for faster initial setup
  - Simplified preparation logic with reduced error noise
  - Single reusable worktree instead of per-PR worktrees

### Fixed

- **Fetch All PR Review Comments**: Now fetches all comments from the PR, not just the latest review
  - Ensures Claude sees complete review context
  - Handles pagination for PRs with many comments

- **Stale Worktree Registration Handling**: Gracefully handles orphaned worktree entries
  - Automatically unregisters worktrees pointing to non-existent directories
  - Prevents "fatal: is already checked out" errors

### Technical

- **Dependencies**: Added `bun:sqlite` for persistent queue (bundled with Bun runtime)
- **Build Process**: Updated `build.ts` to target Bun runtime
- **Documentation**: Updated README.md, USAGE.md, and CLAUDE.md to reflect Bun requirement

## [1.3.1] - 2025-12-23

### Added

- **Automatic Target Branch Detection**: Extract target branch from JIRA task descriptions
  - Add "Target branch: develop" (or "Base branch:" or "PR target:") to task description
  - Supports markdown formatting: `**Target branch**: develop`, `## Target branch: develop`, etc.
  - Falls back to `--pr-target-branch` CLI option when not specified
  - Perfect for server automation where different tasks target different branches

## [1.3.0] - 2025-12-18

### Added

- **GitHub App Authentication**: Organizations can now use GitHub Apps for PR creation instead of individual personal access tokens
  - Each organization creates their own GitHub App for centralized control
  - Fine-grained permissions: only requires Contents (Read) and Pull requests (Read and write)
  - No individual tokens needed - the App authenticates itself
  - Centralized audit trail - all actions show as coming from the App
  - Supports two private key formats:
    - File path: `GITHUB_APP_PRIVATE_KEY_PATH=/path/to/key.pem`
    - Base64-encoded: `GITHUB_APP_PRIVATE_KEY_BASE64=...` (useful for CI/CD)
  - JWT-based authentication with automatic installation token caching
  - Falls back gracefully if App is not installed on a repository
  - **Auto-detected Git author**: Commits are automatically attributed to the GitHub App's bot account (e.g., `my-app[bot]`)

### Changed

- Updated documentation across all markdown files with GitHub App setup instructions
- `GITHUB_TOKEN` takes precedence over GitHub App credentials when both are configured

## [1.2.0] - 2025-11-28

### Added

- **Comment Filtering**: Automatically filter out Claude Intern's own automated comments when fetching task context
  - Prevents context pollution by excluding previous assessment/implementation comments
  - Ensures Claude only sees genuine user and stakeholder feedback
  - Handles all JIRA comment formats: string, rendered HTML, and Atlassian Document Format (ADF)
  - Uses three unique markers to identify automated comments:
    - "Implementation Completed by Claude"
    - "Automated Task Feasibility Assessment"
    - "Implementation Incomplete"
  - Logs number of filtered comments for transparency
  - Comprehensive test coverage with 22 new tests

- **Automatic Git Pull**: Pull latest changes from remote before starting task processing
  - Ensures local repository is up-to-date before creating feature branches
  - Prevents merge conflicts from stale local branches
  - Fetches and pulls from remote origin automatically

- **Automatic JIRA Status Transitions**: Enhanced workflow automation with status transitions
  - **Start Transition**: Automatically move task to "In Progress" when starting implementation (if configured via `inProgressStatus`)
  - **Success Transition**: Automatically move task to review status after PR creation (if configured via `prStatus`)
  - **Failure Transition**: Automatically move task back to "To Do" if implementation fails (if configured via `todoStatus`)
  - Per-project configuration via `settings.json`:
    ```json
    {
      "projects": {
        "PROJ": {
          "inProgressStatus": "In Progress",
          "todoStatus": "To Do",
          "prStatus": "In Review"
        }
      }
    }
    ```
  - Smart status transition detection based on available JIRA workflows

- **Incomplete Implementation Handling**: Better handling when Claude cannot complete a task
  - Posts detailed incomplete implementation comments to JIRA
  - Includes possible reasons for incompletion (clarity, scope, blockers)
  - Provides actionable recommendations for task improvements
  - Duplicate prevention: Skips posting if same task description already has incomplete comment
  - Transitions task back to "To Do" status (if configured)
  - Saves task description for duplicate detection on retry

- **Auto-Commit Recovery**: Automatically commit/amend changes when Claude forgets
  - Detects when Claude makes changes but doesn't commit them
  - Prompts user to auto-commit or amend previous commit
  - Helps recover from interrupted workflows
  - Includes clear git amend instructions in push hook prompts

### Fixed

- **Lock File Cleanup**: Release PID lock file on all exit paths
  - Fixed issue where lock file wasn't cleaned up on early exits (e.g., missing env vars)
  - Lock file now properly released during error conditions, SIGINT, SIGTERM, and uncaught exceptions
  - Prevents stale locks from blocking subsequent runs

- **Status Transition Timing**: Move "In Progress" transition to after clarity assessment
  - Prevents marking tasks as "In Progress" when they fail the clarity check
  - Only transitions to "In Progress" after confirming task is implementable
  - More accurate workflow state management

### Technical

- **Test Coverage Expansion**: Added 22 comprehensive comment filtering tests
  - Tests for all three comment formats (string, HTML, ADF)
  - Edge case handling (null, undefined, empty, malformed bodies)
  - Marker uniqueness verification
  - All 99 tests passing across 5 test suites
- **Improved Error Handling**: Better batch processing resilience with continue-on-error strategy
- **Enhanced Logging**: More detailed git operation logging with verbose mode

## [1.1.1] - 2025-11-25

### Added

- **Instance Lock Mechanism**: Prevent multiple instances from running simultaneously in the same directory
  - Lock file created in `.claude-intern/.pid.lock` when instance starts
  - Automatic detection and cleanup of stale locks from crashed processes
  - Graceful cleanup on process termination (SIGINT, SIGTERM, uncaught exceptions)
  - Added to `.gitignore` to prevent committing lock files
  - Comprehensive test suite with 6 test scenarios using Bun's native test runner
  - Tests run in isolated temporary directories to enable parallel execution

### Technical

- Migrated lock manager tests to use Bun's native `bun:test` API for better integration
- Added test isolation for CLI tests to prevent lock conflicts during parallel test execution
- All 35 tests pass consistently with full parallel execution support

## [1.1.0] - 2025-11-25

### Added

- **Init Command**: New `claude-intern init` command for easy project setup
  - Creates `.claude-intern/` folder with project-specific configuration
  - Generates `.env` file for JIRA credentials
  - Creates `.env.sample` template with all configuration options
  - Creates `settings.json` for per-project settings
  - **Automatic .gitignore Protection**: Automatically adds `.claude-intern/.env` and `.claude-intern/.env.local` to `.gitignore` to prevent credential leaks

- **Per-Project Settings**: New `settings.json` configuration file for project-specific behavior
  - Configure different PR status transitions for different JIRA projects
  - Example: `{"projects": {"PROJ": {"prStatus": "In Review"}, "ABC": {"prStatus": "Code Review"}}}`
  - Automatically extracts project key from task key (e.g., "PROJ-123" → "PROJ")
  - Per-project configuration takes precedence over global environment variables

- **Enhanced Environment Configuration**: Improved configuration loading with priority order
  1. Custom path (via `--env-file`)
  2. **Project-specific** (`.claude-intern/.env`) - NEW
  3. Current working directory (`.env`)
  4. Home directory (`~/.env`)
  5. Tool installation directory

- **Comprehensive Test Suite**: Added 29 unit tests for reliability
  - Settings management tests (8 tests)
  - CLI argument handling tests (21 tests)
  - All tests organized in `tests/` directory
  - Full TypeScript type coverage including tests

### Changed

- **JIRA PR Status Configuration**: Moved from environment variable to `settings.json`
  - `JIRA_PR_STATUS` environment variable deprecated in favor of per-project configuration
  - Each JIRA project can now have its own status workflow
  - Removed `JIRA_PR_STATUS` from `.env.sample` template

- **CLI Architecture**: Improved command-line argument handling
  - Fixed issue where `init` command conflicted with task key parsing
  - Task keys like "DISCO-123" now work correctly alongside subcommands
  - Early detection of `init` command to avoid Commander.js conflicts

### Dependencies

- Added `@types/bun` for better test type safety

## [1.0.1] - 2025-08-18

### Fixed
- **Git Branching**: Fixed issue where feature branches were always created from main/master instead of respecting the `--pr-target-branch` parameter
  - Feature branches now correctly branch from the specified target branch (e.g., `develop`)
  - Ensures proper git history when creating PRs to non-main branches
  - Updated `createFeatureBranch` function to accept and use the base branch parameter

## [1.0.0] - Initial Release

### Added

- **JIRA Task Processing**: Comprehensive JIRA task fetching with complete context
  - JIRA REST API v3 integration with comprehensive error handling
  - Supports both rendered HTML and Atlassian Document Format content
  - Fetches complete context including subtasks, parent tasks, epics, and linked issues
  - Handles authentication edge cases and API token formats
- **Batch Processing**: Process multiple JIRA tasks sequentially with robust error handling
  - Multiple task keys: Process multiple specific tasks `claude-intern PROJ-123 PROJ-124 PROJ-125`
  - JQL query support: Full JIRA Query Language support with complex conditions `--jql "project = PROJ AND status = 'To Do'"`
  - Custom field queries: Support for custom fields like `cf[10016] <= 3`
  - Complex filtering: Status, priority, labels, assignee, and date-based filtering
  - Error isolation: Failed tasks don't stop processing of remaining tasks
  - Progress tracking: Real-time progress updates with task indexing ([1/5], [2/5], etc.)
  - Batch summary: Final report showing successful and failed tasks with error details
- **Claude AI Integration**: Automatic implementation using Claude Code
  - Spawns Claude Code as subprocess with enhanced permissions (`-p --dangerously-skip-permissions`)
  - Real-time output streaming to user while capturing for JIRA posting
  - Detects completion status and max-turns errors
  - Posts rich-text implementation summaries back to JIRA using Atlassian Document Format
  - Clarity assessment prompts for feasibility checking
- **Pull Request Creation**: Automatically create PRs on GitHub or Bitbucket after successful implementation
  - Smart repository detection: Automatically detects GitHub/Bitbucket platform and workspace from git remote URL
  - GitHub integration: Full GitHub API integration with personal access token authentication
  - Bitbucket integration: Complete Bitbucket API integration with app password authentication
  - Automatic workspace detection: No need to manually configure Bitbucket workspace
  - Rich PR content: PR descriptions include Claude's implementation details, JIRA task context, and acceptance criteria
  - PR title format: Uses `[TASK-KEY] Task Summary` format for consistency
- **Git Automation**: Seamless git workflow integration
  - Creates feature branches with consistent naming: `feature/{task-key-lowercase}`
  - Handles existing branch scenarios gracefully
  - Automated commit messages include task context
  - Main branch detection: Automatically switches to main/master branch before creating feature branches
  - Integrates with Claude Code workflow for seamless development
- **Dynamic File Management**: Smart output file handling for batch processing
  - Dynamic naming prevents file conflicts with pattern `{base-name}-{task-key-lowercase}.md`
  - Separate files for each task enable parallel review
  - Configurable output directory via `CLAUDE_INTERN_OUTPUT_DIR` environment variable
- **Comprehensive CLI Interface**: Full-featured command-line interface
  - `--jql` for JQL query-based batch processing
  - `--create-pr` to automatically create pull requests
  - `--pr-target-branch` to specify target branch (default: main)
  - `--no-claude` to skip Claude execution (formatting only)
  - `--no-git` to skip branch creation
  - `--skip-clarity-check` to bypass feasibility analysis
  - `--no-auto-commit` to skip automatic commits
  - `--claude-path` and `--max-turns` for Claude configuration
  - `-v` for verbose logging
  - `--env-file` for custom environment file path
- **JIRA Status Automation**: Automatic task status transition after successful PR creation
- **Rich Text Processing**: Advanced content format conversion
  - Converts JIRA's Atlassian Document Format to readable text
  - Smart link detection for external resources
  - HTML to Markdown conversion for Claude consumption
  - Creates structured prompts with task context, related issues, and linked resources
- **Comprehensive Environment Configuration**:
  - Multi-location `.env` file loading (current directory, home directory, installation directory)
  - Custom environment file path with `--env-file`
  - Required: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
  - Optional: `GITHUB_TOKEN` or GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`), `BITBUCKET_TOKEN`, `CLAUDE_INTERN_OUTPUT_DIR`

### Technical Architecture

- **Modular TypeScript Architecture**: Optimized for Bun runtime during development and Node.js for distribution
- **Core Components**:
  - Main entry point (`src/index.ts`) with Bun shebang and CLI orchestration
  - JIRA Client (`src/lib/jira-client.ts`) with comprehensive API integration
  - Claude Formatter (`src/lib/claude-formatter.ts`) for Atlassian Document Format conversion
  - Utilities (`src/lib/utils.ts`) for git operations and file handling
  - Comprehensive type definitions (`src/types/`) for all data structures
- **Runtime Strategy**: Bun for fast development, Node.js-compatible bundled output for npm distribution
- **Modular PR Client Architecture**: Abstract base class with platform-specific implementations
- **Repository Platform Detection**: Intelligent parsing of git remote URLs for GitHub and Bitbucket
- **Token Authentication**: Secure API authentication with proper error handling
- **Type Safety**: Full TypeScript support for all functionality including batch processing
- **Error Handling and Validation**:
  - Comprehensive environment validation
  - JIRA API authentication testing
  - Claude CLI path resolution across platforms
  - Graceful degradation when optional features fail

### Workflow

Complete workflow orchestration: fetch → format → git → claude → commit → jira
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

### Installation & Usage

- **Global Installation**: `bun install -g claude-intern` or `bunx claude-intern`
- **Single Task**: `claude-intern PROJ-123`
- **Multiple Tasks**: `claude-intern PROJ-123 PROJ-124 PROJ-125`
- **JQL Queries**: `claude-intern --jql "project = PROJ AND status = 'To Do'"`
- **With PR Creation**: `claude-intern PROJ-123 --create-pr`
