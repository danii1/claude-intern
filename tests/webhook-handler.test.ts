import { describe, test, expect } from "bun:test";
import {
  verifyWebhookSignature,
  parseEventType,
  shouldProcessReview,
  processReviewEvent,
  processReviewComment,
  RateLimiter,
  isGitHubIP,
  containsBotMention,
  reviewMentionsBot,
} from "../src/lib/webhook-handler";
import type {
  PullRequestReviewEvent,
  GitHubReviewComment,
  ProcessedReviewComment,
} from "../src/types/github-webhooks";

describe("Webhook Handler", () => {
  describe("verifyWebhookSignature", () => {
    const secret = "test-secret-123";

    test("should verify valid signature", () => {
      const payload = '{"action":"submitted"}';
      // Pre-computed signature for this payload with this secret
      const signature =
        "sha256=" +
        require("crypto")
          .createHmac("sha256", secret)
          .update(payload)
          .digest("hex");

      const result = verifyWebhookSignature(payload, signature, secret);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test("should reject missing signature", () => {
      const payload = '{"action":"submitted"}';
      const result = verifyWebhookSignature(payload, null, secret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing X-Hub-Signature-256 header");
    });

    test("should reject invalid signature format", () => {
      const payload = '{"action":"submitted"}';
      const result = verifyWebhookSignature(payload, "invalid-signature", secret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature format (expected sha256=...)");
    });

    test("should reject wrong signature", () => {
      const payload = '{"action":"submitted"}';
      const wrongSignature = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

      const result = verifyWebhookSignature(payload, wrongSignature, secret);
      expect(result.valid).toBe(false);
    });

    test("should reject signature with wrong length", () => {
      const payload = '{"action":"submitted"}';
      const shortSignature = "sha256=abc123";

      const result = verifyWebhookSignature(payload, shortSignature, secret);
      expect(result.valid).toBe(false);
    });
  });

  describe("parseEventType", () => {
    test("should parse pull_request_review event", () => {
      expect(parseEventType("pull_request_review")).toBe("pull_request_review");
    });

    test("should parse pull_request_review_comment event", () => {
      expect(parseEventType("pull_request_review_comment")).toBe("pull_request_review_comment");
    });

    test("should parse ping event", () => {
      expect(parseEventType("ping")).toBe("ping");
    });

    test("should return null for unsupported events", () => {
      expect(parseEventType("push")).toBeNull();
      expect(parseEventType("issues")).toBeNull();
      expect(parseEventType("pull_request")).toBeNull();
    });

    test("should return null for null input", () => {
      expect(parseEventType(null)).toBeNull();
    });
  });

  describe("containsBotMention", () => {
    test("should detect bot mention with @", () => {
      expect(containsBotMention("@claude-intern please fix this", "claude-intern")).toBe(true);
    });

    test("should detect bot mention case-insensitively", () => {
      expect(containsBotMention("@Claude-Intern please fix this", "claude-intern")).toBe(true);
    });

    test("should detect bot mention in middle of text", () => {
      expect(containsBotMention("Hey @claude-intern can you help?", "claude-intern")).toBe(true);
    });

    test("should not match partial bot names", () => {
      expect(containsBotMention("@claude please fix this", "claude-intern")).toBe(false);
    });

    test("should return false for null text", () => {
      expect(containsBotMention(null, "claude-intern")).toBe(false);
    });

    test("should return false for empty text", () => {
      expect(containsBotMention("", "claude-intern")).toBe(false);
    });

    test("should return false when no bot name provided", () => {
      expect(containsBotMention("@claude-intern fix this", undefined)).toBe(false);
    });

    test("should handle bot names with hyphens and numbers", () => {
      expect(containsBotMention("@my-bot-123 fix this", "my-bot-123")).toBe(true);
    });
  });

  describe("reviewMentionsBot", () => {
    const baseEvent: PullRequestReviewEvent = {
      action: "submitted",
      review: {
        id: 1,
        user: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
        body: "Please fix these issues",
        state: "changes_requested",
        commit_id: "abc123",
        submitted_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1#pullrequestreview-1",
      },
      pull_request: {
        number: 1,
        title: "Test PR",
        body: null,
        state: "open",
        html_url: "https://github.com/owner/repo/pull/1",
        user: { login: "author", id: 2, avatar_url: "", type: "User" },
        head: {
          ref: "feature-branch",
          sha: "abc123",
          repo: {
            id: 1,
            name: "repo",
            full_name: "owner/repo",
            private: false,
            owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
            html_url: "https://github.com/owner/repo",
            default_branch: "main",
          },
        },
        base: {
          ref: "main",
          sha: "def456",
          repo: {
            id: 1,
            name: "repo",
            full_name: "owner/repo",
            private: false,
            owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
            html_url: "https://github.com/owner/repo",
            default_branch: "main",
          },
        },
      },
      repository: {
        id: 1,
        name: "repo",
        full_name: "owner/repo",
        private: false,
        owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
        html_url: "https://github.com/owner/repo",
        default_branch: "main",
      },
      sender: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
    };

    test("should detect bot mention in review body", () => {
      const event = {
        ...baseEvent,
        review: {
          ...baseEvent.review,
          body: "@claude-intern please fix these issues",
        },
      };

      expect(reviewMentionsBot(event, [], "claude-intern")).toBe(true);
    });

    test("should detect bot mention in comment", () => {
      const comments: ProcessedReviewComment[] = [{
        id: 1,
        path: "src/index.ts",
        line: 10,
        side: "RIGHT",
        diffHunk: "@@",
        body: "@claude-intern fix this",
        reviewer: "reviewer",
        isReply: false,
      }];

      expect(reviewMentionsBot(baseEvent, comments, "claude-intern")).toBe(true);
    });

    test("should return false when no mention found", () => {
      expect(reviewMentionsBot(baseEvent, [], "claude-intern")).toBe(false);
    });

    test("should return false when bot name not provided", () => {
      const event = {
        ...baseEvent,
        review: {
          ...baseEvent.review,
          body: "@claude-intern please fix these issues",
        },
      };

      expect(reviewMentionsBot(event, [], undefined)).toBe(false);
    });
  });

  describe("shouldProcessReview", () => {
    const baseEvent: PullRequestReviewEvent = {
      action: "submitted",
      review: {
        id: 1,
        user: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
        body: "Please fix these issues",
        state: "changes_requested",
        commit_id: "abc123",
        submitted_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1#pullrequestreview-1",
      },
      pull_request: {
        number: 1,
        title: "Test PR",
        body: null,
        state: "open",
        html_url: "https://github.com/owner/repo/pull/1",
        user: { login: "author", id: 2, avatar_url: "", type: "User" },
        head: {
          ref: "feature-branch",
          sha: "abc123",
          repo: {
            id: 1,
            name: "repo",
            full_name: "owner/repo",
            private: false,
            owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
            html_url: "https://github.com/owner/repo",
            default_branch: "main",
          },
        },
        base: {
          ref: "main",
          sha: "def456",
          repo: {
            id: 1,
            name: "repo",
            full_name: "owner/repo",
            private: false,
            owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
            html_url: "https://github.com/owner/repo",
            default_branch: "main",
          },
        },
      },
      repository: {
        id: 1,
        name: "repo",
        full_name: "owner/repo",
        private: false,
        owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
        html_url: "https://github.com/owner/repo",
        default_branch: "main",
      },
      sender: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
    };

    test("should process changes_requested review on open PR (no bot mention check)", () => {
      expect(shouldProcessReview(baseEvent)).toBe(true);
    });

    test("should not process approved review", () => {
      const event = {
        ...baseEvent,
        review: { ...baseEvent.review, state: "approved" as const },
      };
      expect(shouldProcessReview(event)).toBe(false);
    });

    test("should not process commented review", () => {
      const event = {
        ...baseEvent,
        review: { ...baseEvent.review, state: "commented" as const },
      };
      expect(shouldProcessReview(event)).toBe(false);
    });

    test("should not process review on closed PR", () => {
      const event = {
        ...baseEvent,
        pull_request: { ...baseEvent.pull_request, state: "closed" as const },
      };
      expect(shouldProcessReview(event)).toBe(false);
    });

    test("should not process review from bot", () => {
      const event = {
        ...baseEvent,
        review: {
          ...baseEvent.review,
          user: { ...baseEvent.review.user, type: "Bot" as const },
        },
      };
      expect(shouldProcessReview(event)).toBe(false);
    });

    test("should process when bot is mentioned in review body", () => {
      const event = {
        ...baseEvent,
        review: {
          ...baseEvent.review,
          body: "@claude-intern please fix these issues",
        },
      };

      expect(shouldProcessReview(event, {
        requireBotMention: true,
        botName: "claude-intern",
      })).toBe(true);
    });

    test("should process when bot is mentioned in comment", () => {
      const comments: ProcessedReviewComment[] = [{
        id: 1,
        path: "src/index.ts",
        line: 10,
        side: "RIGHT",
        diffHunk: "@@",
        body: "@claude-intern fix this please",
        reviewer: "reviewer",
        isReply: false,
      }];

      expect(shouldProcessReview(baseEvent, {
        requireBotMention: true,
        botName: "claude-intern",
        comments,
      })).toBe(true);
    });

    test("should not process when bot mention required but not present", () => {
      expect(shouldProcessReview(baseEvent, {
        requireBotMention: true,
        botName: "claude-intern",
      })).toBe(false);
    });

    test("should not process when bot mention required but bot name not provided", () => {
      expect(shouldProcessReview(baseEvent, {
        requireBotMention: true,
      })).toBe(false);
    });
  });

  describe("processReviewEvent", () => {
    test("should extract review information correctly", () => {
      const event: PullRequestReviewEvent = {
        action: "submitted",
        review: {
          id: 123,
          user: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
          body: "Please fix these issues",
          state: "changes_requested",
          commit_id: "abc123",
          submitted_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/1#pullrequestreview-123",
        },
        pull_request: {
          number: 42,
          title: "Add new feature",
          body: "Description",
          state: "open",
          html_url: "https://github.com/owner/repo/pull/42",
          user: { login: "author", id: 2, avatar_url: "", type: "User" },
          head: {
            ref: "feature-branch",
            sha: "abc123",
            repo: {
              id: 1,
              name: "repo",
              full_name: "owner/repo",
              private: false,
              owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
              html_url: "https://github.com/owner/repo",
              default_branch: "main",
            },
          },
          base: {
            ref: "main",
            sha: "def456",
            repo: {
              id: 1,
              name: "repo",
              full_name: "owner/repo",
              private: false,
              owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
              html_url: "https://github.com/owner/repo",
              default_branch: "main",
            },
          },
        },
        repository: {
          id: 1,
          name: "repo",
          full_name: "owner/repo",
          private: false,
          owner: { login: "owner", id: 1, avatar_url: "", type: "User" },
          html_url: "https://github.com/owner/repo",
          default_branch: "main",
        },
        sender: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
        installation: { id: 456, account: { login: "org", id: 3, avatar_url: "", type: "Organization" } },
      };

      const result = processReviewEvent(event);

      expect(result.prNumber).toBe(42);
      expect(result.prTitle).toBe("Add new feature");
      expect(result.repository).toBe("owner/repo");
      expect(result.branch).toBe("feature-branch");
      expect(result.reviewer).toBe("reviewer");
      expect(result.reviewState).toBe("changes_requested");
      expect(result.reviewBody).toBe("Please fix these issues");
      expect(result.installationId).toBe(456);
      expect(result.comments).toEqual([]);
    });
  });

  describe("processReviewComment", () => {
    test("should process comment correctly", () => {
      const comment: GitHubReviewComment = {
        id: 789,
        pull_request_review_id: 123,
        diff_hunk: "@@ -1,5 +1,6 @@\n const foo = 1;",
        path: "src/index.ts",
        position: 5,
        original_position: 5,
        line: 10,
        original_line: 10,
        start_line: null,
        original_start_line: null,
        side: "RIGHT",
        start_side: null,
        body: "Please add error handling here",
        user: { login: "reviewer", id: 1, avatar_url: "", type: "User" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1#discussion_r789",
      };

      const result = processReviewComment(comment);

      expect(result.id).toBe(789);
      expect(result.path).toBe("src/index.ts");
      expect(result.line).toBe(10);
      expect(result.side).toBe("RIGHT");
      expect(result.diffHunk).toBe("@@ -1,5 +1,6 @@\n const foo = 1;");
      expect(result.body).toBe("Please add error handling here");
      expect(result.reviewer).toBe("reviewer");
      expect(result.isReply).toBe(false);
    });

    test("should detect reply comments", () => {
      const comment: GitHubReviewComment = {
        id: 790,
        pull_request_review_id: 123,
        diff_hunk: "@@ -1,5 +1,6 @@\n const foo = 1;",
        path: "src/index.ts",
        position: null,
        original_position: null,
        line: null,
        original_line: 10,
        start_line: null,
        original_start_line: null,
        side: "RIGHT",
        start_side: null,
        body: "Good point, will fix",
        user: { login: "author", id: 2, avatar_url: "", type: "User" },
        created_at: "2024-01-01T01:00:00Z",
        updated_at: "2024-01-01T01:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1#discussion_r790",
        in_reply_to_id: 789,
      };

      const result = processReviewComment(comment);
      expect(result.isReply).toBe(true);
      expect(result.line).toBe(10); // Falls back to original_line
    });
  });

  describe("RateLimiter", () => {
    test("should allow requests under limit", () => {
      const limiter = new RateLimiter(1000, 5); // 5 requests per second

      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
    });

    test("should block requests over limit", () => {
      const limiter = new RateLimiter(1000, 3); // 3 requests per second

      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(false);
    });

    test("should track different IPs separately", () => {
      const limiter = new RateLimiter(1000, 2);

      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(true);
      expect(limiter.isAllowed("192.168.1.1")).toBe(false);

      // Different IP should still be allowed
      expect(limiter.isAllowed("192.168.1.2")).toBe(true);
    });

    test("should report remaining requests", () => {
      const limiter = new RateLimiter(1000, 5);

      expect(limiter.getRemaining("192.168.1.1")).toBe(5);
      limiter.isAllowed("192.168.1.1");
      expect(limiter.getRemaining("192.168.1.1")).toBe(4);
    });
  });

  describe("isGitHubIP", () => {
    test("should accept GitHub webhook IPs", () => {
      // These are within GitHub's published ranges
      expect(isGitHubIP("140.82.112.1")).toBe(true);
      expect(isGitHubIP("143.55.64.1")).toBe(true);
      expect(isGitHubIP("185.199.108.1")).toBe(true);
      expect(isGitHubIP("192.30.252.1")).toBe(true);
    });

    test("should reject non-GitHub IPs", () => {
      expect(isGitHubIP("192.168.1.1")).toBe(false);
      expect(isGitHubIP("10.0.0.1")).toBe(false);
      expect(isGitHubIP("8.8.8.8")).toBe(false);
    });

    test("should handle IPv6-mapped IPv4 addresses", () => {
      expect(isGitHubIP("::ffff:140.82.112.1")).toBe(true);
      expect(isGitHubIP("::ffff:192.168.1.1")).toBe(false);
    });

    test("should handle invalid IPs gracefully", () => {
      expect(isGitHubIP("invalid")).toBe(false);
      expect(isGitHubIP("")).toBe(false);
      expect(isGitHubIP("256.256.256.256")).toBe(false);
    });
  });
});
