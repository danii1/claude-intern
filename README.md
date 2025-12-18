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

### Quick Setup with Init Command

The easiest way to set up claude-intern for your project is using the `init` command:

```bash
# Initialize project-specific configuration
claude-intern init
```

This creates a `.claude-intern` folder in your current project with:
- `.env` - Your project-specific configuration file with JIRA credentials
- `.env.sample` - Template with all configuration options
- `settings.json` - Per-project settings (PR status transitions, etc.)

**Automatic .gitignore Protection:** The `init` command automatically adds `.claude-intern/.env` to your `.gitignore` file (or creates one if it doesn't exist) to prevent accidentally committing credentials to version control.

After running `init`:
1. Edit `.claude-intern/.env` with your JIRA credentials
2. (Optional) Edit `.claude-intern/settings.json` to configure per-project PR status transitions

### Environment File Setup

The tool searches for `.env` files in the following order:

1. **Custom path** (if specified with `--env-file`)
2. **Project-specific** (`.claude-intern/.env` - recommended)
3. **Current working directory** (`.env`)
4. **User home directory** (`~/.env`)
5. **Tool installation directory**

Configuration options:

```bash
# Option 1: Project-specific (recommended)
claude-intern init  # Creates .claude-intern/.env

# Option 2: Current directory
cp .env.sample .env

# Option 3: Global configuration
cp .env.sample ~/.env

# Option 4: Custom location
claude-intern PROJ-123 --env-file /path/to/custom.env
```

### Required Configuration

Update your `.env` file with your JIRA details:

   - `JIRA_BASE_URL`: Your JIRA instance URL (e.g., https://yourcompany.atlassian.net)
   - `JIRA_EMAIL`: Your JIRA email address
   - `JIRA_API_TOKEN`: Your JIRA API token (create one at https://id.atlassian.com/manage-profile/security/api-tokens)

   Optional PR integration (choose one):

   **Option 1: GitHub Personal Access Token** (for individual users)
   - `GITHUB_TOKEN`: GitHub personal access token for creating pull requests
     - **Classic token**: Requires `repo` scope
     - **Fine-grained token** (recommended): Requires `Pull requests: Read and write` and `Contents: Read` permissions
     - Create at: https://github.com/settings/tokens

   **Option 2: GitHub App Authentication** (for organizations)
   - `GITHUB_APP_ID`: Your GitHub App's ID
   - `GITHUB_APP_PRIVATE_KEY_PATH`: Path to your App's private key file
   - See [GitHub App Setup](#github-app-setup) section below for detailed instructions

   **Bitbucket:**
   - `BITBUCKET_TOKEN`: Bitbucket app password for creating pull requests
     - Requires `Repositories: Write` permission
     - Create at: https://bitbucket.org/account/settings/app-passwords/

   The `.env.sample` file includes helpful comments and optional configuration options.

   **Note:** JIRA PR status transitions are now configured per-project in `settings.json` (see below).

### Per-Project Settings (settings.json)

The `.claude-intern/settings.json` file allows you to configure project-specific behavior:

```json
{
  "projects": {
    "PROJ": {
      "prStatus": "In Review"
    },
    "ABC": {
      "prStatus": "Code Review"
    }
  }
}
```

**Configuration options:**
- `prStatus`: JIRA status to transition to after PR creation for a specific project
  - Each project key can have its own status workflow
  - If not configured, no status transition will occur

**Example:** If you work with multiple JIRA projects that have different workflows (e.g., "PROJ" uses "In Review" but "ABC" uses "Code Review"), configure each project's status in `settings.json`.

### GitHub App Setup

For organizations that want centralized control over PR creation, you can configure a GitHub App instead of using individual personal access tokens.

**Benefits of GitHub App authentication:**
- No individual tokens needed - the App authenticates itself
- Fine-grained permissions - only pull request and content read access
- Centralized control - organization admins manage the App installation
- Audit trail - all actions show as coming from the App, not individual users

**Setup Steps:**

1. **Create a GitHub App:**
   - Go to your organization's Settings → Developer settings → GitHub Apps → New GitHub App
   - Or for personal account: https://github.com/settings/apps
   - Fill in the required fields:
     - **App name:** e.g., "Claude Intern Bot" (must be unique across GitHub)
     - **Homepage URL:** Your project URL or a placeholder
     - **Webhook:** Uncheck "Active" (not needed)
   - Set **Repository permissions:**
     - **Contents:** Read (to check branches)
     - **Pull requests:** Read and write (to create PRs)
   - Click "Create GitHub App"

2. **Generate a Private Key:**
   - On your App's settings page, scroll to "Private keys"
   - Click "Generate a private key"
   - Save the downloaded `.pem` file securely

3. **Install the App:**
   - Go to your App's page → "Install App"
   - Select the organization/account and repositories where you want to use it

4. **Configure claude-intern:**
   Add to your `.claude-intern/.env`:
   ```bash
   GITHUB_APP_ID=123456  # Your App's ID (shown on the App's settings page)
   GITHUB_APP_PRIVATE_KEY_PATH=/secure/path/to/your-app.private-key.pem
   ```

   Or for CI/CD environments, use base64-encoded key:
   ```bash
   GITHUB_APP_ID=123456
   GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi4uLg==
   ```

   To encode your key:
   ```bash
   # macOS
   base64 -i your-app.private-key.pem

   # Linux
   base64 -w 0 your-app.private-key.pem
   ```

**Note:** If both `GITHUB_TOKEN` and GitHub App credentials are configured, `GITHUB_TOKEN` takes precedence.

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

# Testing options - skip ALL JIRA comments (feasibility + implementation)
claude-intern TASK-123 --skip-jira-comments

# Local testing without PR (commits stay local, no push to remote)
# Simply omit --create-pr to skip pushing to remote
claude-intern TASK-123 --skip-jira-comments
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

### Automated Processing with Cron

You can set up automated task processing using cron jobs. This is useful for continuously picking up new tasks labeled for the intern to work on:

```bash
# Example: Process tasks labeled "Intern" in open sprints every 10 minutes
# Add to crontab (run: crontab -e)
*/10 * * * * cd /path/to/your/project && claude-intern --jql 'statusCategory = "To Do" AND sprint in openSprints() AND labels IN (Intern) ORDER BY created DESC' --max-turns 500 --create-pr --pr-target-branch master >> /tmp/claude-intern-cron.log 2>&1

# Example: Process assigned tasks every hour
0 * * * * cd /path/to/your/project && claude-intern --jql 'assignee = currentUser() AND status = "To Do" AND labels IN (AutoImpl)' --create-pr >> /tmp/claude-intern-cron.log 2>&1

# Example: Process high-priority bugs twice daily
0 9,17 * * * cd /path/to/your/project && claude-intern --jql 'type = Bug AND priority = High AND status = "To Do" AND labels IN (Intern)' --max-turns 300 --create-pr >> /tmp/claude-intern-cron.log 2>&1
```

**Important notes for cron setup:**
- Always change to your project directory (`cd /path/to/your/project`) to ensure the correct `.claude-intern/.env` is loaded
- Use absolute paths or ensure PATH includes `claude-intern` and `claude` binaries
- Redirect output to a log file for monitoring (`>> /tmp/claude-intern-cron.log 2>&1`)
- Use the `ORDER BY created DESC` clause to process newest tasks first
- Consider using labels (e.g., `labels = "Intern"`) to mark tasks for automated processing
- Test your JQL query manually before adding to cron to ensure it returns the expected tasks
- Monitor the log file regularly to ensure the cron job is running successfully

## What it does

1. Fetches the JIRA task details including:

   - Task description
   - Custom fields (including links to Figma, external docs, etc.)
   - Comments and discussion

2. Formats the information for Claude

3. Creates a feature branch named `feature/task-id` (e.g., `feature/proj-123`)

4. Runs optional feasibility assessment to validate task clarity (skippable with `--skip-clarity-check`)
   - Posts assessment results to JIRA (skippable with `--skip-jira-comments`)
   - Saves assessment results for debugging:
     - `{output-dir}/{task-key}/feasibility-assessment.md` (formatted results with JSON)
     - `{output-dir}/{task-key}/feasibility-assessment-failed.txt` (raw output on parse failure)

5. Runs `claude -p` with enhanced permissions and extended conversation limits for automatic implementation

6. Saves Claude's implementation summary to local files for analysis:
   - `{output-dir}/{task-key}/implementation-summary.md` (successful)
   - `{output-dir}/{task-key}/implementation-summary-incomplete.md` (incomplete/failed)

7. Automatically commits all changes with a descriptive commit message after Claude completes successfully

8. Pushes the feature branch to remote repository (when creating PRs)

9. Optionally creates pull requests on GitHub or Bitbucket with detailed implementation summaries

10. Posts implementation results back to JIRA as comments (skippable with `--skip-jira-comments`)
    - Includes feasibility assessment results
    - Includes implementation summary

## Requirements

- Bun runtime
- JIRA API access
- Claude CLI installed and configured
- Git (for automatic branch creation)

## Quick Start

1. Install globally: `npm install -g claude-intern`
2. Initialize your project: `claude-intern init`
3. Configure your JIRA credentials in `.claude-intern/.env`
4. Run from any directory: `claude-intern PROJ-123`

**Alternative:** For global configuration across all projects, place `.env` in your home directory (`~/.env`)

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
