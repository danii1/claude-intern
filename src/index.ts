#!/usr/bin/env node

import { type ChildProcess, execSync, spawn } from "child_process";
import { program } from "commander";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { ClaudeFormatter } from "./lib/claude-formatter";
import { GitHubAppAuth } from "./lib/github-app-auth";
import { JiraClient } from "./lib/jira-client";
import { LockManager } from "./lib/lock-manager";
import { PRManager } from "./lib/pr-client";
import { Utils } from "./lib/utils";
import { runClaudeToFixGitHook } from "./lib/git-hook-fixer";
import { runAutoReviewLoop } from "./lib/auto-review-loop";
import type { ProjectSettings } from "./types/settings";

// Version is injected at build time via --define flag, or read from package.json in dev
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0";

// Get the directory of this script at runtime (works in both ESM and bundled environments)
const __filename_resolved = fileURLToPath(import.meta.url);
const __dirname_resolved = dirname(__filename_resolved);

interface ProgramOptions {
  claude: boolean;
  claudePath: string;
  envFile?: string;
  git: boolean;
  verbose: boolean;
  maxTurns: string;
  autoCommit: boolean;
  skipClarityCheck: boolean; // New option to skip clarity check
  createPr: boolean; // New option to create pull request
  prTargetBranch: string; // Target branch for PR
  autoReview: boolean; // New option to run automatic PR review loop
  autoReviewIterations: string; // Max iterations for auto-review loop
  jql?: string; // JQL query for batch processing
  skipJiraComments: boolean; // New option to skip posting comments to JIRA
  hookRetries: string; // Number of retries for git hook failures
}

interface ClarityAssessment {
  isImplementable: boolean;
  clarityScore: number;
  issues: Array<{
    category: string;
    description: string;
    severity: "critical" | "major" | "minor";
  }>;
  recommendations: string[];
  summary: string;
}

// Initialize project-specific configuration folder
async function initializeProject(): Promise<void> {
  const configDir = resolve(process.cwd(), ".claude-intern");
  const envFile = join(configDir, ".env");
  const envSampleFile = join(configDir, ".env.sample");

  console.log("🚀 Initializing Claude Intern for this project...");

  // Check if .claude-intern folder already exists
  if (existsSync(configDir)) {
    console.log(`\n⚠️  Configuration folder already exists: ${configDir}`);

    // Check if .env file exists
    if (existsSync(envFile)) {
      console.log("✅ .env file found");
    } else {
      console.log("⚠️  .env file not found");
    }

    console.log("\n💡 To reconfigure, either:");
    console.log(`   1. Delete the folder: rm -rf ${configDir}`);
    console.log("   2. Or edit the files directly");
    return;
  }

  // Create .claude-intern folder
  try {
    mkdirSync(configDir, { recursive: true });
    console.log(`✅ Created configuration folder: ${configDir}`);
  } catch (error) {
    console.error(`❌ Failed to create configuration folder: ${error}`);
    process.exit(1);
  }

  // Create .env.sample file with template
  const envSampleContent = `# Claude Intern Environment Configuration
# Copy this file to .env and update with your actual values

# JIRA Configuration
# Your JIRA instance URL (without trailing slash)
JIRA_BASE_URL=https://your-company.atlassian.net

# Your JIRA email address
JIRA_EMAIL=your-email@company.com

# Your JIRA API token
# Create one at: https://id.atlassian.com/manage-profile/security/api-tokens
# Option 1: Just the API token (will be combined with email above)
JIRA_API_TOKEN=your-api-token-here
# Option 2: If your token already includes email, use format: email@company.com:api-token
# JIRA_API_TOKEN=your-email@company.com:your-api-token-here

# Optional: Claude CLI Configuration
# Path to Claude CLI executable (defaults to 'claude' if not specified)
CLAUDE_CLI_PATH=claude

# Note: Claude will be run with --dangerously-skip-permissions and --max-turns 10
# This allows for elevated permissions and extended conversations for complex tasks

# Optional: Output Directory Configuration
# Base directory for saving task-related files (defaults to /tmp/claude-intern-tasks)
# CLAUDE_INTERN_OUTPUT_DIR=/tmp/claude-intern-tasks

# Optional: Enable verbose logging by default
# VERBOSE=true

# Optional: Pull Request Integration
#
# Option 1: GitHub Personal Access Token (for individual users)
# Create at: https://github.com/settings/tokens
# Required permissions:
#   - Classic token: 'repo' scope (or 'public_repo' for public repos only)
#   - Fine-grained token (recommended): 'Pull requests: Read and write' + 'Contents: Read'
# GITHUB_TOKEN=your-github-token-here
#
# Option 2: GitHub App Authentication (for organizations)
# Each organization creates their own GitHub App for centralized control.
# Create at: https://github.com/settings/apps (or your org's settings)
# Required App permissions:
#   - Repository permissions:
#     - Contents: Read (to check branches)
#     - Pull requests: Read and write (to create PRs)
# After creating the App, generate a private key and install the App on your repositories.
#
# GITHUB_APP_ID=123456
# Private key can be provided as a file path:
# GITHUB_APP_PRIVATE_KEY_PATH=/path/to/your-app.private-key.pem
# Or as base64-encoded content (useful for CI/CD environments):
# To encode: base64 -i your-key.pem (macOS) or base64 -w 0 your-key.pem (Linux)
# GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi4uLg==
#
# Note: If both GITHUB_TOKEN and GitHub App credentials are set, GITHUB_TOKEN takes precedence.

# Bitbucket app password for creating pull requests
# Create at: https://bitbucket.org/account/settings/app-passwords/
# Required permissions: 'Repositories: Write'
# BITBUCKET_TOKEN=your-bitbucket-app-password-here

# Note: Bitbucket workspace is automatically detected from your git remote URL
`;

  try {
    writeFileSync(envSampleFile, envSampleContent, "utf8");
    console.log(`✅ Created template file: ${envSampleFile}`);
  } catch (error) {
    console.error(`❌ Failed to create .env.sample: ${error}`);
    process.exit(1);
  }

  // Create empty .env file for user to fill in
  try {
    writeFileSync(envFile, envSampleContent, "utf8");
    console.log(`✅ Created configuration file: ${envFile}`);
  } catch (error) {
    console.error(`❌ Failed to create .env file: ${error}`);
    process.exit(1);
  }

  // Create settings.json for per-project configuration
  const settingsFile = join(configDir, "settings.json");
  const settingsContent = {
    projects: {
      "PROJECT-KEY": {
        inProgressStatus: "In Progress",
        todoStatus: "To Do",
        prStatus: "In Review"
      }
    }
  };

  const settingsJsonString = JSON.stringify(settingsContent, null, 2);

  try {
    writeFileSync(settingsFile, settingsJsonString, "utf8");
    console.log(`✅ Created settings file: ${settingsFile}`);
  } catch (error) {
    console.error(`❌ Failed to create settings.json: ${error}`);
    process.exit(1);
  }

  // Update .gitignore to exclude .claude-intern/.env, lock file, and review worktree
  const gitignorePath = join(process.cwd(), ".gitignore");
  const gitignoreEntries = [
    ".claude-intern/.env",
    ".claude-intern/.env.local",
    ".claude-intern/.pid.lock"
  ];

  try {
    let gitignoreContent = "";
    let gitignoreExists = false;

    // Read existing .gitignore if it exists
    if (existsSync(gitignorePath)) {
      gitignoreContent = readFileSync(gitignorePath, "utf8");
      gitignoreExists = true;
    }

    // Check if entries already exist
    const entriesToAdd = gitignoreEntries.filter(
      (entry) => !gitignoreContent.includes(entry)
    );

    if (entriesToAdd.length > 0) {
      // Add entries to .gitignore
      const newEntries = [
        "",
        "# Claude Intern - Keep credentials secure",
        ...entriesToAdd,
      ].join("\n");

      // Ensure there's a newline at the end of existing content if it exists
      if (gitignoreContent && !gitignoreContent.endsWith("\n")) {
        gitignoreContent += "\n";
      }

      writeFileSync(gitignorePath, gitignoreContent + newEntries + "\n", "utf8");
      console.log(
        `✅ Updated .gitignore to exclude ${entriesToAdd.join(", ")}`
      );
    } else if (gitignoreExists) {
      console.log("✅ .gitignore already excludes .claude-intern/.env");
    }
  } catch (error) {
    console.warn(
      `⚠️  Could not update .gitignore automatically: ${error}`
    );
    console.log(
      "   Please manually add '.claude-intern/.env' to your .gitignore"
    );
  }

  console.log("\n🎉 Project initialized successfully!");
  console.log("\n📝 Next steps:");
  console.log(`   1. Edit ${envFile}`);
  console.log("      - Add your JIRA credentials");
  console.log(`   2. Edit ${settingsFile} (optional)`);
  console.log("      - Configure per-project PR status transitions");
  console.log("   3. Run 'claude-intern <TASK-KEY>' to start working on tasks");
}

// Load project settings from .claude-intern/settings.json
function loadProjectSettings(): ProjectSettings | null {
  const settingsPath = resolve(process.cwd(), ".claude-intern", "settings.json");

  if (!existsSync(settingsPath)) {
    return null;
  }

  try {
    const settingsContent = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(settingsContent) as ProjectSettings;
    return settings;
  } catch (error) {
    console.warn(`⚠️  Failed to parse settings.json: ${error}`);
    return null;
  }
}

// Get PR status for a specific project key
function getPrStatusForProject(projectKey: string, settings: ProjectSettings | null): string | undefined {
  // Check settings.json for project-specific configuration
  return settings?.projects?.[projectKey]?.prStatus;
}

// Get In Progress status for a specific project key
function getInProgressStatusForProject(projectKey: string, settings: ProjectSettings | null): string | undefined {
  return settings?.projects?.[projectKey]?.inProgressStatus;
}

// Get To Do status for a specific project key
function getTodoStatusForProject(projectKey: string, settings: ProjectSettings | null): string | undefined {
  return settings?.projects?.[projectKey]?.todoStatus;
}

