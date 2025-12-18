# Environment Setup Guide

## Overview

Claude Intern needs JIRA credentials to fetch task details. You can provide these credentials in several ways, giving you maximum flexibility for different use cases.

## Required Environment Variables

```bash
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token-here
CLAUDE_CLI_PATH=claude  # Optional, defaults to 'claude'
```

## Optional Environment Variables (PR Integration)

```bash
# Option 1: GitHub Personal Access Token (for individual users)
GITHUB_TOKEN=your-github-token-here

# Option 2: GitHub App Authentication (for organizations)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
# Or base64-encoded: GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi4uLg==

# Bitbucket
BITBUCKET_TOKEN=your-bitbucket-token    # For Bitbucket PR creation
```

**Note:** JIRA PR status transitions are now configured per-project in `settings.json`.

### Option 1: GitHub Personal Access Token

When creating a GitHub personal access token, you need the following permissions:

**Classic Personal Access Token:**
- `repo` scope (Full control of private repositories)
- Or `public_repo` if you only work with public repositories

**Fine-grained Personal Access Token (recommended):**
- **Pull requests**: Read and write
- **Contents**: Read (needed to read branch info for the PR)

To create a GitHub token:
1. Go to https://github.com/settings/tokens
2. Choose "Fine-grained tokens" (recommended) or "Tokens (classic)"
3. For fine-grained tokens, select the specific repositories you need access to
4. Grant the permissions listed above
5. Set the token as `GITHUB_TOKEN` in your `.env` file

### Option 2: GitHub App Authentication

For organizations that want centralized control, create a GitHub App instead of using individual tokens.

**Required App permissions:**
- **Contents**: Read (to check branches)
- **Pull requests**: Read and write (to create PRs)

**Setup steps:**
1. Go to your organization's Settings → Developer settings → GitHub Apps → New GitHub App
2. Set repository permissions: Contents (Read), Pull requests (Read and write)
3. Disable webhooks (not needed)
4. Generate a private key after creating the App
5. Install the App on your repositories
6. Configure in your `.env`:
   ```bash
   GITHUB_APP_ID=123456
   GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
   ```

**For CI/CD environments**, use base64-encoded key:
```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi4uLg==
```

To encode: `base64 -i your-key.pem` (macOS) or `base64 -w 0 your-key.pem` (Linux)

**Note:** If both `GITHUB_TOKEN` and GitHub App credentials are set, `GITHUB_TOKEN` takes precedence.

### Bitbucket Token Permissions

When creating a Bitbucket app password:
- **Repositories**: Write permission

To create a Bitbucket app password:
1. Go to https://bitbucket.org/account/settings/app-passwords/
2. Click "Create app password"
3. Grant "Repositories: Write" permission
4. Set the token as `BITBUCKET_TOKEN` in your `.env` file

## Setup Methods (in order of precedence)

### 1. Custom .env File (--env-file option)

**Use case**: Different JIRA instances, shared configs, custom locations

```bash
# Create a custom env file anywhere
cat > ~/configs/work-jira.env << EOF
JIRA_BASE_URL=https://work-company.atlassian.net
JIRA_EMAIL=work-email@company.com
JIRA_API_TOKEN=work-api-token
GITHUB_TOKEN=work-github-token
EOF

cat > ~/configs/personal-jira.env << EOF
JIRA_BASE_URL=https://personal-company.atlassian.net
JIRA_EMAIL=personal-email@company.com
JIRA_API_TOKEN=personal-api-token
BITBUCKET_TOKEN=personal-bitbucket-token
EOF

# Use specific config
claude-intern WORK-123 --env-file ~/configs/work-jira.env
claude-intern PERSONAL-456 --env-file ~/configs/personal-jira.env
```

### 2. Project-Specific .env File

**Use case**: Different credentials per project

```bash
# In project A directory
cd ~/projects/project-a
cat > .env << EOF
JIRA_BASE_URL=https://projecta.atlassian.net
JIRA_EMAIL=projecta@company.com
JIRA_API_TOKEN=projecta-token
EOF

# In project B directory
cd ~/projects/project-b
cat > .env << EOF
JIRA_BASE_URL=https://projectb.atlassian.net
JIRA_EMAIL=projectb@company.com
JIRA_API_TOKEN=projectb-token
EOF

# Use from respective directories
cd ~/projects/project-a && claude-intern PROJA-123
cd ~/projects/project-b && claude-intern PROJB-456
```

### 3. Global .env File in Home Directory

**Use case**: Same JIRA instance for all projects

```bash
# Create global config
cat > ~/.env << EOF
JIRA_BASE_URL=https://company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token
EOF

# Works from any directory
cd anywhere && claude-intern PROJ-123
```

