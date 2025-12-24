#!/usr/bin/env node

/**
 * Webhook Server for Claude Intern
 *
 * Listens for GitHub PR review events and automatically addresses
 * review feedback using Claude.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { GitHubReviewsClient } from "./lib/github-reviews";
import {
  extractClaudeSummary,
  formatReviewPrompt,
  formatReviewSummaryReply,
} from "./lib/review-formatter";
import { Utils } from "./lib/utils";
import {
  handlePingEvent,
  isGitHubIP,
  parseEventType,
  processReviewComment,
  processReviewEvent,
  RateLimiter,
  shouldProcessReview,
  verifyWebhookSignature,
} from "./lib/webhook-handler";
import type {
  PingEvent,
  ProcessedReviewFeedback,
  PullRequestReviewEvent,
  WebhookServerConfig,
} from "./types/github-webhooks";

// Default configuration
const DEFAULT_CONFIG: WebhookServerConfig = {
  port: parseInt(process.env.WEBHOOK_PORT || "3000", 10),
  host: process.env.WEBHOOK_HOST || "0.0.0.0",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  autoReply: process.env.WEBHOOK_AUTO_REPLY === "true",
  validateIp: process.env.WEBHOOK_VALIDATE_IP === "true",
  debug: process.env.WEBHOOK_DEBUG === "true",
};

// Rate limiter instance
const rateLimiter = new RateLimiter(60000, 30); // 30 requests per minute

// Review processing queue - ensures sequential processing to avoid race conditions
const reviewQueue = new PQueue({ concurrency: 1 });

// Cleanup rate limiter periodically
setInterval(() => rateLimiter.cleanup(), 60000);
// Note: We use a single reusable worktree, so no periodic cleanup needed

/**
 * Log a debug message if debug mode is enabled.
 */
function debugLog(config: WebhookServerConfig, message: string): void {
  if (config.debug) {
    console.log(`[DEBUG] ${message}`);
  }
}

/**
 * Create JSON response helper.
 */
