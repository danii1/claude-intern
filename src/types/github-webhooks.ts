/**
 * GitHub Webhook Event Types
 *
 * These types represent the webhook payloads sent by GitHub for PR review events.
 * Reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads
 */

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  type: "User" | "Bot" | "Organization";
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubUser;
  html_url: string;
  default_branch: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  user: GitHubUser;
  head: {
    ref: string;
    sha: string;
    repo: GitHubRepository;
  };
  base: {
    ref: string;
    sha: string;
    repo: GitHubRepository;
  };
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  body: string | null;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  commit_id: string;
  submitted_at: string;
  html_url: string;
}

export interface GitHubReviewComment {
  id: number;
  pull_request_review_id: number;
  diff_hunk: string;
  path: string;
  position: number | null;
  original_position: number | null;
  line: number | null;
  original_line: number | null;
  start_line: number | null;
  original_start_line: number | null;
  side: "LEFT" | "RIGHT";
  start_side: "LEFT" | "RIGHT" | null;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  in_reply_to_id?: number;
}

export interface GitHubInstallation {
  id: number;
  account: GitHubUser;
}

/**
 * Pull Request Review Event
 * Triggered when a review is submitted, edited, or dismissed.
 */
export interface PullRequestReviewEvent {
  action: "submitted" | "edited" | "dismissed";
  review: GitHubReview;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
  installation?: GitHubInstallation;
}

/**
 * Pull Request Review Comment Event
 * Triggered when a review comment is created, edited, or deleted.
 */
export interface PullRequestReviewCommentEvent {
  action: "created" | "edited" | "deleted";
  comment: GitHubReviewComment;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
  installation?: GitHubInstallation;
}

/**
 * Union type for all supported webhook events
 */
export type WebhookEvent = PullRequestReviewEvent | PullRequestReviewCommentEvent;

/**
 * Webhook event type identifiers (from X-GitHub-Event header)
 */
export type WebhookEventType = "pull_request_review" | "pull_request_review_comment" | "ping";

/**
 * Ping event sent when webhook is first configured
 */
export interface PingEvent {
  zen: string;
  hook_id: number;
  hook: {
    type: string;
    id: number;
    name: string;
    active: boolean;
    events: string[];
    config: {
      content_type: string;
      url: string;
    };
  };
  repository?: GitHubRepository;
  sender: GitHubUser;
}

/**
 * Result of webhook signature verification
 */
export interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Processed review feedback ready for Claude
 */
export interface ProcessedReviewFeedback {
  prNumber: number;
  prTitle: string;
  repository: string;
  branch: string;
  reviewer: string;
  reviewState: GitHubReview["state"];
  reviewBody: string | null;
  comments: ProcessedReviewComment[];
  conversationComments?: ProcessedConversationComment[];
  installationId?: number;
}

export interface ProcessedReviewComment {
  id: number;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  diffHunk: string;
  body: string;
  reviewer: string;
  isReply: boolean;
}

export interface ProcessedConversationComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

/**
 * Webhook server configuration
 */
export interface WebhookServerConfig {
  port: number;
  host: string;
  webhookSecret: string;
  autoReply: boolean;
  validateIp: boolean;
  debug: boolean;
}

/**
 * Result of processing a webhook event
 */
export interface WebhookProcessingResult {
  success: boolean;
  message: string;
  prNumber?: number;
  repository?: string;
  error?: Error;
}
