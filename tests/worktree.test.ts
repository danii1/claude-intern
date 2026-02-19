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
    expect(path).toBe("/tmp/claude-intern-review-worktree");
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

describe("Git Worktree with Origin Remote", () => {
  let testDir: string;
  let repoDir: string;
  let bareDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();

    testDir = join(
      tmpdir(),
      `worktree-origin-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    mkdirSync(testDir, { recursive: true });

    // Create bare repo to serve as origin
    bareDir = join(testDir, "bare-origin");
    mkdirSync(bareDir, { recursive: true });
    execSync("git init --bare", { cwd: bareDir });

    // Create test repo
    repoDir = join(testDir, "test-repo");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    execSync("git init", { cwd: repoDir });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir });
    execSync("git config user.name 'Test User'", { cwd: repoDir });

    // Create initial commit and push to origin
    writeFileSync(join(repoDir, "README.md"), "# Test Repo\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Initial commit'", { cwd: repoDir });
    execSync(`git remote add origin ${bareDir}`, { cwd: repoDir });
    execSync("git push -u origin master", { cwd: repoDir });

    // Create feature branch and push
    execSync("git checkout -b feature/test-branch", { cwd: repoDir });
    writeFileSync(join(repoDir, "feature.txt"), "Feature content\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Add feature'", { cwd: repoDir });
    execSync("git push -u origin feature/test-branch", { cwd: repoDir });

    // Create another feature branch and push
    execSync("git checkout master", { cwd: repoDir });
    execSync("git checkout -b feature/another-branch", { cwd: repoDir });
    writeFileSync(join(repoDir, "another.txt"), "Another content\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Add another'", { cwd: repoDir });
    execSync("git push -u origin feature/another-branch", { cwd: repoDir });

    // Return to master
    execSync("git checkout master", { cwd: repoDir });
  });

  afterEach(() => {
    process.chdir(originalCwd);

    // Clean up worktree
    const worktreePath = Utils.getReviewWorktreePath();
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoDir });
    } catch {}
    try {
      execSync("git worktree prune", { cwd: repoDir });
    } catch {}
    try {
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch {}

    // Clean up test directory
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test("should create worktree tracking origin branch", async () => {
    const result = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(existsSync(result.path!)).toBe(true);
    expect(existsSync(join(result.path!, "feature.txt"))).toBe(true);

    // Verify the branch tracks origin
    const trackResult = await Utils.executeGitCommand(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { verbose: false, cwd: result.path! }
    );
    expect(trackResult.success).toBe(true);
    expect(trackResult.output).toContain("origin/feature/test-branch");
  });

  test("should create worktree when branch is checked out in main (with origin)", async () => {
    // Check out the feature branch in main repo (simulates running task)
    execSync("git checkout feature/test-branch", { cwd: repoDir });

    // Try to create worktree for the same branch
    const result = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    // Should succeed via --force fallback
    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(existsSync(result.path!)).toBe(true);
    expect(existsSync(join(result.path!, "feature.txt"))).toBe(true);
  });

  test("should reset worktree to latest origin when branch existed locally", async () => {
    // Make a local-only commit on the feature branch
    execSync("git checkout feature/test-branch", { cwd: repoDir });
    writeFileSync(join(repoDir, "local-only.txt"), "Not pushed\n", "utf8");
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Local only commit'", { cwd: repoDir });
    execSync("git checkout master", { cwd: repoDir });

    // Create worktree - should get origin version (without local-only commit)
    const result = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    expect(result.success).toBe(true);
    expect(existsSync(join(result.path!, "feature.txt"))).toBe(true);
    // The local-only file should NOT be present since we reset to origin
    expect(existsSync(join(result.path!, "local-only.txt"))).toBe(false);
  });

  test("should recover from externally removed worktree (with origin)", async () => {
    const worktreePath = Utils.getReviewWorktreePath();

    // Create worktree
    const result1 = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );
    expect(result1.success).toBe(true);

    // Simulate external removal
    rmSync(worktreePath, { recursive: true, force: true });

    // Should recover
    const result2 = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );

    expect(result2.success).toBe(true);
    expect(existsSync(result2.path!)).toBe(true);
    expect(existsSync(join(result2.path!, "feature.txt"))).toBe(true);
  });

  test("should switch branches in worktree with origin", async () => {
    // Create worktree for first branch
    const result1 = await Utils.prepareReviewWorktree(
      "feature/test-branch",
      { verbose: false }
    );
    expect(result1.success).toBe(true);
    expect(existsSync(join(result1.path!, "feature.txt"))).toBe(true);

    // Switch to another branch
    const result2 = await Utils.prepareReviewWorktree(
      "feature/another-branch",
      { verbose: false }
    );
    expect(result2.success).toBe(true);
    expect(result2.path).toBe(result1.path);
    expect(existsSync(join(result2.path!, "another.txt"))).toBe(true);
    expect(existsSync(join(result2.path!, "feature.txt"))).toBe(false);
  });
});