function jsonResponse(
  data: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle incoming webhook request.
 */
async function handleWebhook(
  request: Request,
  config: WebhookServerConfig
): Promise<Response> {
  const startTime = Date.now();

  // Get client IP for rate limiting and logging
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  debugLog(config, `Incoming request from ${clientIp}`);

  // Rate limiting
  if (!rateLimiter.isAllowed(clientIp)) {
    console.log(`⚠️  Rate limit exceeded for ${clientIp}`);
    return jsonResponse(
      { error: "Rate limit exceeded" },
      429
    );
  }

  // IP validation (optional)
  if (config.validateIp && clientIp !== "unknown" && !isGitHubIP(clientIp)) {
    console.log(`⚠️  Request from non-GitHub IP: ${clientIp}`);
    return jsonResponse(
      { error: "Request not from GitHub" },
      403
    );
  }

  // Get raw body for signature verification
  const rawBody = await request.text();

  // Verify webhook signature
  const signature = request.headers.get("x-hub-signature-256");
  const verification = verifyWebhookSignature(
    rawBody,
    signature,
    config.webhookSecret
  );

  if (!verification.valid) {
    console.log(`❌ Signature verification failed: ${verification.error}`);
    return jsonResponse(
      { error: "Invalid signature", details: verification.error },
      401
    );
  }

  debugLog(config, "Signature verified successfully");

  // Parse event type
  const eventType = parseEventType(request.headers.get("x-github-event"));
  if (!eventType) {
    return jsonResponse(
      { error: "Unsupported event type" },
      400
    );
  }

  debugLog(config, `Event type: ${eventType}`);

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return jsonResponse(
      { error: "Invalid JSON payload" },
      400
    );
  }

  // Handle ping event
  if (eventType === "ping") {
    const result = handlePingEvent(payload as PingEvent);
    return jsonResponse({ success: true, message: result.message });
  }

  // Handle pull_request_review event
  if (eventType === "pull_request_review") {
    const event = payload as PullRequestReviewEvent;

    // Initialize GitHub client to get bot name and comments
    const githubClient = new GitHubReviewsClient();
    const [owner, repo] = event.repository.full_name.split("/");

    // Get bot username for mention checking
    const botName = await githubClient.getBotUsername(owner, repo);

    debugLog(config, `Bot username: ${botName || "unknown"}`);

    // Fetch ALL review comments for mention checking (not just from this review)
    const rawComments = await githubClient.getPullRequestReviewComments(
      owner,
      repo,
      event.pull_request.number
    );
    const processedComments = rawComments.map(processReviewComment);

    // Check if we should process this review (including bot mention check)
    if (!shouldProcessReview(event, {
      requireBotMention: true,
      botName: botName || undefined,
      comments: processedComments,
    })) {
      let reason = `state=${event.review.state}, pr_state=${event.pull_request.state}`;

      // Add bot mention info if applicable
      if (botName && event.review.state === "changes_requested" && event.pull_request.state === "open") {
        reason = `No @${botName} mention found in review`;
      }

      console.log(
        `⏭️  Skipping review: ${reason}`
      );
      return jsonResponse({
        success: true,
        message: "Review does not require processing",
        reason,
      });
    }

    console.log(
      `\n🔔 Received changes_requested review for PR #${event.pull_request.number}`
    );
    console.log(`   Repository: ${event.repository.full_name}`);
    console.log(`   Reviewer: ${event.review.user.login}`);
    if (botName) {
      console.log(`   Bot mention: @${botName} detected`);
    }

    // Add to queue for sequential processing (prevents race conditions)
    reviewQueue.add(() => processReviewAsync(event, config)).catch((error) => {
      console.error("❌ Error processing review:", error);
    });

    const duration = Date.now() - startTime;
    return jsonResponse({
      success: true,
      message: "Review processing started",
      prNumber: event.pull_request.number,
      repository: event.repository.full_name,
      processingTime: `${duration}ms`,
    });
  }

  // Handle pull_request_review_comment event (optional - for individual comments)
  if (eventType === "pull_request_review_comment") {
    // For now, we only process full reviews, not individual comments
    // This could be extended to handle real-time comment addressing
    return jsonResponse({
      success: true,
      message: "Individual comment events not processed (use full review events)",
    });
  }

  return jsonResponse({ error: "Unhandled event type" }, 400);
}

/**
 * Process a review asynchronously.
 */
