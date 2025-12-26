/**
 * Test to verify branch creation cleanup works correctly
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Utils } from "../src/lib/utils";

describe("Branch Creation Cleanup", () => {
  let testDir: string;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Save original directory
    originalCwd = process.cwd();

    // Create temporary test directory
    testDir = join(
      require("os").tmpdir(),
      `branch-cleanup-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
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

  test("should clean up uncommitted changes before creating branch", async () => {
    // Make some uncommitted changes
    writeFileSync(join(repoDir, "uncommitted.txt"), "uncommitted content\n", "utf8");
    writeFileSync(join(repoDir, "README.md"), "# Modified README\n", "utf8");

    // Stage one file
    execSync("git add uncommitted.txt", { cwd: repoDir });

    // Verify there are uncommitted changes
    let hasChanges = await Utils.hasUncommittedChanges();
    expect(hasChanges).toBe(true);

    // Create feature branch - should clean up automatically
    const result = await Utils.createFeatureBranch("TEST-123");

    expect(result.success).toBe(true);
    expect(result.branchName).toBe("feature/test-123");

    // Verify we're on the new branch
    const currentBranch = await Utils.getCurrentBranch();
    expect(currentBranch).toBe("feature/test-123");

    // Verify no uncommitted changes remain
    hasChanges = await Utils.hasUncommittedChanges();
    expect(hasChanges).toBe(false);

    // Verify uncommitted file was removed
    expect(existsSync(join(repoDir, "uncommitted.txt"))).toBe(false);

    // Verify modified file was reset
    const readmeContent = require("fs").readFileSync(join(repoDir, "README.md"), "utf8");
    expect(readmeContent).toBe("# Test Repo\n");
  });

  test("should clean up untracked files before creating branch", async () => {
    // Create untracked files
    writeFileSync(join(repoDir, "untracked1.txt"), "untracked 1\n", "utf8");
    writeFileSync(join(repoDir, "untracked2.txt"), "untracked 2\n", "utf8");

    // Create untracked directory
    mkdirSync(join(repoDir, "temp-dir"), { recursive: true });
    writeFileSync(join(repoDir, "temp-dir", "file.txt"), "temp file\n", "utf8");

    // Verify files exist
    expect(existsSync(join(repoDir, "untracked1.txt"))).toBe(true);
    expect(existsSync(join(repoDir, "untracked2.txt"))).toBe(true);
    expect(existsSync(join(repoDir, "temp-dir"))).toBe(true);

    // Create feature branch - should clean up untracked files
    const result = await Utils.createFeatureBranch("TEST-456");

    expect(result.success).toBe(true);

    // Verify untracked files were removed
    expect(existsSync(join(repoDir, "untracked1.txt"))).toBe(false);
    expect(existsSync(join(repoDir, "untracked2.txt"))).toBe(false);
    expect(existsSync(join(repoDir, "temp-dir"))).toBe(false);
  });

  test("should clean up staged changes before creating branch", async () => {
    // Make and stage changes
    writeFileSync(join(repoDir, "new-file.txt"), "new content\n", "utf8");
    execSync("git add new-file.txt", { cwd: repoDir });

    // Verify file is staged
    const statusOutput = execSync("git status --porcelain", { cwd: repoDir }).toString();
    expect(statusOutput).toContain("new-file.txt");

    // Create feature branch - should clean up
    const result = await Utils.createFeatureBranch("TEST-789");

    expect(result.success).toBe(true);

    // Verify no staged or uncommitted changes
    const hasChanges = await Utils.hasUncommittedChanges();
    expect(hasChanges).toBe(false);

    // Verify file was removed
    expect(existsSync(join(repoDir, "new-file.txt"))).toBe(false);
  });

  test("should succeed even with mixed changes", async () => {
    // Mix of staged, modified, and untracked files
    writeFileSync(join(repoDir, "staged.txt"), "staged\n", "utf8");
    execSync("git add staged.txt", { cwd: repoDir });

    writeFileSync(join(repoDir, "README.md"), "# Modified\n", "utf8");

    writeFileSync(join(repoDir, "untracked.txt"), "untracked\n", "utf8");

    // Create feature branch - should handle all types of changes
    const result = await Utils.createFeatureBranch("TEST-MIX");

    expect(result.success).toBe(true);

    // Verify clean state
    const hasChanges = await Utils.hasUncommittedChanges();
    expect(hasChanges).toBe(false);

    // Verify all files cleaned up
    expect(existsSync(join(repoDir, "staged.txt"))).toBe(false);
    expect(existsSync(join(repoDir, "untracked.txt"))).toBe(false);

    // Verify README reset to original
    const readmeContent = require("fs").readFileSync(join(repoDir, "README.md"), "utf8");
    expect(readmeContent).toBe("# Test Repo\n");
  });
});
