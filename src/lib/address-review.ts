/**
 * Address Review Command
 *
 * Manually address PR review feedback by fetching comments and running Claude.
 */

import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { GitHubReviewsClient } from "./github-reviews";
import {
  formatReviewPrompt,
  formatReviewSummaryReply,
} from "./review-formatter";
import { Utils } from "./utils";
import type {
  ProcessedReviewComment,
  ProcessedReviewFeedback,
} from "../types/github-webhooks";

export interface AddressReviewOptions {
  noPush?: boolean;
  noReply?: boolean;
  verbose?: boolean;
}

interface ParsedPRUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Parse a GitHub PR URL into its components.
 */
function parsePRUrl(url: string): ParsedPRUrl {
  // Match URLs like:
  // https://github.com/owner/repo/pull/123
  // https://github.com/owner/repo/pull/123/files
  // https://github.com/owner/repo/pull/123#discussion_r123456
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );

  if (!match) {
    throw new Error(
      `Invalid GitHub PR URL: ${url}\n` +
      `Expected format: https://github.com/owner/repo/pull/123`
    );
  }

  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/**
 * Get the latest review with "changes_requested" state.
 */
async function getLatestChangesRequestedReview(
  client: GitHubReviewsClient,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  reviewId: number;
  reviewer: string;
  body: string | null;
} | null> {
  // Fetch all reviews for the PR using the client
  const reviews = await client.getReviews(owner, repo, prNumber);

  // Find the latest "changes_requested" review
  const changesRequestedReviews = reviews
    .filter((r) => r.state === "CHANGES_REQUESTED")
    .sort(
      (a, b) =>
        new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    );

  if (changesRequestedReviews.length === 0) {
    return null;
  }

  const latest = changesRequestedReviews[0];
  return {
    reviewId: latest.id,
    reviewer: latest.user.login,
    body: latest.body,
  };
}

/**
 * Run Claude to address review feedback.
 */
async function runClaude(
  prompt: string,
  workDir: string,
  verbose: boolean
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS || "25", 10);

    if (verbose) {
      console.log(`   Command: ${claudePath} -p --dangerously-skip-permissions --max-turns ${maxTurns}`);
    }

    let output = "";

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
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });
    }

    if (claude.stderr) {
      claude.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stderr.write(text);
      });
    }

    claude.on("error", (error: NodeJS.ErrnoException) => {
      resolve({
        success: false,
        output: `Failed to run Claude: ${error.message}`,
      });
    });

    claude.on("close", (code: number | null) => {
      resolve({
        success: code === 0,
        output,
      });
    });

    // Send prompt to Claude via stdin
    if (claude.stdin) {
      claude.stdin.write(prompt);
      claude.stdin.end();
    }
  });
}

/**
 * Post a reply comment on the PR.
 */
async function postReplyComment(
  client: GitHubReviewsClient,
  owner: string,
  repo: string,
  prNumber: number,
  commentsAddressed: number,
  totalComments: number
): Promise<void> {
  const body = formatReviewSummaryReply(commentsAddressed, totalComments);

  try {
    await client.postPullRequestComment(owner, repo, prNumber, body);
    console.log("✅ Posted review summary reply");
  } catch (error) {
    console.warn(`⚠️  Failed to post reply: ${(error as Error).message}`);
  }
}

/**
 * Main function to address PR review feedback.
 */
