import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import type { ProjectSettings } from "../src/types/settings";

// Test directory
const testDir = join("/tmp", "claude-intern-test-settings");
const settingsPath = join(testDir, ".claude-intern", "settings.json");

// Helper to create test settings
function createTestSettings(settings: ProjectSettings): void {
  const configDir = join(testDir, ".claude-intern");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

// Helper to load settings (simulating the function from index.ts)
function loadProjectSettings(baseDir: string): ProjectSettings | null {
  const settingsFilePath = join(baseDir, ".claude-intern", "settings.json");

  if (!existsSync(settingsFilePath)) {
    return null;
  }

  try {
    const settingsContent = Bun.file(settingsFilePath);
    return settingsContent.json() as ProjectSettings;
  } catch (error) {
    return null;
  }
}

// Helper to get PR status (simulating the function from index.ts)
function getPrStatusForProject(
  projectKey: string,
  settings: ProjectSettings | null
): string | undefined {
  return settings?.projects?.[projectKey]?.prStatus;
}

describe("Project Settings", () => {
  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should load settings.json when it exists", async () => {
    const testSettings: ProjectSettings = {
      projects: {
        "PROJ": { prStatus: "In Review" },
        "ABC": { prStatus: "Code Review" },
      },
    };

    createTestSettings(testSettings);

    const loaded = await loadProjectSettings(testDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.projects?.["PROJ"]?.prStatus).toBe("In Review");
    expect(loaded?.projects?.["ABC"]?.prStatus).toBe("Code Review");
  });

  test("should return null when settings.json does not exist", async () => {
    const loaded = await loadProjectSettings(testDir);
    expect(loaded).toBeNull();
  });

  test("should get PR status for configured project", async () => {
    const testSettings: ProjectSettings = {
      projects: {
        "PROJ": { prStatus: "In Review" },
        "ABC": { prStatus: "Code Review" },
      },
    };

    createTestSettings(testSettings);
    const settings = await loadProjectSettings(testDir);

    expect(getPrStatusForProject("PROJ", settings)).toBe("In Review");
    expect(getPrStatusForProject("ABC", settings)).toBe("Code Review");
  });

  test("should return undefined for unconfigured project", async () => {
    const testSettings: ProjectSettings = {
      projects: {
        "PROJ": { prStatus: "In Review" },
      },
    };

    createTestSettings(testSettings);
    const settings = await loadProjectSettings(testDir);

    expect(getPrStatusForProject("UNKNOWN", settings)).toBeUndefined();
  });

  test("should return undefined when settings is null", () => {
    expect(getPrStatusForProject("PROJ", null)).toBeUndefined();
  });

  test("should handle multiple projects with different statuses", async () => {
    const testSettings: ProjectSettings = {
      projects: {
        "PROJ": { prStatus: "In Review" },
        "ABC": { prStatus: "Code Review" },
        "XYZ": { prStatus: "Ready for QA" },
      },
    };

    createTestSettings(testSettings);
    const settings = await loadProjectSettings(testDir);

    expect(getPrStatusForProject("PROJ", settings)).toBe("In Review");
    expect(getPrStatusForProject("ABC", settings)).toBe("Code Review");
    expect(getPrStatusForProject("XYZ", settings)).toBe("Ready for QA");
  });

  test("should extract project key from task key", () => {
    const taskKey = "PROJ-123";
    const projectKey = taskKey.split("-")[0];
    expect(projectKey).toBe("PROJ");
  });

  test("should extract project key from different formats", () => {
    expect("ABC-456".split("-")[0]).toBe("ABC");
    expect("XYZ-789".split("-")[0]).toBe("XYZ");
    expect("LONG-PROJECT-123".split("-")[0]).toBe("LONG");
  });
});
