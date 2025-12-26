/**
 * Test to verify protected branch safety checks
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Utils } from "../src/lib/utils";

describe("Protected Branch Safety Checks", () => {
  let testDir: string;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Save original directory
    originalCwd = process.cwd();

    // Create temporary test directory
    testDir = join(
      require("os").tmpdir(),
      `protected-branch-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    repoDir = join(testDir, "test-repo");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    // Initialize git repo
    execSync("git init", { cwd: repoDir });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir });
    execSync("git config user.name 'Test User'", { cwd: repoDir });

    // Create initial commit on main
    writeFileSync(join(repoDir, "README.md"), "# Test Repo\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Initial commit'", { cwd: repoDir });

    // Rename to main if needed
    try {
      execSync("git branch -M main", { cwd: repoDir });
    } catch (e) {
      // Already on main
    }
  });

  afterEach(() => {
    // Return to original directory
    process.chdir(originalCwd);

    // Clean up test directory
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test("should detect main as protected branch", async () => {
    const isProtected = await Utils.isProtectedBranch("main");
    expect(isProtected).toBe(true);
  });

  test("should detect master as protected branch", async () => {
    const isProtected = await Utils.isProtectedBranch("master");
    expect(isProtected).toBe(true);
  });

  test("should detect develop as protected branch", async () => {
    const isProtected = await Utils.isProtectedBranch("develop");
    expect(isProtected).toBe(true);
  });

  test("should not detect feature branch as protected", async () => {
    const isProtected = await Utils.isProtectedBranch("feature/test-123");
    expect(isProtected).toBe(false);
  });

  test("should prevent commit on main branch", async () => {
    // Ensure we're on main
    const currentBranch = await Utils.getCurrentBranch();
    expect(currentBranch).toBe("main");

    // Make a change
    writeFileSync(join(repoDir, "test.txt"), "test content\n", "utf8");

    // Try to commit - should fail
    const result = await Utils.commitChanges("TEST-123", "Test commit");

    expect(result.success).toBe(false);
    expect(result.message).toContain("protected branch");
    expect(result.message).toContain("main");
  });

  test("should allow commit on feature branch", async () => {
    // Create and checkout feature branch
    execSync("git checkout -b feature/test-123", { cwd: repoDir });

    const currentBranch = await Utils.getCurrentBranch();
    expect(currentBranch).toBe("feature/test-123");

    // Make a change
    writeFileSync(join(repoDir, "test.txt"), "test content\n", "utf8");

    // Try to commit - should succeed
    const result = await Utils.commitChanges("TEST-123", "Test commit");

    expect(result.success).toBe(true);
  });

  test("should prevent push on main branch", async () => {
    // Ensure we're on main
    const currentBranch = await Utils.getCurrentBranch();
    expect(currentBranch).toBe("main");

    // Try to push - should fail
    const result = await Utils.pushCurrentBranch();

    expect(result.success).toBe(false);
    expect(result.message).toContain("protected branch");
    expect(result.message).toContain("main");
  });

  test("should detect current branch as protected", async () => {
    // On main branch
    const isProtected = await Utils.isProtectedBranch();
    expect(isProtected).toBe(true);

    // Switch to feature branch
    execSync("git checkout -b feature/test-456", { cwd: repoDir });

    const isProtectedNow = await Utils.isProtectedBranch();
    expect(isProtectedNow).toBe(false);
  });
});
