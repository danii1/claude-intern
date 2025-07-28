# Claude Intern

Your AI intern for automatically implementing JIRA tasks using Claude. Supports both single task processing and batch processing of multiple tasks through JQL queries or explicit task lists. Pulls task details and feeds them to Claude for implementation with full automation of the development workflow.

## Installation

### Global Installation (Recommended)

Install globally via npm to use from any directory:

```bash
# Install globally
npm install -g claude-intern

# Or use directly without installing
npx claude-intern PROJ-123
```

### Local Development Setup

For development or contributing to the project:

1. Install Bun (if not already installed):

```bash
curl -fsSL https://bun.sh/install | bash
```

2. Clone and install dependencies:

```bash
git clone https://github.com/danii1/claude-intern.git
cd claude-intern
bun install
```

3. (Optional) Install development version globally:

```bash
bun run install-global
```

## Configuration

### Environment File Setup

The tool searches for `.env` files in the following order:

1. **Custom path** (if specified with `--env-file`)
2. **Current working directory** (where you run the command)
3. **User home directory** (`~/.env`)
4. **Tool installation directory**

For global installation, it's recommended to either:
- Place `.env` in your project directory (most common)
- Place `.env` in your home directory (`~/.env`) for global access

```bash
# Option 1: Project-specific (recommended)
cp .env.sample .env

# Option 2: Global configuration
cp .env.sample ~/.env

# Option 3: Custom location
claude-intern PROJ-123 --env-file /path/to/custom.env
```

### Required Configuration

