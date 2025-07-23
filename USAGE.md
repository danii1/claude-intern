# Claude Intern Usage Guide

Claude Intern supports both single task processing and batch processing of multiple JIRA tasks through JQL queries or explicit task lists.

## Installation Options

### Option 1: Local Development

```bash
git clone <repo-url>
cd claude-intern
npm install
npm run build
```

### Option 2: Global Installation (Recommended)

```bash
# From the claude-intern directory
npm run install-global

# Now you can use it from anywhere
claude-intern --help
```

## Environment Setup

1. **Create environment file** (in your project directory or globally):

```bash
# Copy from claude-intern directory
cp /path/to/claude-intern/.env.sample .env

# Or create manually
cat > .env << EOF
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token-here
CLAUDE_CLI_PATH=claude
# Optional: For automatic PR creation
GITHUB_TOKEN=your-github-token-here
BITBUCKET_TOKEN=your-bitbucket-token-here
# Optional: Auto-transition JIRA status after PR creation
JIRA_PR_STATUS="In Review"
EOF
```

2. **Get JIRA API Token**:
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Create a new token
   - Copy it to your `.env` file

## Usage Scenarios

### Scenario 1: Working in Your Project Repository

This is the most common use case - you're in your project's git repository and want to implement a JIRA task:

```bash
# Navigate to your project
cd /path/to/your/project

# Ensure you have a .env file with JIRA credentials
# (either in this directory or globally accessible)

# Run claude-intern - it will:
# 1. Fetch JIRA task details
# 2. Create feature branch (e.g., feature/proj-123)
# 3. Run Claude with the task details
claude-intern PROJ-123
```

### Scenario 2: Just Fetch Task Details (No Git/Claude)

```bash
# Just get the formatted task details
claude-intern PROJ-123 --no-claude --no-git

# This creates task-details.md with formatted content
# You can then manually create branches and run Claude
git checkout -b feature/proj-123
claude -p --dangerously-skip-permissions --max-turns 10 < task-details.md
```

### Scenario 3: Custom Output Location

```bash
# Save to specific file
claude-intern PROJ-123 --no-claude -o ~/tasks/proj-123.md

# Use custom Claude path
claude-intern PROJ-123 --claude-path /usr/local/bin/claude

# Increase max turns for complex tasks
claude-intern PROJ-123 --max-turns 50
```

### Scenario 4: Debugging and Verbose Output

```bash
# Get detailed output for troubleshooting
claude-intern PROJ-123 --verbose

# Skip git operations if you have uncommitted changes
claude-intern PROJ-123 --no-git

# Increase max turns for complex tasks
claude-intern PROJ-123 --max-turns 50

# Skip automatic commit after Claude completes
claude-intern PROJ-123 --no-auto-commit

# Create pull request after implementation
claude-intern PROJ-123 --create-pr

# Create pull request targeting specific branch
claude-intern PROJ-123 --create-pr --pr-target-branch develop
```

### Scenario 5: Pull Request Integration

```bash
# Automatically create PR after implementation (GitHub or Bitbucket)
claude-intern PROJ-123 --create-pr

# Create PR targeting a specific branch instead of main
claude-intern PROJ-123 --create-pr --pr-target-branch develop

# Combine with other options
claude-intern PROJ-123 --create-pr --max-turns 50 --verbose

# PR creation works with both platforms:
# - GitHub: Detects from git remote, uses GITHUB_TOKEN
# - Bitbucket: Detects workspace from git remote, uses BITBUCKET_TOKEN
```

## Batch Processing Scenarios

### Scenario 6: Multiple Specific Tasks

Process multiple tasks by specifying their keys explicitly:

```bash
# Process 3 specific tasks sequentially
claude-intern PROJ-123 PROJ-124 PROJ-125

# With additional options
claude-intern PROJ-123 PROJ-124 PROJ-125 --create-pr --max-turns 300

# Skip Claude and just fetch all task details
claude-intern PROJ-123 PROJ-124 PROJ-125 --no-claude

# Each task gets its own output file:
# - /tmp/task-details-proj-123.md
# - /tmp/task-details-proj-124.md
# - /tmp/task-details-proj-125.md
```

### Scenario 7: JQL Query Processing

Use JIRA Query Language to dynamically select tasks:

```bash
# Process all "To Do" tasks in a project
claude-intern --jql "project = PROJ AND status = 'To Do'"

# Process tasks assigned to you
claude-intern --jql "assignee = currentUser() AND status = 'To Do'"

# Process frontend bugs with high priority
claude-intern --jql "labels = 'frontend' AND type = Bug AND priority = High"

# Complex query with custom fields
claude-intern --jql "project = \"My Project\" AND cf[10016] <= 3 AND labels IN (FrontEnd, MobileApp)"
```

### Scenario 8: Advanced Batch Operations

```bash
# Process all tasks in current sprint assigned to you
claude-intern --jql "assignee = currentUser() AND sprint in openSprints()"

# Process all tasks in a specific epic
claude-intern --jql "\"Epic Link\" = PROJ-100" --create-pr --pr-target-branch develop

# Process backlog items with specific story points
claude-intern --jql "status = 'Backlog' AND \"Story Points\" <= 5" --max-turns 300

# Process recent bugs (created in last 7 days)
claude-intern --jql "type = Bug AND created >= -7d" --skip-clarity-check
```

### Scenario 9: Batch Processing with Error Handling

