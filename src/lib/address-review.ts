/**
 * Address Review Command
 *
 * Manually address PR review feedback by fetching comments and running Claude.
 */

import { spawn, type ChildProcess } from "child_process";
import { GitHubReviewsClient } from "./github-reviews";
import { GitHubAppAuth } from "./github-app-auth";
import {
  extractClaudeSummary,
  formatReviewPrompt,
  formatReviewSummaryReply,
} from "./review-formatter";
import { Utils } from "./utils";
import { runClaudeToFixGitHook } from "./git-hook-fixer";
import type {
  ProcessedReviewComment,
  ProcessedReviewFeedback,
  ProcessedConversationComment,
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
  submittedAt: string;
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
    submittedAt: latest.submitted_at,
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
 * Mark review comments and conversation comments as addressed and post summary.
 */
async function markCommentsAddressed(
  client: GitHubReviewsClient,
  owner: string,
  repo: string,
  prNumber: number,
  comments: ProcessedReviewComment[],
  conversationComments: ProcessedConversationComment[],
  changesSummary: string
): Promise<void> {
  if (comments.length === 0 && conversationComments.length === 0) {
    return;
  }

  let successCount = 0;

  // Add 🎉 (hooray) reaction to each review comment
  if (comments.length > 0) {
    console.log(`   Marking ${comments.length} review comment(s) as addressed...`);

    for (const comment of comments) {
      // Skip reply comments (only mark top-level comments)
      if (comment.isReply) {
        continue;
      }

      try {
        await client.addReactionToComment(owner, repo, comment.id, "hooray");
        successCount++;
      } catch (error) {
        console.warn(`   ⚠️  Failed to add reaction to review comment ${comment.id}: ${(error as Error).message}`);
      }
    }
  }

  // Add 🎉 (hooray) reaction to each conversation comment
  if (conversationComments.length > 0) {
    console.log(`   Marking ${conversationComments.length} conversation comment(s) as addressed...`);

    for (const comment of conversationComments) {
      try {
        await client.addReactionToIssueComment(owner, repo, comment.id, "hooray");
        successCount++;
      } catch (error) {
        console.warn(`   ⚠️  Failed to add reaction to conversation comment ${comment.id}: ${(error as Error).message}`);
      }
    }
  }

  if (successCount > 0) {
    console.log(`✅ Marked ${successCount} comment(s) as addressed with 🎉 reaction`);
  }

  // Post a single summary comment
  const totalComments = comments.length + conversationComments.length;
  const summaryBody = formatReviewSummaryReply(successCount, totalComments, changesSummary);
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

  // Fetch ALL review comments for the PR (not just from this review)
  console.log("\n📥 Fetching review comments...");
  const rawComments = await githubClient.getPullRequestReviewComments(
    owner,
    repo,
    prNumber
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

  // Fetch conversation comments (issue comments)
  console.log("\n💬 Fetching conversation comments...");
  const rawIssueComments = await githubClient.getIssueComments(owner, repo, prNumber);

  // Filter to only include comments from the reviewer, created after the review
  const reviewSubmittedAt = new Date(review.submittedAt);
  const reviewerIssueComments = rawIssueComments.filter(
    (c) => c.user.login === review.reviewer && new Date(c.created_at) >= reviewSubmittedAt
  );

  // Check which issue comments already have a "hooray" reaction
  const addressedIssueCommentIds = new Set<number>();

  for (const comment of reviewerIssueComments) {
    try {
      const reactions = await githubClient.getIssueCommentReactions(
        owner,
        repo,
        comment.id
      );

      const hasHoorayReaction = reactions.some((r) => r.content === "hooray");
      if (hasHoorayReaction) {
        addressedIssueCommentIds.add(comment.id);
      }
    } catch (error) {
      if (verbose) {
        console.warn(`   ⚠️  Failed to fetch reactions for issue comment ${comment.id}`);
      }
    }
  }

  const processedConversationComments: ProcessedConversationComment[] = reviewerIssueComments
    .filter((c) => !addressedIssueCommentIds.has(c.id))
    .map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user.login,
      createdAt: c.created_at,
    }));

  const totalIssueComments = reviewerIssueComments.length;
  const alreadyAddressedIssue = totalIssueComments - processedConversationComments.length;

  console.log(`   Found ${totalIssueComments} conversation comment(s) from reviewer`);
  if (alreadyAddressedIssue > 0) {
    console.log(`   ${alreadyAddressedIssue} already addressed (skipping)`);
  }
  console.log(`   ${processedConversationComments.length} remaining to address`);

  // If no comments remaining (neither review nor conversation), we're done
  if (processedComments.length === 0 && processedConversationComments.length === 0) {
    console.log("\n✅ All review and conversation comments have been addressed already.");
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
    conversationComments: processedConversationComments.length > 0 ? processedConversationComments : undefined,
  };

  // Prepare the review worktree
  console.log(`\n🌿 Preparing review worktree for branch: ${pr.head.ref}`);

  // Check if we're in a git repo
  const isGitRepo = await Utils.isGitRepository();
  if (!isGitRepo) {
    throw new Error("Not in a git repository. Please run this command from within the repository.");
  }

  // Prepare the single reusable worktree for this review
  const worktreeResult = await Utils.prepareReviewWorktree(pr.head.ref, { verbose });

  if (!worktreeResult.success) {
    throw new Error(`Failed to prepare worktree: ${worktreeResult.error}`);
  }

  const workDir = worktreeResult.path!;
  console.log(`✅ Worktree ready at: ${workDir}`);

  // Format prompt for Claude
  const prompt = formatReviewPrompt(feedback);

  // Set git config for bot author if available (so Claude's commits are attributed to bot)
  let originalGitName: string | null = null;
  let originalGitEmail: string | null = null;

  if (gitAuthor) {
    // Save original git config
    const nameResult = await Utils.executeGitCommand(["config", "user.name"], { verbose: false, cwd: workDir });
    if (nameResult.success && nameResult.output.trim()) {
      originalGitName = nameResult.output.trim();
    }

    const emailResult = await Utils.executeGitCommand(["config", "user.email"], { verbose: false, cwd: workDir });
    if (emailResult.success && emailResult.output.trim()) {
      originalGitEmail = emailResult.output.trim();
    }

    // Set bot author in git config
    await Utils.executeGitCommand(["config", "user.name", gitAuthor.name], { verbose, cwd: workDir });
    await Utils.executeGitCommand(["config", "user.email", gitAuthor.email], { verbose, cwd: workDir });

    if (verbose) {
      console.log(`   Set git config to bot author: ${gitAuthor.name} <${gitAuthor.email}>`);
    }
  }

  try {
    // Run Claude (prompt is passed via stdin, no file created)
    console.log("\n🤖 Running Claude to address review feedback...");
    const claudeResult = await runClaude(prompt, workDir, verbose);

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
      { verbose, cwd: workDir }
    );
    const hasUnpushed = unpushedResult.success && unpushedResult.output.trim().length > 0;

    // Check if there are uncommitted changes (fallback if Claude didn't commit)
    const hasUncommitted = await Utils.hasUncommittedChanges(workDir);

    if (!hasUncommitted && !hasUnpushed) {
      console.log("\n⚠️  No changes were made by Claude");
      console.log(`   View PR: ${prUrl}`);
      return;
    }

    // Get hook retries configuration
    const hookRetries = parseInt(process.env.HOOK_RETRIES || "10", 10);
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const maxTurns = parseInt(process.env.CLAUDE_MAX_TURNS || "500", 10);

    // Prefer Claude's commits, but handle uncommitted changes as fallback
    if (hasUnpushed) {
      console.log("\n✅ Changes committed by Claude");
    } else if (hasUncommitted) {
      console.log("\n📝 Claude left changes uncommitted, committing now...");

      // Try committing with retry logic for git hook failures
      let commitAttempt = 0;
      let commitSuccess = false;

      while (commitAttempt <= hookRetries && !commitSuccess) {
        commitAttempt++;
        const commitResult = await Utils.commitChanges(
          `PR-${prNumber}`,
          `Address review feedback from ${feedback.reviewer}`,
          { verbose, author: gitAuthor, cwd: workDir }
        );

        if (commitResult.success) {
          console.log("✅ Changes committed successfully");
          commitSuccess = true;
          break;
        }

        // Check if this is a git hook error that we can try to fix
        if (commitResult.hookError && commitAttempt <= hookRetries) {
          console.log(`\n⚠️  Git hook failed (attempt ${commitAttempt}/${hookRetries + 1})`);

          // Try to fix the hook error with Claude
          const fixed = await runClaudeToFixGitHook("commit", claudePath, maxTurns, workDir);

          if (fixed) {
            console.log("\n🔄 Retrying commit after Claude fixed the issues...");
            continue;
          } else {
            console.log("\n❌ Could not fix git hook errors automatically");
            break;
          }
        } else {
          // Not a hook error or out of retries
          if (commitAttempt > hookRetries) {
            console.log(`\n❌ Max retries (${hookRetries}) exceeded for git hook fixes`);
          }
          console.error(`\n❌ Failed to commit changes: ${commitResult.message}`);
          throw new Error(`Commit failed: ${commitResult.message}`);
        }
      }

      if (!commitSuccess) {
        throw new Error("Failed to commit changes after retries");
      }
    }

    // Push changes if requested
    if (!noPush) {
      console.log("\n📤 Pushing changes...");

      // Try pushing with retry logic for git hook failures
      let pushAttempt = 0;
      let pushSuccess = false;

      while (pushAttempt <= hookRetries && !pushSuccess) {
        pushAttempt++;
        const pushResult = await Utils.pushCurrentBranch({ verbose, cwd: workDir });

        if (pushResult.success) {
          console.log("✅ Changes pushed successfully");
          pushSuccess = true;
          break;
        }

        // Check if this is a git hook error that we can try to fix
        if (pushResult.hookError && pushAttempt <= hookRetries) {
          console.log(`\n⚠️  Git pre-push hook failed (attempt ${pushAttempt}/${hookRetries + 1})`);

          // Try to fix the hook error with Claude
          const fixed = await runClaudeToFixGitHook("push", claudePath, maxTurns, workDir);

          if (fixed) {
            console.log("\n🔄 Retrying push after Claude fixed and amended the commit...");
            // Claude was instructed to amend the commit, so just retry the push
            continue;
          } else {
            console.log("\n❌ Could not fix git pre-push hook errors automatically");
            break;
          }
        } else {
          // Not a hook error or out of retries
          if (pushAttempt > hookRetries) {
            console.log(`\n❌ Max retries (${hookRetries}) exceeded for git hook fixes`);
          }
          console.error(`\n❌ Failed to push changes: ${pushResult.message}`);
          throw new Error(`Push failed: ${pushResult.message}`);
        }
      }

      if (!pushSuccess) {
        throw new Error("Failed to push changes after retries");
      }
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
        processedConversationComments,
        changesSummary
      );
    } else if (noReply) {
      console.log("\n⏭️  Skipping marking comments (--no-reply flag)");
    }

    console.log(`\n✅ Successfully addressed review for PR #${prNumber}`);
    console.log(`   View PR: ${prUrl}`);
  } finally {
    // Clean up any untracked files left by linters/tools/Claude
    const statusResult = await Utils.executeGitCommand(
      ["status", "--porcelain"],
      { verbose: false, cwd: workDir }
    );

    if (statusResult.success && statusResult.output.trim()) {
      // Check for untracked files (lines starting with "??")
      const untrackedLines = statusResult.output
        .split("\n")
        .filter(line => line.startsWith("??"));

      if (untrackedLines.length > 0) {
        if (verbose) {
          console.log("\n🧹 Cleaning up untracked files...");
          untrackedLines.forEach(line => {
            const file = line.substring(3).trim();
            console.log(`   Removing: ${file}`);
          });
        }

        // Use git clean to remove all untracked files and directories
        // -f: force, -d: directories
        await Utils.executeGitCommand(
          ["clean", "-fd"],
          { verbose: false, cwd: workDir }
        );
      }
    }

    // Restore original git config if we changed it
    if (gitAuthor) {
      if (originalGitName) {
        await Utils.executeGitCommand(["config", "user.name", originalGitName], { verbose: false, cwd: workDir });
      } else {
        await Utils.executeGitCommand(["config", "--unset", "user.name"], { verbose: false, cwd: workDir });
      }

      if (originalGitEmail) {
        await Utils.executeGitCommand(["config", "user.email", originalGitEmail], { verbose: false, cwd: workDir });
      } else {
        await Utils.executeGitCommand(["config", "--unset", "user.email"], { verbose: false, cwd: workDir });
      }

      if (verbose) {
        console.log("   Restored original git config");
      }
    }
  }
}