Update your `.env` file with your JIRA details:

   - `JIRA_BASE_URL`: Your JIRA instance URL (e.g., https://yourcompany.atlassian.net)
   - `JIRA_EMAIL`: Your JIRA email address
   - `JIRA_API_TOKEN`: Your JIRA API token (create one at https://id.atlassian.com/manage-profile/security/api-tokens)

   Optional PR integration:
   - `GITHUB_TOKEN`: GitHub personal access token for creating pull requests
   - `BITBUCKET_TOKEN`: Bitbucket app password for creating pull requests
   - `JIRA_PR_STATUS`: Auto-transition JIRA status after PR creation (e.g., "In Review")

   The `.env.sample` file includes helpful comments and optional configuration options.

## Usage

### Single Task Processing

```bash
# Global installation usage (recommended)
claude-intern TASK-123

# Or use with npx (no installation needed)
npx claude-intern TASK-123

# Skip Claude and just fetch/format the task
claude-intern TASK-123 --no-claude

# Skip git branch creation
claude-intern TASK-123 --no-git

# Use custom .env file
claude-intern TASK-123 --env-file /path/to/custom.env

# Specify custom output file
claude-intern TASK-123 -o my-task.md

# Verbose output for debugging
claude-intern TASK-123 -v

# Custom Claude CLI path
claude-intern TASK-123 --claude-path /path/to/claude

# Increase max turns for complex tasks
claude-intern TASK-123 --max-turns 50

# Skip automatic commit after Claude completes
claude-intern TASK-123 --no-auto-commit

# Create pull request after implementation
claude-intern TASK-123 --create-pr

# Create pull request targeting specific branch
claude-intern TASK-123 --create-pr --pr-target-branch develop
```

#### Local Development Usage

```bash
# Run with Bun during development
bun start TASK-123

# Development mode (same as start)
bun run dev TASK-123

# All options work with bun as well (note the -- separator)
bun start TASK-123 -- --no-claude --verbose
```

### Batch Processing (Multiple Tasks)

```bash
# Process multiple specific tasks
claude-intern PROJ-123 PROJ-124 PROJ-125

# Process tasks matching JQL query
claude-intern --jql "project = PROJ AND status = 'To Do'"

# Complex JQL with custom fields and conditions
claude-intern --jql "project = \"My Project\" AND cf[10016] <= 3 AND labels IN (FrontEnd, MobileApp)"

# Batch process with PR creation
claude-intern --jql "assignee = currentUser() AND status = 'To Do'" --create-pr

# High-complexity batch processing with extended turns
claude-intern --jql "labels = 'refactoring' AND type = Story" --max-turns 500 --create-pr

# Batch process with skipped clarity checks for faster processing
claude-intern PROJ-101 PROJ-102 PROJ-103 --skip-clarity-check --create-pr
```

#### Local Development Batch Processing

```bash
# Process multiple tasks with Bun
bun start PROJ-123 PROJ-124 PROJ-125

# JQL queries (note -- separator for options)
bun start -- --jql "project = PROJ AND status = 'To Do'"
bun start -- --jql "assignee = currentUser()" --create-pr
```

### Quick Examples

```bash
# Fetch JIRA task and run Claude automatically
claude-intern PROJ-456

# Just fetch and format (useful for reviewing before Claude runs)
claude-intern PROJ-456 --no-claude

# Then manually run Claude with the formatted output
claude -p --dangerously-skip-permissions --max-turns 10 < task-details.md

# Advanced batch scenarios
claude-intern --jql "\"Epic Link\" = PROJ-100" --create-pr
claude-intern --jql "sprint in openSprints() AND assignee = currentUser()" --max-turns 500
```

## What it does

1. Fetches the JIRA task details including:

   - Task description
   - Custom fields (including links to Figma, external docs, etc.)
   - Comments and discussion

2. Formats the information for Claude

3. Creates a feature branch named `feature/task-id` (e.g., `feature/proj-123`)

4. Runs `claude -p` with enhanced permissions and extended conversation limits for automatic implementation

5. Automatically commits all changes with a descriptive commit message after Claude completes successfully

6. Pushes the feature branch to remote repository (when creating PRs)

7. Optionally creates pull requests on GitHub or Bitbucket with detailed implementation summaries

## Requirements

- Bun runtime
- JIRA API access
- Claude CLI installed and configured
- Git (for automatic branch creation)

## Quick Start

1. Install globally: `npm install -g claude-intern`
2. Get the sample environment file:
   ```bash
   # Download .env.sample from the repository
   curl -o .env https://raw.githubusercontent.com/danii1/claude-intern/master/.env.sample
   ```
3. Configure your JIRA credentials in `.env` (or `~/.env` for global access)
4. Run from any directory: `claude-intern PROJ-123`

See [USAGE.md](./USAGE.md) for detailed usage scenarios and troubleshooting.  
See [GLOBAL_USAGE.md](./GLOBAL_USAGE.md) for quick reference on global installation.  
See [ENV_SETUP.md](./ENV_SETUP.md) for comprehensive environment configuration guide.

## Features

### Core Functionality
- ✅ **Full TypeScript Support** - Type-safe development with comprehensive interfaces
- ✅ **JIRA API Integration** - Connects to any JIRA instance with proper authentication
- ✅ **Smart Link Detection** - Automatically finds Figma, GitHub, Confluence links in custom fields
- ✅ **Rich Text Processing** - Handles JIRA's Atlassian Document Format with proper conversion
- ✅ **HTML to Markdown Conversion** - Converts JIRA's rendered HTML descriptions to clean markdown format
- ✅ **Working Attachment Links** - Converts relative JIRA attachment URLs to clickable full URLs
- ✅ **Comment Threading** - Includes all task discussions and updates

### Batch Processing
- ✅ **Multiple Task Support** - Process multiple tasks with explicit task keys
- ✅ **JQL Query Integration** - Use JIRA Query Language for dynamic task selection
- ✅ **Complex JQL Support** - Custom fields, arrays, operators, and advanced conditions
- ✅ **Error Isolation** - Failed tasks don't stop processing of remaining work
- ✅ **Progress Tracking** - Real-time progress indicators for batch operations
- ✅ **Dynamic File Naming** - Unique output files prevent conflicts during batch processing

### Automation & Integration
- ✅ **Claude Integration** - Automatically runs `claude -p` with formatted context
- ✅ **Real-time Output** - All Claude output is visible in real-time during execution
- ✅ **CLI Interface** - Easy-to-use command line tool with comprehensive options
- ✅ **Git Integration** - Automatically creates feature branches for each task
- ✅ **Auto-Commit** - Commits changes automatically after Claude completes successfully
- ✅ **Pull Request Creation** - Automatically creates PRs on GitHub or Bitbucket with implementation details
- ✅ **Smart Repository Detection** - Automatically detects GitHub/Bitbucket and workspace from git remote
- ✅ **Error Handling** - Robust error handling and validation
- ✅ **Configurable** - Flexible options for output and Claude path
