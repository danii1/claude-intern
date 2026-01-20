import { spawn } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

export class Utils {
  /**
   * Ensure a directory exists, create it if it doesn't
   */
  static ensureDirectoryExists(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Format a date string to a readable format
   */
  static formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch (error) {
      return dateString;
    }
  }

  /**
   * Sanitize a filename by removing invalid characters
   */
  static sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_");
  }

  /**
   * Extract domain from URL
   */
  static extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return url;
    }
  }

  /**
   * Truncate text to a specified length
   */
  static truncateText(text: string, maxLength = 100): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }

  /**
   * Check if a string is a valid URL
   */
  static isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Convert bytes to human readable format
   */
  static formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Number.parseFloat((bytes / k ** i).toFixed(dm)) + " " + sizes[i];
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retry a function with exponential backoff
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          throw lastError;
        }

        const delay = baseDelay * 2 ** (attempt - 1);
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await Utils.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * HTTP status codes that should trigger a retry
   */
  private static RETRYABLE_STATUS_CODES = new Set([
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ]);

  /**
   * Check if an error is a retryable network error
   */
  private static isRetryableNetworkError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("unable to connect") ||
      message.includes("network") ||
      message.includes("socket hang up") ||
      message.includes("epipe")
    );
  }

  /**
   * Fetch with exponential backoff retry for transient failures.
   * Automatically retries on network errors and retryable HTTP status codes.
   *
   * @param url - The URL to fetch
   * @param options - Fetch options (method, headers, body, etc.)
   * @param retryOptions - Retry configuration
   * @returns The fetch Response object
   */
  static async fetchWithRetry(
    url: string,
    options?: RequestInit,
    retryOptions?: {
      maxRetries?: number;
      baseDelay?: number;
      maxDelay?: number;
      jitter?: boolean;
    }
  ): Promise<Response> {
    const maxRetries = retryOptions?.maxRetries ?? 3;
    const baseDelay = retryOptions?.baseDelay ?? 1000;
    const maxDelay = retryOptions?.maxDelay ?? 30000;
    const jitter = retryOptions?.jitter ?? true;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await fetch(url, options);

        // Check if response status is retryable
        if (Utils.RETRYABLE_STATUS_CODES.has(response.status)) {
          if (attempt > maxRetries) {
            // Return the response anyway on final attempt - let caller handle it
            return response;
          }

          // Check for Retry-After header (common with 429 and 503)
          const retryAfter = response.headers.get("Retry-After");
          let delay: number;

          if (retryAfter) {
            // Retry-After can be seconds or an HTTP date
            const seconds = Number.parseInt(retryAfter, 10);
            if (!Number.isNaN(seconds)) {
              delay = seconds * 1000;
            } else {
              const date = new Date(retryAfter);
              delay = Math.max(0, date.getTime() - Date.now());
            }
          } else {
            // Calculate exponential backoff with optional jitter
            delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
            if (jitter) {
              // Add random jitter (0-50% of delay) to avoid thundering herd
              delay = delay + Math.random() * delay * 0.5;
            }
          }

          console.warn(
            `⚠️  HTTP ${response.status} from ${url}, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries + 1})...`
          );
          await Utils.sleep(delay);
          continue;
        }

        // Success or non-retryable error - return response
        return response;
      } catch (error) {
        lastError = error as Error;

        // Check if it's a retryable network error
        if (!Utils.isRetryableNetworkError(lastError)) {
          throw lastError;
        }

        if (attempt > maxRetries) {
          throw lastError;
        }

        // Calculate exponential backoff with jitter
        let delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
        if (jitter) {
          delay = delay + Math.random() * delay * 0.5;
        }

        console.warn(
          `⚠️  Network error (${lastError.message}), retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries + 1})...`
        );
        await Utils.sleep(delay);
      }
    }

    throw lastError || new Error("Unexpected retry loop exit");
  }

  /**
   * Parse JIRA task key to extract project and number
   */
  static parseTaskKey(taskKey: string): {
    project: string;
    number: number;
    key: string;
  } {
    const match = taskKey.match(/^([A-Z]+)-(\d+)$/);
    if (!match) {
      throw new Error(`Invalid JIRA task key format: ${taskKey}`);
    }

    return {
      project: match[1],
      number: Number.parseInt(match[2], 10),
      key: taskKey,
    };
  }

  /**
   * Extract target branch from JIRA task description
   * Looks for patterns like "Target branch: <branch-name>"
   * Handles various markdown formatting (bold, italic, headings, etc.)
   */
  static extractTargetBranch(description: string | undefined): string | null {
    if (!description) {
      return null;
    }

    // Support multiple patterns with flexible markdown formatting:
    // - "Target branch: branch-name"
    // - "**Target branch**: branch-name"
    // - "*Target branch*: branch-name"
    // - "## Target branch: branch-name"
    // - "_Base branch_: branch-name"
    // - "***PR target***: branch-name"
    // The regex handles:
    // - Optional leading # characters (headings)
    // - Optional * or _ for bold/italic (0-3 occurrences before and after keyword)
    // - The keyword (target branch, base branch, pr target)
    // - REQUIRED colon (with optional table separator |)
    // - The branch name (capturing group) - allows -, _, /, ., alphanumeric
    // - Must end at whitespace, newline, or markdown formatting
    const patterns = [
      /#{0,6}\s*[*_]{0,3}target\s+branch[*_]{0,3}\s*:\s*\|?\s*[*_]{0,3}([a-zA-Z0-9][a-zA-Z0-9._/-]*)(?=\s|[*_,]|\n|$)/i,
      /#{0,6}\s*[*_]{0,3}base\s+branch[*_]{0,3}\s*:\s*\|?\s*[*_]{0,3}([a-zA-Z0-9][a-zA-Z0-9._/-]*)(?=\s|[*_,]|\n|$)/i,
      /#{0,6}\s*[*_]{0,3}pr\s+target[*_]{0,3}\s*:\s*\|?\s*[*_]{0,3}([a-zA-Z0-9][a-zA-Z0-9._/-]*)(?=\s|[*_,]|\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        let branchName = match[1].trim();

        // Clean up any remaining markdown artifacts (but preserve underscores in branch name)
        // Only remove leading/trailing * and _ that are markdown formatting
        branchName = branchName.replace(/^[*_]+/, '').replace(/[*_]+$/, '');

        // Validate branch name (basic check)
        if (branchName && branchName.length > 0 && !branchName.includes(' ')) {
          return branchName;
        }
      }
    }

    return null;
  }

  /**
   * Generate a unique filename based on task key and timestamp
   */
  static generateTaskFilename(taskKey: string, extension = "md"): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedKey = Utils.sanitizeFilename(taskKey);
    return `task-${sanitizedKey}-${timestamp}.${extension}`;
  }

  /**
   * Execute a git command and return the result
   */
  static async executeGitCommand(
    args: string[],
    options?: { verbose?: boolean; cwd?: string }
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const verbose = options?.verbose ?? false;
    const cwd = options?.cwd;

    if (verbose) {
      console.log(`🔧 Executing: git ${args.join(" ")}${cwd ? ` (in ${cwd})` : ""}`);
    }

    return new Promise((resolve) => {
      const git = spawn("git", args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: cwd || process.cwd()
      });

      let output = "";
      let error = "";

      git.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        if (verbose) {
          process.stdout.write(text);
        }
      });

      git.stderr.on("data", (data) => {
        const text = data.toString();
        error += text;
        if (verbose) {
          process.stderr.write(text);
        }
      });

      git.on("close", (code) => {
        const result = {
          success: code === 0,
          output: output.trim(),
          error: error.trim(),
        };

        if (verbose) {
          if (!result.success) {
            console.error(`❌ Git command failed (exit code ${code})`);
            if (result.error) {
              console.error(`   Error: ${result.error}`);
            }
            if (result.output) {
              console.error(`   Output: ${result.output}`);
            }
          } else {
            console.log(`✅ Git command succeeded`);
          }
        }

        resolve(result);
      });
    });
  }

  /**
   * Check if we're in a git repository
   */
  static async isGitRepository(): Promise<boolean> {
    const result = await Utils.executeGitCommand(["rev-parse", "--git-dir"]);
    return result.success;
  }

  /**
   * Get the current git branch name
   */
  static async getCurrentBranch(cwd?: string): Promise<string | null> {
    const result = await Utils.executeGitCommand(["branch", "--show-current"], { cwd });
    return result.success ? result.output : null;
  }

  /**
   * Check if there are uncommitted changes
   */
  static async hasUncommittedChanges(cwd?: string): Promise<boolean> {
    const result = await Utils.executeGitCommand(["status", "--porcelain"], { cwd });
    return result.success && result.output.length > 0;
  }

  /**
   * Commit all changes with a descriptive message
   */
  static async commitChanges(
    taskKey: string,
    taskSummary: string,
    options?: {
      verbose?: boolean;
      author?: { name: string; email: string };
      cwd?: string;
    }
  ): Promise<{ success: boolean; message: string; hookError?: string }> {
    const verbose = options?.verbose ?? false;
    const author = options?.author;
    const cwd = options?.cwd;

    try {
      // Check if we're in a git repository
      if (!(await Utils.isGitRepository())) {
        return {
          success: false,
          message: "Not in a git repository",
        };
      }

      // Safety check: prevent commits directly to protected branches
      const currentBranch = await Utils.getCurrentBranch();
      if (currentBranch && await Utils.isProtectedBranch(currentBranch)) {
        return {
          success: false,
          message: `Cannot commit directly to protected branch '${currentBranch}'. Please create a feature branch first.`,
        };
      }

      // Check if there are any changes to commit
      if (!(await Utils.hasUncommittedChanges(cwd))) {
        return {
          success: false,
          message: "No changes to commit",
        };
      }

      // Add all changes
      const addResult = await Utils.executeGitCommand(["add", "."], { verbose, cwd });
      if (!addResult.success) {
        return {
          success: false,
          message: `Failed to stage changes: ${addResult.error}`,
        };
      }

      // Create commit message
      const commitMessage = `feat: implement ${taskKey} - ${taskSummary}`;

      // Build commit command with optional author override
      const commitArgs: string[] = [];

      // If author is provided, use -c flags to override user.name and user.email
      if (author) {
        commitArgs.push("-c", `user.name=${author.name}`);
        commitArgs.push("-c", `user.email=${author.email}`);
      }

      commitArgs.push("commit", "-m", commitMessage);

      // Commit changes
      const commitResult = await Utils.executeGitCommand(commitArgs, { verbose, cwd });
      if (commitResult.success) {
        return {
          success: true,
          message: `Successfully committed changes for ${taskKey}`,
        };
      }

      // Treat any commit failure as a potential hook/fixable error
      // The full error context (stdout + stderr) will be passed to Claude
      // to diagnose and fix. This is more generic than keyword matching and
      // handles all types of commit failures (hooks, linting, tests, etc.)
      const fullError = [
        commitResult.error,
        commitResult.output
      ].filter(Boolean).join("\n").trim();

      return {
        success: false,
        message: `Failed to commit changes: ${commitResult.error}`,
        hookError: fullError || commitResult.error,
      };
    } catch (error) {
      return {
        success: false,
        message: `Git commit failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Pull latest changes from remote repository for a specific branch
   */
  static async pullLatestChanges(
    branch: string,
    options?: {
      verbose?: boolean;
    }
  ): Promise<{ success: boolean; message: string }> {
    const verbose = options?.verbose ?? false;

    try {
      // Check if we're in a git repository
      if (!(await Utils.isGitRepository())) {
        return {
          success: false,
          message: "Not in a git repository",
        };
      }

      // Check for uncommitted changes
      if (await Utils.hasUncommittedChanges()) {
        return {
          success: false,
          message:
            "There are uncommitted changes. Please commit or stash them before pulling.",
        };
      }

      const currentBranch = await Utils.getCurrentBranch();

      // Switch to target branch if not already on it
      if (currentBranch !== branch) {
        if (verbose) {
          console.log(`📥 Switching to branch '${branch}'...`);
        }
        const switchResult = await Utils.executeGitCommand(
          ["checkout", branch],
          { verbose }
        );
        if (!switchResult.success) {
          return {
            success: false,
            message: `Failed to switch to branch '${branch}': ${switchResult.error}`,
          };
        }
      }

      if (verbose) {
        console.log(`📥 Pulling latest changes for branch '${branch}'...`);
      }

      // Pull latest changes
      const pullResult = await Utils.executeGitCommand(
        ["pull", "origin", branch],
        { verbose }
      );

      if (pullResult.success) {
        return {
          success: true,
          message: `Successfully pulled latest changes for '${branch}'`,
        };
      }

      return {
        success: false,
        message: `Failed to pull changes: ${pullResult.error}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Git pull failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get the main branch name (master or main)
   */
  static async getMainBranchName(): Promise<string> {
    // First try to get default branch from git
    const defaultBranch = await Utils.executeGitCommand([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    if (defaultBranch.success) {
      const branchName = defaultBranch.output.replace(
        "refs/remotes/origin/",
        ""
      );
      if (branchName) {
        return branchName;
      }
    }

    // Check if 'main' exists
    const mainExists = await Utils.executeGitCommand([
      "show-ref",
      "--verify",
      "--quiet",
      "refs/heads/main",
    ]);
    if (mainExists.success) {
      return "main";
    }

    // Check if 'master' exists
    const masterExists = await Utils.executeGitCommand([
      "show-ref",
      "--verify",
      "--quiet",
      "refs/heads/master",
    ]);
    if (masterExists.success) {
      return "master";
    }

    // Default to 'main' if neither exists (for new repos)
    return "main";
  }

  /**
   * Push current branch to remote repository
   */
  static async pushCurrentBranch(options?: { verbose?: boolean; cwd?: string }): Promise<{
    success: boolean;
    message: string;
    hookError?: string;
  }> {
    const verbose = options?.verbose ?? false;
    const cwd = options?.cwd;

    try {
      // Get current branch name (from the specified working directory)
      const currentBranch = await Utils.getCurrentBranch(cwd);
      if (!currentBranch) {
        return {
          success: false,
          message: "Could not determine current branch",
        };
      }

      // Safety check: prevent pushing protected branches (this is unusual but could happen)
      if (await Utils.isProtectedBranch(currentBranch)) {
        return {
          success: false,
          message: `Cannot push protected branch '${currentBranch}'. This should not happen - please create a feature branch.`,
        };
      }

      if (verbose) {
        console.log(`📤 Pushing branch '${currentBranch}' to remote...`);
      }

      // Check if remote branch exists
      const remoteBranchExists = await Utils.executeGitCommand([
        "ls-remote",
        "--heads",
        "origin",
        currentBranch,
      ], { verbose, cwd });

      let pushResult;
      if (remoteBranchExists.success && remoteBranchExists.output.trim()) {
        // Remote branch exists, just push
        pushResult = await Utils.executeGitCommand([
          "push",
          "origin",
          currentBranch,
        ], { verbose, cwd });
        if (pushResult.success) {
          return {
            success: true,
            message: `Successfully pushed '${currentBranch}' to remote`,
          };
        }
      } else {
        // Remote branch doesn't exist, push with -u flag to set upstream
        pushResult = await Utils.executeGitCommand([
          "push",
          "-u",
          "origin",
          currentBranch,
        ], { verbose, cwd });
        if (pushResult.success) {
          return {
            success: true,
            message: `Successfully pushed '${currentBranch}' to remote and set upstream`,
          };
        }
      }

      // Check if this is a non-fixable git state error
      const fullError = [
        pushResult.error,
        pushResult.output
      ].filter(Boolean).join("\n").trim();

      const isNonFastForward = fullError.includes("[rejected]") &&
                               fullError.includes("non-fast-forward");
      const isFetchFirst = fullError.includes("fetch first") ||
                          fullError.includes("Updates were rejected");

      // Non-fast-forward and similar errors are not fixable by Claude
      // They require manual intervention (pull, rebase, or force push)
      if (isNonFastForward || isFetchFirst) {
        return {
          success: false,
          message: `Push rejected - branch diverged from remote. Run 'git pull --rebase' or 'git push --force' (dangerous): ${pushResult.error}`,
          // Don't mark as hookError since this is not fixable by Claude
        };
      }

      // Treat other push failures as potential hook/fixable errors
      // The full error context (stdout + stderr) will be passed to Claude
      return {
        success: false,
        message: `Failed to push branch: ${pushResult.error}`,
        hookError: fullError || pushResult.error,
      };
    } catch (error) {
      return {
        success: false,
        message: `Git push failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Check if the current branch is a protected branch (main/master/develop)
   */
  static async isProtectedBranch(branch?: string): Promise<boolean> {
    try {
      const currentBranch = branch || (await Utils.getCurrentBranch());
      if (!currentBranch) {
        return false;
      }

      const protectedBranches = ["main", "master", "develop", "development", "staging", "production"];
      return protectedBranches.includes(currentBranch.toLowerCase());
    } catch (error) {
      return false;
    }
  }

  /**
   * Create and checkout a new feature branch for the task
   */
  static async createFeatureBranch(
    taskKey: string,
    baseBranch?: string
  ): Promise<{ success: boolean; branchName: string; message: string }> {
    const baseBranchName = `feature/${taskKey.toLowerCase()}`;
    let branchName = baseBranchName;
    let attemptCounter = 1;

    try {
      // Check if we're in a git repository
      if (!(await Utils.isGitRepository())) {
        return {
          success: false,
          branchName,
          message: "Not in a git repository",
        };
      }

      // Clean up any uncommitted changes and untracked files before creating branch
      // This ensures a clean state for the new feature branch
      console.log("🧹 Cleaning up working directory before creating feature branch...");

      // Reset any staged or modified files
      const resetResult = await Utils.executeGitCommand(["reset", "--hard", "HEAD"]);
      if (!resetResult.success) {
        console.warn(`⚠️  Failed to reset changes: ${resetResult.error}`);
      }

      // Remove untracked files and directories
      const cleanResult = await Utils.executeGitCommand(["clean", "-fd"]);
      if (!cleanResult.success) {
        console.warn(`⚠️  Failed to clean untracked files: ${cleanResult.error}`);
      }

      console.log("✅ Working directory cleaned");

      // Switch to target branch first (or main/master if not specified)
      let targetBranch = baseBranch || (await Utils.getMainBranchName());
      const currentBranch = await Utils.getCurrentBranch();

      // Track whether we should create branch from remote ref instead of local checkout
      let createFromRemote = false;

      if (currentBranch !== targetBranch) {
        let switchResult = await Utils.executeGitCommand([
          "checkout",
          targetBranch,
        ]);

        // If checkout failed and we're trying a default branch (not user-specified),
        // try the alternative default branch
        if (!switchResult.success && !baseBranch) {
          const alternativeBranch = targetBranch === "main" ? "master" : "main";
          const altBranchExists = await Utils.executeGitCommand([
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${alternativeBranch}`,
          ]);

          if (altBranchExists.success) {
            console.log(`⚠️  Branch '${targetBranch}' not found, trying '${alternativeBranch}'...`);
            targetBranch = alternativeBranch;
            switchResult = await Utils.executeGitCommand([
              "checkout",
              alternativeBranch,
            ]);
          }
        }

        // Handle worktree conflict - target branch is locked by another worktree
        if (!switchResult.success && switchResult.error?.includes("already used by worktree")) {
          console.log(`⚠️  Target branch '${targetBranch}' is locked by a worktree, will create branch from remote...`);
          createFromRemote = true;
        } else if (!switchResult.success) {
          return {
            success: false,
            branchName,
            message: `Failed to switch to ${targetBranch} branch: ${switchResult.error}`,
          };
        }
      }

      // Fetch and update target branch
      if (createFromRemote) {
        // Fetch the target branch from remote without checking it out
        console.log(`📥 Fetching latest '${targetBranch}' from remote...`);
        const fetchResult = await Utils.executeGitCommand([
          "fetch",
          "origin",
          `${targetBranch}:refs/remotes/origin/${targetBranch}`,
        ]);
        if (!fetchResult.success) {
          console.log(`⚠️  Failed to fetch '${targetBranch}': ${fetchResult.error}`);
          console.log("   Will try to create branch from local reference...");
        }
      } else {
        // Ensure target branch is up to date with remote
        console.log(`📥 Pulling latest changes for target branch '${targetBranch}'...`);
        const pullResult = await Utils.executeGitCommand([
          "pull",
          "origin",
          targetBranch,
        ]);

        if (!pullResult.success) {
          console.log(`⚠️  Failed to pull latest changes for '${targetBranch}': ${pullResult.error}`);
          console.log("   Continuing with local version of the branch...");
        }
      }

      // Find an available branch name by checking for existing branches
      while (true) {
        const branchExists = await Utils.executeGitCommand([
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${branchName}`,
        ]);

        if (!branchExists.success) {
          // Branch doesn't exist, we can use this name
          break;
        }

        // Branch exists, try next attempt
        attemptCounter++;
        branchName = `${baseBranchName}-attempt-${attemptCounter}`;
      }

      // Check if the branch is being used by a worktree and clean it up if needed
      const worktreeListResult = await Utils.executeGitCommand([
        "worktree",
        "list",
        "--porcelain",
      ]);

      if (worktreeListResult.success && worktreeListResult.output.includes(`branch refs/heads/${branchName}`)) {
        console.log(`⚠️  Branch '${branchName}' is checked out in a worktree, cleaning up...`);

        // Find the worktree path for this branch
        const lines = worktreeListResult.output.split("\n");
        let worktreeToRemove: string | null = null;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("worktree ")) {
            const path = lines[i].substring("worktree ".length);
            // Check if this worktree has our branch
            for (let j = i + 1; j < lines.length && !lines[j].startsWith("worktree "); j++) {
              if (lines[j] === `branch refs/heads/${branchName}`) {
                worktreeToRemove = path;
                break;
              }
            }
            if (worktreeToRemove) break;
          }
        }

        if (worktreeToRemove) {
          // Remove the worktree
          const removeResult = await Utils.executeGitCommand([
            "worktree",
            "remove",
            worktreeToRemove,
            "--force",
          ]);

          if (!removeResult.success) {
            // Try to forcibly delete the worktree directory and prune
            try {
              rmSync(worktreeToRemove, { recursive: true, force: true });
            } catch (e) {
              // Ignore deletion errors
            }
            await Utils.executeGitCommand(["worktree", "prune"]);
          }
          console.log(`✅ Cleaned up worktree at ${worktreeToRemove}`);
        }

        // Delete the branch if it still exists (it might after worktree removal)
        await Utils.executeGitCommand(["branch", "-D", branchName]);
      }

      // Create and checkout new branch from target branch
      // When createFromRemote is true, we couldn't checkout targetBranch (worktree conflict),
      // so create from the remote or local reference instead
      const createFromRef = createFromRemote
        ? `origin/${targetBranch}`
        : undefined; // undefined means create from HEAD (current branch)

      let createResult = await Utils.executeGitCommand(
        createFromRef
          ? ["checkout", "-b", branchName, createFromRef]
          : ["checkout", "-b", branchName]
      );

      // If creating from remote ref failed, try the local branch ref
      if (!createResult.success && createFromRemote) {
        console.log(`⚠️  Failed to create from origin/${targetBranch}, trying local ref...`);
        createResult = await Utils.executeGitCommand([
          "checkout",
          "-b",
          branchName,
          targetBranch,
        ]);
      }

      // Handle worktree conflict that wasn't caught by the proactive check
      if (!createResult.success && createResult.error?.includes("already used by worktree")) {
        console.log(`⚠️  Branch '${branchName}' is still locked by a worktree, forcing cleanup...`);

        // Extract worktree path from error message
        const match = createResult.error.match(/already used by worktree at '([^']+)'/);
        if (match) {
          const worktreePath = match[1];

          // Force remove the worktree
          await Utils.executeGitCommand(["worktree", "remove", worktreePath, "--force"]);

          // Also try to delete directory if still exists
          try {
            rmSync(worktreePath, { recursive: true, force: true });
          } catch (e) {
            // Ignore
          }

          // Prune worktree registry
          await Utils.executeGitCommand(["worktree", "prune"]);

          // Delete the branch
          await Utils.executeGitCommand(["branch", "-D", branchName]);

          console.log(`✅ Force cleaned up worktree at ${worktreePath}`);

          // Retry branch creation with same ref strategy
          createResult = await Utils.executeGitCommand(
            createFromRef
              ? ["checkout", "-b", branchName, createFromRef]
              : ["checkout", "-b", branchName]
          );
        }
      }

      if (createResult.success) {
        const message =
          attemptCounter === 1
            ? `Created and switched to new branch '${branchName}' from ${targetBranch}`
            : `Created and switched to new branch '${branchName}' from ${targetBranch} (previous attempts existed)`;

        return {
          success: true,
          branchName,
          message,
        };
      }
      return {
        success: false,
        branchName,
        message: `Failed to create branch: ${createResult.error}`,
      };
    } catch (error) {
      return {
        success: false,
        branchName,
        message: `Git operation failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Remove a git worktree and clean up its directory.
   */
  static async removeReviewWorktree(
    worktreePath: string,
    options?: { verbose?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const verbose = options?.verbose ?? false;

    try {
      if (!existsSync(worktreePath)) {
        if (verbose) {
          console.log(`⏭️  Worktree does not exist: ${worktreePath}`);
        }
        return { success: true };
      }

      if (verbose) {
        console.log(`\n🗑️  Removing worktree: ${worktreePath}`);
      }

      // Try to remove via git first
      const removeResult = await Utils.executeGitCommand(
        ["worktree", "remove", worktreePath, "--force"],
        { verbose }
      );

      if (!removeResult.success) {
        if (verbose) {
          console.log(`   Git worktree remove failed, deleting directory...`);
        }
        // Forcefully delete the directory
        rmSync(worktreePath, { recursive: true, force: true });
      }

      if (verbose) {
        console.log(`✅ Worktree removed successfully`);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Worktree removal failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Prepare the single review worktree for webhook processing.
   * Reuses `/tmp/claude-intern-review-worktree/` (singular) and switches branches.
   * Much more efficient than creating/removing worktrees for each review.
   *
   * Automatically cleans up stale worktree registrations (e.g., from old paths).
   */
  static async prepareReviewWorktree(
    branch: string,
    options?: { verbose?: boolean }
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const verbose = options?.verbose ?? false;

    try {
      // Single worktree path - reused across all webhook reviews
      const worktreePath = Utils.getReviewWorktreePath();

      if (verbose) {
        console.log(`\n📂 Preparing review worktree for branch: ${branch}`);
        console.log(`   Worktree path: ${worktreePath}`);
      }

      // Fetch latest from origin (shallow fetch to minimize data transfer)
      if (verbose) {
        console.log(`   Fetching branch ${branch} from origin (shallow)...`);
      }

      const fetchResult = await Utils.executeGitCommand(
        ["fetch", "origin", branch, "--depth=1"],
        { verbose }
      );

      if (verbose) {
        console.log(`   ✓ Fetch completed (success: ${fetchResult.success})`);
      }

      if (!fetchResult.success) {
        console.warn(`⚠️  Fetch failed: ${fetchResult.error || fetchResult.output}`);
        console.warn(`   Continuing anyway - worktree may have cached version...`);
      }

      // Check if worktree directory exists on filesystem
      const worktreeExists = existsSync(worktreePath);

      if (verbose) {
        console.log(`   Worktree directory exists: ${worktreeExists}`);
      }

      if (worktreeExists) {
        // Check if it's a valid git worktree by testing if .git exists and is valid
        const gitFileExists = existsSync(join(worktreePath, ".git"));

        if (gitFileExists) {
          // Try to verify it's a valid worktree
          const statusCheck = await Utils.executeGitCommand(
            ["status", "--porcelain"],
            { verbose: false, cwd: worktreePath }
          );

          if (statusCheck.success) {
            // Valid worktree - switch branch
            if (verbose) {
              console.log(`   Switching to branch ${branch}...`);
            }

            // Check if origin remote exists
            const originCheck = await Utils.executeGitCommand(
              ["remote", "get-url", "origin"],
              { verbose: false, cwd: worktreePath }
            );
            const hasOrigin = originCheck.success;

            let switchResult;
            if (hasOrigin) {
              // Try checkout with -B to force create/reset branch tracking origin
              switchResult = await Utils.executeGitCommand(
                ["checkout", "-B", branch, "--track", `origin/${branch}`],
                { verbose, cwd: worktreePath }
              );
            } else {
              // No origin - just checkout the local branch
              switchResult = await Utils.executeGitCommand(
                ["checkout", branch],
                { verbose, cwd: worktreePath }
              );
            }

            if (switchResult.success) {
              // Pull latest changes if origin exists
              if (hasOrigin) {
                if (verbose) {
                  console.log(`   Pulling latest changes...`);
                }
                await Utils.executeGitCommand(
                  ["pull", "origin", branch, "--ff-only"],
                  { verbose, cwd: worktreePath }
                );
              }

              if (verbose) {
                console.log(`✅ Switched to branch ${branch}`);
              }

              // Install dependencies
              if (verbose) {
                console.log(`📦 Installing dependencies...`);
              }
              const installResult = await Utils.installDependencies(worktreePath, { verbose });

              if (!installResult.success) {
                console.warn(`⚠️  Failed to install dependencies: ${installResult.error}`);
                console.warn(`   Claude may not be able to run tests or build commands`);
              }

              return { success: true, path: worktreePath };
            }
          }
        }

        // Worktree is corrupted or invalid - clean it up
        if (verbose) {
          console.log(`   Worktree is invalid/corrupted, cleaning up...`);
        }

        // Remove from git's worktree registry (ignore errors)
        await Utils.executeGitCommand(
          ["worktree", "remove", worktreePath, "--force"],
          { verbose: false }
        );

        // Remove directory itself (ignore errors)
        try {
          rmSync(worktreePath, { recursive: true, force: true });
        } catch (e) {
          // Ignore
        }

        // Prune any stale worktree registrations
        await Utils.executeGitCommand(["worktree", "prune"], { verbose: false });
      }

      // Create new worktree
      if (verbose) {
        console.log(`   Creating worktree at ${worktreePath}...`);
      }

      // Check if the branch exists locally
      const localBranchCheck = await Utils.executeGitCommand(
        ["show-ref", "--verify", `refs/heads/${branch}`],
        { verbose: false }
      );

      // Check if origin remote exists
      const originCheck = await Utils.executeGitCommand(
        ["remote", "get-url", "origin"],
        { verbose: false }
      );
      const hasOrigin = originCheck.success;

      let createResult;

      if (hasOrigin) {
        // With origin - try to create worktree tracking origin branch
        if (localBranchCheck.success) {
          // Local branch exists - delete it first to avoid conflicts
          await Utils.executeGitCommand(
            ["branch", "-D", branch],
            { verbose: false }
          );
        }

        createResult = await Utils.executeGitCommand(
          ["worktree", "add", "--track", "-b", branch, worktreePath, `origin/${branch}`],
          { verbose }
        );
      } else {
        // No origin - use local branch
        createResult = await Utils.executeGitCommand(
          ["worktree", "add", worktreePath, branch],
          { verbose }
        );
      }

      if (!createResult.success) {
        // If creation failed, it might be due to stale registrations - clean up
        const errorMsg = (createResult.error || "") + (createResult.output || "");

        if (errorMsg.includes("already registered") || errorMsg.includes("missing but")) {
          if (verbose) {
            console.log(`   Cleaning up stale worktree registrations...`);
          }

          // Prune stale worktrees silently
          await Utils.executeGitCommand(["worktree", "prune"], { verbose: false });

          // Delete the local branch if it exists (may have been created by the failed first attempt)
          await Utils.executeGitCommand(["branch", "-D", branch], { verbose: false });

          // Try again after pruning
          if (hasOrigin) {
            createResult = await Utils.executeGitCommand(
              ["worktree", "add", "--track", "-b", branch, worktreePath, `origin/${branch}`],
              { verbose }
            );
          } else {
            createResult = await Utils.executeGitCommand(
              ["worktree", "add", worktreePath, branch],
              { verbose }
            );
          }
        }

        if (!createResult.success) {
          return {
            success: false,
            error: `Failed to create worktree: ${createResult.error || createResult.output}`,
          };
        }
      }

      if (verbose) {
        console.log(`✅ Worktree ready at ${worktreePath}`);
      }

      // Install dependencies to ensure Claude has everything needed
      if (verbose) {
        console.log(`📦 Installing dependencies...`);
      }
      const installResult = await Utils.installDependencies(worktreePath, { verbose });

      if (verbose) {
        console.log(`   ✓ Dependency installation completed (success: ${installResult.success})`);
      }

      if (!installResult.success) {
        // Log warning but don't fail - Claude can still work without dependencies in some cases
        console.warn(`⚠️  Failed to install dependencies: ${installResult.error}`);
        console.warn(`   Claude may not be able to run tests or build commands`);
      }

      if (verbose) {
        console.log(`✅ Worktree preparation complete!`);
      }

      return { success: true, path: worktreePath };
    } catch (error) {
      return {
        success: false,
        error: `Worktree preparation failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get the path to the single review worktree.
   */
  static getReviewWorktreePath(): string {
    return "/tmp/claude-intern-review-worktree";
  }

  /**
   * Detect and run the appropriate package manager to install dependencies.
   * Supports: JavaScript/TypeScript (bun, pnpm, yarn, npm), Python (poetry, pip),
   * Ruby (bundle), Go (go mod), Rust (cargo), PHP (composer), and Java (maven, gradle).
   * Returns true if dependencies were installed successfully.
   */
  static async installDependencies(
    workingDir: string,
    options?: { verbose?: boolean }
  ): Promise<{ success: boolean; packageManager?: string; error?: string }> {
    const verbose = options?.verbose ?? false;

    // Define package managers for each language/ecosystem
    const packageManagers = [
      // JavaScript/TypeScript (only with lock files)
      { name: "bun", manifestFile: "package.json", lockFile: "bun.lockb", command: "bun", args: ["install"] },
      { name: "pnpm", manifestFile: "package.json", lockFile: "pnpm-lock.yaml", command: "pnpm", args: ["install", "--frozen-lockfile"] },
      { name: "yarn", manifestFile: "package.json", lockFile: "yarn.lock", command: "yarn", args: ["install", "--frozen-lockfile"] },
      { name: "npm", manifestFile: "package.json", lockFile: "package-lock.json", command: "npm", args: ["ci"] },

      // Python
      { name: "uv", manifestFile: "pyproject.toml", lockFile: "uv.lock", command: "uv", args: ["sync"] },
      { name: "poetry", manifestFile: "pyproject.toml", lockFile: "poetry.lock", command: "poetry", args: ["install", "--no-root"] },
      { name: "pip", manifestFile: "requirements.txt", lockFile: null, command: "pip", args: ["install", "-r", "requirements.txt"] },
      { name: "pipenv", manifestFile: "Pipfile", lockFile: "Pipfile.lock", command: "pipenv", args: ["install", "--deploy"] },

      // Ruby
      { name: "bundle", manifestFile: "Gemfile", lockFile: "Gemfile.lock", command: "bundle", args: ["install"] },

      // Go
      { name: "go", manifestFile: "go.mod", lockFile: "go.sum", command: "go", args: ["mod", "download"] },

      // Rust
      { name: "cargo", manifestFile: "Cargo.toml", lockFile: "Cargo.lock", command: "cargo", args: ["fetch"] },

      // PHP
      { name: "composer", manifestFile: "composer.json", lockFile: "composer.lock", command: "composer", args: ["install", "--no-interaction"] },

      // Java (no lock files, so only install if we find these files)
      { name: "maven", manifestFile: "pom.xml", lockFile: null, command: "mvn", args: ["dependency:resolve"] },
      { name: "gradle", manifestFile: "build.gradle", lockFile: null, command: "gradle", args: ["dependencies", "--quiet"] },
      { name: "gradle", manifestFile: "build.gradle.kts", lockFile: null, command: "gradle", args: ["dependencies", "--quiet"] },
    ];

    // Find all applicable package managers for this project
    // Prioritize those with lock files, only use manifest-only as fallback
    const pmsWithLock = packageManagers.filter((pm) => {
      const manifestExists = existsSync(join(workingDir, pm.manifestFile));
      if (!manifestExists) return false;

      if (pm.lockFile) {
        return existsSync(join(workingDir, pm.lockFile));
      }

      return false;
    });

    const pmsWithoutLock = packageManagers.filter((pm) => {
      const manifestExists = existsSync(join(workingDir, pm.manifestFile));
      if (!manifestExists) return false;

      // Only include if no lock file is required
      return pm.lockFile === null;
    });

    // Prefer package managers with lock files, otherwise use manifest-only ones
    const applicablePMs = pmsWithLock.length > 0 ? pmsWithLock : pmsWithoutLock;

    if (applicablePMs.length === 0) {
      // No package manager files found - nothing to install
      return { success: true };
    }

    // Install dependencies for each detected package manager
    const results: Array<{ success: boolean; packageManager: string; error?: string }> = [];

    for (const pm of applicablePMs) {
      if (verbose) {
        console.log(`   Installing ${pm.name} dependencies...`);
      }

      const result = await new Promise<{ success: boolean; packageManager: string; error?: string }>((resolve) => {
        const proc = spawn(pm.command, pm.args, {
          cwd: workingDir,
          stdio: verbose ? "inherit" : "pipe",
        });

        let errorOutput = "";

        if (!verbose) {
          // Must consume both stdout and stderr to prevent pipe buffer deadlock
          // When the buffer fills up (typically 64KB), the process blocks
          if (proc.stdout) {
            proc.stdout.on("data", () => {
              // Discard stdout when not verbose, just keep draining the buffer
            });
          }
          if (proc.stderr) {
            proc.stderr.on("data", (data: Buffer) => {
              errorOutput += data.toString();
            });
          }
        }

        proc.on("error", (error: NodeJS.ErrnoException) => {
          resolve({
            success: false,
            packageManager: pm.name,
            error: `Failed to run ${pm.name}: ${error.message}`,
          });
        });

        proc.on("close", (code: number | null) => {
          if (code === 0) {
            if (verbose) {
              console.log(`   ✅ ${pm.name} dependencies installed`);
            }
            resolve({
              success: true,
              packageManager: pm.name,
            });
          } else {
            resolve({
              success: false,
              packageManager: pm.name,
              error: `${pm.name} exited with code ${code}${errorOutput ? `\n${errorOutput}` : ""}`,
            });
          }
        });
      });

      results.push(result);
    }

    // Consider overall success if at least one package manager succeeded
    const anySuccess = results.some((r) => r.success);
    const allErrors = results.filter((r) => !r.success).map((r) => r.error).join("; ");

    if (anySuccess) {
      return {
        success: true,
        packageManager: results.filter((r) => r.success).map((r) => r.packageManager).join(", "),
      };
    } else {
      return {
        success: false,
        packageManager: results.map((r) => r.packageManager).join(", "),
        error: allErrors,
      };
    }
  }
}
