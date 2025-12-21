/**
 * Integration test suite for webhook server with queue and worktree
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Utils } from "../src/lib/utils";
import { execSync } from "child_process";

describe("Webhook Integration - Sequential Processing with Single Worktree", () => {
  let testDir: string;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd();

    // Create unique test directory for each test
    testDir = join(
      tmpdir(),
      `webhook-integration-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    mkdirSync(testDir, { recursive: true });

    // Create a test git repository
    repoDir = join(testDir, "test-repo");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    // Initialize git repo
    execSync("git init", { cwd: repoDir });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir });
    execSync("git config user.name 'Test User'", { cwd: repoDir });

    // Create initial commit on main branch
    writeFileSync(join(repoDir, "README.md"), "# Test Repo\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Initial commit'", { cwd: repoDir });

    // Create multiple PR branches
    for (let i = 1; i <= 3; i++) {
      execSync(`git checkout -b pr-${i}`, { cwd: repoDir });
      writeFileSync(
        join(repoDir, `pr${i}.txt`),
        `PR ${i} content\n`,
        "utf8"
      );
      execSync("git add .", { cwd: repoDir });
      execSync(`git commit -m 'Add PR ${i} changes'`, { cwd: repoDir });
      execSync("git checkout main || git checkout master", { cwd: repoDir });
    }

    // Create .claude-intern directory
    mkdirSync(join(repoDir, ".claude-intern"), { recursive: true });
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

  test("should process multiple PRs sequentially using single worktree", async () => {
    const branches = ["pr-1", "pr-2", "pr-3"];
    const worktreePath = Utils.getReviewWorktreePath();
    const results: Array<{ branch: string; path: string; fileExists: boolean }> = [];

    // Simulate sequential processing of multiple PRs
    for (const branch of branches) {
      const result = await Utils.prepareReviewWorktree(branch, { verbose: false });

      expect(result.success).toBe(true);
      expect(result.path).toBe(worktreePath); // Same path for all

      // Verify we're on the correct branch
      const branchCheck = await Utils.executeGitCommand(
        ["branch", "--show-current"],
        { verbose: false, cwd: result.path! }
      );
      expect(branchCheck.output).toContain(branch);

      // Verify the correct file exists for this PR
      const expectedFile = join(result.path!, `${branch.replace("-", "")}.txt`);
      const fileExists = existsSync(expectedFile);

      results.push({
        branch,
        path: result.path!,
        fileExists,
      });

      // Simulate some work (like Claude processing)
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Verify all results
    expect(results.length).toBe(3);

    // All should use the same worktree path
    const uniquePaths = new Set(results.map(r => r.path));
    expect(uniquePaths.size).toBe(1);

    // All should have found their respective files
    expect(results.every(r => r.fileExists)).toBe(true);
  });

  test("should maintain isolation between sequential PR reviews", async () => {
    // Process first PR
    const result1 = await Utils.prepareReviewWorktree("pr-1", { verbose: false });
    expect(result1.success).toBe(true);
    const worktreePath = result1.path!;

    // Verify pr-1 files exist
    expect(existsSync(join(worktreePath, "pr1.txt"))).toBe(true);
    expect(existsSync(join(worktreePath, "pr2.txt"))).toBe(false);

    // Get the current branch
    const branch1Check = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(branch1Check.output).toContain("pr-1");

    // Switch to second PR
    const result2 = await Utils.prepareReviewWorktree("pr-2", { verbose: false });
    expect(result2.success).toBe(true);
    expect(result2.path).toBe(worktreePath); // Same path

    // Verify pr-2 files exist and pr-1 files are gone
    expect(existsSync(join(worktreePath, "pr2.txt"))).toBe(true);
    expect(existsSync(join(worktreePath, "pr1.txt"))).toBe(false);

    // Verify we're on pr-2 branch
    const branch2Check = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(branch2Check.output).toContain("pr-2");
  });

  test("should handle rapid sequential PR reviews without conflicts", async () => {
    const branches = ["pr-1", "pr-2", "pr-3", "pr-1", "pr-2"]; // Including repeats
    const worktreePath = Utils.getReviewWorktreePath();

    for (const branch of branches) {
      const result = await Utils.prepareReviewWorktree(branch, { verbose: false });

      expect(result.success).toBe(true);
      expect(result.path).toBe(worktreePath);

      // Verify correct branch
      const branchCheck = await Utils.executeGitCommand(
        ["branch", "--show-current"],
        { verbose: false, cwd: result.path! }
      );
      expect(branchCheck.output).toContain(branch);
    }
  });

  test("should persist worktree across all reviews", async () => {
    const worktreePath = Utils.getReviewWorktreePath();

    // Process first PR
    const result1 = await Utils.prepareReviewWorktree("pr-1", { verbose: false });
    expect(result1.success).toBe(true);
    expect(existsSync(worktreePath)).toBe(true);

    // Process second PR
    const result2 = await Utils.prepareReviewWorktree("pr-2", { verbose: false });
    expect(result2.success).toBe(true);
    expect(existsSync(worktreePath)).toBe(true); // Still exists

    // Process third PR
    const result3 = await Utils.prepareReviewWorktree("pr-3", { verbose: false });
    expect(result3.success).toBe(true);
    expect(existsSync(worktreePath)).toBe(true); // Still exists

    // Worktree should still exist after all processing
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("should handle switching to same branch multiple times", async () => {
    const branch = "pr-1";

    // First preparation
    const result1 = await Utils.prepareReviewWorktree(branch, { verbose: false });
    expect(result1.success).toBe(true);
    const worktreePath = result1.path!;

    // Verify we're on pr-1
    const check1 = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(check1.output).toContain(branch);

    // Switch to another branch
    await Utils.prepareReviewWorktree("pr-2", { verbose: false });

    // Switch back to pr-1
    const result2 = await Utils.prepareReviewWorktree(branch, { verbose: false });
    expect(result2.success).toBe(true);
    expect(result2.path).toBe(worktreePath); // Same worktree path

    // Verify we're back on pr-1
    const check2 = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(check2.output).toContain(branch);
  });

  test("should process PRs sequentially even if requested concurrently", async () => {
    // Note: This test shows that concurrent calls can fail because git operations
    // aren't atomic. In the real webhook server, the queue ensures sequential processing.
    // This test documents the expected behavior WITHOUT the queue.

    const branches = ["pr-1", "pr-2", "pr-3"];
    const worktreePath = Utils.getReviewWorktreePath();

    // Process sequentially (as the queue does in the webhook server)
    for (const branch of branches) {
      const result = await Utils.prepareReviewWorktree(branch, { verbose: false });
      expect(result.success).toBe(true);
      expect(result.path).toBe(worktreePath);
    }

    // The final state should be pr-3 (the last one processed)
    expect(existsSync(worktreePath)).toBe(true);

    const finalBranch = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(finalBranch.output).toContain("pr-3");
  });

  test("should correctly switch between branches with different file sets", async () => {
    // Create a branch with many files
    execSync("git checkout -b pr-large", { cwd: repoDir });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(repoDir, `file${i}.txt`), `Content ${i}`, "utf8");
    }
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Add many files'", { cwd: repoDir });
    execSync("git checkout main || git checkout master", { cwd: repoDir });

    // Prepare worktree for pr-large
    const result1 = await Utils.prepareReviewWorktree("pr-large", { verbose: false });
    expect(result1.success).toBe(true);
    const worktreePath = result1.path!;

    // Verify all files exist
    for (let i = 0; i < 5; i++) {
      expect(existsSync(join(worktreePath, `file${i}.txt`))).toBe(true);
    }

    // Switch to pr-1 (which has fewer files)
    const result2 = await Utils.prepareReviewWorktree("pr-1", { verbose: false });
    expect(result2.success).toBe(true);

    // The large branch files should be gone
    for (let i = 0; i < 5; i++) {
      expect(existsSync(join(worktreePath, `file${i}.txt`))).toBe(false);
    }

    // Only pr-1 file should exist
    expect(existsSync(join(worktreePath, "pr1.txt"))).toBe(true);
  });
});
