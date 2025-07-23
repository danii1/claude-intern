import { existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';

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
    return filename.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
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
  static truncateText(text: string, maxLength: number = 100): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
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
  static formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry a function with exponential backoff
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
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

        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Parse JIRA task key to extract project and number
   */
  static parseTaskKey(taskKey: string): { project: string; number: number; key: string } {
    const match = taskKey.match(/^([A-Z]+)-(\d+)$/);
    if (!match) {
      throw new Error(`Invalid JIRA task key format: ${taskKey}`);
    }

    return {
      project: match[1],
      number: parseInt(match[2], 10),
      key: taskKey
    };
  }

  /**
   * Generate a unique filename based on task key and timestamp
   */
  static generateTaskFilename(taskKey: string, extension: string = 'md'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedKey = this.sanitizeFilename(taskKey);
    return `task-${sanitizedKey}-${timestamp}.${extension}`;
  }

  /**
   * Execute a git command and return the result
   */
  static async executeGitCommand(args: string[]): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const git = spawn('git', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let output = '';
      let error = '';

      git.stdout.on('data', (data) => {
        output += data.toString();
      });

      git.stderr.on('data', (data) => {
        error += data.toString();
      });

      git.on('close', (code) => {
        resolve({
          success: code === 0,
          output: output.trim(),
          error: error.trim()
        });
      });
    });
  }

  /**
   * Check if we're in a git repository
   */
  static async isGitRepository(): Promise<boolean> {
    const result = await this.executeGitCommand(['rev-parse', '--git-dir']);
    return result.success;
  }

  /**
   * Get the current git branch name
   */
  static async getCurrentBranch(): Promise<string | null> {
    const result = await this.executeGitCommand(['branch', '--show-current']);
    return result.success ? result.output : null;
  }

  /**
   * Check if there are uncommitted changes
   */
  static async hasUncommittedChanges(): Promise<boolean> {
    const result = await this.executeGitCommand(['status', '--porcelain']);
    return result.success && result.output.length > 0;
  }

  /**
   * Commit all changes with a descriptive message
   */
  static async commitChanges(taskKey: string, taskSummary: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if we're in a git repository
      if (!(await this.isGitRepository())) {
        return {
          success: false,
          message: 'Not in a git repository'
        };
      }

      // Check if there are any changes to commit
      if (!(await this.hasUncommittedChanges())) {
        return {
          success: false,
          message: 'No changes to commit'
        };
      }

      // Add all changes
      const addResult = await this.executeGitCommand(['add', '.']);
      if (!addResult.success) {
        return {
          success: false,
          message: `Failed to stage changes: ${addResult.error}`
        };
      }

      // Create commit message
      const commitMessage = `feat: implement ${taskKey} - ${taskSummary}`;

      // Commit changes
      const commitResult = await this.executeGitCommand(['commit', '-m', commitMessage]);
      if (commitResult.success) {
        return {
          success: true,
          message: `Successfully committed changes for ${taskKey}`
        };
      } else {
        return {
          success: false,
          message: `Failed to commit changes: ${commitResult.error}`
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Git commit failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Get the main branch name (master or main)
   */
  static async getMainBranchName(): Promise<string> {
    // First try to get default branch from git
    const defaultBranch = await this.executeGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    if (defaultBranch.success) {
      const branchName = defaultBranch.output.replace('refs/remotes/origin/', '');
      if (branchName) {
        return branchName;
      }
    }

    // Check if 'main' exists
    const mainExists = await this.executeGitCommand(['show-ref', '--verify', '--quiet', 'refs/heads/main']);
    if (mainExists.success) {
      return 'main';
    }

    // Check if 'master' exists
    const masterExists = await this.executeGitCommand(['show-ref', '--verify', '--quiet', 'refs/heads/master']);
    if (masterExists.success) {
      return 'master';
    }

    // Default to 'main' if neither exists (for new repos)
    return 'main';
  }

  /**
   * Push current branch to remote repository
   */
  static async pushCurrentBranch(): Promise<{ success: boolean; message: string }> {
    try {
      // Get current branch name
      const currentBranch = await this.getCurrentBranch();
      if (!currentBranch) {
        return {
          success: false,
          message: 'Could not determine current branch'
        };
      }

      // Check if remote branch exists
      const remoteBranchExists = await this.executeGitCommand(['ls-remote', '--heads', 'origin', currentBranch]);
      
      if (remoteBranchExists.success && remoteBranchExists.output.trim()) {
        // Remote branch exists, just push
        const pushResult = await this.executeGitCommand(['push', 'origin', currentBranch]);
        if (pushResult.success) {
          return {
            success: true,
            message: `Successfully pushed '${currentBranch}' to remote`
          };
        } else {
          return {
            success: false,
            message: `Failed to push branch: ${pushResult.error}`
          };
        }
      } else {
        // Remote branch doesn't exist, push with -u flag to set upstream
        const pushResult = await this.executeGitCommand(['push', '-u', 'origin', currentBranch]);
        if (pushResult.success) {
          return {
            success: true,
            message: `Successfully pushed '${currentBranch}' to remote and set upstream`
          };
        } else {
          return {
            success: false,
            message: `Failed to push branch: ${pushResult.error}`
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        message: `Git push failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Create and checkout a new feature branch for the task
   */
  static async createFeatureBranch(taskKey: string): Promise<{ success: boolean; branchName: string; message: string }> {
    const baseBranchName = `feature/${taskKey.toLowerCase()}`;
    let branchName = baseBranchName;
    let attemptCounter = 1;

    try {
      // Check if we're in a git repository
      if (!(await this.isGitRepository())) {
        return {
          success: false,
          branchName,
          message: 'Not in a git repository'
        };
      }

      // Check for uncommitted changes
      if (await this.hasUncommittedChanges()) {
        return {
          success: false,
          branchName,
          message: 'There are uncommitted changes. Please commit or stash them before creating a feature branch.'
        };
      }

      // Switch to main/master branch first
      const mainBranch = await this.getMainBranchName();
      const currentBranch = await this.getCurrentBranch();
      
      if (currentBranch !== mainBranch) {
        const switchResult = await this.executeGitCommand(['checkout', mainBranch]);
        if (!switchResult.success) {
          return {
            success: false,
            branchName,
            message: `Failed to switch to ${mainBranch} branch: ${switchResult.error}`
          };
        }
      }

      // Find an available branch name by checking for existing branches
      while (true) {
        const branchExists = await this.executeGitCommand(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
        
        if (!branchExists.success) {
          // Branch doesn't exist, we can use this name
          break;
        }
        
        // Branch exists, try next attempt
        attemptCounter++;
        branchName = `${baseBranchName}-attempt-${attemptCounter}`;
      }

      // Create and checkout new branch from main/master
      const createResult = await this.executeGitCommand(['checkout', '-b', branchName]);
      if (createResult.success) {
        const message = attemptCounter === 1 
          ? `Created and switched to new branch '${branchName}' from ${mainBranch}`
          : `Created and switched to new branch '${branchName}' from ${mainBranch} (previous attempts existed)`;
        
        return {
          success: true,
          branchName,
          message
        };
      } else {
        return {
          success: false,
          branchName,
          message: `Failed to create branch: ${createResult.error}`
        };
      }
    } catch (error) {
      return {
        success: false,
        branchName,
        message: `Git operation failed: ${(error as Error).message}`
      };
    }
  }
} 