// Load environment variables from multiple possible locations
function loadEnvironment(envFile?: string): void {
  // If user specified a custom env file, use that first
  if (envFile) {
    const customEnvPath = resolve(envFile);
    if (existsSync(customEnvPath)) {
      config({ path: customEnvPath });
      console.log(`📁 Loaded environment from custom file: ${customEnvPath}`);
      return;
    }
    console.error(`❌ Specified .env file not found: ${customEnvPath}`);
    process.exit(1);
  }

  // Otherwise, check standard locations with priority order
  const envPaths = [
    resolve(process.cwd(), ".claude-intern", ".env"), // Project-specific config (highest priority)
    resolve(process.cwd(), ".env"), // Current working directory
    resolve(process.env.HOME || "~", ".env"), // Home directory
    resolve(__dirname_resolved, "..", ".env"), // Claude-intern directory (for development)
  ];

  let envLoaded = false;
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      config({ path: envPath });
      envLoaded = true;
      break;
    }
  }

  if (!envLoaded) {
    // Try to load from current directory one more time silently
    const cwdEnv = resolve(process.cwd(), ".env");
    if (existsSync(cwdEnv)) {
      config({ path: cwdEnv });
    }
  }
}

// Check if running subcommands before parsing
// This needs to happen early to avoid Commander treating them as task keys
if (process.argv[2] === "init") {
  (async () => {
    await initializeProject();
    process.exit(0);
  })();
} else if (process.argv[2] === "serve") {
  // Handle serve command - start webhook server
  (async () => {
    // Load environment for webhook server
    loadEnvironment();

    // Parse serve-specific options
    const args = process.argv.slice(3);
    let port = parseInt(process.env.WEBHOOK_PORT || "3000", 10);
    let host = process.env.WEBHOOK_HOST || "0.0.0.0";

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--port" && args[i + 1]) {
        port = parseInt(args[i + 1], 10);
        i++;
      } else if (args[i] === "--host" && args[i + 1]) {
        host = args[i + 1];
        i++;
      } else if (args[i] === "--help" || args[i] === "-h") {
        console.log("Usage: claude-intern serve [options]");
        console.log("");
        console.log("Start the webhook server to automatically address PR review feedback");
        console.log("");
        console.log("Options:");
        console.log("  --port <port>  Port to listen on (default: 3000, or WEBHOOK_PORT env var)");
        console.log("  --host <host>  Host to bind to (default: 0.0.0.0, or WEBHOOK_HOST env var)");
        console.log("  -h, --help     Display this help message");
        console.log("");
        console.log("Environment variables:");
        console.log("  WEBHOOK_SECRET      (required) Secret for verifying GitHub webhook signatures");
        console.log("  WEBHOOK_PORT        Port to listen on (default: 3000)");
        console.log("  WEBHOOK_HOST        Host to bind to (default: 0.0.0.0)");
        console.log("  WEBHOOK_AUTO_REPLY  Set to 'true' to automatically reply to review comments");
        console.log("  WEBHOOK_VALIDATE_IP Set to 'true' to only accept requests from GitHub IPs");
        console.log("  WEBHOOK_DEBUG       Set to 'true' for verbose logging");
        console.log("");
        console.log("See docs/WEBHOOK-DEPLOYMENT.md for deployment instructions.");
        process.exit(0);
      }
    }

    // Import and start webhook server
    const { startWebhookServer } = await import("./webhook-server");
    startWebhookServer({ port, host });
  })();
} else if (process.argv[2] === "address-review") {
  // Handle address-review command - manually address PR review feedback
  (async () => {
    // Load environment
    loadEnvironment();

    // Parse address-review options
    const args = process.argv.slice(3);
    let prUrl: string | undefined;
    let noPush = false;
    let noReply = false;
    let verbose = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--no-push") {
        noPush = true;
      } else if (args[i] === "--no-reply") {
        noReply = true;
      } else if (args[i] === "-v" || args[i] === "--verbose") {
        verbose = true;
      } else if (args[i] === "--help" || args[i] === "-h") {
        console.log("Usage: claude-intern address-review <pr-url> [options]");
        console.log("");
        console.log("Manually address PR review feedback using Claude");
        console.log("");
        console.log("Arguments:");
        console.log("  pr-url         GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)");
        console.log("");
        console.log("Options:");
        console.log("  --no-push      Don't push changes after fixing");
        console.log("  --no-reply     Don't post a reply comment on the PR");
        console.log("  -v, --verbose  Enable verbose logging");
        console.log("  -h, --help     Display this help message");
        console.log("");
        console.log("Examples:");
        console.log("  claude-intern address-review https://github.com/owner/repo/pull/123");
        console.log("  claude-intern address-review https://github.com/owner/repo/pull/123 --no-push");
        process.exit(0);
      } else if (!args[i].startsWith("-")) {
        prUrl = args[i];
      }
    }

    if (!prUrl) {
      console.error("❌ Error: PR URL is required");
      console.error("");
      console.error("Usage: claude-intern address-review <pr-url>");
      console.error("Run 'claude-intern address-review --help' for more information.");
      process.exit(1);
    }

    // Import and run address-review
    const { addressReview } = await import("./lib/address-review");
    try {
      await addressReview(prUrl, { noPush, noReply, verbose });
    } catch (error) {
      console.error(`❌ Error: ${(error as Error).message}`);
      process.exit(1);
    }
  })();
} else {
  // Load environment variables early (before CLI parsing)
  loadEnvironment();
}

// Function to find executable in PATH (cross-platform)
function findInPath(command: string): string | null {
  try {
    const isWindows = process.platform === "win32";
    const whichCommand = isWindows ? "where" : "which";
    const result = execSync(`${whichCommand} ${command}`, {
      encoding: "utf8",
      stdio: "pipe",
    });
    return result.trim().split("\n")[0]; // Take first result on Windows
  } catch {
    return null;
  }
}

// Function to resolve Claude CLI path
function resolveClaudePath(providedPath?: string): string {
  // Determine the command to resolve
  let commandToResolve = providedPath;

  // If no path provided, check environment variable
  if (!commandToResolve) {
    commandToResolve = process.env.CLAUDE_CLI_PATH || "claude";
  }

  // If user provided a specific non-default path, use it as-is
  if (
    providedPath &&
    providedPath !== "claude" &&
    !providedPath.includes("/")
  ) {
    // It's likely a command name, try to find it in PATH first
    const whichResult = findInPath(providedPath);
    if (whichResult) {
      return whichResult;
    }
    return providedPath;
  }

  // If it's an absolute path, use it directly
  if (commandToResolve.startsWith("/") || commandToResolve.includes(":")) {
    return commandToResolve;
  }

  // If it's a relative path, resolve it from current working directory
  if (commandToResolve.includes("/")) {
    const resolvedPath = resolve(process.cwd(), commandToResolve);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  // Try to find the command in PATH
  const whichResult = findInPath(commandToResolve);
  if (whichResult) {
    return whichResult;
  }

  // Final fallback
  return commandToResolve;
}

// Configure CLI
program
  .name("claude-intern")
  .description(
    "Your AI intern for automatically implementing JIRA tasks using Claude. Supports single tasks, multiple tasks, or JQL queries for batch processing."
  )
  .version(VERSION)
  .argument("[task-keys...]", "JIRA task key(s) (e.g., PROJ-123) or use --jql for query-based selection")
  .option(
    "--jql <query>",
    "JQL query to fetch multiple issues (e.g., \"project = PROJ AND status = 'To Do'\")"
  )
  .option("--no-claude", "Skip running Claude, just fetch and format the task")
  .option(
    "--claude-path <path>",
    "Path to Claude CLI executable",
    resolveClaudePath()
  )
  .option("--env-file <path>", "Path to .env file")
  .option("--no-git", "Skip git branch creation")
  .option("-v, --verbose", "Verbose output")
  .option("--max-turns <number>", "Maximum number of turns for Claude", "25")
  .option(
    "--no-auto-commit",
    "Skip automatic git commit after Claude completes"
  )
  .option("--skip-clarity-check", "Skip running Claude for clarity assessment")
  .option("--create-pr", "Create pull request after implementation")
  .option(
    "--pr-target-branch <branch>",
    "Target branch for pull request",
    "main"
  )
  .option(
    "--auto-review",
    "Run automatic PR review loop after creating PR (requires --create-pr)"
  )
  .option(
    "--auto-review-iterations <number>",
    "Maximum iterations for auto-review loop",
    "5"
  )
  .option(
    "--skip-jira-comments",
    "Skip posting comments to JIRA (for testing)"
  )
  .option(
    "--hook-retries <number>",
    "Number of retry attempts for git hook failures",
    "10"
  );

// Only parse with Commander if we're not running a subcommand
const isSubcommand = ['init', 'serve', 'address-review'].includes(process.argv[2]);
if (!isSubcommand) {
  program.parse();
}

const options = isSubcommand ? {} as ProgramOptions : program.opts<ProgramOptions>();
const taskKeys = isSubcommand ? [] : program.args;

// Reload environment variables if custom env file was specified
if (options.envFile) {
  loadEnvironment(options.envFile);
} else if (options.verbose) {
  console.log("⚠️  No .env file found in standard locations");
  console.log("   Checked:");
  const envPaths = [
    resolve(process.cwd(), ".claude-intern", ".env"),
    resolve(process.cwd(), ".env"),
    resolve(process.env.HOME || "~", ".env"),
    resolve(__dirname_resolved, "..", ".env"),
  ];
  envPaths.forEach((path) => console.log(`   - ${path}`));
}

// Resolve the final Claude path
const resolvedClaudePath = resolveClaudePath(options.claudePath);
if (options.verbose) {
  console.log(`🤖 Claude CLI path resolved to: ${resolvedClaudePath}`);
}

// Validate environment variables
function validateEnvironment(): void {
  const required = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error(
      "\nPlease ensure you have a .env file in one of these locations:"
    );
    console.error(`   - Project-specific: ${resolve(process.cwd(), ".claude-intern", ".env")}`);
    console.error(`   - Current directory: ${resolve(process.cwd(), ".env")}`);
    console.error(
      `   - Home directory: ${resolve(process.env.HOME || "~", ".env")}`
    );
    console.error("\nOr specify a custom .env file with --env-file <path>");
    console.error("Or set these environment variables in your shell.");
    console.error("\n💡 Quick start: Run 'claude-intern init' to create project-specific configuration");
    process.exit(1);
  }
}

