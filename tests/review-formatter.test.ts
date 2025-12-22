import { describe, test, expect } from "bun:test";
import {
  formatReviewPrompt,
  formatReplyMessage,
  formatReviewSummaryReply,
  formatSingleCommentPrompt,
} from "../src/lib/review-formatter";
import type {
  ProcessedReviewComment,
  ProcessedReviewFeedback,
} from "../src/types/github-webhooks";

describe("Review Formatter", () => {
  describe("formatReviewPrompt", () => {
    const baseFeedback: ProcessedReviewFeedback = {
      prNumber: 42,
      prTitle: "Add user authentication",
      repository: "owner/repo",
      branch: "feature/auth",
      reviewer: "senior-dev",
      reviewState: "changes_requested",
      reviewBody: "Good progress, but please address these issues.",
      comments: [],
    };

    test("should include PR information", () => {
      const prompt = formatReviewPrompt(baseFeedback);

      expect(prompt).toContain("owner/repo");
      expect(prompt).toContain("PR #42");
      expect(prompt).toContain("Add user authentication");
      expect(prompt).toContain("feature/auth");
      expect(prompt).toContain("@senior-dev");
    });

    test("should include overall review comment", () => {
      const prompt = formatReviewPrompt(baseFeedback);

      expect(prompt).toContain("Overall Review Comment");
      expect(prompt).toContain("Good progress, but please address these issues.");
    });

    test("should not include overall review section if body is empty", () => {
      const feedback = { ...baseFeedback, reviewBody: null };
      const prompt = formatReviewPrompt(feedback);

      expect(prompt).not.toContain("Overall Review Comment");
    });

    test("should format file-specific comments", () => {
      const feedback: ProcessedReviewFeedback = {
        ...baseFeedback,
        comments: [
          {
            id: 1,
            path: "src/auth.ts",
            line: 25,
            side: "RIGHT",
            diffHunk: "@@ -20,5 +20,10 @@\n const validateUser = () => {",
            body: "Add input validation here",
            reviewer: "senior-dev",
            isReply: false,
          },
          {
            id: 2,
            path: "src/auth.ts",
            line: 42,
            side: "RIGHT",
            diffHunk: "@@ -40,3 +40,8 @@\n return token;",
            body: "Consider using a more secure token generation",
            reviewer: "senior-dev",
            isReply: false,
          },
        ],
      };

      const prompt = formatReviewPrompt(feedback);

      expect(prompt).toContain("File-Specific Feedback");
      expect(prompt).toContain("`src/auth.ts`");
      expect(prompt).toContain("Line 25");
      expect(prompt).toContain("Line 42");
      expect(prompt).toContain("Add input validation here");
      expect(prompt).toContain("Consider using a more secure token generation");
    });

    test("should group comments by file", () => {
      const feedback: ProcessedReviewFeedback = {
        ...baseFeedback,
        comments: [
          {
            id: 1,
            path: "src/auth.ts",
            line: 10,
            side: "RIGHT",
            diffHunk: "@@",
            body: "Comment 1",
            reviewer: "dev",
            isReply: false,
          },
          {
            id: 2,
            path: "src/utils.ts",
            line: 5,
            side: "RIGHT",
            diffHunk: "@@",
            body: "Comment 2",
            reviewer: "dev",
            isReply: false,
          },
          {
            id: 3,
            path: "src/auth.ts",
            line: 20,
            side: "RIGHT",
            diffHunk: "@@",
            body: "Comment 3",
            reviewer: "dev",
            isReply: false,
          },
        ],
      };

      const prompt = formatReviewPrompt(feedback);

      // Both files should appear as headers
      expect(prompt).toContain("`src/auth.ts`");
      expect(prompt).toContain("`src/utils.ts`");
    });

    test("should include instructions section", () => {
      const prompt = formatReviewPrompt(baseFeedback);

      expect(prompt).toContain("Instructions");
      expect(prompt).toContain("commit them with a descriptive message");
      expect(prompt).toContain("Do NOT push to the remote");
    });

    test("should format review state correctly", () => {
      const states: Array<{
        state: ProcessedReviewFeedback["reviewState"];
        expected: string;
      }> = [
        { state: "approved", expected: "✅ Approved" },
        { state: "changes_requested", expected: "🔄 Changes Requested" },
        { state: "commented", expected: "💬 Commented" },
        { state: "dismissed", expected: "❌ Dismissed" },
        { state: "pending", expected: "⏳ Pending" },
      ];

      for (const { state, expected } of states) {
        const feedback = { ...baseFeedback, reviewState: state };
        const prompt = formatReviewPrompt(feedback);
        expect(prompt).toContain(expected);
      }
    });

    test("should include diff hunks with syntax highlighting", () => {
      const feedback: ProcessedReviewFeedback = {
        ...baseFeedback,
        comments: [
          {
            id: 1,
            path: "src/app.tsx",
            line: 10,
            side: "RIGHT",
            diffHunk: "@@ -5,5 +5,10 @@\n const Component = () => {\n   return <div>Hello</div>;\n };",
            body: "Add error boundary",
            reviewer: "dev",
            isReply: false,
          },
        ],
      };

      const prompt = formatReviewPrompt(feedback);

      expect(prompt).toContain("```tsx");
      expect(prompt).toContain("const Component = () => {");
    });
  });

  describe("formatReplyMessage", () => {
    const comment: ProcessedReviewComment = {
      id: 1,
      path: "src/index.ts",
      line: 10,
      side: "RIGHT",
      diffHunk: "@@",
      body: "Fix this",
      reviewer: "dev",
      isReply: false,
    };

    test("should format addressed message", () => {
      const reply = formatReplyMessage(comment, true);
      expect(reply).toContain("✅");
      expect(reply).toContain("Addressed");
    });

    test("should format not addressed message", () => {
      const reply = formatReplyMessage(comment, false);
      expect(reply).toContain("⏳");
      expect(reply).toContain("follow-up");
    });
  });

  describe("formatReviewSummaryReply", () => {
    test("should show all addressed when complete", () => {
      const summary = formatReviewSummaryReply(5, 5);

      expect(summary).toContain("✅");
      expect(summary).toContain("All 5 comment(s)");
      expect(summary).toContain("Claude Intern");
    });

    test("should show partial count when incomplete", () => {
      const summary = formatReviewSummaryReply(3, 5);

      expect(summary).toContain("📝");
      expect(summary).toContain("3 of 5");
      expect(summary).toContain("manual attention");
    });

    test("should include Claude Intern branding", () => {
      const summary = formatReviewSummaryReply(1, 1);

      expect(summary).toContain("Claude Intern");
      expect(summary).toContain("github.com/danii1/claude-intern");
    });
  });

  describe("formatSingleCommentPrompt", () => {
    test("should format single comment prompt", () => {
      const comment: ProcessedReviewComment = {
        id: 1,
        path: "src/utils.ts",
        line: 42,
        side: "RIGHT",
        diffHunk: "@@ -40,5 +40,10 @@\n export function helper() {",
        body: "Add type annotations",
        reviewer: "reviewer",
        isReply: false,
      };

      const prompt = formatSingleCommentPrompt(comment, "owner/repo", "feature-branch");

      expect(prompt).toContain("Single PR Review Comment");
      expect(prompt).toContain("owner/repo");
      expect(prompt).toContain("feature-branch");
      expect(prompt).toContain("`src/utils.ts`");
      expect(prompt).toContain("**Line:** 42");
      expect(prompt).toContain("Add type annotations");
      expect(prompt).toContain("```typescript");
    });

    test("should handle comment without line number", () => {
      const comment: ProcessedReviewComment = {
        id: 1,
        path: "README.md",
        line: null,
        side: "RIGHT",
        diffHunk: "@@",
        body: "Update documentation",
        reviewer: "reviewer",
        isReply: false,
      };

      const prompt = formatSingleCommentPrompt(comment, "owner/repo", "main");

      expect(prompt).not.toContain("Line:");
    });
  });
});
