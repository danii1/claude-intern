import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve, join } from "path";

export class LockManager {
  private lockFilePath: string;
  private lockAcquired: boolean = false;

  constructor(workingDir: string = process.cwd()) {
    // Create lock file in .claude-intern directory
    const configDir = resolve(workingDir, ".claude-intern");

    // Ensure .claude-intern directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    this.lockFilePath = join(configDir, ".pid.lock");
  }

  /**
   * Acquire a lock for the current directory
   * Returns true if lock was acquired, false if another instance is running
   */
  acquire(): { success: boolean; message: string; pid?: number } {
    try {
      // Check if lock file exists
      if (existsSync(this.lockFilePath)) {
        // Read existing lock file to get PID
        try {
          const lockContent = readFileSync(this.lockFilePath, "utf8");
          const lockData = JSON.parse(lockContent);
          const pid = lockData.pid;
          const timestamp = lockData.timestamp;

          // Check if the process is still running
          const isProcessRunning = this.isProcessRunning(pid);

          if (isProcessRunning) {
            return {
              success: false,
              message: `Another instance of claude-intern is already running in this directory (PID: ${pid})`,
              pid,
            };
          }

          // Process is not running anymore, remove stale lock file
          console.log(
            `⚠️  Found stale lock file from previous instance (PID: ${pid}, started: ${new Date(timestamp).toLocaleString()})`
          );
          console.log("   Removing stale lock and continuing...");
          unlinkSync(this.lockFilePath);
        } catch (error) {
          // If we can't read or parse the lock file, assume it's corrupted and remove it
          console.log("⚠️  Found corrupted lock file, removing and continuing...");
          unlinkSync(this.lockFilePath);
        }
      }

      // Create new lock file with current process PID
      const lockData = {
        pid: process.pid,
        timestamp: new Date().toISOString(),
        workingDir: process.cwd(),
      };

      writeFileSync(this.lockFilePath, JSON.stringify(lockData, null, 2), "utf8");
      this.lockAcquired = true;

      return {
        success: true,
        message: "Lock acquired successfully",
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to acquire lock: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Release the lock
   */
  release(): void {
    if (!this.lockAcquired) {
      return;
    }

    try {
      if (existsSync(this.lockFilePath)) {
        unlinkSync(this.lockFilePath);
      }
      this.lockAcquired = false;
    } catch (error) {
      console.warn(`⚠️  Failed to release lock: ${(error as Error).message}`);
    }
  }

  /**
   * Check if a process is still running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without actually sending a signal
      // This works cross-platform (Unix-like systems and Windows)
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // If we get ESRCH error, the process doesn't exist
      // If we get EPERM error, the process exists but we don't have permission to signal it
      // For our purposes, if we can't verify the process is running, we treat it as not running
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EPERM") {
        // Process exists but we don't have permission - treat as running
        return true;
      }
      return false;
    }
  }

  /**
   * Get the path to the lock file
   */
  getLockFilePath(): string {
    return this.lockFilePath;
  }
}