// Function to process a single task
async function processSingleTask(
  taskKey: string,
  taskIndex = 0,
  totalTasks = 1
): Promise<void> {
  try {
    const taskPrefix =
      totalTasks > 1 ? `[${taskIndex + 1}/${totalTasks}] ` : "";
    console.log(`${taskPrefix}🔍 Fetching JIRA task: ${taskKey}`);

    // Validate environment
    validateEnvironment();

    // Initialize JIRA client
    const jiraClient = new JiraClient(
      process.env.JIRA_BASE_URL!,
      process.env.JIRA_EMAIL!,
      process.env.JIRA_API_TOKEN!
    );

    // Fetch task details
    if (options.verbose) {
      console.log("📥 Fetching issue details...");
    }
    const issue = await jiraClient.getIssue(taskKey);

    // Load project settings to get status transitions
    const projectSettings = loadProjectSettings();
    const projectKey = taskKey.split('-')[0];

    // Check if incomplete implementation comment exists with unchanged description
    // If so, skip processing to avoid redundant work
    if (options.claude && !options.skipJiraComments) {
      console.log("🔍 Checking for previous incomplete implementation attempts...");

      // Import JiraExtractor to properly extract text from ADF
      const { JiraExtractor } = await import("./lib/jira-extractor");
      const descriptionText = JiraExtractor.extractTextFromADF(issue.fields?.description);

      const hasDuplicate = await jiraClient.hasIncompleteImplementationComment(
        taskKey,
        descriptionText
      );

      if (hasDuplicate) {
        console.log(`\n⏭️  Skipping ${taskKey} - incomplete implementation comment already exists`);
        console.log("   Task description hasn't changed since last incomplete attempt");
        console.log("   Please update the task description with more details before retrying");
        console.log();

        // For batch processing, just return to continue with next task
        // For single task processing, this will end execution
        if (totalTasks > 1) {
          return;
        }
        // Release lock before exiting
        if (lockManager) {
          lockManager.release();
        }
        process.exit(0);
      }
    }

    if (options.verbose) {
      console.log("💬 Fetching comments...");
    }
    console.log("💬 Fetching comments...");
    const comments = await jiraClient.getIssueComments(taskKey);
    console.log(`✅ Successfully fetched ${comments.length} comments`);

    if (options.verbose) {
      console.log("🔗 Extracting linked resources...");
    }
    console.log("🔗 Extracting linked resources...");
    const linkedResources = jiraClient.extractLinkedResources(issue);
    console.log(
      `✅ Successfully extracted ${linkedResources.length} linked resources`
    );

    // Fetch detailed related work items
    console.log("🔗 Fetching related work items...");
    const relatedIssues = await jiraClient.getRelatedWorkItems(issue);
    console.log(
      `✅ Successfully fetched ${relatedIssues.length} related work items`
    );

    // Format task details
    console.log("📝 Formatting task details...");
    console.log(
      "🔍 Issue structure:",
      JSON.stringify(
        {
          key: issue.key,
          hasFields: !!issue.fields,
          fieldKeys: issue.fields ? Object.keys(issue.fields) : [],
          summary: issue.fields?.summary,
          issueType: issue.fields?.issuetype,
        },
        null,
        2
      )
    );

    let taskDetails;
    try {
      taskDetails = jiraClient.formatIssueDetails(
        issue,
        comments,
        linkedResources,
        relatedIssues
      );
      console.log("✅ Successfully formatted task details");
    } catch (formatError) {
      console.error("❌ Error formatting task details:", formatError);
      throw formatError;
    }

    // Display summary
    console.log("\n📋 Task Summary:");
    console.log(`   Key: ${taskDetails.key}`);
    console.log(`   Summary: ${taskDetails.summary}`);
    console.log(`   Type: ${taskDetails.issueType}`);
    console.log(`   Status: ${taskDetails.status}`);
    console.log(`   Priority: ${taskDetails.priority || "Not specified"}`);
    console.log(`   Assignee: ${taskDetails.assignee || "Unassigned"}`);

    if (linkedResources.length > 0) {
      console.log(`   Linked Resources: ${linkedResources.length} found`);
      if (options.verbose) {
        linkedResources.forEach((resource) => {
          if (resource.url) {
            console.log(`     - ${resource.description}: ${resource.url}`);
          } else if (resource.issueKey) {
            console.log(`     - ${resource.linkType}: ${resource.issueKey}`);
          }
        });
      }
    }

    if (relatedIssues.length > 0) {
      console.log(`   Related Work Items: ${relatedIssues.length} found`);
      if (options.verbose) {
        relatedIssues.forEach((relatedIssue) => {
          console.log(
            `     - ${relatedIssue.linkType}: ${relatedIssue.key} - ${relatedIssue.summary} (${relatedIssue.status})`
          );
        });
      }
    }

    if (comments.length > 0) {
      console.log(`   Comments: ${comments.length} found`);
    }

    // Extract target branch from task description if present
    // This allows per-task branch targeting via patterns like "Target branch: develop"
    // Falls back to --pr-target-branch CLI option (default: main)
    let effectiveTargetBranch = options.prTargetBranch;
    const { JiraExtractor } = await import("./lib/jira-extractor");
    const descriptionText = JiraExtractor.extractTextFromADF(issue.fields?.description);
    const extractedBranch = Utils.extractTargetBranch(descriptionText);

    if (extractedBranch) {
      console.log(`   🎯 Detected target branch from description: ${extractedBranch}`);
      if (options.verbose) {
        // Show context around the match for debugging
        const lines = descriptionText?.split('\n') || [];
        const matchingLine = lines.find(line => line.toLowerCase().includes('target branch') || line.toLowerCase().includes('base branch'));
        if (matchingLine) {
          console.log(`      Context: "${matchingLine.substring(0, 100)}${matchingLine.length > 100 ? '...' : ''}"`);
        }
      }
      effectiveTargetBranch = extractedBranch;
    } else {
      console.log(`   🎯 Using target branch: ${effectiveTargetBranch} (from CLI option)`);
    }

    // Create unified task-specific directory structure
    const baseOutputDir =
      process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
    const taskDir = join(baseOutputDir, taskKey.toLowerCase());
    const taskFileName = "task-details.md";

    // Create task directory if it doesn't exist
    mkdirSync(taskDir, { recursive: true });

    const outputFile = join(taskDir, taskFileName);
    const attachmentDir = join(taskDir, "attachments");

    // Download attachments automatically - both direct attachments and embedded ones
    let attachmentMap: Map<string, string> | undefined;

    // First, download direct attachments
    if (taskDetails.attachments.length > 0) {
      console.log(
        `\n📎 Downloading ${taskDetails.attachments.length} direct attachments...`
      );
      attachmentMap = await jiraClient.downloadIssueAttachments(
        taskKey,
        attachmentDir
      );
    } else {
      attachmentMap = new Map<string, string>();
    }

    // Then, scan all HTML content for embedded attachment URLs
    console.log("\n🔍 Scanning content for embedded attachments...");
    let allHtmlContent = "";

    // Collect all HTML content from descriptions and comments
    if (taskDetails.renderedDescription) {
      allHtmlContent += taskDetails.renderedDescription;
    }

    // Add comments
    taskDetails.comments.forEach((comment) => {
      if (comment.renderedBody) {
        allHtmlContent += comment.renderedBody;
      }
    });

    // Add related issues HTML content
    relatedIssues.forEach((relatedIssue) => {
      if (relatedIssue.renderedDescription) {
        allHtmlContent += relatedIssue.renderedDescription;
      }
    });

    // Download embedded attachments
    if (allHtmlContent) {
      attachmentMap = await jiraClient.downloadAttachmentsFromContent(
        allHtmlContent,
        attachmentDir,
        attachmentMap
      );
    }

    if (attachmentMap.size > 0) {
      console.log(
        `✅ Downloaded ${attachmentMap.size} total attachments to: ${attachmentDir}`
      );
    }
    console.log(`\n💾 Saving formatted task details to: ${outputFile}`);
    ClaudeFormatter.saveFormattedTask(
      taskDetails,
      outputFile,
      process.env.JIRA_BASE_URL!,
      attachmentMap
    );

    // Run Claude if requested
    if (options.claude) {
      // Create feature branch before running Claude (unless disabled)
      if (options.git) {
        console.log("\n🌿 Creating feature branch...");
        const branchResult = await Utils.createFeatureBranch(
          taskKey,
          effectiveTargetBranch
        );

        if (branchResult.success) {
          console.log(`✅ ${branchResult.message}`);
        } else {
          // Branch creation failed - this is critical for safety
          console.error(`\n❌ Failed to create feature branch: ${branchResult.message}`);

          if (branchResult.message.includes("uncommitted changes")) {
            console.error("Please commit or stash your changes before running claude-intern.");
            console.error('You can use: git add . && git commit -m "your commit message"');
          } else {
            console.error("Cannot proceed without a feature branch to prevent accidental commits to main/master.");
            console.error(`\nPlease create a feature branch manually:`);
            console.error(`   git checkout -b feature/${taskKey.toLowerCase()}`);
            console.error(`\nThen run claude-intern again with --no-git flag:`);
            console.error(`   claude-intern ${taskKey} --no-git`);
          }

          // Release lock before exiting
          if (lockManager) {
            lockManager.release();
          }
          process.exit(1);
        }
      }

      // Run clarity check first (unless skipped)
      if (!options.skipClarityCheck) {
        console.log("\n🔍 Running basic feasibility assessment...");
        console.log(
          "   (Checking for fundamental requirements only - technical details will be inferred from code)"
        );
        // Use temporary file for clarity assessment input (will be cleaned up)
        const { tmpdir } = require("os");
        const clarityFile = join(tmpdir(), `clarity-${taskKey.toLowerCase()}-${Date.now()}.md`);
        ClaudeFormatter.saveClarityAssessment(
          taskDetails,
          clarityFile,
          process.env.JIRA_BASE_URL!,
          attachmentMap
        );

        try {
          const assessment = await runClarityCheck(
            clarityFile,
            resolvedClaudePath,
            taskKey,
            jiraClient,
            options.skipJiraComments
          );

          if (assessment && !assessment.isImplementable) {
            // For batch processing, log and continue; for single task, exit
            if (totalTasks > 1) {
              console.log(
                `\n⚠️  Task ${taskKey} failed clarity assessment but continuing with batch processing...`
              );
            } else {
              // Exit early if task is not clear enough (single task mode)
              // Release lock before exiting
              if (lockManager) {
                lockManager.release();
              }
              process.exit(1);
            }
          }

          // Clean up temporary clarity file
          try {
            require("fs").unlinkSync(clarityFile);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        } catch (clarityError) {
          console.warn(
            "⚠️  Feasibility check failed, continuing with implementation:",
            clarityError
          );
          console.log(
            "   You can skip feasibility checks with --skip-clarity-check"
          );

          // Clean up temporary clarity file on error too
          try {
            require("fs").unlinkSync(clarityFile);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        }
      }

      // Transition task to "In Progress" now that we're actually starting implementation
      // (after clarity check passed or was skipped)
      if (!options.skipJiraComments) {
        const inProgressStatus = getInProgressStatusForProject(projectKey, projectSettings);
        if (inProgressStatus && inProgressStatus.trim()) {
          try {
            console.log(`\n🔄 Transitioning ${taskKey} to '${inProgressStatus}'...`);
            await jiraClient.transitionIssue(taskKey, inProgressStatus.trim());
            console.log(`✅ Task moved to '${inProgressStatus}'`);
          } catch (statusError) {
            console.warn(
              `⚠️  Failed to transition task to '${inProgressStatus}': ${
                (statusError as Error).message
              }`
            );
            console.log("   Continuing with task processing...");
          }
        }
      }

      // Get GitHub App author info for commits if configured
      let gitAuthor: { name: string; email: string } | undefined;
      if (options.git && options.autoCommit && !process.env.GITHUB_TOKEN) {
        const githubAppAuth = GitHubAppAuth.fromEnvironment();
        if (githubAppAuth) {
          try {
            gitAuthor = await githubAppAuth.getGitAuthor();
            console.log(`🤖 Commits will be authored by: ${gitAuthor.name}`);
          } catch (error) {
            console.warn(`⚠️  Could not get GitHub App author info: ${(error as Error).message}`);
            console.log("   Commits will use local git config instead.");
          }
        }
      }

      console.log("\n🤖 Running Claude with task details...");
      await runClaude(
        outputFile,
        resolvedClaudePath,
        Number.parseInt(options.maxTurns),
        taskKey,
        taskDetails.summary,
        options.git && options.autoCommit,
        issue,
        options.createPr,
        effectiveTargetBranch,
        jiraClient,
        options.skipJiraComments,
        Number.parseInt(options.hookRetries),
        projectSettings,
        gitAuthor,
        options.autoReview,
        Number.parseInt(options.autoReviewIterations)
      );
    } else {
      console.log("\n✅ Task details saved. You can now:");
      console.log("   1. Create a feature branch manually:");
      console.log(`      git checkout -b feature/${taskKey.toLowerCase()}`);
      console.log("   2. Run clarity check:");
      console.log(
        `      ${resolvedClaudePath} -p --dangerously-skip-permissions --max-turns 10 < ${outputFile.replace(
          ".md",
          "-clarity.md"
        )}`
      );
      console.log("   3. Run Claude:");
      console.log(
        `      ${resolvedClaudePath} -p --dangerously-skip-permissions --max-turns ${options.maxTurns} < ${outputFile}`
      );
      console.log("   4. Commit changes:");
      console.log('      git add . && git commit -m "feat: implement task"');
      console.log(
        "\n   Or run this script again with the same task key to automatically create the branch, run clarity check, invoke Claude, and commit changes."
      );
    }
  } catch (error) {
    const err = error as Error;
    const taskPrefix =
      totalTasks > 1 ? `[${taskIndex + 1}/${totalTasks}] ` : "";
    console.error(
      `${taskPrefix}❌ Error processing ${taskKey}: ${err.message}`
    );
    if (options.verbose && err.stack) {
      console.error(err.stack);
    }

    // For batch processing, throw the error to be handled by the main function
    // For single task processing, exit immediately
    if (totalTasks > 1) {
      throw error;
    }
    process.exit(1);
  }
}

// Global lock manager instance
let lockManager: LockManager | null = null;

// Main execution function
async function main(): Promise<void> {
  try {
    // Acquire lock to prevent multiple instances
    lockManager = new LockManager();
    const lockResult = lockManager.acquire();

    if (!lockResult.success) {
      console.error(`❌ ${lockResult.message}`);
      console.error("   Please wait for the other instance to complete or stop it manually.");
      if (lockResult.pid) {
        console.error(`   You can stop the other instance with: kill ${lockResult.pid}`);
      }
      process.exit(1);
    }

    // Validate environment first
    validateEnvironment();

    // Pull latest changes from remote (unless git is disabled)
    if (options.git) {
      console.log("\n📥 Pulling latest changes from remote...");
      const pullResult = await Utils.pullLatestChanges(
        options.prTargetBranch,
        {
          verbose: options.verbose,
        }
      );

      if (pullResult.success) {
        console.log(`✅ ${pullResult.message}`);
      } else {
        // Don't fail the entire workflow if pull fails - just warn the user
        console.log(`⚠️  ${pullResult.message}`);
        console.log("   Continuing without pulling latest changes...");
        console.log("   You may want to pull manually before processing tasks.\n");
      }
    }

    let tasksToProcess: string[] = [];

    // Determine which tasks to process
    if (options.jql) {
      // JQL query mode
      console.log(`🔍 Searching JIRA with JQL: ${options.jql}`);

      const jiraClient = new JiraClient(
        process.env.JIRA_BASE_URL!,
        process.env.JIRA_EMAIL!,
        process.env.JIRA_API_TOKEN!
      );

      const searchResult = await jiraClient.searchIssues(options.jql);

      if (searchResult.issues.length === 0) {
        console.log("⚠️  No issues found matching the JQL query");
        return;
      }

      tasksToProcess = searchResult.issues.map((issue) => issue.key);
      console.log(
        `📋 Found ${
          tasksToProcess.length
        } tasks to process: ${tasksToProcess.join(", ")}`
      );
    } else if (taskKeys.length > 0) {
      // Individual task keys mode
      tasksToProcess = taskKeys;
      console.log(
        `📋 Processing ${tasksToProcess.length} task(s): ${tasksToProcess.join(
          ", "
        )}`
      );
    } else {
      // No tasks specified
      console.error(
        "❌ Error: No tasks specified. Provide task keys as arguments or use --jql option."
      );
      console.error("   Examples:");
      console.error("     claude-intern PROJ-123");
      console.error("     claude-intern PROJ-123 PROJ-124 PROJ-125");
      console.error(
        "     claude-intern --jql \"project = PROJ AND status = 'To Do'\""
      );
      process.exit(1);
    }

    // Process tasks sequentially
    const results = {
      total: tasksToProcess.length,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ taskKey: string; error: string }>,
    };

    for (let i = 0; i < tasksToProcess.length; i++) {
      const taskKey = tasksToProcess[i];

      try {
        await processSingleTask(taskKey, i, tasksToProcess.length);
        results.successful++;

        if (i < tasksToProcess.length - 1) {
          console.log("\n" + "=".repeat(80));
          console.log("⏭️  Moving to next task...\n");
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          taskKey,
          error: (error as Error).message,
        });

        console.log("⚠️  Continuing with remaining tasks...\n");
      }
    }

    // Print summary for batch operations
    if (tasksToProcess.length > 1) {
      console.log("\n" + "=".repeat(80));
      console.log("📊 Batch Processing Summary:");
      console.log(`   Total tasks: ${results.total}`);
      console.log(`   ✅ Successful: ${results.successful}`);
      console.log(`   ❌ Failed: ${results.failed}`);

      if (results.errors.length > 0) {
        console.log("\n❌ Failed tasks:");
        results.errors.forEach(({ taskKey, error }) => {
          console.log(`   - ${taskKey}: ${error}`);
        });
      }

      if (results.failed > 0) {
        // Release lock before exiting
        if (lockManager) {
          lockManager.release();
        }
        process.exit(1);
      }
    }

    // Release lock on successful completion
    if (lockManager) {
      lockManager.release();
    }
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error: ${err.message}`);
    if (options.verbose && err.stack) {
      console.error(err.stack);
    }
    // Release lock before exiting on error
    if (lockManager) {
      lockManager.release();
    }
    process.exit(1);
  }
}

// Function to run Claude clarity assessment
async function runClarityCheck(
  clarityFile: string,
  claudePath: string,
  taskKey: string,
  jiraClient: JiraClient,
  skipJiraComments = false
): Promise<ClarityAssessment | null> {
  return new Promise((resolve, reject) => {
    // Check if clarity file exists
    if (!existsSync(clarityFile)) {
      reject(new Error(`Clarity assessment file not found: ${clarityFile}`));
      return;
    }

    // Read the clarity assessment content
    const clarityContent = readFileSync(clarityFile, "utf8");

    console.log("🔍 Running feasibility assessment with Claude...");
    console.log(
      `   Command: ${claudePath} -p --dangerously-skip-permissions --max-turns 10`
    );
    console.log(`   Input: ${clarityFile}`);

    let stdoutOutput = "";
    let stderrOutput = "";

    // Spawn Claude process for clarity check
    const claude: ChildProcess = spawn(
      claudePath,
      ["-p", "--dangerously-skip-permissions", "--max-turns", "10"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Capture stdout for parsing JSON response
    if (claude.stdout) {
      claude.stdout.on("data", (data: Buffer) => {
        stdoutOutput += data.toString();
      });
    }

    // Capture stderr for error handling
    if (claude.stderr) {
      claude.stderr.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
      });
    }

    // Handle errors
    claude.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Claude CLI not found at: ${claudePath}\nPlease install Claude CLI or specify the correct path with --claude-path`
          )
        );
      } else {
        reject(
          new Error(`Failed to run Claude clarity check: ${error.message}`)
        );
      }
    });

    // Handle process exit
    claude.on("close", async (code: number | null) => {
      if (code === 0) {
        try {
          // Parse the JSON response from Claude
          const assessment = parseClarityResponse(stdoutOutput);

          // Save assessment results to task directory for debugging
          try {
            const baseOutputDir =
              process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
            const taskDir = join(baseOutputDir, taskKey.toLowerCase());
            const assessmentResultFile = join(taskDir, "feasibility-assessment.md");

            // Format assessment as readable markdown
            let assessmentContent = `# Feasibility Assessment Results\n\n`;
            assessmentContent += `**Status**: ${assessment.isImplementable ? '✅ Implementable' : '❌ Not Implementable'}\n`;
            assessmentContent += `**Clarity Score**: ${assessment.clarityScore}/10\n\n`;
            assessmentContent += `## Summary\n\n${assessment.summary}\n\n`;

            if (assessment.issues.length > 0) {
              assessmentContent += `## Issues\n\n`;
              assessment.issues.forEach((issue) => {
                const severityIcon = issue.severity === "critical" ? "🔴" : issue.severity === "major" ? "🟡" : "🔵";
                assessmentContent += `### ${severityIcon} ${issue.category} (${issue.severity})\n\n`;
                assessmentContent += `${issue.description}\n\n`;
              });
            }

            if (assessment.recommendations.length > 0) {
              assessmentContent += `## Recommendations\n\n`;
              assessment.recommendations.forEach((rec, index) => {
                assessmentContent += `${index + 1}. ${rec}\n`;
              });
              assessmentContent += `\n`;
            }

            // Also save raw JSON for programmatic access
            assessmentContent += `## Raw JSON\n\n\`\`\`json\n${JSON.stringify(assessment, null, 2)}\n\`\`\`\n`;

            writeFileSync(assessmentResultFile, assessmentContent, "utf8");
            console.log(`\n💾 Saved feasibility assessment to: ${assessmentResultFile}`);
          } catch (saveError) {
            console.warn(`⚠️  Failed to save feasibility assessment: ${saveError}`);
          }

          if (assessment.isImplementable) {
            console.log("\n✅ Task feasibility assessment passed");
            console.log(
              `📊 Clarity Score: ${assessment.clarityScore}/10 (threshold: 4/10)`
            );
            console.log(`📝 Summary: ${assessment.summary}`);
            if (assessment.clarityScore < 7) {
              console.log(
                "💡 Note: Some details may need to be inferred from existing codebase"
              );
            }

            // Post successful assessment to JIRA as well for feedback
            if (!skipJiraComments) {
              console.log("\n💬 Posting feasibility assessment to JIRA...");
              await postClarityComment(jiraClient, taskKey, assessment);
            } else {
              console.log("\n⏭️  Skipping feasibility assessment JIRA comment (--skip-jira-comments)");
            }
          } else {
            console.log("\n❌ Task feasibility assessment failed");
            console.log(
              `📊 Clarity Score: ${assessment.clarityScore}/10 (threshold: 4/10)`
            );
            console.log(`📝 Summary: ${assessment.summary}`);

            if (assessment.issues.length > 0) {
              console.log("\n🚨 Critical issues identified:");
              assessment.issues.forEach((issue) => {
                const severityIcon =
                  issue.severity === "critical"
                    ? "🔴"
                    : issue.severity === "major"
                    ? "🟡"
                    : "🔵";
                console.log(
                  `   ${severityIcon} ${issue.category}: ${issue.description}`
                );
              });
            }

            if (assessment.recommendations.length > 0) {
              console.log("\n💡 Recommendations:");
              assessment.recommendations.forEach((rec, index) => {
                console.log(`   ${index + 1}. ${rec}`);
              });
            }

            // Post comment to JIRA with clarity issues
            if (!skipJiraComments) {
              await postClarityComment(jiraClient, taskKey, assessment);
            } else {
              console.log("\n⏭️  Skipping failed assessment JIRA comment (--skip-jira-comments)");
            }

            console.log(
              "\n🛑 Stopping execution - fundamental requirements unclear"
            );
            console.log("   Please address the critical issues and run again");
            console.log(
              "   Or use --skip-clarity-check to bypass this assessment"
            );
          }

          resolve(assessment);
        } catch (parseError) {
          console.warn(
            "Failed to parse clarity assessment response:",
            parseError
          );
          console.log("Raw Claude output:", stdoutOutput);

          // Save failed assessment output for debugging
          try {
            const baseOutputDir =
              process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
            const taskDir = join(baseOutputDir, taskKey.toLowerCase());
            const failedAssessmentFile = join(taskDir, "feasibility-assessment-failed.txt");

            writeFileSync(failedAssessmentFile, stdoutOutput, "utf8");
            console.log(`\n💾 Saved failed assessment output to: ${failedAssessmentFile}`);
          } catch (saveError) {
            console.warn(`⚠️  Failed to save assessment output: ${saveError}`);
          }

          // Check if Claude reached max turns or had other issues
          if (
            stdoutOutput.includes("Reached max turns") ||
            stdoutOutput.includes("max-turns")
          ) {
            console.log(
              "\n⚠️  Clarity assessment reached maximum conversation turns"
            );
            console.log(
              "   This may indicate task complexity or insufficient details"
            );
            if (!skipJiraComments) {
              console.log(
                "   Will attempt to proceed with implementation but posting failure to JIRA...\n"
              );

              // Post assessment failure to JIRA
              try {
                await postAssessmentFailure(
                  jiraClient,
                  taskKey,
                  "max-turns",
                  stdoutOutput
                );
              } catch (jiraError) {
                console.warn(
                  "Failed to post assessment failure to JIRA:",
                  jiraError
                );
              }
            } else {
              console.log(
                "   Will attempt to proceed with implementation (skipping JIRA comment)...\n"
              );
            }
          } else {
            console.log("\n⚠️  Could not parse clarity assessment response");
            if (!skipJiraComments) {
              console.log(
                "   Will attempt to proceed with implementation but posting failure to JIRA...\n"
              );

              // Post assessment failure to JIRA
              try {
                await postAssessmentFailure(
                  jiraClient,
                  taskKey,
                  "parse-error",
                  stdoutOutput
                );
              } catch (jiraError) {
                console.warn(
                  "Failed to post assessment failure to JIRA:",
                  jiraError
                );
              }
            } else {
              console.log(
                "   Will attempt to proceed with implementation (skipping JIRA comment)...\n"
              );
            }
          }

          resolve(null); // Continue with implementation if parsing fails
        }
      } else {
        reject(new Error(`Claude clarity check exited with code ${code}`));
      }
    });

    // Send clarity assessment content to Claude
    if (claude.stdin) {
      claude.stdin.write(clarityContent);
      claude.stdin.end();
    }
  });
}

