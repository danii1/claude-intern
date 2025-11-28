import { describe, test, expect, beforeEach } from "bun:test";
import { JiraClient } from "../src/lib/jira-client";
import { JiraFormatter } from "../src/lib/jira-formatter";
import type { JiraComment } from "../src/types/jira";

describe("JiraClient Comment Filtering", () => {
  let jiraClient: JiraClient;

  beforeEach(() => {
    // Create a JiraClient instance for testing
    jiraClient = new JiraClient(
      "https://test.atlassian.net",
      "test@example.com",
      "test-token"
    );
  });

  describe("isClaudeInternComment - String Body Format", () => {
    test("should detect implementation completed comment", () => {
      const comment: JiraComment = {
        id: "1",
        body: "🤖 Implementation Completed by Claude - I've added the feature",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      // Access private method via reflection for testing
      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect clarity assessment comment", () => {
      const comment: JiraComment = {
        id: "2",
        body: "🤖 Automated Task Feasibility Assessment - Score: 8/10",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect incomplete implementation comment", () => {
      const comment: JiraComment = {
        id: "3",
        body: "⚠️ Implementation Incomplete - Could not finish the task",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should NOT detect regular user comment", () => {
      const comment: JiraComment = {
        id: "4",
        body: "Please implement this feature as soon as possible",
        author: { displayName: "John Doe" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });

    test("should NOT detect comment mentioning Claude but not automated", () => {
      const comment: JiraComment = {
        id: "5",
        body: "I think Claude should work on this task next week",
        author: { displayName: "Jane Smith" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });
  });

  describe("isClaudeInternComment - Rendered Body Format", () => {
    test("should detect implementation comment in renderedBody", () => {
      const comment: JiraComment = {
        id: "6",
        body: "",
        renderedBody: "<h3>🤖 Implementation Completed by Claude</h3><p>Task completed successfully</p>",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect assessment comment in renderedBody", () => {
      const comment: JiraComment = {
        id: "7",
        body: "",
        renderedBody: "<h3>🤖 Automated Task Feasibility Assessment</h3><p>Clarity: 8/10</p>",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect incomplete comment in renderedBody", () => {
      const comment: JiraComment = {
        id: "8",
        body: "",
        renderedBody: "<h3>⚠️ Implementation Incomplete</h3><p>Could not complete</p>",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });
  });

  describe("isClaudeInternComment - ADF Body Format", () => {
    test("should detect implementation comment in ADF format", () => {
      const adfContent = JiraFormatter.createImplementationCommentADF(
        "Implementation completed successfully",
        "Add login feature"
      );

      const comment: JiraComment = {
        id: "9",
        body: {
          type: "doc",
          version: 1,
          content: adfContent
        },
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect assessment comment in ADF format", () => {
      const adfContent = JiraFormatter.createClarityAssessmentADF({
        clarityScore: 8,
        isImplementable: true,
        summary: "Task is clear",
        issues: [],
        recommendations: []
      });

      const comment: JiraComment = {
        id: "10",
        body: {
          type: "doc",
          version: 1,
          content: adfContent
        },
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect incomplete comment in ADF format", () => {
      const adfContent = JiraFormatter.createIncompleteImplementationCommentADF(
        "Could not complete the task",
        "Add login feature"
      );

      const comment: JiraComment = {
        id: "11",
        body: {
          type: "doc",
          version: 1,
          content: adfContent
        },
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should NOT detect regular comment in ADF format", () => {
      const comment: JiraComment = {
        id: "12",
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "This is a regular user comment about the task"
                }
              ]
            }
          ]
        },
        author: { displayName: "John Doe" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty body", () => {
      const comment: JiraComment = {
        id: "13",
        body: "",
        author: { displayName: "Test User" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });

    test("should handle undefined body", () => {
      const comment: JiraComment = {
        id: "14",
        body: undefined as any,
        author: { displayName: "Test User" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });

    test("should handle null body", () => {
      const comment: JiraComment = {
        id: "15",
        body: null as any,
        author: { displayName: "Test User" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });

    test("should handle malformed ADF body", () => {
      const comment: JiraComment = {
        id: "16",
        body: {
          type: "doc",
          version: 1,
          // Missing content field
        } as any,
        author: { displayName: "Test User" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });

    test("should be case sensitive for markers", () => {
      const comment: JiraComment = {
        id: "17",
        body: "implementation completed by claude",
        author: { displayName: "Test User" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });

    test("should detect marker even with surrounding text", () => {
      const comment: JiraComment = {
        id: "18",
        body: "Here is some text before. Implementation Completed by Claude. And some after.",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(true);
    });

    test("should detect marker with different whitespace", () => {
      const comment: JiraComment = {
        id: "19",
        body: "Implementation   Completed   by   Claude",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      // This should NOT match because we check for exact string
      const isClaudeComment = (jiraClient as any).isClaudeInternComment(comment);
      expect(isClaudeComment).toBe(false);
    });
  });

  describe("All Three Comment Types", () => {
    test("should correctly identify all three automated comment types", () => {
      const implementationComment: JiraComment = {
        id: "20",
        body: "🤖 Implementation Completed by Claude",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const assessmentComment: JiraComment = {
        id: "21",
        body: "🤖 Automated Task Feasibility Assessment",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const incompleteComment: JiraComment = {
        id: "22",
        body: "⚠️ Implementation Incomplete",
        author: { displayName: "Claude Bot" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      const regularComment: JiraComment = {
        id: "23",
        body: "Regular user feedback",
        author: { displayName: "John Doe" },
        created: "2024-01-01",
        updated: "2024-01-01"
      };

      expect((jiraClient as any).isClaudeInternComment(implementationComment)).toBe(true);
      expect((jiraClient as any).isClaudeInternComment(assessmentComment)).toBe(true);
      expect((jiraClient as any).isClaudeInternComment(incompleteComment)).toBe(true);
      expect((jiraClient as any).isClaudeInternComment(regularComment)).toBe(false);
    });
  });

  describe("Marker Uniqueness", () => {
    test("markers should be unique substrings of each comment type", () => {
      const markers = [
        "Implementation Completed by Claude",
        "Automated Task Feasibility Assessment",
        "Implementation Incomplete"
      ];

      // Ensure no marker is a substring of another
      for (let i = 0; i < markers.length; i++) {
        for (let j = 0; j < markers.length; j++) {
          if (i !== j) {
            expect(markers[i].includes(markers[j])).toBe(false);
            expect(markers[j].includes(markers[i])).toBe(false);
          }
        }
      }
    });

    test("each marker should appear in exactly one comment type", () => {
      const implementationADF = JiraFormatter.createImplementationCommentADF("test");
      const assessmentADF = JiraFormatter.createClarityAssessmentADF({
        clarityScore: 5,
        isImplementable: true,
        summary: "test",
        issues: [],
        recommendations: []
      });
      const incompleteADF = JiraFormatter.createIncompleteImplementationCommentADF("test");

      const implementationStr = JSON.stringify(implementationADF);
      const assessmentStr = JSON.stringify(assessmentADF);
      const incompleteStr = JSON.stringify(incompleteADF);

      // Implementation marker should only appear in implementation comments
      expect(implementationStr).toContain("Implementation Completed by Claude");
      expect(assessmentStr).not.toContain("Implementation Completed by Claude");
      expect(incompleteStr).not.toContain("Implementation Completed by Claude");

      // Assessment marker should only appear in assessment comments
      expect(implementationStr).not.toContain("Automated Task Feasibility Assessment");
      expect(assessmentStr).toContain("Automated Task Feasibility Assessment");
      expect(incompleteStr).not.toContain("Automated Task Feasibility Assessment");

      // Incomplete marker should only appear in incomplete comments
      expect(implementationStr).not.toContain("Implementation Incomplete");
      expect(assessmentStr).not.toContain("Implementation Incomplete");
      expect(incompleteStr).toContain("Implementation Incomplete");
    });
  });
});
