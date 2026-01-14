#!/usr/bin/env node

/**
 * Webhook Server for Claude Intern
 *
 * Listens for GitHub PR review events and automatically addresses
 * review feedback using Claude.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { join } from "path";
import PQueue from "p-queue";
import { GitHubAppAuth } from "./lib/github-app-auth";
import { GitHubReviewsClient } from "./lib/github-reviews";
import { WebhookQueue } from "./lib/webhook-queue";
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
  ProcessedReviewComment,
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

// Persistent webhook queue (initialized in startWebhookServer)
let webhookQueue: WebhookQueue | null = null;

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

    // Persist event to SQLite before processing (crash resilience)
    let eventId: string | undefined;
    if (webhookQueue) {
      eventId = webhookQueue.enqueue("pull_request_review", event);
      debugLog(config, `Persisted event ${eventId} to queue`);
    }

    // Add to queue for sequential processing (prevents race conditions)
    reviewQueue.add(() => processReviewWithPersistence(eventId, event, config)).catch((error) => {
      console.error("❌ Error processing review:", error);
    });

    const duration = Date.now() - startTime;
    return jsonResponse({
      success: true,
      message: "Review processing started",
      eventId,
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
 * Wrapper for processReviewAsync that handles persistence.
 */
async function processReviewWithPersistence(
  eventId: string | undefined,
  event: PullRequestReviewEvent,
  config: WebhookServerConfig
): Promise<void> {
  // Mark as processing
  if (eventId && webhookQueue) {
    webhookQueue.markProcessing(eventId);
  }

  try {
    await processReviewAsync(event, config);

    // Mark as completed (removes from queue)
    if (eventId && webhookQueue) {
      webhookQueue.markCompleted(eventId);
    }
  } catch (error) {
    // Mark as failed (will retry if under max retries)
    if (eventId && webhookQueue) {
      webhookQueue.markFailed(eventId, (error as Error).message);
    }
    throw error; // Re-throw so the queue's catch handler logs it
  }
}

/**
 * Mark review comments as addressed by adding a hooray reaction.
 */