export async function addressReview(
  prUrl: string,
  options: AddressReviewOptions = {}
): Promise<void> {
  const { noPush = false, noReply = false, verbose = false } = options;

  console.log("🔍 Parsing PR URL...");
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  console.log(`   Repository: ${owner}/${repo}`);
  console.log(`   PR #${prNumber}`);

  // Initialize GitHub client
  const githubClient = new GitHubReviewsClient();

  // Get PR details
  console.log("\n📋 Fetching PR details...");
  const pr = await githubClient.getPullRequest(owner, repo, prNumber);
  console.log(`   Title: ${pr.title}`);
  console.log(`   Branch: ${pr.head.ref}`);
  console.log(`   State: ${pr.state}`);

  if (pr.state !== "open") {
    throw new Error(`PR is ${pr.state}, not open. Cannot address review.`);
  }

  // Get latest changes_requested review
  console.log("\n🔎 Looking for changes_requested review...");
  const review = await getLatestChangesRequestedReview(
    githubClient,
    owner,
    repo,
    prNumber
  );

  if (!review) {
    console.log("✅ No pending changes_requested reviews found.");
    return;
  }

  console.log(`   Found review from @${review.reviewer}`);

  // Fetch review comments
  console.log("\n📥 Fetching review comments...");
  const rawComments = await githubClient.getReviewComments(
    owner,
    repo,
    prNumber,
    review.reviewId
  );

  const processedComments: ProcessedReviewComment[] = rawComments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line,
    side: c.side,
    diffHunk: c.diff_hunk,
    body: c.body,
    reviewer: c.user.login,
    isReply: c.in_reply_to_id !== undefined,
  }));

  console.log(`   Found ${processedComments.length} comment(s)`);

  // Build feedback object
  const feedback: ProcessedReviewFeedback = {
    prNumber,
    prTitle: pr.title,
    repository: `${owner}/${repo}`,
    branch: pr.head.ref,
    reviewer: review.reviewer,
    reviewState: "changes_requested",
    reviewBody: review.body,
    comments: processedComments,
  };

  // Checkout the PR branch
  console.log(`\n🌿 Checking out branch: ${pr.head.ref}`);

  // Check if we're in a git repo
  const isGitRepo = await Utils.isGitRepository();
  if (!isGitRepo) {
    throw new Error("Not in a git repository. Please run this command from within the repository.");
  }

  // Fetch and checkout branch
  await Utils.executeGitCommand(["fetch", "origin"], { verbose });

  const checkoutResult = await Utils.executeGitCommand(
    ["checkout", pr.head.ref],
    { verbose }
  );

  if (!checkoutResult.success) {
    // Try to checkout tracking branch
    const trackResult = await Utils.executeGitCommand(
      ["checkout", "-b", pr.head.ref, `origin/${pr.head.ref}`],
      { verbose }
    );

    if (!trackResult.success) {
      throw new Error(`Failed to checkout branch ${pr.head.ref}: ${trackResult.error}`);
    }
  }

  // Pull latest changes
  await Utils.executeGitCommand(["pull", "origin", pr.head.ref], { verbose });

  // Format prompt for Claude
  const prompt = formatReviewPrompt(feedback);

  // Save prompt to file for reference
  const promptFile = join(process.cwd(), ".claude-intern-review-prompt.md");
  writeFileSync(promptFile, prompt, "utf8");
  if (verbose) {
    console.log(`💾 Saved review prompt to: ${promptFile}`);
  }

  // Run Claude
  console.log("\n🤖 Running Claude to address review feedback...");
  const claudeResult = await runClaude(prompt, process.cwd(), verbose);

  if (!claudeResult.success) {
    throw new Error("Claude failed to complete successfully");
  }

  console.log("\n✅ Claude completed successfully");

  // Push changes if requested
  if (!noPush) {
    console.log("\n📤 Pushing changes...");
    const pushResult = await Utils.pushCurrentBranch({ verbose });

    if (!pushResult.success) {
      throw new Error(`Push failed: ${pushResult.message}`);
    }

    console.log("✅ Changes pushed successfully");
  } else {
    console.log("\n⏭️  Skipping push (--no-push flag)");
  }

  // Post reply comment if requested
  if (!noReply && !noPush) {
    console.log("\n💬 Posting review summary reply...");
    await postReplyComment(
      githubClient,
      owner,
      repo,
      prNumber,
      processedComments.length,
      processedComments.length
    );
  } else if (noReply) {
    console.log("\n⏭️  Skipping reply (--no-reply flag)");
  }

  console.log(`\n✅ Successfully addressed review for PR #${prNumber}`);
  console.log(`   View PR: ${prUrl}`);
}