// Function to parse Claude's clarity assessment response
function parseClarityResponse(output: string): ClarityAssessment {
  // Extract JSON from Claude's response
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    // Provide more specific error based on output content
    if (output.includes("Reached max turns") || output.includes("max-turns")) {
      throw new Error(
        "warn: Claude reached max turns - no JSON assessment available"
      );
    }
    if (output.trim().length === 0) {
      throw new Error("warn: Empty response from Claude");
    }
    throw new Error("warn: No JSON found in Claude response");
  }

  try {
    const assessment = JSON.parse(jsonMatch[1]);

    // Validate required fields
    if (
      typeof assessment.isImplementable !== "boolean" ||
      typeof assessment.clarityScore !== "number" ||
      !Array.isArray(assessment.issues) ||
      !Array.isArray(assessment.recommendations) ||
      typeof assessment.summary !== "string"
    ) {
      throw new Error(
        "warn: Invalid assessment structure - missing required fields"
      );
    }

    return assessment;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `warn: Malformed JSON in Claude response: ${error.message}`
      );
    }
    throw new Error(`warn: Failed to parse assessment: ${error}`);
  }
}

// Function to post Claude's implementation output to JIRA
async function postImplementationComment(
  taskKey: string,
  claudeOutput: string,
  taskSummary?: string
): Promise<void> {
  try {
    // Initialize JIRA client
    const jiraClient = new JiraClient(
      process.env.JIRA_BASE_URL!,
      process.env.JIRA_EMAIL!,
      process.env.JIRA_API_TOKEN!
    );

    // Use the rich text implementation comment method
    await jiraClient.postImplementationComment(
      taskKey,
      claudeOutput,
      taskSummary
    );
    console.log(`✅ Implementation summary posted to ${taskKey}`);
  } catch (error) {
    throw new Error(`Failed to post implementation comment: ${error}`);
  }
}