async function markCommentsAsAddressed(
  client: GitHubReviewsClient,
  owner: string,
  repo: string,
  comments: ProcessedReviewComment[],
  verbose = false
): Promise<void> {
  if (comments.length === 0) {
    return;
  }

  const topLevelComments = comments.filter(c => !c.isReply);
  const replyCount = comments.length - topLevelComments.length;

  if (replyCount > 0) {
    console.log(`   Skipping ${replyCount} reply comment(s) (only marking top-level)`);
  }

  if (topLevelComments.length === 0) {
    console.log(`   No top-level comments to mark`);
    return;
  }

  console.log(`🎉 Marking ${topLevelComments.length} comment(s) as addressed...`);
  let successCount = 0;
  let failCount = 0;

  for (const comment of topLevelComments) {
    try {
      await client.addReactionToComment(owner, repo, comment.id, "hooray");
      successCount++;
    } catch (error) {
      failCount++;
      // Always log failures - they indicate a real problem
      console.warn(`   ⚠️  Failed to add reaction to comment ${comment.id}: ${(error as Error).message}`);
    }
  }

  if (successCount > 0) {
    console.log(`✅ Marked ${successCount} comment(s) as addressed with 🎉 reaction`);
  }
  if (failCount > 0) {
    console.warn(`⚠️  Failed to mark ${failCount} comment(s)`);
  }
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

    // Get GitHub App author info if available (for commit attribution)
    let gitAuthor: { name: string; email: string } | undefined;
    if (!process.env.GITHUB_TOKEN) {
      const githubAppAuth = GitHubAppAuth.fromEnvironment();
      if (githubAppAuth) {
        try {
          gitAuthor = await githubAppAuth.getGitAuthor();
          debugLog(config, `Commits will be authored by: ${gitAuthor.name}`);
        } catch (error) {
          debugLog(config, `Could not get GitHub App author info: ${(error as Error).message}`);
        }
      }
    }

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
    const worktreePath = await prepareRepository(branch, config.debug);

    if (!worktreePath) {
      console.error("❌ Failed to prepare repository");
      return;
    }

    // Set git config for bot author if available (so Claude's commits are attributed to bot)
    if (gitAuthor) {
      await Utils.executeGitCommand(["config", "user.name", gitAuthor.name], { verbose: config.debug, cwd: worktreePath });
      await Utils.executeGitCommand(["config", "user.email", gitAuthor.email], { verbose: config.debug, cwd: worktreePath });
      console.log(`🤖 Git author set to: ${gitAuthor.name}`);
    }

    // Format prompt for Claude
    const prompt = formatReviewPrompt(feedback);

    // Save prompt to file (outside worktree to avoid git issues)
    const promptFile = `/tmp/claude-intern-review-prompt-${prNumber}.md`;
    writeFileSync(promptFile, prompt, "utf8");
    console.log(`💾 Saved review prompt to: ${promptFile}`);

    // Run Claude to address the feedback
    console.log("🤖 Running Claude to address review feedback...");
    const claudeResult = await runClaudeForReview(promptFile, worktreePath);

    // Clean up prompt file
    try {
      unlinkSync(promptFile);
    } catch {
      // Ignore cleanup errors
    }

    // Check for max turns error in output (Claude exits 0 but didn't complete)
    const hitMaxTurns = claudeResult.output?.includes("Reached max turns");

    if (!claudeResult.success) {
      console.error(`❌ Claude failed: ${claudeResult.message}`);
      return;
    }

    if (hitMaxTurns) {
      console.warn("⚠️  Claude hit max turns limit");
    }

    // Check for uncommitted changes (indicates Claude didn't commit)
    const statusResult = await Utils.executeGitCommand(
      ["status", "--porcelain"],
      { verbose: false, cwd: worktreePath }
    );

    const hasUncommittedChanges = statusResult.success && statusResult.output && statusResult.output.trim().length > 0;

    if (hasUncommittedChanges) {
      console.error("❌ Claude left uncommitted changes:");
      console.error(statusResult.output);
      console.error("   This usually means Claude hit max turns or failed to complete the task.");
      return;
    }

    // Check if there are commits to push
    const aheadResult = await Utils.executeGitCommand(
      ["rev-list", "--count", `origin/${branch}..HEAD`],
      { verbose: false, cwd: worktreePath }
    );

    const commitsAhead = parseInt(aheadResult.output?.trim() || "0", 10);

    if (commitsAhead === 0) {
      console.warn("⚠️  No new commits to push - Claude may not have made any changes");
      // Still continue to mark comments as addressed if Claude determined no changes needed
    } else {
      console.log(`📤 Pushing ${commitsAhead} commit(s)...`);
    }

    const pushResult = await Utils.executeGitCommand(
      ["push", "origin", branch],
      { verbose: true, cwd: worktreePath }
    );

    if (!pushResult.success) {
      console.error(`❌ Push failed: ${pushResult.error}`);
      return;
    }

    if (commitsAhead > 0) {
      console.log("✅ Changes pushed successfully");
    }

    // Mark comments as addressed with hooray reaction
    await markCommentsAsAddressed(githubClient, owner, repo, processedComments, config.debug);

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
  branch: string,
  verbose = false
): Promise<string | null> {
  const isGitRepo = await Utils.isGitRepository();
  if (!isGitRepo) {
    console.error("❌ Not in a git repository");
    return null;
  }

  // Prepare the single reusable worktree
  console.log(`   Preparing worktree for ${branch}...`);
  const worktreeResult = await Utils.prepareReviewWorktree(branch, {
    verbose,
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
    const maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS || "500", 10);

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
  const queueStats = webhookQueue?.getStats() || { pending: 0, processing: 0, failed: 0 };
  return jsonResponse({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    queue: queueStats,
  });
}

/**
 * Read the body from a Node.js IncomingMessage.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Send a Web API Response via Node.js ServerResponse.
 */
async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  const body = await response.text();
  res.writeHead(response.status, {
    "Content-Type": response.headers.get("Content-Type") || "application/json",
  });
  res.end(body);
}

