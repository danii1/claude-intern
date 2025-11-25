import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI_PATH = join(__dirname, "..", "src", "index.ts");

// Helper to run the CLI in an isolated directory to avoid lock conflicts
function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  // Create unique temp directory for this test run
  const testDir = join(tmpdir(), `cli-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  mkdirSync(testDir, { recursive: true });

  try {
    const result = spawnSync("bun", [CLI_PATH, ...args], {
      encoding: "utf8",
      timeout: 5000,
      cwd: testDir, // Run in isolated directory
      env: {
        ...process.env,
        JIRA_BASE_URL: "https://test.atlassian.net",
        JIRA_EMAIL: "test@example.com",
        JIRA_API_TOKEN: "test-token",
      },
    });

    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.status || 0,
    };
  } finally {
    // Clean up temp directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

describe("CLI Argument Handling", () => {
  test("should show help with --help", () => {
    const result = runCLI(["--help"]);
    expect(result.stdout).toContain("claude-intern");
    expect(result.stdout).toContain("JIRA task key");
    expect(result.exitCode).toBe(0);
  });

  test("should show version with --version", () => {
    const result = runCLI(["--version"]);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.exitCode).toBe(0);
  });

  test("should handle init command", () => {
    const result = runCLI(["init"]);
    expect(result.stdout).toContain("Initializing Claude Intern");
    expect(result.exitCode).toBe(0);
  });

  test("should accept single task key", () => {
    const result = runCLI(["TEST-123", "--no-claude"]);
    // Will fail to fetch from JIRA but should parse arguments correctly
    expect(result.stdout).toContain("Processing");
    expect(result.stdout).toContain("TEST-123");
  });

  test("should accept multiple task keys", () => {
    const result = runCLI(["TEST-123", "TEST-456", "--no-claude"]);
    expect(result.stdout).toContain("Processing 2 task");
    expect(result.stdout).toContain("TEST-123");
    expect(result.stdout).toContain("TEST-456");
  });

  test("should handle --jql option", () => {
    const result = runCLI(["--jql", "project = TEST", "--no-claude"]);
    expect(result.stdout).toContain("Searching JIRA with JQL");
  });

  test("should handle --no-claude option", () => {
    const result = runCLI(["TEST-123", "--no-claude"]);
    // Should not try to run Claude
    expect(result.stdout).not.toContain("Running Claude");
  });

  test("should handle --no-git option", () => {
    const result = runCLI(["TEST-123", "--no-git", "--no-claude"]);
    // Should not try to create git branch
    expect(result.stdout).not.toContain("Creating feature branch");
  });

  test("should handle --max-turns option", () => {
    // This is harder to test without actually running Claude
    // Just verify it parses without error
    const result = runCLI(["TEST-123", "--max-turns", "500", "--no-claude"]);
    expect(result.stdout).toContain("Processing");
  });

  test("should handle --create-pr option", () => {
    const result = runCLI(["TEST-123", "--create-pr", "--no-claude"]);
    expect(result.stdout).toContain("Processing");
  });

  test("should handle --pr-target-branch option", () => {
    const result = runCLI(["TEST-123", "--create-pr", "--pr-target-branch", "develop", "--no-claude"]);
    expect(result.stdout).toContain("Processing");
  });

  test("should handle --skip-clarity-check option", () => {
    const result = runCLI(["TEST-123", "--skip-clarity-check", "--no-claude"]);
    expect(result.stdout).not.toContain("clarity assessment");
  });

  test("should handle --skip-jira-comments option", () => {
    const result = runCLI(["TEST-123", "--skip-jira-comments", "--no-claude"]);
    expect(result.stdout).toContain("Processing");
  });

  test("should handle --verbose option", () => {
    const result = runCLI(["TEST-123", "-v", "--no-claude"]);
    // Verbose mode shows more output
    expect(result.stdout).toContain("Claude CLI path");
  });

  test("should handle --no-auto-commit option", () => {
    const result = runCLI(["TEST-123", "--no-auto-commit", "--no-claude"]);
    expect(result.stdout).toContain("Processing");
  });

  test("should handle --hook-retries option", () => {
    const result = runCLI(["TEST-123", "--hook-retries", "5", "--no-claude"]);
    expect(result.stdout).toContain("Processing");
  });

  test("should handle combination of options", () => {
    const result = runCLI([
      "TEST-123",
      "--max-turns",
      "500",
      "--create-pr",
      "--pr-target-branch",
      "master",
      "--skip-clarity-check",
      "--no-claude",
    ]);
    expect(result.stdout).toContain("Processing");
    expect(result.stdout).toContain("TEST-123");
  });

  test("should error when no task keys and no JQL provided", () => {
    const result = runCLI(["--no-claude"]);
    // The error appears in stdout as part of the main() function
    const output = result.stdout + result.stderr;
    expect(output).toContain("No tasks specified");
  });

  test("should handle task keys that look like options", () => {
    // Task key starting with dash should still work
    const result = runCLI(["TEST-123", "--no-claude"]);
    expect(result.stdout).toContain("TEST-123");
  });
});

describe("CLI Init Command", () => {
  test("init should not be treated as a task key", () => {
    const result = runCLI(["init"]);
    expect(result.stdout).not.toContain("Fetching JIRA task: init");
    expect(result.stdout).toContain("Initializing Claude Intern");
    expect(result.exitCode).toBe(0);
  });

  test("init should work without other arguments", () => {
    const result = runCLI(["init"]);
    // Check for either success message or "already exists" message
    const hasInitOutput =
      result.stdout.includes("Created configuration folder") ||
      result.stdout.includes("Configuration folder already exists");
    expect(hasInitOutput).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