// Function to post clarity assessment comment to JIRA
async function postAssessmentFailure(
  jiraClient: JiraClient,
  taskKey: string,
  failureType: "max-turns" | "parse-error",
  _rawOutput: string
): Promise<void> {
  try {
    const isMaxTurns = failureType === "max-turns";

    const commentBody = {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "panel",
            attrs: { panelType: "warning" },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "🤖 Claude Intern - Feasibility Assessment Failed",
                    marks: [{ type: "strong" }],
                  },
                ],
              },
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: isMaxTurns
                      ? "⚠️ Assessment reached maximum conversation turns before completion"
                      : "⚠️ Could not parse feasibility assessment response",
                  },
                ],
              },
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "📋 ", marks: [{ type: "strong" }] },
                  {
                    type: "text",
                    text: "What this means:",
                    marks: [{ type: "strong" }],
                  },
                ],
              },
              ...(isMaxTurns
                ? [
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "🧩 ",
                                  marks: [{ type: "strong" }],
                                },
                                {
                                  type: "text",
                                  text: "Task complexity: ",
                                  marks: [{ type: "strong" }],
                                },
                                {
                                  type: "text",
                                  text: "The task may involve multiple complex components or interdependencies that require extensive analysis",
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "📝 ",
                                  marks: [{ type: "strong" }],
                                },
                                {
                                  type: "text",
                                  text: "Insufficient details: ",
                                  marks: [{ type: "strong" }],
                                },
                                {
                                  type: "text",
                                  text: "The task description may lack specific requirements, acceptance criteria, or technical specifications",
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "🔍 ",
                                  marks: [{ type: "strong" }],
                                },
                                {
                                  type: "text",
                                  text: "Context discovery: ",
                                  marks: [{ type: "strong" }],
                                },
                                {
                                  type: "text",
                                  text: "Extensive codebase exploration was needed to understand existing patterns and architecture",
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "🚀 ",
                          marks: [{ type: "strong" }],
                        },
                        {
                          type: "text",
                          text: "Next steps:",
                          marks: [{ type: "strong" }],
                        },
                      ],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "Implementation will proceed with available information",
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "Additional clarification may be requested during development",
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "Consider adding more specific acceptance criteria for future similar tasks",
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ]
                : [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "The AI assessment tool encountered an unexpected response format. Implementation will proceed but may require manual review of results.",
                        },
                      ],
                    },
                  ]),
            ],
          },
        ],
      },
    };

    // Use the same API call pattern as other rich text comments
    await (jiraClient as any).jiraApiCall(
      "POST",
      `/rest/api/3/issue/${taskKey}/comment`,
      commentBody
    );
  } catch (error) {
    console.warn("Failed to post assessment failure to JIRA:", error);
  }
}

async function postClarityComment(
  jiraClient: JiraClient,
  taskKey: string,
  assessment: ClarityAssessment
): Promise<void> {
  try {
    // Use the rich text clarity comment method
    await jiraClient.postClarityComment(taskKey, assessment);
  } catch (error) {
    console.warn("Failed to post clarity comment to JIRA:", error);
  }
}

