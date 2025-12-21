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
  static async getCurrentBranch(): Promise<string | null> {
    const result = await Utils.executeGitCommand(["branch", "--show-current"]);
    return result.success ? result.output : null;
  }

  /**
   * Check if there are uncommitted changes
   */
  static async hasUncommittedChanges(): Promise<boolean> {
    const result = await Utils.executeGitCommand(["status", "--porcelain"]);
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
    }
  ): Promise<{ success: boolean; message: string; hookError?: string }> {
    const verbose = options?.verbose ?? false;
    const author = options?.author;

    try {
      // Check if we're in a git repository
      if (!(await Utils.isGitRepository())) {
        return {
          success: false,
          message: "Not in a git repository",
        };
      }

      // Check if there are any changes to commit
      if (!(await Utils.hasUncommittedChanges())) {
        return {
          success: false,
          message: "No changes to commit",
        };
      }

      // Add all changes
      const addResult = await Utils.executeGitCommand(["add", "."], { verbose });
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
      const commitResult = await Utils.executeGitCommand(commitArgs, { verbose });
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
  static async pushCurrentBranch(options?: { verbose?: boolean }): Promise<{
    success: boolean;
    message: string;
    hookError?: string;
  }> {
    const verbose = options?.verbose ?? false;

    try {
      // Get current branch name
      const currentBranch = await Utils.getCurrentBranch();
      if (!currentBranch) {
        return {
          success: false,
          message: "Could not determine current branch",
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
      ], { verbose });

      let pushResult;
      if (remoteBranchExists.success && remoteBranchExists.output.trim()) {
        // Remote branch exists, just push
        pushResult = await Utils.executeGitCommand([
          "push",
          "origin",
          currentBranch,
        ], { verbose });
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
        ], { verbose });
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

      // Check for uncommitted changes
      if (await Utils.hasUncommittedChanges()) {
        return {
          success: false,
          branchName,
          message:
            "There are uncommitted changes. Please commit or stash them before creating a feature branch.",
        };
      }

      // Switch to target branch first (or main/master if not specified)
      let targetBranch = baseBranch || (await Utils.getMainBranchName());
      const currentBranch = await Utils.getCurrentBranch();

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

        if (!switchResult.success) {
          return {
            success: false,
            branchName,
            message: `Failed to switch to ${targetBranch} branch: ${switchResult.error}`,
          };
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

      // Create and checkout new branch from target branch
      const createResult = await Utils.executeGitCommand([
        "checkout",
        "-b",
        branchName,
      ]);
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
   * Create a git worktree for PR review work.
   * Creates worktrees in `.claude-intern/review-worktrees/` to isolate PR work.
   */
  static async createReviewWorktree(
    owner: string,
    repo: string,
    branch: string,
    options?: { verbose?: boolean }
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const verbose = options?.verbose ?? false;

    try {
      // Create worktrees directory in .claude-intern folder
      const reviewsDir = join(process.cwd(), ".claude-intern", "review-worktrees");
      Utils.ensureDirectoryExists(reviewsDir);

      // Sanitize names for directory path
      const sanitizedOwner = Utils.sanitizeFilename(owner);
      const sanitizedRepo = Utils.sanitizeFilename(repo);
      const sanitizedBranch = Utils.sanitizeFilename(branch);
      const worktreePath = join(
        reviewsDir,
        `${sanitizedOwner}-${sanitizedRepo}-${sanitizedBranch}`
      );

      if (verbose) {
        console.log(`\n📂 Creating review worktree:`);
        console.log(`   Owner: ${owner}`);
        console.log(`   Repo: ${repo}`);
        console.log(`   Branch: ${branch}`);
        console.log(`   Path: ${worktreePath}`);
      }

      // Remove existing worktree if it exists
      if (existsSync(worktreePath)) {
        if (verbose) {
          console.log(`   Removing existing worktree...`);
        }

        // Try to remove the worktree via git first
        const removeResult = await Utils.executeGitCommand(
          ["worktree", "remove", worktreePath, "--force"],
          { verbose }
        );

        // If git remove fails, forcefully delete the directory
        if (!removeResult.success) {
          if (verbose) {
            console.log(`   Git worktree remove failed, deleting directory...`);
          }
          try {
            rmSync(worktreePath, { recursive: true, force: true });
          } catch (error) {
            // Ignore errors, will try to create anyway
          }
        }
      }

      // Fetch latest from origin to ensure branch is up to date
      if (verbose) {
        console.log(`   Fetching latest from origin...`);
      }
      await Utils.executeGitCommand(["fetch", "origin"], { verbose });

      // Create the worktree
      if (verbose) {
        console.log(`   Creating worktree...`);
      }

      const createResult = await Utils.executeGitCommand(
        ["worktree", "add", worktreePath, branch],
        { verbose }
      );

      if (!createResult.success) {
        // Try creating with origin/ prefix
        if (verbose) {
          console.log(`   Retrying with origin/${branch}...`);
        }

        const retryResult = await Utils.executeGitCommand(
          ["worktree", "add", worktreePath, `origin/${branch}`],
          { verbose }
        );

        if (!retryResult.success) {
          return {
            success: false,
            error: `Failed to create worktree: ${retryResult.error || createResult.error}`,
          };
        }
      }

      if (verbose) {
        console.log(`✅ Worktree created successfully`);
      }

      return {
        success: true,
        path: worktreePath,
      };
    } catch (error) {
      return {
        success: false,
        error: `Worktree creation failed: ${(error as Error).message}`,
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
   * List all review worktrees.
   */
  static async listReviewWorktrees(options?: {
    verbose?: boolean;
  }): Promise<string[]> {
    const verbose = options?.verbose ?? false;
    const reviewsDir = join(process.cwd(), ".claude-intern", "review-worktrees");

    if (!existsSync(reviewsDir)) {
      return [];
    }

    try {
      const { readdir } = await import("fs/promises");
      const entries = await readdir(reviewsDir, { withFileTypes: true });
      const worktrees = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(reviewsDir, entry.name));

      if (verbose) {
        console.log(`\n📋 Found ${worktrees.length} review worktree(s):`);
        worktrees.forEach((path, index) => {
          console.log(`   ${index + 1}. ${path}`);
        });
      }

      return worktrees;
    } catch (error) {
      if (verbose) {
        console.error(`Failed to list worktrees: ${(error as Error).message}`);
      }
      return [];
    }
  }

  /**
   * Clean up old review worktrees.
   */
  static async cleanupReviewWorktrees(options?: {
    verbose?: boolean;
    olderThanDays?: number;
  }): Promise<{ success: boolean; cleaned: number; errors: number }> {
    const verbose = options?.verbose ?? false;
    const olderThanDays = options?.olderThanDays ?? 7;

    const worktrees = await Utils.listReviewWorktrees({ verbose });
    let cleaned = 0;
    let errors = 0;

    if (worktrees.length === 0) {
      if (verbose) {
        console.log(`\n🧹 No worktrees to clean up`);
      }
      return { success: true, cleaned: 0, errors: 0 };
    }

    if (verbose) {
      console.log(`\n🧹 Cleaning up worktrees older than ${olderThanDays} days...`);
    }

    const { stat } = await import("fs/promises");
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    for (const worktreePath of worktrees) {
      try {
        const stats = await stat(worktreePath);
        const modifiedTime = stats.mtime.getTime();

        if (modifiedTime < cutoffTime) {
          if (verbose) {
            const ageInDays = Math.floor((Date.now() - modifiedTime) / (24 * 60 * 60 * 1000));
            console.log(`   Removing worktree (${ageInDays} days old): ${worktreePath}`);
          }

          const result = await Utils.removeReviewWorktree(worktreePath, {
            verbose: false,
          });

          if (result.success) {
            cleaned++;
          } else {
            errors++;
            if (verbose) {
              console.error(`   Failed to remove: ${result.error}`);
            }
          }
        }
      } catch (error) {
        errors++;
        if (verbose) {
          console.error(
            `   Error checking worktree ${worktreePath}: ${(error as Error).message}`
          );
        }
      }
    }

    if (verbose) {
      console.log(`\n✅ Cleanup complete: ${cleaned} removed, ${errors} errors`);
    }

    return { success: errors === 0, cleaned, errors };
  }

  /**
   * Prepare the single review worktree for webhook processing.
   * Reuses `.claude-intern/review-worktree/` (singular) and switches branches.
   * Much more efficient than creating/removing worktrees for each review.
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
      }

      // Fetch latest from origin
      if (verbose) {
        console.log(`   Fetching from origin...`);
      }
      await Utils.executeGitCommand(["fetch", "origin"], { verbose });

      // Check if worktree exists
      const worktreeExists = existsSync(worktreePath);

      if (worktreeExists) {
        // Worktree exists - switch branch
        if (verbose) {
          console.log(`   Switching to branch ${branch}...`);
        }

        // Try to switch to the branch
        let switchResult = await Utils.executeGitCommand(
          ["checkout", branch],
          { verbose, cwd: worktreePath }
        );

        if (!switchResult.success) {
          // Try with origin/ prefix and force create local branch
          switchResult = await Utils.executeGitCommand(
            ["checkout", "-B", branch, `origin/${branch}`],
            { verbose, cwd: worktreePath }
          );
        }

        if (switchResult.success) {
          // Pull latest changes
          if (verbose) {
            console.log(`   Pulling latest changes...`);
          }
          await Utils.executeGitCommand(
            ["pull", "origin", branch, "--ff-only"],
            { verbose, cwd: worktreePath }
          );

          if (verbose) {
            console.log(`✅ Switched to branch ${branch}`);
          }

          // Install dependencies to ensure Claude has everything needed
          if (verbose) {
            console.log(`📦 Installing dependencies...`);
          }
          const installResult = await Utils.installDependencies(worktreePath, { verbose });

          if (!installResult.success) {
            // Log warning but don't fail - Claude can still work without dependencies in some cases
            console.warn(`⚠️  Failed to install dependencies: ${installResult.error}`);
            console.warn(`   Claude may not be able to run tests or build commands`);
          }

          return { success: true, path: worktreePath };
        }

        // Failed to switch - remove and recreate worktree
        if (verbose) {
          console.log(`   Failed to switch, removing worktree...`);
        }
        await Utils.executeGitCommand(
          ["worktree", "remove", worktreePath, "--force"],
          { verbose }
        );
        // Fallback cleanup
        try {
          rmSync(worktreePath, { recursive: true, force: true });
        } catch (e) {
          // Ignore
        }
      }

      // Create new worktree
      if (verbose) {
        console.log(`   Creating worktree...`);
      }

      let createResult = await Utils.executeGitCommand(
        ["worktree", "add", worktreePath, branch],
        { verbose }
      );

      if (!createResult.success) {
        // Try with origin/ prefix
        createResult = await Utils.executeGitCommand(
          ["worktree", "add", worktreePath, `origin/${branch}`],
          { verbose }
        );
      }

      if (!createResult.success) {
        return {
          success: false,
          error: `Failed to create worktree: ${createResult.error}`,
        };
      }

      if (verbose) {
        console.log(`✅ Worktree ready at ${worktreePath}`);
      }

      // Install dependencies to ensure Claude has everything needed
      if (verbose) {
        console.log(`📦 Installing dependencies...`);
      }
      const installResult = await Utils.installDependencies(worktreePath, { verbose });

      if (!installResult.success) {
        // Log warning but don't fail - Claude can still work without dependencies in some cases
        console.warn(`⚠️  Failed to install dependencies: ${installResult.error}`);
        console.warn(`   Claude may not be able to run tests or build commands`);
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
    return join(process.cwd(), ".claude-intern", "review-worktree");
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

        if (!verbose && proc.stderr) {
          proc.stderr.on("data", (data: Buffer) => {
            errorOutput += data.toString();
          });
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