```bash
# Process tasks with verbose output to see progress
claude-intern --jql "project = PROJ AND status = 'To Do'" --verbose

# Skip clarity checks for faster batch processing
claude-intern PROJ-101 PROJ-102 PROJ-103 --skip-clarity-check

# Continue processing even if some tasks fail
# (This is the default behavior - failed tasks don't stop the batch)
claude-intern --jql "labels = 'refactoring'" --max-turns 500

# Batch summary will show:
# - Total tasks processed
# - Number of successful implementations  
# - Number of failed tasks with error details
```

### Scenario 10: Batch Processing Output Management

```bash
# Custom output directory for batch processing
claude-intern PROJ-123 PROJ-124 -o /tmp/batch-tasks/task-details.md
# Creates:
# - /tmp/batch-tasks/task-details-proj-123.md
# - /tmp/batch-tasks/task-details-proj-124.md

# Process without Claude to review all tasks first
claude-intern --jql "sprint = 'Sprint 1'" --no-claude
# Then manually review the generated files before running Claude

# Format only mode for planning
claude-intern --jql "status = 'To Do'" --no-claude --no-git
```

## Environment Variable Locations

The tool looks for environment variables in this order:

1. **Current directory**: `.env` in your current working directory
2. **System environment**: Variables set in your shell
3. **Global config**: You can set these in your shell profile

```bash
# Option: Add to your ~/.zshrc or ~/.bashrc
export JIRA_BASE_URL="https://your-company.atlassian.net"
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"
export CLAUDE_CLI_PATH="claude"
# Optional: For PR creation
export GITHUB_TOKEN="your-github-token"
export BITBUCKET_TOKEN="your-bitbucket-token"
# Optional: Auto-transition JIRA status after PR creation
export JIRA_PR_STATUS="In Review"
```

## Git Integration Details

### Automatic Branch Creation

- Creates branches with format: `feature/task-id`
- Converts task keys to lowercase: `PROJ-123` → `feature/proj-123`
- Checks for uncommitted changes before creating branches
- Switches to existing branch if it already exists

### Automatic Commit

- Commits all changes after Claude successfully completes
- Uses descriptive commit message: `feat: implement TASK-123 - Task Summary`
- Includes attribution: "Implemented by Claude AI via claude-intern"
- Can be disabled with `--no-auto-commit` flag

### Pull Request Creation

- Automatically creates PRs on GitHub or Bitbucket after successful implementation
- Detects repository platform from git remote URL
- PR title format: `[TASK-123] Task Summary`
- PR body includes Claude's implementation details and links back to JIRA
- GitHub: Requires `GITHUB_TOKEN` environment variable
- Bitbucket: Requires `BITBUCKET_TOKEN`, workspace auto-detected from git remote
- Can be enabled with `--create-pr` flag
- Target branch can be specified with `--pr-target-branch` (defaults to 'main')

### Git Requirements

- Must be in a git repository
- No uncommitted changes (commit or stash first)
- Git must be available in PATH

### Handling Git Issues

```bash
# If you have uncommitted changes:
git add . && git commit -m "WIP: saving progress"
# or
git stash

# Then run claude-intern
claude-intern PROJ-123

# If you don't want git integration:
claude-intern PROJ-123 --no-git
```

## Troubleshooting

### Common Issues

1. **"Missing required environment variables"**

   - Ensure `.env` file exists in current directory
   - Or set environment variables in your shell
   - Check that variable names match exactly

2. **"Not in a git repository"**

   - Run `git init` if starting a new project
   - Or use `--no-git` flag to skip git operations

3. **"There are uncommitted changes"**

   - Commit your changes: `git add . && git commit -m "message"`
   - Or stash them: `git stash`
   - Or use `--no-git` to skip branch creation

4. **"Claude CLI not found"**

   - Install Claude CLI
   - Or specify path: `--claude-path /path/to/claude`

5. **"Issue not found"**

   - Check JIRA credentials
   - Verify task key exists and you have access
   - Ensure JIRA_BASE_URL is correct

6. **"Claude reached maximum turns limit"**
   - Task is too complex for the current turn limit
   - Increase max turns: `--max-turns 50`
   - Consider breaking the task into smaller subtasks
   - Review the task description for clarity

7. **"PR creation failed"**
   - Ensure you have the correct token configured (`GITHUB_TOKEN` or `BITBUCKET_TOKEN`)
   - Check token permissions (GitHub needs 'repo' scope, Bitbucket needs 'Repositories: Write')
   - Verify you're in a repository with a remote origin
   - Confirm the repository platform is detected correctly
   - Use `--verbose` flag to see detailed error messages

### Debug Mode

```bash
# Get detailed error information
claude-intern PROJ-123 --verbose
```

## Examples

### Complete Workflow Example

```bash
# 1. Navigate to your project
cd ~/projects/my-app

# 2. Ensure clean git state
git status
git add . && git commit -m "Current progress"

# 3. Run claude-intern
claude-intern MYAPP-456

# Output:
# 🔍 Fetching JIRA task: MYAPP-456
# 📋 Task Summary: [details...]
# 💾 Saving formatted task details to: ./task-details.md
# 🌿 Creating feature branch...
# ✅ Created and switched to new branch 'feature/myapp-456'
# 🤖 Running Claude with task details...
# [Claude implements the task...]
```

### Manual Step-by-Step Example

```bash
# 1. Get task details only
claude-intern MYAPP-456 --no-claude --no-git

# 2. Review the generated task-details.md
cat task-details.md

# 3. Create branch manually
git checkout -b feature/myapp-456

# 4. Run Claude manually
claude -p --dangerously-skip-permissions --max-turns 10 < task-details.md
```

## Uninstalling

```bash
# From the claude-intern directory
npm run uninstall-global

# Or manually
npm uninstall -g claude-intern
```