// Function to log git hook errors to file
function logHookErrorToFile(
  taskKey: string,
  hookType: string,
  attempt: number,
  error: string,
  fixed: boolean
): void {
  try {
    const baseOutputDir =
      process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
    const taskDir = join(baseOutputDir, taskKey.toLowerCase());
    const hookErrorFile = join(taskDir, "git-hook-errors.log");

    const timestamp = new Date().toISOString();
    const status = fixed ? "FIXED" : "FAILED";
    const logEntry = `
${"=".repeat(80)}
Timestamp: ${timestamp}
Hook Type: ${hookType}
Attempt: ${attempt}
Status: ${status}
Error:
${error}
${"=".repeat(80)}
`;

    // Append to log file
    const existingContent = existsSync(hookErrorFile)
      ? readFileSync(hookErrorFile, "utf8")
      : "# Git Hook Errors Log\n\n";

    writeFileSync(hookErrorFile, existingContent + logEntry, "utf8");
    console.log(`💾 Hook error logged to: ${hookErrorFile}`);
  } catch (saveError) {
    console.warn(`⚠️  Failed to save hook error to file: ${saveError}`);
  }
}


/**
 * Detects if Claude only created a plan instead of implementing the task.
 * Returns the plan file path if detected, null otherwise.
 */
function detectPlanOnlyBehavior(claudeOutput: string): string | null {
  // Check for common plan creation patterns (specific phrases first)
  const planCreationPatterns = [
    /I'?ve created (a|an|the) (comprehensive )?(implementation )?plan/i,
    /created a plan for/i,
    /plan has been created/i,
    /implementation plan is (now )?ready/i,
    /The plan is (now )?ready/i,
    /plan is ready for (your )?review/i,
    /Here'?s a summary:?\s*\n+##.*plan/i,
    /drafted a plan/i,
    /wrote out a plan/i,
    /plan (file )?(is )?(available|saved)/i,
    /##.*plan.*summary/i,
  ];

  const hasPlanCreationLanguage = planCreationPatterns.some(pattern =>
    pattern.test(claudeOutput)
  );

  // Fallback: if "plan" appears with context suggesting plan-only behavior
  // (since this function is only called when there are no changes to commit)
  const hasPlanFallback = !hasPlanCreationLanguage &&
    /\bplan\b/i.test(claudeOutput) &&
    (/summary|review|ready|created|implementation|approach|steps|changes (required|needed)/i.test(claudeOutput));

  if (!hasPlanCreationLanguage && !hasPlanFallback) {
    return null;
  }

  // Try to extract the plan file path
  // Common patterns:
  // - "available at `/path/to/plan.md`"
  // - "available at /path/to/plan.md"
  // - "saved to: /path/to/plan.md"
  // - ~/.claude/plans/something.md
  const pathPatterns = [
    /(?:available at|saved to:?)\s*[`"]?((?:\/[^\s`"]+|~\/\.claude\/plans\/[^\s`"]+)\.md)[`"]?/i,
    /[`"]((?:\/home\/[^\s`"]+|~)\/\.claude\/plans\/[^\s`"]+\.md)[`"]/,
    /(\/home\/[^\s]+\/\.claude\/plans\/[^\s]+\.md)/,
  ];

  for (const pattern of pathPatterns) {
    const match = claudeOutput.match(pattern);
    if (match && match[1]) {
      let planPath = match[1];
      // Expand ~ to home directory
      if (planPath.startsWith('~')) {
        const homeDir = process.env.HOME || '/tmp';
        planPath = planPath.replace('~', homeDir);
      }
      return planPath;
    }
  }

  // If we detected plan creation language but couldn't extract the path,
  // return a sentinel value to indicate plan-only behavior
  return 'PLAN_DETECTED_NO_PATH';
}

/**
 * Creates a prompt to instruct Claude to implement an existing plan
 */
function createPlanImplementationPrompt(planPath: string | null, originalTaskContent: string): string {
  const planInstructions = planPath && planPath !== 'PLAN_DETECTED_NO_PATH'
    ? `You previously created an implementation plan at: ${planPath}

Please read this plan file and implement it NOW. Do not create another plan - actually write the code and make the changes described in the plan.`
    : `You previously created an implementation plan but did not implement it.

Please implement the task NOW. Do not just plan or describe what needs to be done - actually write the code and make the changes.`;

  return `${planInstructions}

IMPORTANT: You MUST actually implement the changes, not just plan them. Create/modify files as needed. Do not exit until actual code changes have been made.

For reference, here is the original task:
---
${originalTaskContent}
---

Now implement the solution. Write the actual code.`;
}

