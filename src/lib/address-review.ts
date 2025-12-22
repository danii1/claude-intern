/**
 * Address Review Command
 *
 * Manually address PR review feedback by fetching comments and running Claude.
 */

import { spawn, type ChildProcess } from "child_process";
import { GitHubReviewsClient } from "./github-reviews";
import { GitHubAppAuth } from "./github-app-auth";
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
): Promise<{ success: boolean; output: string; maxTurnsReached?: boolean }> {
  return new Promise((resolve) => {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    // Use high default like regular development (500 turns)
    const maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS || "500", 10);

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
      // Check if Claude hit max turns
      const maxTurnsReached = output.includes("Reached max turns");

      resolve({
        success: code === 0 && !maxTurnsReached,
        output,
        maxTurnsReached,
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
 * Extract Claude's summary from its output.
 * Looks for sections like "## Summary" or Claude's final response.
 */
function extractClaudeSummary(output: string): string {
  const MAX_LENGTH = 500;

  // Remove ANSI color codes
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, "");

  // Helper to truncate if needed
  const truncate = (text: string): string => {
    return text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) + "..." : text;
  };

  // Try to find a "Summary" section (## Summary or ## summary)
  const summaryMatch = cleanOutput.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##|\n---|\z)/i);
  if (summaryMatch && summaryMatch[1].trim()) {
    return truncate(summaryMatch[1].trim());
  }

  // Try to find "Changes Made" section (### Changes Made:)
  const changesMatch = cleanOutput.match(/###\s*Changes Made:?\s*\n+([\s\S]*?)(?=\n###|\n##|\n---|\z)/i);
  if (changesMatch && changesMatch[1].trim()) {
    const text = `**Changes Made:**\n${changesMatch[1].trim()}`;
    return truncate(text);
  }

  // Look for a paragraph after "Perfect!" or "I've successfully"
  const successMatch = cleanOutput.match(/(?:Perfect!|I've successfully[^\n]*)\s*\n+([\s\S]*?)(?=\n##|\n###|\z)/);
  if (successMatch && successMatch[1].trim()) {
    return truncate(successMatch[1].trim());
  }

  // Fallback: return a generic message
  return "Addressed review feedback by implementing the requested changes.";
}

/**
 * Mark review comments as addressed and post summary.
 */
async function markCommentsAddressed(
  client: GitHubReviewsClient,
  owner: string,
  repo: string,
  prNumber: number,
  comments: ProcessedReviewComment[],
  changesSummary: string
): Promise<void> {
  if (comments.length === 0) {
    return;
  }

  console.log(`   Marking ${comments.length} review comment(s) as addressed...`);

  let successCount = 0;

  // Add 🎉 (hooray) reaction to each comment
  for (const comment of comments) {
    // Skip reply comments (only mark top-level comments)
    if (comment.isReply) {
      continue;
    }

    try {
      await client.addReactionToComment(owner, repo, comment.id, "hooray");
      successCount++;
    } catch (error) {
      console.warn(`   ⚠️  Failed to add reaction to comment ${comment.id}: ${(error as Error).message}`);
    }
  }

  if (successCount > 0) {
    console.log(`✅ Marked ${successCount} comment(s) as addressed with 🎉 reaction`);
  }

  // Post a single summary comment
  const summaryBody = formatReviewSummaryReply(successCount, comments.length, changesSummary);
  try {
    await client.postPullRequestComment(owner, repo, prNumber, summaryBody);
    console.log("✅ Posted review summary comment");
  } catch (error) {
    console.warn(`⚠️  Failed to post summary: ${(error as Error).message}`);
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

  // Get GitHub App author info if available (for commit attribution)
  let gitAuthor: { name: string; email: string } | undefined;
  if (!process.env.GITHUB_TOKEN) {
    const githubAppAuth = GitHubAppAuth.fromEnvironment();
    if (githubAppAuth) {
      try {
        gitAuthor = await githubAppAuth.getGitAuthor();
        if (verbose) {
          console.log(`🤖 Commits will be authored by: ${gitAuthor.name}`);
        }
      } catch (error) {
        if (verbose) {
          console.warn(`⚠️  Could not get GitHub App author info: ${(error as Error).message}`);
          console.log("   Commits will use local git config instead.");
        }
      }
    }
  }

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

  // Check which comments already have a "hooray" reaction (marked as addressed)
  const addressedCommentIds = new Set<number>();

  for (const comment of rawComments) {
    try {
      const reactions = await githubClient.getCommentReactions(
        owner,
        repo,
        comment.id
      );

      // Check if there's a "hooray" (🎉) reaction
      const hasHoorayReaction = reactions.some((r) => r.content === "hooray");
      if (hasHoorayReaction) {
        addressedCommentIds.add(comment.id);
      }
    } catch (error) {
      // Ignore errors fetching reactions, treat as not addressed
      if (verbose) {
        console.warn(`   ⚠️  Failed to fetch reactions for comment ${comment.id}`);
      }
    }
  }

  const processedComments: ProcessedReviewComment[] = rawComments
    .filter((c) => !addressedCommentIds.has(c.id)) // Filter out already addressed
    .map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line ?? c.original_line,
      side: c.side,
      diffHunk: c.diff_hunk,
      body: c.body,
      reviewer: c.user.login,
      isReply: c.in_reply_to_id !== undefined,
    }));

  const totalComments = rawComments.length;
  const alreadyAddressed = totalComments - processedComments.length;

  console.log(`   Found ${totalComments} comment(s)`);
  if (alreadyAddressed > 0) {
    console.log(`   ${alreadyAddressed} already addressed (skipping)`);
  }
  console.log(`   ${processedComments.length} remaining to address`);

  // If no comments remaining, we're done
  if (processedComments.length === 0) {
    console.log("\n✅ All review comments have been addressed already.");
    console.log(`   View PR: ${prUrl}`);
    return;
  }

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

  // Run Claude (prompt is passed via stdin, no file created)
  console.log("\n🤖 Running Claude to address review feedback...");
  const claudeResult = await runClaude(prompt, process.cwd(), verbose);

  if (claudeResult.maxTurnsReached) {
    console.error("\n❌ Claude reached max turns limit without completing the task");
    throw new Error("Claude reached max turns limit. Increase CLAUDE_MAX_TURNS environment variable.");
  }

  if (!claudeResult.success) {
    console.error("\n❌ Claude failed to complete successfully");
    throw new Error("Claude failed to complete successfully");
  }

  console.log("\n✅ Claude completed successfully");

  // Check if there are unpushed commits (Claude should have committed)
  const unpushedResult = await Utils.executeGitCommand(
    ["log", `origin/${pr.head.ref}..HEAD`, "--oneline"],
    { verbose }
  );
  const hasUnpushed = unpushedResult.success && unpushedResult.output.trim().length > 0;

  // Check if there are uncommitted changes (fallback if Claude didn't commit)
  const hasUncommitted = await Utils.hasUncommittedChanges();

  if (!hasUncommitted && !hasUnpushed) {
    console.log("\n⚠️  No changes were made by Claude");
    console.log(`   View PR: ${prUrl}`);
    return;
  }

  // Prefer Claude's commits, but handle uncommitted changes as fallback
  if (hasUnpushed) {
    console.log("\n✅ Changes committed by Claude");
  } else if (hasUncommitted) {
    console.log("\n📝 Claude left changes uncommitted, committing now...");
    const commitResult = await Utils.commitChanges(
      `PR-${prNumber}`,
      `Address review feedback from ${feedback.reviewer}`,
      { verbose, author: gitAuthor }
    );

    if (!commitResult.success) {
      console.error(`\n❌ Failed to commit changes: ${commitResult.message}`);
      throw new Error(`Commit failed: ${commitResult.message}`);
    }

    console.log("✅ Changes committed successfully");
  }

  // Push changes if requested
  if (!noPush) {
    console.log("\n📤 Pushing changes...");
    const pushResult = await Utils.pushCurrentBranch({ verbose });

    if (!pushResult.success) {
      console.error(`\n❌ Failed to push changes: ${pushResult.message}`);
      throw new Error(`Push failed: ${pushResult.message}`);
    }

    console.log("✅ Changes pushed successfully");
  } else {
    console.log("\n⏭️  Skipping push (--no-push flag)");
  }

  // Mark comments as addressed if requested (only if push succeeded)
  if (!noReply && !noPush) {
    console.log("\n💬 Marking comments as addressed...");

    // Extract summary from Claude's output
    const changesSummary = extractClaudeSummary(claudeResult.output);

    await markCommentsAddressed(
      githubClient,
      owner,
      repo,
      prNumber,
      processedComments,
      changesSummary
    );
  } else if (noReply) {
    console.log("\n⏭️  Skipping marking comments (--no-reply flag)");
  }

  console.log(`\n✅ Successfully addressed review for PR #${prNumber}`);
  console.log(`   View PR: ${prUrl}`);
}