### 4. Shell Environment Variables

**Use case**: System-wide configuration, CI/CD environments

```bash
# Add to ~/.zshrc, ~/.bashrc, or ~/.profile
export JIRA_BASE_URL="https://company.atlassian.net"
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"
export CLAUDE_CLI_PATH="claude"

# Reload shell or source the file
source ~/.zshrc

# Works from any directory without any .env files
claude-intern PROJ-123
```

## Getting Your JIRA API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a descriptive name (e.g., "Claude Intern CLI")
4. Copy the generated token
5. Use it in your environment configuration

## Common Scenarios

### Scenario 1: Multiple JIRA Instances

```bash
# Work JIRA
cat > ~/work.env << EOF
JIRA_BASE_URL=https://work.atlassian.net
JIRA_EMAIL=work@company.com
JIRA_API_TOKEN=work-token
EOF

# Personal JIRA
cat > ~/personal.env << EOF
JIRA_BASE_URL=https://personal.atlassian.net
JIRA_EMAIL=personal@company.com
JIRA_API_TOKEN=personal-token
EOF

# Usage
claude-intern WORK-123 --env-file ~/work.env
claude-intern PERSONAL-456 --env-file ~/personal.env
```

### Scenario 2: Team Shared Configuration

```bash
# Team shared location
sudo mkdir -p /etc/claude-intern
sudo cat > /etc/claude-intern/team.env << EOF
JIRA_BASE_URL=https://team.atlassian.net
JIRA_EMAIL=team-account@company.com
JIRA_API_TOKEN=team-token
EOF

# Team members use
claude-intern TEAM-123 --env-file /etc/claude-intern/team.env
```

### Scenario 3: CI/CD Environment

```bash
# In your CI/CD pipeline
export JIRA_BASE_URL="https://company.atlassian.net"
export JIRA_EMAIL="ci-bot@company.com"
export JIRA_API_TOKEN="$CI_JIRA_TOKEN"  # From CI secrets

# No .env file needed
claude-intern BUILD-123 --no-git --no-claude
```

## Troubleshooting

### Debug Environment Loading

```bash
# See which .env file is being loaded
claude-intern PROJ-123 --verbose --no-claude

# Output will show:
# 📁 Loaded environment from: /path/to/env/file
```

### Common Issues

1. **"Missing required environment variables"**

   ```bash
   # Check what's loaded
   claude-intern PROJ-123 --verbose --no-claude

   # Verify file exists and has correct variables
   cat .env
   ```

2. **"Specified .env file not found"**

   ```bash
   # Check path is correct
   ls -la /path/to/your/env/file

   # Use absolute path
   claude-intern PROJ-123 --env-file /absolute/path/to/file.env
   ```

3. **Wrong JIRA instance being used**

   ```bash
   # Check which env file is loaded
   claude-intern PROJ-123 --verbose --no-claude

   # Override with specific file
   claude-intern PROJ-123 --env-file /path/to/correct.env
   ```

## Security Best Practices

1. **Never commit .env files to git**

   ```bash
   echo ".env" >> .gitignore
   echo "*.env" >> .gitignore
   ```

2. **Use restrictive file permissions**

   ```bash
   chmod 600 ~/.env
   chmod 600 ~/configs/*.env
   ```

3. **Use different tokens for different purposes**

   - Development: Personal token with limited scope
   - Production: Service account token
   - CI/CD: Dedicated automation token

4. **Regularly rotate API tokens**
   - Set calendar reminders to rotate tokens
   - Use descriptive names to track token usage
   - Revoke unused tokens

## Examples

### Quick Start Example

```bash
# 1. Create config
cat > ~/.env << EOF
JIRA_BASE_URL=https://mycompany.atlassian.net
JIRA_EMAIL=me@mycompany.com
JIRA_API_TOKEN=my-secret-token
EOF

# 2. Use from anywhere
cd ~/my-project
claude-intern MYPROJ-123
```

### Multi-Environment Example

```bash
# 1. Create environment configs
mkdir -p ~/.config/claude-intern

cat > ~/.config/claude-intern/staging.env << EOF
JIRA_BASE_URL=https://staging.atlassian.net
JIRA_EMAIL=staging@company.com
JIRA_API_TOKEN=staging-token
EOF

cat > ~/.config/claude-intern/prod.env << EOF
JIRA_BASE_URL=https://prod.atlassian.net
JIRA_EMAIL=prod@company.com
JIRA_API_TOKEN=prod-token
EOF

# 2. Use with specific environments
claude-intern STAGE-123 --env-file ~/.config/claude-intern/staging.env
claude-intern PROD-456 --env-file ~/.config/claude-intern/prod.env
```
