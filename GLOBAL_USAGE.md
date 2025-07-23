# Running Claude Intern from Any Directory

## Quick Setup

1. **Install globally** (one-time setup):

```bash
cd /path/to/claude-intern
npm run install-global
```

2. **Set up environment** (in your project directory):

```bash
# Copy the sample environment file
cp /path/to/claude-intern/.env.sample .env

# Edit with your JIRA credentials
vim .env  # or your preferred editor
```

## Usage from Your Project Directory

Now you can run `claude-intern` from any directory, especially your project's git repository:

```bash
# Navigate to your project where you want to implement the task
cd ~/projects/my-awesome-app

# Ensure you have a .env file with JIRA credentials
ls -la .env

# Run claude-intern - it will:
# 1. Fetch JIRA task details
# 2. Create a feature branch (feature/task-id)
# 3. Run Claude to implement the task
claude-intern PROJ-123
```

## Example Workflow

```bash
# 1. Go to your project directory
cd ~/projects/my-app

# 2. Check git status (should be clean)
git status

# 3. Run claude-intern
claude-intern MYAPP-456

# Expected output:
# 🔍 Fetching JIRA task: MYAPP-456
# 📋 Task Summary: Implement user authentication
# 💾 Saving formatted task details to: ./task-details.md
# 🌿 Creating feature branch...
# ✅ Created and switched to new branch 'feature/myapp-456'
# 🤖 Running Claude with task details...
# [Claude implements the task...]
# ✅ Claude execution completed successfully
# 📝 Committing changes...
# ✅ Successfully committed changes for MYAPP-456
```

## Environment Options

### Option 1: Per-Project .env File (Recommended)

```bash
# In each project directory
cat > .env << EOF
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token
# Optional: For PR creation
GITHUB_TOKEN=your-github-token
BITBUCKET_TOKEN=your-bitbucket-token
# Optional: Auto-transition JIRA status after PR creation
JIRA_PR_STATUS="In Review"
EOF
```

### Option 2: Global Environment Variables

```bash
# Add to ~/.zshrc or ~/.bashrc
export JIRA_BASE_URL="https://your-company.atlassian.net"
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"
# Optional: For PR creation
export GITHUB_TOKEN="your-github-token"
export BITBUCKET_TOKEN="your-bitbucket-token"
# Optional: Auto-transition JIRA status after PR creation
export JIRA_PR_STATUS="In Review"
```

## Common Commands

```bash
# Standard usage (creates branch + runs Claude)
claude-intern PROJ-123

# Just fetch task details (no git/Claude)
claude-intern PROJ-123 --no-claude --no-git

# Skip git operations (if you have uncommitted changes)
claude-intern PROJ-123 --no-git

# Verbose output for debugging
claude-intern PROJ-123 --verbose

# Use custom .env file
claude-intern PROJ-123 --env-file ~/my-jira-config.env

# Custom output file
claude-intern PROJ-123 -o ~/tasks/proj-123.md

# Skip automatic commit
claude-intern PROJ-123 --no-auto-commit

# Create pull request after implementation
claude-intern PROJ-123 --create-pr

# Create pull request targeting specific branch
claude-intern PROJ-123 --create-pr --pr-target-branch develop
```

## Uninstalling

```bash
# From the claude-intern directory
cd /path/to/claude-intern
npm run uninstall-global

# Or manually
npm uninstall -g claude-intern
```

## Troubleshooting

- **"Missing environment variables"**: Create `.env` file in your project directory
- **"Not in git repository"**: Run `git init` or use `--no-git`
- **"Uncommitted changes"**: Commit changes or use `--no-git`
- **"Command not found"**: Reinstall globally or check PATH

## Benefits of Global Installation

✅ **Run from any directory** - especially your project repositories  
✅ **No need to navigate** to claude-intern directory  
✅ **Clean workflow** - work directly in your project context  
✅ **Git integration** works in your actual project repository  
✅ **Environment isolation** - each project can have its own `.env`
