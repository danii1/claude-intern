# Claude Intern Changelog

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
  - Optional: `GITHUB_TOKEN`, `BITBUCKET_TOKEN`, `JIRA_PR_STATUS`, `CLAUDE_INTERN_OUTPUT_DIR`

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

- **Global Installation**: `npm install -g claude-intern` or `npx claude-intern`
- **Single Task**: `claude-intern PROJ-123`
- **Multiple Tasks**: `claude-intern PROJ-123 PROJ-124 PROJ-125`
- **JQL Queries**: `claude-intern --jql "project = PROJ AND status = 'To Do'"`
- **With PR Creation**: `claude-intern PROJ-123 --create-pr`