async function processReviewAsync(
  event: PullRequestReviewEvent,
  config: WebhookServerConfig
): Promise<void> {
  const [owner, repo] = event.repository.full_name.split("/");
  const prNumber = event.pull_request.number;
  const branch = event.pull_request.head.ref;

  console.log(`\n📋 Processing review for ${owner}/${repo}#${prNumber}`);

  try {
    // Initialize GitHub client
    const githubClient = new GitHubReviewsClient();

    // Fetch ALL review comments for the PR (not just from this review)
    console.log("📥 Fetching review comments...");
    const allRawComments = await githubClient.getPullRequestReviewComments(
      owner,
      repo,
      prNumber
    );

    console.log(`   Found ${allRawComments.length} total comment(s)`);

    // Filter out comments that have already been addressed (have a "hooray" reaction)
    const addressedCommentIds = new Set<number>();

    for (const comment of allRawComments) {
      try {
        const reactions = await githubClient.getCommentReactions(owner, repo, comment.id);
        const hasHoorayReaction = reactions.some((r) => r.content === "hooray");
        if (hasHoorayReaction) {
          addressedCommentIds.add(comment.id);
        }
      } catch (error) {
        // Ignore errors, treat as not addressed
        debugLog(config, `Failed to fetch reactions for comment ${comment.id}`);
      }
    }

    const rawComments = allRawComments.filter((c) => !addressedCommentIds.has(c.id));
    const alreadyAddressed = allRawComments.length - rawComments.length;

    if (alreadyAddressed > 0) {
      console.log(`   ${alreadyAddressed} already addressed (skipping)`);
    }
    console.log(`   ${rawComments.length} remaining to address`);

    // Process comments
    const processedComments = rawComments.map(processReviewComment);

    // Build feedback object
    const feedback = processReviewEvent(event, processedComments);

    // Prepare the single reusable worktree for this review
    console.log(`🌿 Preparing worktree for branch: ${branch}`);
    const worktreePath = await prepareRepository(branch);

    if (!worktreePath) {
      console.error("❌ Failed to prepare repository");
      return;
    }

    // Format prompt for Claude
    const prompt = formatReviewPrompt(feedback);

    // Save prompt to file
    const promptFile = join(worktreePath, ".claude-intern-review-prompt.md");
    writeFileSync(promptFile, prompt, "utf8");
    console.log(`💾 Saved review prompt to: ${promptFile}`);

    // Run Claude to address the feedback
    console.log("🤖 Running Claude to address review feedback...");
    const claudeResult = await runClaudeForReview(promptFile, worktreePath);

    if (!claudeResult.success) {
      console.error(`❌ Claude failed: ${claudeResult.message}`);
      return;
    }

    console.log("✅ Claude completed successfully");

    // Push changes from worktree
    console.log("📤 Pushing changes...");
    const pushResult = await Utils.executeGitCommand(
      ["push", "origin", branch],
      { verbose: true, cwd: worktreePath }
    );

    if (!pushResult.success) {
      console.error(`❌ Push failed: ${pushResult.error}`);
      return;
    }

    console.log("✅ Changes pushed successfully");

    // Post reply if auto-reply is enabled
    if (config.autoReply) {
      console.log("💬 Posting review summary reply...");
      // Extract summary from Claude's output
      const changesSummary = claudeResult.output
        ? extractClaudeSummary(claudeResult.output)
        : undefined;
      await postReviewReply(githubClient, owner, repo, prNumber, feedback, changesSummary);
    }

    console.log(`\n✅ Successfully addressed review for PR #${prNumber}`);
  } catch (error) {
    console.error(`❌ Error processing review: ${(error as Error).message}`);
    if (config.debug) {
      console.error((error as Error).stack);
    }
  }
  // Note: We don't cleanup the worktree - it's reused across reviews for efficiency
}

/**
 * Prepare the single review worktree for the given branch.
 * Returns the worktree directory path.
 */
async function prepareRepository(
  branch: string
): Promise<string | null> {
  const isGitRepo = await Utils.isGitRepository();
  if (!isGitRepo) {
    console.error("❌ Not in a git repository");
    return null;
  }

  // Prepare the single reusable worktree
  console.log(`   Preparing worktree for ${branch}...`);
  const worktreeResult = await Utils.prepareReviewWorktree(branch, {
    verbose: false,
  });

  if (!worktreeResult.success) {
    console.error(`❌ Failed to prepare worktree: ${worktreeResult.error}`);
    return null;
  }

  console.log(`   Worktree ready at: ${worktreeResult.path}`);
  return worktreeResult.path || null;
}

/**
 * Run Claude to address review feedback.
 */
