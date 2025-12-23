import { describe, expect, test } from "bun:test";
import { Utils } from "../src/lib/utils";

describe("Target Branch Extraction from JIRA Description", () => {
  describe("Basic extraction patterns", () => {
    test("should extract branch from 'Target branch:' pattern (lowercase)", () => {
      const description = "This is a task.\n\nTarget branch: develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should extract branch from 'Target Branch:' pattern (title case)", () => {
      const description = "Fix bug\n\nTarget Branch: main";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("main");
    });

    test("should extract branch from 'TARGET BRANCH:' pattern (uppercase)", () => {
      const description = "Feature work\n\nTARGET BRANCH: release/v2.0";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("release/v2.0");
    });

    test("should extract branch from 'Base branch:' pattern", () => {
      const description = "Fix bug\n\nBase branch: feature/new-api";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("feature/new-api");
    });

    test("should extract branch from 'PR target:' pattern", () => {
      const description = "Implement feature\n\nPR target: develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });
  });

  describe("Complex branch names", () => {
    test("should extract branch with slashes (feature/xxx)", () => {
      const description = "Target branch: feature/new-authentication";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("feature/new-authentication");
    });

    test("should extract branch with slashes (release/xxx)", () => {
      const description = "Base branch: release/v2.0.1";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("release/v2.0.1");
    });

    test("should extract branch with multiple slashes", () => {
      const description = "PR target: feature/team-a/new-api";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("feature/team-a/new-api");
    });

    test("should extract branch with hyphens", () => {
      const description = "Target branch: feature-new-api-v2";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("feature-new-api-v2");
    });

    test("should extract branch with underscores", () => {
      const description = "Base branch: release_v2_0_1";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("release_v2_0_1");
    });

    test("should extract branch with dots", () => {
      const description = "Target branch: release/2.0.1";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("release/2.0.1");
    });
  });

  describe("Whitespace handling", () => {
    test("should handle extra whitespace after colon", () => {
      const description = "Target branch:    develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should handle no whitespace after colon", () => {
      const description = "Target branch:develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should handle tabs and mixed whitespace", () => {
      const description = "Target branch:\t\tdevelop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should handle whitespace before pattern", () => {
      const description = "Some text\n   Target branch: develop\nMore text";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });
  });

  describe("Edge cases and validation", () => {
    test("should return null when no pattern found", () => {
      const description = "This is a task without branch specification";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBeNull();
    });

    test("should return null for undefined description", () => {
      const result = Utils.extractTargetBranch(undefined);
      expect(result).toBeNull();
    });

    test("should return null for empty string", () => {
      const result = Utils.extractTargetBranch("");
      expect(result).toBeNull();
    });

    test("should reject branch name with spaces", () => {
      const description = "Target branch: develop branch";
      const result = Utils.extractTargetBranch(description);
      // Should only extract "develop" (stops at space)
      expect(result).toBe("develop");
    });

    test("should extract first matching pattern when multiple present", () => {
      const description = "Target branch: develop\nBase branch: main";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should stop at newline", () => {
      const description = "Target branch: develop\nSome other text";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should stop at comma", () => {
      const description = "Target branch: develop, please review";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });
  });

  describe("Real-world JIRA description examples", () => {
    test("should extract from typical JIRA task description", () => {
      const description = `
## Summary
Implement new authentication feature

## Description
We need to add OAuth2 authentication to the API.

## Technical Details
Target branch: develop

## Acceptance Criteria
- [ ] OAuth2 flow implemented
- [ ] Tests added
      `.trim();
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should extract from description with links and formatting", () => {
      const description = `
**Task**: Update user profile API

**Links**:
- Figma: https://figma.com/design/123
- API Docs: https://docs.example.com

**Base branch: feature/api-v2**

**Notes**: Please review carefully
      `.trim();
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("feature/api-v2");
    });

    test("should extract from bullet point list", () => {
      const description = `
Requirements:
- Update authentication
- Add new endpoints
- PR target: release/v2.0
- Write tests
      `.trim();
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("release/v2.0");
    });

    test("should handle markdown-style descriptions", () => {
      const description = `
# Task Description

Implement new feature X

## Configuration

- **Target branch**: feature/team-alpha
- **Story points**: 5
- **Sprint**: Sprint 42
      `.trim();
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("feature/team-alpha");
    });
  });

  describe("Pattern priority", () => {
    test("should prefer 'Target branch' over 'Base branch'", () => {
      const description = "Base branch: main\nTarget branch: develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should use 'Base branch' when 'Target branch' not present", () => {
      const description = "Some text\nBase branch: develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });

    test("should use 'PR target' as fallback", () => {
      const description = "Some text\nPR target: develop";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("develop");
    });
  });

  describe("Special characters in branch names", () => {
    test("should handle branch names with numbers", () => {
      const description = "Target branch: release/2024.01.15";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("release/2024.01.15");
    });

    test("should handle branch names with version numbers", () => {
      const description = "Base branch: v2.0.1-rc1";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("v2.0.1-rc1");
    });

    test("should handle branch names with uppercase", () => {
      const description = "Target branch: HOTFIX-123";
      const result = Utils.extractTargetBranch(description);
      expect(result).toBe("HOTFIX-123");
    });
  });

  describe("Atlassian Document Format (ADF) scenarios", () => {
    test("should work with plain text extracted from ADF", () => {
      // Simulating text extracted from ADF by JiraExtractor
      const extractedText = "Task description goes here\n\nTarget branch: develop\n\nMore details";
      const result = Utils.extractTargetBranch(extractedText);
      expect(result).toBe("develop");
    });

    test("should work with multi-paragraph ADF text", () => {
      const extractedText = `
First paragraph with task details.

Second paragraph with more info.

Target branch: feature/new-ui

Third paragraph with acceptance criteria.
      `.trim();
      const result = Utils.extractTargetBranch(extractedText);
      expect(result).toBe("feature/new-ui");
    });
  });

  describe("Markdown formatting variations", () => {
    describe("Bold formatting", () => {
      test("should extract from **Target branch**: develop", () => {
        const result = Utils.extractTargetBranch("**Target branch**: develop");
        expect(result).toBe("develop");
      });

      test("should extract from **Target branch: develop**", () => {
        const result = Utils.extractTargetBranch("**Target branch: develop**");
        expect(result).toBe("develop");
      });

      test("should extract from Target branch: **develop**", () => {
        const result = Utils.extractTargetBranch("Target branch: **develop**");
        expect(result).toBe("develop");
      });

      test("should extract from **Target branch: develop**", () => {
        const result = Utils.extractTargetBranch("**Target branch: develop**");
        expect(result).toBe("develop");
      });
    });

    describe("Italic formatting", () => {
      test("should extract from *Target branch*: develop", () => {
        const result = Utils.extractTargetBranch("*Target branch*: develop");
        expect(result).toBe("develop");
      });

      test("should extract from _Target branch_: develop", () => {
        const result = Utils.extractTargetBranch("_Target branch_: develop");
        expect(result).toBe("develop");
      });

      test("should extract from Target branch: *develop*", () => {
        const result = Utils.extractTargetBranch("Target branch: *develop*");
        expect(result).toBe("develop");
      });

      test("should extract from Target branch: _develop_", () => {
        const result = Utils.extractTargetBranch("Target branch: _develop_");
        expect(result).toBe("develop");
      });
    });

    describe("Bold + Italic formatting", () => {
      test("should extract from ***Target branch***: develop", () => {
        const result = Utils.extractTargetBranch("***Target branch***: develop");
        expect(result).toBe("develop");
      });

      test("should extract from ___Base branch___: feature/api", () => {
        const result = Utils.extractTargetBranch("___Base branch___: feature/api");
        expect(result).toBe("feature/api");
      });

      test("should extract from Target branch: ***develop***", () => {
        const result = Utils.extractTargetBranch("Target branch: ***develop***");
        expect(result).toBe("develop");
      });
    });

    describe("Heading formatting", () => {
      test("should extract from # Target branch: develop", () => {
        const result = Utils.extractTargetBranch("# Target branch: develop");
        expect(result).toBe("develop");
      });

      test("should extract from ## Target branch: develop", () => {
        const result = Utils.extractTargetBranch("## Target branch: develop");
        expect(result).toBe("develop");
      });

      test("should extract from ### Base branch: feature/new-ui", () => {
        const result = Utils.extractTargetBranch("### Base branch: feature/new-ui");
        expect(result).toBe("feature/new-ui");
      });

      test("should extract from #### PR target: release/v2.0", () => {
        const result = Utils.extractTargetBranch("#### PR target: release/v2.0");
        expect(result).toBe("release/v2.0");
      });

      test("should extract from ##### Target branch: main", () => {
        const result = Utils.extractTargetBranch("##### Target branch: main");
        expect(result).toBe("main");
      });

      test("should extract from ###### Target branch: develop", () => {
        const result = Utils.extractTargetBranch("###### Target branch: develop");
        expect(result).toBe("develop");
      });
    });

    describe("Combined markdown formatting", () => {
      test("should extract from ## **Target branch**: develop", () => {
        const result = Utils.extractTargetBranch("## **Target branch**: develop");
        expect(result).toBe("develop");
      });

      test("should extract from ### *Base branch*: feature/api", () => {
        const result = Utils.extractTargetBranch("### *Base branch*: feature/api");
        expect(result).toBe("feature/api");
      });

      test("should extract from ## Target branch: **develop**", () => {
        const result = Utils.extractTargetBranch("## Target branch: **develop**");
        expect(result).toBe("develop");
      });

      test("should extract from # ***Target branch***: release/v1.0", () => {
        const result = Utils.extractTargetBranch("# ***Target branch***: release/v1.0");
        expect(result).toBe("release/v1.0");
      });

      test("should extract from ### **Target branch: develop**", () => {
        const result = Utils.extractTargetBranch("### **Target branch: develop**");
        expect(result).toBe("develop");
      });
    });

    describe("Boundary detection", () => {
      test("should stop at whitespace after branch name", () => {
        const description = "Target branch: feature/slam-1042 Error handling notes";
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("feature/slam-1042");
      });

      test("should stop at newline after branch name", () => {
        const description = "Target branch: feature/slam-1042\nError handling notes";
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("feature/slam-1042");
      });

      test("should stop at newline even when text starts with uppercase", () => {
        const description = "Target branch: feature/slam-1042\nError: validation failed";
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("feature/slam-1042");
      });

      test("should require colon to avoid false matches", () => {
        const description = "Target branch feature/slam-1042Error";
        const result = Utils.extractTargetBranch(description);
        expect(result).toBeNull();
      });

      test("should handle branch name at end of line", () => {
        const description = "Target branch: develop";
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("develop");
      });
    });

    describe("Mixed formatting in real scenarios", () => {
      test("should handle JIRA-style bold with markdown", () => {
        const description = `
## Task Details

**Summary**: Implement new feature
**Target branch**: feature/team-a
**Priority**: High
        `.trim();
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("feature/team-a");
      });

      test("should handle heading with bold branch name", () => {
        const description = `
# Configuration

Target branch: **release/2024.01**
Assignee: John Doe
        `.trim();
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("release/2024.01");
      });

      test("should handle italic label with value", () => {
        const description = `
*Base branch*: develop
*Story points*: 5
        `.trim();
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("develop");
      });

      test("should handle nested markdown in list", () => {
        const description = `
- **Requirements**: Must work on mobile
- **Target branch**: _feature/mobile-support_
- **Deadline**: Next sprint
        `.trim();
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("feature/mobile-support");
      });

      test("should handle markdown table row with colon", () => {
        const description = `
| Field | Value |
|-------|-------|
| **Target branch**: | develop |
| Priority | High |
        `.trim();
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("develop");
      });

      test("should handle combination of all formats", () => {
        const description = `
## **Technical Details**

***Target branch***: **feature/api-v2**
        `.trim();
        const result = Utils.extractTargetBranch(description);
        expect(result).toBe("feature/api-v2");
      });
    });
  });
});