/**
 * Start the webhook server.
 */
export async function startWebhookServer(
  config: Partial<WebhookServerConfig> = {}
): Promise<void> {
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

  // Initialize persistent webhook queue
  const dbPath = process.env.WEBHOOK_QUEUE_DB || "/tmp/claude-intern-webhooks/queue.db";
  webhookQueue = new WebhookQueue({
    dbPath,
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || "3", 10),
    verbose: finalConfig.debug,
  });

  console.log("🚀 Starting Claude Intern Webhook Server");
  console.log(`   Port: ${finalConfig.port}`);
  console.log(`   Host: ${finalConfig.host}`);
  console.log(`   Auto-reply: ${finalConfig.autoReply}`);
  console.log(`   IP validation: ${finalConfig.validateIp}`);
  console.log(`   Debug mode: ${finalConfig.debug}`);

  // Log bot username for debugging
  try {
    const githubClient = new GitHubReviewsClient();
    // Use a dummy repo to trigger app info fetch (doesn't need real repo for app auth)
    const botName = await githubClient.getBotUsername("_", "_");
    if (botName) {
      console.log(`   Bot username: @${botName}`);
    } else {
      console.log(`   Bot username: (unknown - using GITHUB_TOKEN or no auth)`);
    }
  } catch (error) {
    console.log(`   Bot username: (failed to determine)`);
  }

  // Log queue stats and recover pending events
  const stats = webhookQueue.getStats();
  console.log(`   Queue DB: ${dbPath}`);
  if (stats.pending > 0 || stats.processing > 0 || stats.failed > 0) {
    console.log(`   Queue stats: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed`);
  }

  // Recover pending/processing events from previous runs
  const pendingEvents = webhookQueue.getPendingEvents();
  if (pendingEvents.length > 0) {
    console.log(`\n🔄 Recovering ${pendingEvents.length} pending event(s) from previous run...`);
    for (const event of pendingEvents) {
      try {
        const payload = JSON.parse(event.payload) as PullRequestReviewEvent;
        console.log(`   Requeueing: PR #${payload.pull_request.number} (${payload.repository.full_name})`);

        // Add to processing queue
        reviewQueue.add(() => processReviewWithPersistence(event.id, payload, finalConfig)).catch((error) => {
          console.error(`❌ Error processing recovered event ${event.id}:`, error);
        });
      } catch (error) {
        console.error(`   ⚠️  Failed to parse event ${event.id}: ${(error as Error).message}`);
        webhookQueue.markFailed(event.id, `Failed to parse: ${(error as Error).message}`);
      }
    }
  }

  console.log("");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const path = url.pathname;
      const method = req.method || "GET";

      // Health check endpoint
      if (path === "/health" && method === "GET") {
        const response = handleHealthCheck();
        sendResponse(res, response);
        return;
      }

      // Webhook endpoint
      if (path === "/webhooks/github" && method === "POST") {
        // Convert Node request to Web Request
        const body = await readBody(req);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) {
            headers.set(key, Array.isArray(value) ? value[0] : value);
          }
        }
        const request = new Request(url.toString(), {
          method: "POST",
          headers,
          body,
        });
        const response = await handleWebhook(request, finalConfig);
        sendResponse(res, response);
        return;
      }

      // Root endpoint (info)
      if (path === "/" && method === "GET") {
        const response = jsonResponse({
          service: "Claude Intern Webhook Server",
          endpoints: {
            webhook: "POST /webhooks/github",
            health: "GET /health",
          },
        });
        sendResponse(res, response);
        return;
      }

      // 404 for unknown routes
      sendResponse(res, jsonResponse({ error: "Not found" }, 404));
    } catch (error) {
      console.error("Server error:", error);
      sendResponse(res, jsonResponse({ error: "Internal server error" }, 500));
    }
  });

  server.listen(finalConfig.port, finalConfig.host);

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