// Function to run Claude with the formatted task
async function runClaude(
  taskFile: string,
  claudePath: string,
  maxTurns = 25,
  taskKey?: string,
  taskSummary?: string,
  enableGit = true,
  issue?: any,
  createPr = false,
  prTargetBranch = "main",
  jiraClient?: JiraClient,
  skipJiraComments = false,
  hookRetries = 10,
  projectSettings: ProjectSettings | null = null,
  gitAuthor?: { name: string; email: string },
  autoReview = false,
  autoReviewIterations = 5,
  isPlanRetry = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if task file exists
    if (!existsSync(taskFile)) {
      reject(new Error(`Task file not found: ${taskFile}`));
      return;
    }

    // Load project settings
    const projectSettings = loadProjectSettings();

    // Read the task content
    const taskContent = readFileSync(taskFile, "utf8");

    console.log("🚀 Launching Claude...");
    console.log(
      `   Command: ${claudePath} -p --dangerously-skip-permissions --max-turns ${maxTurns} --verbose`
    );
    console.log(`   Input: ${taskFile}`);
    console.log(
      "   Output: All Claude output will be displayed below in real-time"
    );
    console.log("\n" + "=".repeat(60));

    // Capture stderr to detect max turns error and stdout for JIRA comment
    let stderrOutput = "";
    let stdoutOutput = "";

    // Spawn Claude process with enhanced permissions and max turns
    // stdio configuration:
    // - stdin: 'pipe' (we write task content to it)
    // - stdout: 'pipe' (we capture it for JIRA comment while also showing to user)
    // - stderr: 'pipe' (we capture it for error detection while also showing to user)
    const claude: ChildProcess = spawn(
      claudePath,
      [
        "-p",
        "--dangerously-skip-permissions",
        "--max-turns",
        maxTurns.toString(),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Capture and display stdout output
    if (claude.stdout) {
      claude.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutOutput += output;
        // Immediately write stdout output to user (no buffering)
        process.stdout.write(output);
      });
    }

    // Capture stderr output for error detection while ensuring it's visible to user
    if (claude.stderr) {
      claude.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        stderrOutput += output;
        // Immediately write stderr output to user (no buffering)
        process.stderr.write(output);
      });
    }

    // Handle errors
    claude.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Claude CLI not found at: ${claudePath}\nPlease install Claude CLI or specify the correct path with --claude-path`
          )
        );
      } else {
        reject(new Error(`Failed to run Claude: ${error.message}`));
      }
    });

    // Handle process exit
    claude.on("close", async (code: number | null) => {
      console.log("\n" + "=".repeat(60));

      // Check for max turns error in stderr output
      const maxTurnsReached =
        stderrOutput.includes("Reached max turns") ||
        stderrOutput.includes("max turns reached") ||
        stderrOutput.includes("maximum turns reached");

      if (maxTurnsReached) {
        console.log(
          "⚠️  Claude reached maximum turns limit without completing the task"
        );
        console.log(
          "   The task may be too complex or require more turns to complete"
        );
        console.log(
          "   Consider breaking it into smaller tasks or increasing the max-turns limit"
        );

        // Save incomplete implementation for analysis
        if (taskKey && stdoutOutput.trim()) {
          try {
            const baseOutputDir =
              process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
            const taskDir = join(baseOutputDir, taskKey.toLowerCase());
            const summaryFile = join(
              taskDir,
              "implementation-summary-incomplete.md"
            );

            writeFileSync(summaryFile, stdoutOutput, "utf8");
            console.log(`\n💾 Saved incomplete implementation to: ${summaryFile}`);

            // Post incomplete implementation comment to JIRA (no duplicate check here
            // since we already skip tasks with existing incomplete comments)
            if (jiraClient && !skipJiraComments && issue) {
              try {
                // Extract description text for saving
                const { JiraExtractor } = require("./lib/jira-extractor");
                const descriptionText = JiraExtractor.extractTextFromADF(issue.fields?.description);

                await jiraClient.postIncompleteImplementationComment(
                  taskKey,
                  stdoutOutput,
                  taskSummary,
                  descriptionText
                );
              } catch (commentError) {
                console.warn(
                  `⚠️  Failed to post incomplete implementation comment to JIRA: ${commentError}`
                );
              }
            }

            // Transition back to "To Do" status if configured
            if (jiraClient && !skipJiraComments && taskKey && projectSettings) {
              const projectKey = taskKey.split('-')[0];
              const todoStatus = getTodoStatusForProject(projectKey, projectSettings);
              if (todoStatus && todoStatus.trim()) {
                try {
                  console.log(`\n🔄 Moving ${taskKey} back to '${todoStatus}' due to max turns reached...`);
                  await jiraClient.transitionIssue(taskKey, todoStatus.trim());
                  console.log(`✅ Task moved to '${todoStatus}'`);
                } catch (statusError) {
                  console.warn(
                    `⚠️  Failed to transition task to '${todoStatus}': ${
                      (statusError as Error).message
                    }`
                  );
                }
              }
            }
          } catch (saveError) {
            console.warn(
              `⚠️  Failed to save implementation summary: ${saveError}`
            );
          }
        }

        console.log("\n⏭️  Skipping commit and moving to next task (if any)...");

        // Resolve instead of reject to allow batch processing to continue
        resolve();
        return;
      }

      // Check for genuine failure indicators in the output
      const hasErrors =
        stderrOutput.includes("Error:") &&
        !stderrOutput.includes("Reached max turns");

      // Look for genuine failure patterns, not just words that might appear in implementation summaries
      const hasGenuineFailures =
        /I (?:was unable to|cannot|could not|failed to)/i.test(stdoutOutput) ||
        stdoutOutput.includes("implementation was unsuccessful") ||
        stdoutOutput.includes("failed to implement") ||
        stdoutOutput.includes("I apologize, but I");

      if (code === 0) {
        // Even if exit code is 0, check if Claude actually completed meaningful work
        const hasMinimalOutput = stdoutOutput.trim().length < 100;
        const seemsIncomplete =
          hasErrors || hasGenuineFailures || hasMinimalOutput;

        // Save implementation summary to task directory (even if incomplete for analysis)
        if (taskKey && stdoutOutput.trim()) {
          try {
            const baseOutputDir =
              process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
            const taskDir = join(baseOutputDir, taskKey.toLowerCase());
            const summaryFile = join(
              taskDir,
              seemsIncomplete
                ? "implementation-summary-incomplete.md"
                : "implementation-summary.md"
            );

            writeFileSync(summaryFile, stdoutOutput, "utf8");
            console.log(`\n💾 Saved implementation summary to: ${summaryFile}`);
          } catch (saveError) {
            console.warn(
              `⚠️  Failed to save implementation summary: ${saveError}`
            );
          }
        }

        if (seemsIncomplete) {
          console.log(
            "⚠️  Claude execution completed but appears to be incomplete or failed"
          );
          console.log("   Check the output above for specific issues");
          console.log("\n⏭️  Skipping commit and moving to next task (if any)...");

          // Post incomplete implementation comment to JIRA (no duplicate check here
          // since we already skip tasks with existing incomplete comments)
          if (jiraClient && !skipJiraComments && taskKey && stdoutOutput.trim() && issue) {
            try {
              // Extract description text for saving
              const { JiraExtractor } = require("./lib/jira-extractor");
              const descriptionText = JiraExtractor.extractTextFromADF(issue.fields?.description);

              await jiraClient.postIncompleteImplementationComment(
                taskKey,
                stdoutOutput,
                taskSummary,
                descriptionText
              );
            } catch (commentError) {
              console.warn(
                `⚠️  Failed to post incomplete implementation comment to JIRA: ${commentError}`
              );
            }
          }

          // Transition back to "To Do" status if configured
          if (jiraClient && !skipJiraComments && taskKey && projectSettings) {
            const projectKey = taskKey.split('-')[0];
            const todoStatus = getTodoStatusForProject(projectKey, projectSettings);
            if (todoStatus && todoStatus.trim()) {
              try {
                console.log(`\n🔄 Moving ${taskKey} back to '${todoStatus}' due to incomplete implementation...`);
                await jiraClient.transitionIssue(taskKey, todoStatus.trim());
                console.log(`✅ Task moved to '${todoStatus}'`);
              } catch (statusError) {
                console.warn(
                  `⚠️  Failed to transition task to '${todoStatus}': ${
                    (statusError as Error).message
                  }`
                );
              }
            }
          }

          // Don't commit or continue processing when implementation is incomplete
          // Just resolve to allow batch processing to continue
          resolve();
          return;
        } else {
          console.log("✅ Claude execution completed successfully");
        }

        // Commit changes if git is enabled and we have task details
        if (enableGit && taskKey && taskSummary) {
          console.log("\n📝 Committing changes...");

          // Try committing with retry logic for git hook failures
          const handleCommitWithRetry = async () => {
            let attempt = 0;

            while (attempt <= hookRetries) {
              attempt++;
              const commitResult = await Utils.commitChanges(taskKey, taskSummary, {
                verbose: options.verbose,
                author: gitAuthor,
              });

              if (commitResult.success) {
                console.log(`✅ ${commitResult.message}`);
                return { success: true, result: commitResult };
              }

              // Check if this is a git hook error that we can try to fix
              if (commitResult.hookError && attempt <= hookRetries) {
                console.log(`\n⚠️  Git hook failed (attempt ${attempt}/${hookRetries + 1})`);

                // Try to fix the hook error with Claude
                const fixed = await runClaudeToFixGitHook(
                  "commit",
                  claudePath,
                  maxTurns
                );

                // Log the hook error to file
                logHookErrorToFile(
                  taskKey,
                  "commit",
                  attempt,
                  commitResult.hookError,
                  fixed
                );

                if (fixed) {
                  console.log("\n🔄 Retrying commit after Claude fixed the issues...");
                  continue;
                } else {
                  console.log("\n❌ Could not fix git hook errors automatically");
                  return { success: false, result: commitResult };
                }
              } else {
                // Not a hook error or out of retries
                if (attempt > hookRetries) {
                  console.log(`\n❌ Max retries (${hookRetries}) exceeded for git hook fixes`);
                }
                console.log(`⚠️  ${commitResult.message}`);
                return { success: false, result: commitResult };
              }
            }

            return { success: false, result: { message: "Max retries exceeded" } };
          };

          handleCommitWithRetry()
            .then(async ({ success, result }) => {
              if (!success) {
                // Check if this is a "plan only" scenario - Claude created a plan but didn't implement
                const noChangesToCommit = result.message === "No changes to commit";
                const planPath = noChangesToCommit ? detectPlanOnlyBehavior(stdoutOutput) : null;

                if (noChangesToCommit && planPath && !isPlanRetry) {
                  // Claude only created a plan - run it again with instructions to implement
                  console.log("\n🔄 Claude created a plan but didn't implement it. Re-running to execute the plan...");

                  if (planPath !== 'PLAN_DETECTED_NO_PATH') {
                    console.log(`   Plan file detected: ${planPath}`);
                  }

                  // Create a new prompt to implement the plan
                  const implementationPrompt = createPlanImplementationPrompt(planPath, taskContent);

                  // Spawn Claude again with the implementation prompt
                  const retryProcess: ChildProcess = spawn(
                    claudePath,
                    [
                      "-p",
                      "--dangerously-skip-permissions",
                      "--max-turns",
                      maxTurns.toString(),
                    ],
                    {
                      stdio: ["pipe", "pipe", "pipe"],
                    }
                  );

                  let retryStdoutOutput = "";
                  let retryStderrOutput = "";

                  if (retryProcess.stdout) {
                    retryProcess.stdout.on("data", (data: Buffer) => {
                      const output = data.toString();
                      retryStdoutOutput += output;
                      process.stdout.write(output);
                    });
                  }

                  if (retryProcess.stderr) {
                    retryProcess.stderr.on("data", (data: Buffer) => {
                      const output = data.toString();
                      retryStderrOutput += output;
                      process.stderr.write(output);
                    });
                  }

                  if (retryProcess.stdin) {
                    retryProcess.stdin.write(implementationPrompt);
                    retryProcess.stdin.end();
                  }

                  retryProcess.on("close", async (retryCode: number | null) => {
                    console.log("\n" + "=".repeat(60));

                    if (retryCode === 0) {
                      console.log("✅ Plan implementation completed");

                      // Save updated implementation summary
                      if (taskKey && retryStdoutOutput.trim()) {
                        try {
                          const summaryFile = join(
                            dirname(taskFile),
                            "implementation-summary.md"
                          );
                          writeFileSync(
                            summaryFile,
                            `# Plan Implementation Output\n\n${retryStdoutOutput}`,
                            "utf8"
                          );
                          console.log(`\n💾 Updated implementation summary: ${summaryFile}`);
                        } catch (saveError) {
                          console.warn(`⚠️  Failed to save implementation summary: ${saveError}`);
                        }
                      }

                      // Try to commit the changes from plan implementation
                      console.log("\n📝 Committing plan implementation changes...");
                      const retryCommitResult = await Utils.commitChanges(taskKey, taskSummary, {
                        verbose: options.verbose,
                        author: gitAuthor,
                      });

                      if (retryCommitResult.success) {
                        console.log(`✅ ${retryCommitResult.message}`);

                        // Continue with PR creation if requested
                        if (createPr && issue) {
                          // Push and create PR (simplified - using existing logic pattern)
                          console.log("\n📤 Pushing branch to remote...");
                          const pushResult = await Utils.executeGitCommand(
                            ["push", "-u", "origin", "HEAD"],
                            { verbose: options.verbose }
                          );

                          if (pushResult.success) {
                            console.log("✅ Branch pushed successfully");

                            // Post implementation comment to JIRA if enabled
                            if (jiraClient && !skipJiraComments && retryStdoutOutput.trim()) {
                              try {
                                await postImplementationComment(
                                  taskKey,
                                  retryStdoutOutput,
                                  taskSummary
                                );
                              } catch (commentError) {
                                console.warn(`⚠️  Failed to post implementation comment: ${commentError}`);
                              }
                            }
                          } else {
                            console.log(`⚠️  Failed to push: ${pushResult.error}`);
                          }
                        }
                      } else {
                        console.log(`⚠️  ${retryCommitResult.message}`);
                        console.log(
                          'You can commit changes manually with: git add . && git commit -m "feat: implement task"'
                        );
                      }
                    } else {
                      console.log("⚠️  Plan implementation failed");
                    }

                    resolve();
                  });

                  retryProcess.on("error", (error: Error) => {
                    console.error(`❌ Failed to re-run Claude: ${error.message}`);
                    resolve();
                  });

                  return;
                }

                console.log(
                  'You can commit changes manually with: git add . && git commit -m "feat: implement task"'
                );
                resolve();
                return;
              }

              // Create pull request if requested
              if (createPr && issue) {
                // Validate pre-push hook locally with retry logic (fix with Claude if needed)
                const handleLocalHookValidation = async (phase: string) => {
                  let attempt = 0;

                  while (attempt <= hookRetries) {
                    attempt++;
                    const hookResult = await Utils.runPrePushHookLocally({
                      verbose: options.verbose,
                    });

                    if (hookResult.success) {
                      if (attempt === 1) {
                        console.log(`✅ ${hookResult.message}`);
                      } else {
                        console.log(`✅ Pre-push hook passed after ${attempt} attempt(s)`);
                      }
                      return { success: true, result: hookResult };
                    }

                    // Check if this is a hook error that we can try to fix
                    if (hookResult.hookError && attempt <= hookRetries) {
                      console.log(`\n⚠️  Pre-push hook failed during ${phase} (attempt ${attempt}/${hookRetries + 1})`);

                      // Try to fix the hook error with Claude
                      const fixed = await runClaudeToFixGitHook(
                        "push",
                        claudePath,
                        maxTurns
                      );

                      // Log the hook error to file
                      logHookErrorToFile(
                        taskKey,
                        "push-local-validation",
                        attempt,
                        hookResult.hookError,
                        fixed
                      );

                      if (fixed) {
                        console.log("\n🔄 Retrying local hook validation after Claude fixed the issues...");
                        continue;
                      } else {
                        console.log("\n❌ Could not fix pre-push hook errors automatically");
                        return { success: false, result: hookResult };
                      }
                    } else {
                      // Not a hook error or out of retries
                      if (attempt > hookRetries) {
                        console.log(`\n❌ Max retries (${hookRetries}) exceeded for pre-push hook fixes`);
                      }
                      console.log(`⚠️  ${hookResult.message}`);
                      return { success: false, result: hookResult };
                    }
                  }

                  return { success: false, result: { message: "Max retries exceeded" } };
                };

                // Step 1: Validate pre-push hook locally BEFORE any push
                console.log("\n🔍 Validating pre-push hook locally (before pushing)...");
                const initialHookValidation = await handleLocalHookValidation("initial validation");

                if (!initialHookValidation.success) {
                  console.log("   Cannot proceed without passing pre-push hook validation");
                  resolve();
                  return;
                }

                // Step 2: Run auto-review with skipPush if enabled
                // This allows all improvements to be made locally before pushing
                const currentBranch = await Utils.getCurrentBranch();
                let autoReviewRan = false;

                if (autoReview && currentBranch) {
                  try {
                    console.log("\n🔄 Running auto-review loop (without pushing)...");

                    // Calculate task output directory
                    const baseOutputDir =
                      process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
                    const taskDir = taskKey
                      ? join(baseOutputDir, taskKey.toLowerCase())
                      : join(baseOutputDir, `auto-review-${Date.now()}`);

                    const autoReviewResult = await runAutoReviewLoop({
                      repository: "local/repo", // Placeholder - not used when skipPush is true
                      prNumber: 0, // Placeholder - PR doesn't exist yet
                      prBranch: currentBranch,
                      baseBranch: prTargetBranch,
                      claudePath,
                      maxIterations: autoReviewIterations,
                      minPriority: 'medium',
                      workingDir: process.cwd(),
                      outputDir: taskDir,
                      skipPush: true, // Don't push during auto-review iterations
                    });

                    // Save final summary
                    const summaryPath = join(taskDir, 'auto-review-summary.json');
                    writeFileSync(summaryPath, JSON.stringify(autoReviewResult, null, 2));
                    console.log(`\n📄 Auto-review summary saved to: ${summaryPath}`);

                    autoReviewRan = true;

                    // Step 3: After auto-review, validate hooks again (auto-review changes may have broken things)
                    console.log("\n🔍 Re-validating pre-push hook after auto-review improvements...");
                    const postAutoReviewValidation = await handleLocalHookValidation("post auto-review validation");

                    if (!postAutoReviewValidation.success) {
                      console.log("   Cannot proceed - auto-review changes failed pre-push hook validation");
                      resolve();
                      return;
                    }
                  } catch (autoReviewError) {
                    console.warn(
                      `\n⚠️  Auto-review loop failed: ${(autoReviewError as Error).message}`
                    );
                    console.log('   Continuing with push and PR creation...');
                  }
                }

                // Step 4: Now do the actual push (hooks already validated, should succeed)
                console.log("\n📤 Pushing branch to remote...");

                // Push with retry logic (hooks should pass, but network issues can occur)
                const handlePushWithRetry = async () => {
                  let attempt = 0;

                  while (attempt <= hookRetries) {
                    attempt++;
                    const pushResult = await Utils.pushCurrentBranch({
                      verbose: options.verbose,
                    });

                    if (pushResult.success) {
                      console.log(`✅ ${pushResult.message}`);
                      return { success: true, result: pushResult };
                    }

                    // Check if this is a git hook error that we can try to fix
                    if (pushResult.hookError && attempt <= hookRetries) {
                      console.log(`\n⚠️  Git pre-push hook failed during actual push (attempt ${attempt}/${hookRetries + 1})`);

                      // Try to fix the hook error with Claude
                      const fixed = await runClaudeToFixGitHook(
                        "push",
                        claudePath,
                        maxTurns
                      );

                      // Log the hook error to file
                      logHookErrorToFile(
                        taskKey,
                        "push",
                        attempt,
                        pushResult.hookError,
                        fixed
                      );

                      if (fixed) {
                        console.log("\n🔄 Retrying push after Claude fixed and amended the commit...");
                        continue;
                      } else {
                        console.log("\n❌ Could not fix git pre-push hook errors automatically");
                        return { success: false, result: pushResult };
                      }
                    } else {
                      // Not a hook error or out of retries
                      if (attempt > hookRetries) {
                        console.log(`\n❌ Max retries (${hookRetries}) exceeded for git hook fixes`);
                      }
                      console.log(`⚠️  ${pushResult.message}`);
                      return { success: false, result: pushResult };
                    }
                  }

                  return { success: false, result: { message: "Max retries exceeded" } };
                };

                const pushOutcome = await handlePushWithRetry();

                if (pushOutcome.success) {
                  // Post implementation summary to JIRA after successful push
                  if (taskKey && stdoutOutput.trim() && !skipJiraComments) {
                    try {
                      console.log("\n💬 Posting implementation summary to JIRA...");
                      await postImplementationComment(
                        taskKey,
                        stdoutOutput,
                        taskSummary
                      );
                    } catch (commentError) {
                      console.warn(
                        `⚠️  Failed to post implementation comment to JIRA: ${commentError}`
                      );
                      console.log(
                        "   Push succeeded, but JIRA comment failed"
                      );
                    }
                  } else if (skipJiraComments && taskKey) {
                    console.log("\n⏭️  Skipping JIRA comment posting (--skip-jira-comments)");
                  }

                  console.log("\n🔀 Creating pull request...");
                  try {
                    const prManager = new PRManager();
                    // Note: currentBranch was already fetched earlier for auto-review

                    if (currentBranch) {
                      // Safety check: prevent creating PRs from protected branches
                      if (await Utils.isProtectedBranch(currentBranch)) {
                        console.error(
                          `\n❌ Cannot create PR from protected branch '${currentBranch}'`
                        );
                        console.error(
                          "   This indicates a bug - feature branch was not created properly."
                        );
                        console.error(
                          "   Please create a feature branch manually and try again."
                        );
                        resolve();
                        return;
                      }

                      const prResult = await prManager.createPullRequest(
                        issue,
                        currentBranch,
                        prTargetBranch,
                        stdoutOutput // Use Claude's output as implementation summary
                      );

                      if (prResult.success) {
                        console.log(
                          `✅ Pull request created: ${prResult.url}`
                        );

                        // Transition JIRA status if configured
                        if (taskKey && jiraClient && !skipJiraComments) {
                          // Extract project key from task key (e.g., "PROJ-123" -> "PROJ")
                          const projectKey = taskKey.split('-')[0];
                          const prStatus = getPrStatusForProject(projectKey, projectSettings);

                          if (prStatus && prStatus.trim()) {
                            try {
                              console.log(
                                "\n🔄 Transitioning JIRA status after PR creation..."
                              );
                              await jiraClient.transitionIssue(
                                taskKey,
                                prStatus.trim()
                              );
                            } catch (statusError) {
                              console.warn(
                                `⚠️  Failed to transition JIRA status: ${
                                  (statusError as Error).message
                                }`
                              );
                              console.log(
                                "   PR was created successfully, but status transition failed"
                              );
                            }
                          }
                        } else if (skipJiraComments) {
                          console.log(
                            "\n⏭️  Skipping JIRA status transition (--skip-jira-comments)"
                          );
                        }

                        // Note: Auto-review loop (if enabled) was already run before pushing
                        // to minimize CI impact. The code was validated locally first.
                        if (autoReviewRan) {
                          console.log("\n✅ Auto-review was completed before push (see summary file for details)");
                        }
                      } else {
                        console.log(
                          `⚠️  PR creation failed: ${prResult.message}`
                        );
                      }
                    } else {
                      console.log(
                        "⚠️  Could not determine current branch for PR creation"
                      );
                    }
                  } catch (prError) {
                    console.log(
                      `⚠️  PR creation failed: ${(prError as Error).message}`
                    );
                  }
                } else {
                  console.log(
                    "   Cannot create PR without pushing branch to remote"
                  );
                }
              } else {
                // No PR requested, but commit succeeded - post to JIRA here
                if (taskKey && stdoutOutput.trim() && !skipJiraComments) {
                  try {
                    console.log("\n💬 Posting implementation summary to JIRA...");
                    await postImplementationComment(
                      taskKey,
                      stdoutOutput,
                      taskSummary
                    );
                  } catch (commentError) {
                    console.warn(
                      `⚠️  Failed to post implementation comment to JIRA: ${commentError}`
                    );
                    console.log(
                      "   Commit succeeded, but JIRA comment failed"
                    );
                  }
                } else if (skipJiraComments && taskKey) {
                  console.log("\n⏭️  Skipping JIRA comment posting (--skip-jira-comments)");
                }
              }
              resolve();
            })
            .catch((commitError) => {
              console.log(
                `⚠️  Failed to commit changes: ${commitError.message}`
              );
              console.log(
                'You can commit changes manually with: git add . && git commit -m "feat: implement task"'
              );
              resolve(); // Still resolve since Claude succeeded
            });
        } else {
          resolve();
        }
      } else {
        console.log(`❌ Claude exited with non-zero code ${code}`);
        console.log(
          "   No JIRA comment will be posted due to execution failure"
        );
        reject(new Error(`Claude exited with code ${code}`));
      }
    });

    // Send task content to Claude
    if (claude.stdin) {
      claude.stdin.write(taskContent);
      claude.stdin.end();
    }
  });
}

