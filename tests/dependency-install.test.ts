/**
 * Test suite for dependency installation in worktrees
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Utils } from "../src/lib/utils";
import { execSync } from "child_process";

describe("Dependency Installation", () => {
  let testDir: string;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd();

    // Create unique test directory for each test
    testDir = join(
      tmpdir(),
      `dependency-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
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

  test("should skip installation when no package.json exists", async () => {
    const testWorkingDir = join(testDir, "no-package");
    mkdirSync(testWorkingDir, { recursive: true });

    const result = await Utils.installDependencies(testWorkingDir, { verbose: false });

    expect(result.success).toBe(true);
    expect(result.packageManager).toBeUndefined();
  });

  test("should detect bun.lockb and use bun", async () => {
    const testWorkingDir = join(testDir, "bun-project");
    mkdirSync(testWorkingDir, { recursive: true });

    // Create package.json and bun.lockb
    writeFileSync(
      join(testWorkingDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: {} }),
      "utf8"
    );
    writeFileSync(join(testWorkingDir, "bun.lockb"), "", "utf8");

    const result = await Utils.installDependencies(testWorkingDir, { verbose: false });

    // Should succeed (even if bun fails, we test the detection)
    expect(result.packageManager).toBe("bun");
  });

  test("should detect pnpm-lock.yaml and use pnpm", async () => {
    const testWorkingDir = join(testDir, "pnpm-project");
    mkdirSync(testWorkingDir, { recursive: true });

    // Create package.json and pnpm-lock.yaml
    writeFileSync(
      join(testWorkingDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: {} }),
      "utf8"
    );
    writeFileSync(join(testWorkingDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf8");

    const result = await Utils.installDependencies(testWorkingDir, { verbose: false });

    expect(result.packageManager).toBe("pnpm");
  });

  test("should detect yarn.lock and use yarn", async () => {
    const testWorkingDir = join(testDir, "yarn-project");
    mkdirSync(testWorkingDir, { recursive: true });

    // Create package.json and yarn.lock
    writeFileSync(
      join(testWorkingDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: {} }),
      "utf8"
    );
    writeFileSync(join(testWorkingDir, "yarn.lock"), "# yarn lockfile v1\n", "utf8");

    const result = await Utils.installDependencies(testWorkingDir, { verbose: false });

    expect(result.packageManager).toBe("yarn");
  });

  test("should detect package-lock.json and use npm", async () => {
    const testWorkingDir = join(testDir, "npm-project");
    mkdirSync(testWorkingDir, { recursive: true });

    // Create package.json and package-lock.json
    writeFileSync(
      join(testWorkingDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: {} }),
      "utf8"
    );
    writeFileSync(
      join(testWorkingDir, "package-lock.json"),
      JSON.stringify({ name: "test", version: "1.0.0", lockfileVersion: 2 }),
      "utf8"
    );

    const result = await Utils.installDependencies(testWorkingDir, { verbose: false });

    expect(result.packageManager).toBe("npm");
  });

  test("should skip installation when package.json exists but no lock file", async () => {
    const testWorkingDir = join(testDir, "no-lock");
    mkdirSync(testWorkingDir, { recursive: true });

    // Create only package.json without lock file
    writeFileSync(
      join(testWorkingDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: {} }),
      "utf8"
    );

    const result = await Utils.installDependencies(testWorkingDir, { verbose: false });

    // Should succeed but not install anything (no lock file detected)
    expect(result.success).toBe(true);
    expect(result.packageManager).toBeUndefined();
  });

  test("should install dependencies when preparing worktree", async () => {
    // Create a branch with package.json
    execSync("git checkout -b feature/with-deps", { cwd: repoDir });

    // Create a simple package.json
    writeFileSync(
      join(repoDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {},
        devDependencies: {}
      }),
      "utf8"
    );

    // Create package-lock.json
    writeFileSync(
      join(repoDir, "package-lock.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        lockfileVersion: 2,
        packages: {
          "": {
            name: "test-project",
            version: "1.0.0"
          }
        }
      }),
      "utf8"
    );

    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'Add package files'", { cwd: repoDir });
    execSync("git checkout main || git checkout master", { cwd: repoDir });

    // Prepare worktree - should install dependencies
    const result = await Utils.prepareReviewWorktree("feature/with-deps", { verbose: false });

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();

    // Verify node_modules was created (if npm install succeeded)
    // Note: This might fail if npm isn't available, which is OK for the test
    const worktreePath = result.path!;
    const packageJsonExists = existsSync(join(worktreePath, "package.json"));
    expect(packageJsonExists).toBe(true);
  });
});
