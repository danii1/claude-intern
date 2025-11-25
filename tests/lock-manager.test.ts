/**
 * Test suite for LockManager
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LockManager } from "../src/lib/lock-manager";

describe("LockManager", () => {
  let testDir: string;

  beforeEach(() => {
    // Create unique test directory for each test to enable parallel execution
    testDir = join(tmpdir(), `lock-manager-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory and any lock files
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test("should acquire and release lock successfully", () => {
    const lock1 = new LockManager(testDir);
    const result1 = lock1.acquire();

    expect(result1.success).toBe(true);

    // Try to acquire with second instance - should fail
    const lock2 = new LockManager(testDir);
    const result2 = lock2.acquire();

    expect(result2.success).toBe(false);
    expect(result2.pid).toBe(process.pid);

    // Release first lock
    lock1.release();

    // Verify lock file is removed
    expect(existsSync(lock1.getLockFilePath())).toBe(false);

    // Now third instance should be able to acquire
    const lock3 = new LockManager(testDir);
    const result3 = lock3.acquire();

    expect(result3.success).toBe(true);
    lock3.release();
  });

  test("should detect and remove stale locks", () => {
    // Create a lock and release it to ensure we start clean
    const cleanLock = new LockManager(testDir);
    const cleanResult = cleanLock.acquire();
    if (cleanResult.success) {
      cleanLock.release();
    }

    // Manually create a stale lock file with non-existent PID
    const staleLockData = {
      pid: 999999, // Non-existent PID
      timestamp: new Date().toISOString(),
      workingDir: testDir,
    };

    const lockPath = cleanLock.getLockFilePath();
    writeFileSync(lockPath, JSON.stringify(staleLockData, null, 2), "utf8");

    // Try to acquire lock - should detect stale lock and proceed
    const lock = new LockManager(testDir);
    const result = lock.acquire();

    expect(result.success).toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  test("should store lock file in correct location", () => {
    const lock = new LockManager(testDir);
    const lockPath = lock.getLockFilePath();

    // Verify lock is in .claude-intern directory with correct filename
    expect(lockPath).toContain(".claude-intern");
    expect(lockPath).toEndWith(".pid.lock");

    // Verify .claude-intern directory is created and lock file is created
    const result = lock.acquire();
    expect(result.success).toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    lock.release();
  });

  test("should handle multiple release calls gracefully (idempotence)", () => {
    const lock = new LockManager(testDir);
    const result = lock.acquire();

    expect(result.success).toBe(true);

    // Release multiple times - should not cause errors
    expect(() => {
      lock.release();
      lock.release();
      lock.release();
    }).not.toThrow();
  });

  test("should prevent multiple instances from acquiring lock", () => {
    const lock1 = new LockManager(testDir);
    const result1 = lock1.acquire();

    expect(result1.success).toBe(true);

    const lock2 = new LockManager(testDir);
    const result2 = lock2.acquire();

    expect(result2.success).toBe(false);
    expect(result2.message).toContain("already running");
    expect(result2.pid).toBeDefined();

    lock1.release();
  });

  test("should include process information in lock file", () => {
    const lock = new LockManager(testDir);
    const result = lock.acquire();

    expect(result.success).toBe(true);

    const lockPath = lock.getLockFilePath();
    const lockContent = readFileSync(lockPath, "utf8");
    const lockData = JSON.parse(lockContent);

    expect(lockData.pid).toBe(process.pid);
    expect(lockData.timestamp).toBeDefined();
    expect(lockData.workingDir).toBe(process.cwd());

    lock.release();
  });
});