// Handle uncaught errors
process.on("unhandledRejection", (error: Error) => {
  console.error("❌ Unhandled error:", error.message);
  if (options.verbose && error.stack) {
    console.error(error.stack);
  }
  // Release lock before exiting
  if (lockManager) {
    lockManager.release();
  }
  process.exit(1);
});

// Handle process termination signals
process.on("SIGINT", () => {
  console.log("\n\n⚠️  Received SIGINT (Ctrl+C), cleaning up...");
  if (lockManager) {
    lockManager.release();
  }
  process.exit(130); // Standard exit code for SIGINT
});

process.on("SIGTERM", () => {
  console.log("\n\n⚠️  Received SIGTERM, cleaning up...");
  if (lockManager) {
    lockManager.release();
  }
  process.exit(143); // Standard exit code for SIGTERM
});

// Handle uncaught exceptions
process.on("uncaughtException", (error: Error) => {
  console.error("❌ Uncaught exception:", error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  // Release lock before exiting
  if (lockManager) {
    lockManager.release();
  }
  process.exit(1);
});

// Run the main function (only if not running a subcommand)
if (require.main === module) {
  // Check if a subcommand was run (like 'init' or 'serve')
  // Commander.js will have the command in process.argv[2]
  const command = process.argv[2];

  // If it's a recognized subcommand, don't run main()
  if (command === 'init' || command === 'serve' || command === 'address-review') {
    // Subcommand was handled earlier, don't run main
  } else {
    // Run main for task processing
    main();
  }
}

export { main, JiraClient, ClaudeFormatter };