async function runClaudeForReview(
  promptFile: string,
  workDir: string
): Promise<{ success: boolean; message: string; output?: string }> {
  return new Promise((resolve) => {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS || "25", 10);

    console.log(`   Command: ${claudePath} -p --dangerously-skip-permissions --max-turns ${maxTurns}`);

    let stdoutOutput = "";
    let stderrOutput = "";

    const claude: ChildProcess = spawn(
      claudePath,
      ["-p", "--dangerously-skip-permissions", "--max-turns", maxTurns.toString()],
      {
        cwd: workDir,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    if (claude.stdout) {
      claude.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutOutput += output;
        process.stdout.write(output);
      });
    }

    if (claude.stderr) {
      claude.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        stderrOutput += output;
        process.stderr.write(output);
      });
    }

    claude.on("error", (error: NodeJS.ErrnoException) => {
      resolve({
        success: false,
        message: `Failed to run Claude: ${error.message}`,
      });
    });

    claude.on("close", (code: number | null) => {
      if (code === 0) {
        resolve({
          success: true,
          message: "Claude completed successfully",
          output: stdoutOutput,
        });
      } else {
        resolve({
          success: false,
          message: `Claude exited with code ${code}`,
          output: stdoutOutput,
        });
      }
    });

    // Send prompt content to Claude
    if (claude.stdin) {
      const promptContent = require("fs").readFileSync(promptFile, "utf8");
      claude.stdin.write(promptContent);
      claude.stdin.end();
    }
  });
}

/**
 * Post a summary reply to the review.
 */
async function postReviewReply(
  client: GitHubReviewsClient,
  owner: string,
  repo: string,
  prNumber: number,
  feedback: ProcessedReviewFeedback,
  changesSummary?: string
): Promise<void> {
  try {
    const summary = formatReviewSummaryReply(
      feedback.comments.length,
      feedback.comments.length,
      changesSummary
    );

    // Create a review comment (general comment on the PR)
    // Note: GitHub API doesn't have a direct "reply to review" endpoint,
    // so we create a new issue comment
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.warn("⚠️  No GITHUB_TOKEN for posting reply");
      return;
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "claude-intern",
        },
        body: JSON.stringify({ body: summary }),
      }
    );

    if (response.ok) {
      console.log("✅ Posted review summary reply");
    } else {
      console.warn(`⚠️  Failed to post reply: ${response.statusText}`);
    }
  } catch (error) {
    console.warn(`⚠️  Failed to post review reply: ${(error as Error).message}`);
  }
}

/**
 * Health check handler.
 */
function handleHealthCheck(): Response {
  return jsonResponse({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
}

/**
 * Start the webhook server.
 */
export function startWebhookServer(
  config: Partial<WebhookServerConfig> = {}
): void {
  const finalConfig: WebhookServerConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // Validate configuration
  if (!finalConfig.webhookSecret) {
    console.error("❌ WEBHOOK_SECRET environment variable is required");
    console.error("   Generate one with: openssl rand -hex 32");
    process.exit(1);
  }

  console.log("🚀 Starting Claude Intern Webhook Server");
  console.log(`   Port: ${finalConfig.port}`);
  console.log(`   Host: ${finalConfig.host}`);
  console.log(`   Auto-reply: ${finalConfig.autoReply}`);
  console.log(`   IP validation: ${finalConfig.validateIp}`);
  console.log(`   Debug mode: ${finalConfig.debug}`);
  console.log("");

  const server = Bun.serve({
    port: finalConfig.port,
    hostname: finalConfig.host,

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      // Health check endpoint
      if (path === "/health" && request.method === "GET") {
        return handleHealthCheck();
      }

      // Webhook endpoint
      if (path === "/webhooks/github" && request.method === "POST") {
        return handleWebhook(request, finalConfig);
      }

      // Root endpoint (info)
      if (path === "/" && request.method === "GET") {
        return jsonResponse({
          service: "Claude Intern Webhook Server",
          endpoints: {
            webhook: "POST /webhooks/github",
            health: "GET /health",
          },
        });
      }

      // 404 for unknown routes
      return jsonResponse({ error: "Not found" }, 404);
    },

    error(error: Error): Response {
      console.error("Server error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    },
  });

  console.log(`✅ Server listening on http://${finalConfig.host}:${finalConfig.port}`);
  console.log("");
  console.log("📝 Configure your GitHub App webhook URL to:");
  console.log(`   https://your-domain/webhooks/github`);
  console.log("");
  console.log("Press Ctrl+C to stop the server");
}

// CLI entry point
if (import.meta.main) {
  startWebhookServer();
}

export { DEFAULT_CONFIG };
