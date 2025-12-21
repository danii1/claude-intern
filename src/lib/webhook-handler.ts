/**
 * Webhook Handler
 *
 * Handles GitHub webhook signature verification and event routing.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type {
  PingEvent,
  ProcessedReviewComment,
  ProcessedReviewFeedback,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
  SignatureVerificationResult,
  WebhookEventType,
  WebhookProcessingResult,
} from "../types/github-webhooks";

/**
 * Verify GitHub webhook signature using HMAC-SHA256.
 *
 * GitHub signs webhook payloads with the secret you configure.
 * The signature is sent in the X-Hub-Signature-256 header.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): SignatureVerificationResult {
  if (!signature) {
    return {
      valid: false,
      error: "Missing X-Hub-Signature-256 header",
    };
  }

  if (!signature.startsWith("sha256=")) {
    return {
      valid: false,
      error: "Invalid signature format (expected sha256=...)",
    };
  }

  const expected =
    "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return {
        valid: false,
        error: "Signature length mismatch",
      };
    }

    const valid = timingSafeEqual(signatureBuffer, expectedBuffer);
    return { valid };
  } catch (error) {
    return {
      valid: false,
      error: `Signature verification failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Parse and validate webhook event type from X-GitHub-Event header.
 */
export function parseEventType(
  eventHeader: string | null
): WebhookEventType | null {
  if (!eventHeader) {
    return null;
  }

  const supportedEvents: WebhookEventType[] = [
    "pull_request_review",
    "pull_request_review_comment",
    "ping",
  ];

  if (supportedEvents.includes(eventHeader as WebhookEventType)) {
    return eventHeader as WebhookEventType;
  }

  return null;
}

/**
 * Check if text contains a mention of the bot.
 * Looks for @bot-name patterns.
 */
export function containsBotMention(text: string | null, botName?: string): boolean {
  if (!text) {
    return false;
  }

  if (!botName) {
    // No bot name provided, cannot check for mentions
    return false;
  }

  // Escape special regex characters in bot name
  const escapedName = botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`@${escapedName}\\b`, "i");
  return pattern.test(text);
}

/**
 * Check if a review or its comments mention the bot.
 */
export function reviewMentionsBot(
  event: PullRequestReviewEvent,
  comments: ProcessedReviewComment[] = [],
  botName?: string
): boolean {
  if (!botName) {
    // No bot name provided, cannot check for mentions
    return false;
  }

  // Check review body
  if (containsBotMention(event.review.body, botName)) {
    return true;
  }

  // Check any comments
  for (const comment of comments) {
    if (containsBotMention(comment.body, botName)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a review event should trigger automated processing.
 * Only process "changes_requested" reviews.
 */
export function shouldProcessReview(
  event: PullRequestReviewEvent,
  options: {
    requireBotMention?: boolean;
    botName?: string;
    comments?: ProcessedReviewComment[];
  } = {}
): boolean {
  // Only process when changes are requested
  if (event.review.state !== "changes_requested") {
    return false;
  }

  // Don't process reviews from bots (to avoid loops)
  if (event.review.user.type === "Bot") {
    return false;
  }

  // Only process for open PRs
  if (event.pull_request.state !== "open") {
    return false;
  }

  // If bot mention is required, check for it
  if (options.requireBotMention) {
    if (!reviewMentionsBot(event, options.comments || [], options.botName)) {
      return false;
    }
  }

  return true;
}

/**
 * Process a pull_request_review event into structured feedback.
 */
export function processReviewEvent(
  event: PullRequestReviewEvent,
  comments: ProcessedReviewComment[] = []
): ProcessedReviewFeedback {
  return {
    prNumber: event.pull_request.number,
    prTitle: event.pull_request.title,
    repository: event.repository.full_name,
    branch: event.pull_request.head.ref,
    reviewer: event.review.user.login,
    reviewState: event.review.state,
    reviewBody: event.review.body,
    comments,
    installationId: event.installation?.id,
  };
}

/**
 * Process a single review comment into structured format.
 */
export function processReviewComment(
  comment: PullRequestReviewCommentEvent["comment"]
): ProcessedReviewComment {
  return {
    id: comment.id,
    path: comment.path,
    line: comment.line ?? comment.original_line,
    side: comment.side,
    diffHunk: comment.diff_hunk,
    body: comment.body,
    reviewer: comment.user.login,
    isReply: comment.in_reply_to_id !== undefined,
  };
}

/**
 * Handle ping event (sent when webhook is first configured).
 */
export function handlePingEvent(event: PingEvent): WebhookProcessingResult {
  console.log(`🏓 Received ping from GitHub: "${event.zen}"`);
  console.log(`   Hook ID: ${event.hook_id}`);
  console.log(`   Events: ${event.hook.events.join(", ")}`);

  return {
    success: true,
    message: `Webhook configured successfully. Zen: ${event.zen}`,
  };
}

/**
 * Simple in-memory rate limiter.
 * Tracks requests per IP within a time window.
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs = 60000, maxRequests = 30) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a request from the given IP should be allowed.
   */
  isAllowed(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get existing requests for this IP
    let ipRequests = this.requests.get(ip) || [];

    // Filter to only requests within the window
    ipRequests = ipRequests.filter((timestamp) => timestamp > windowStart);

    // Check if under limit
    if (ipRequests.length >= this.maxRequests) {
      return false;
    }

    // Record this request
    ipRequests.push(now);
    this.requests.set(ip, ipRequests);

    return true;
  }

  /**
   * Get remaining requests for an IP.
   */
  getRemaining(ip: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const ipRequests = (this.requests.get(ip) || []).filter(
      (timestamp) => timestamp > windowStart
    );
    return Math.max(0, this.maxRequests - ipRequests.length);
  }

  /**
   * Clear old entries to prevent memory leaks.
   * Call periodically (e.g., every minute).
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [ip, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, valid);
      }
    }
  }
}

/**
 * GitHub webhook IP ranges for allowlisting.
 * These can be fetched from https://api.github.com/meta
 * but are hardcoded here for reliability.
 *
 * Last updated: 2024-12
 */
export const GITHUB_WEBHOOK_IP_RANGES = [
  "140.82.112.0/20",
  "143.55.64.0/20",
  "185.199.108.0/22",
  "192.30.252.0/22",
];

/**
 * Check if an IP address is within GitHub's webhook IP ranges.
 * This is a simple check that works for most cases.
 */
export function isGitHubIP(ip: string): boolean {
  // Handle IPv4-mapped IPv6 addresses (e.g., ::ffff:192.30.252.1)
  const normalizedIp = ip.replace(/^::ffff:/, "");

  // Simple CIDR check for GitHub ranges
  for (const range of GITHUB_WEBHOOK_IP_RANGES) {
    if (isIpInCidr(normalizedIp, range)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an IP is within a CIDR range.
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = -1 << (32 - parseInt(bits, 10));

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);

  if (ipNum === null || rangeNum === null) {
    return false;
  }

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Convert an IPv4 address string to a number.
 */
function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let num = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return null;
    }
    num = (num << 8) + octet;
  }

  return num >>> 0; // Convert to unsigned
}
