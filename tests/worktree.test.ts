/**
 * Test suite for git worktree utilities
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Utils } from "../src/lib/utils";
import { execSync } from "child_process";

describe("Git Worktree Utilities - Single Reusable Worktree", () => {
  let testDir: string;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd();

    // Create unique test directory for each test to enable parallel execution
    testDir = join(
      tmpdir(),
      `worktree-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
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

    // Create initial commit
    writeFileSync(join(repoDir, "README.md"), "# Test Repo\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Initial commit'", { cwd: repoDir });

    // Create a feature branch
    execSync("git checkout -b feature/test-branch", { cwd: repoDir });
    writeFileSync(
      join(repoDir, "feature.txt"),
      "Feature content\n",
      "utf8"
    );
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Add feature'", { cwd: repoDir });
    execSync("git checkout main || git checkout master", { cwd: repoDir });

    // Create another branch
    execSync("git checkout -b feature/another-branch", { cwd: repoDir });
    writeFileSync(
      join(repoDir, "another.txt"),
      "Another content\n",
      "utf8"
    );
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Add another'", { cwd: repoDir });
    execSync("git checkout main || git checkout master", { cwd: repoDir });

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

  test("should prepare review worktree for first branch", async () => {
    const result = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(existsSync(result.path!)).toBe(true);

    // Verify worktree contains the feature file
    const featureFile = join(result.path!, "feature.txt");
    expect(existsSync(featureFile)).toBe(true);

    // Verify path is the single worktree path
    expect(result.path).toBe(Utils.getReviewWorktreePath());
  });

  test("should reuse worktree and switch to different branch", async () => {
    // Prepare worktree for first branch
    const result1 = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    expect(result1.success).toBe(true);
    const worktreePath = result1.path!;
    expect(existsSync(join(worktreePath, "feature.txt"))).toBe(true);

    // Now switch to another branch using the same worktree
    const result2 = await Utils.prepareReviewWorktree(
      "feature/another-branch",
      { verbose: false }
    );

    expect(result2.success).toBe(true);
    // Should be the same path
    expect(result2.path).toBe(worktreePath);

    // Should now have the other branch's file
    expect(existsSync(join(worktreePath, "another.txt"))).toBe(true);
    // Should NOT have the previous branch's file
    expect(existsSync(join(worktreePath, "feature.txt"))).toBe(false);
  });

  test("should get worktree path", () => {
    const path = Utils.getReviewWorktreePath();
    expect(path).toContain(".claude-intern");
    expect(path).toContain("review-worktree");
    expect(path).not.toContain("review-worktrees"); // singular, not plural
  });

  test("should handle non-existent branch gracefully", async () => {
    const result = await Utils.prepareReviewWorktree(
      "non-existent-branch",
      { verbose: false }
    );

    // Should fail gracefully
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("should execute git commands with custom cwd in worktree", async () => {
    const result = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    expect(result.success).toBe(true);
    const worktreePath = result.path!;

    // Execute git command in worktree
    const branchResult = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );

    expect(branchResult.success).toBe(true);
    expect(branchResult.output).toContain("feature/test-branch");
  });

  test("should switch back and forth between branches", async () => {
    const branch1 = "feature/test-branch";
    const branch2 = "feature/another-branch";

    // Switch to branch1
    const result1 = await Utils.prepareReviewWorktree(branch1, { verbose: false });
    expect(result1.success).toBe(true);
    const worktreePath = result1.path!;

    // Verify branch1 content
    const branch1Result = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(branch1Result.output).toContain(branch1);

    // Switch to branch2
    const result2 = await Utils.prepareReviewWorktree(branch2, { verbose: false });
    expect(result2.success).toBe(true);
    expect(result2.path).toBe(worktreePath);

    // Verify branch2 content
    const branch2Result = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(branch2Result.output).toContain(branch2);

    // Switch back to branch1
    const result3 = await Utils.prepareReviewWorktree(branch1, { verbose: false });
    expect(result3.success).toBe(true);
    expect(result3.path).toBe(worktreePath);

    // Verify back on branch1
    const branch1Result2 = await Utils.executeGitCommand(
      ["branch", "--show-current"],
      { verbose: false, cwd: worktreePath }
    );
    expect(branch1Result2.output).toContain(branch1);
  });
});
