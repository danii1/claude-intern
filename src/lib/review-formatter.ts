/**
 * Review Formatter
 *
 * Formats PR review feedback into structured prompts for Claude.
 */

import type {
  ProcessedReviewComment,
  ProcessedReviewFeedback,
} from "../types/github-webhooks";

/**
 * Format review feedback into a Claude prompt.
 */
export function formatReviewPrompt(feedback: ProcessedReviewFeedback): string {
  const lines: string[] = [];

  // Header
  lines.push("# PR Review Feedback - Address Required Changes");
  lines.push("");

  // PR Information
  lines.push("## PR Information");
  lines.push("");
  lines.push(`- **Repository:** ${feedback.repository}`);
  lines.push(`- **PR #${feedback.prNumber}:** ${feedback.prTitle}`);
  lines.push(`- **Branch:** \`${feedback.branch}\``);
  lines.push(`- **Reviewer:** @${feedback.reviewer}`);
  lines.push(`- **Review Status:** ${formatReviewState(feedback.reviewState)}`);
  lines.push("");

  // Overall review comment (if any)
  if (feedback.reviewBody && feedback.reviewBody.trim()) {
    lines.push("## Overall Review Comment");
    lines.push("");
    lines.push(feedback.reviewBody);
    lines.push("");
  }

  // Individual file comments
  if (feedback.comments.length > 0) {
    lines.push("## File-Specific Feedback");
    lines.push("");

    // Group comments by file
    const commentsByFile = groupCommentsByFile(feedback.comments);

    for (const [filePath, fileComments] of Object.entries(commentsByFile)) {
      lines.push(`### \`${filePath}\``);
      lines.push("");

      for (const comment of fileComments) {
        lines.push(formatSingleComment(comment));
        lines.push("");
      }
    }
  }

  // Instructions
  lines.push("## Instructions");
  lines.push("");
  lines.push("Please address each piece of feedback above by making the necessary code changes.");
  lines.push("");
  lines.push("**Guidelines:**");
  lines.push("1. Address each comment systematically, starting from the first file");
  lines.push("2. Make minimal, focused changes that directly address the feedback");
  lines.push("3. If a suggestion is unclear or you disagree, explain your reasoning");
  lines.push("4. Ensure your changes don't break existing functionality");
  lines.push("5. Run any relevant tests to verify your changes");
  lines.push("");
  lines.push("**IMPORTANT:**");
  lines.push("- After making your changes, commit them with a descriptive message");
  lines.push("- Your commit message should summarize what changes you made to address the feedback");
  lines.push("- Do NOT push to the remote - that will be done automatically");

  return lines.join("\n");
}

/**
 * Format review state into human-readable text.
 */
function formatReviewState(state: ProcessedReviewFeedback["reviewState"]): string {
  switch (state) {
    case "approved":
      return "✅ Approved";
    case "changes_requested":
      return "🔄 Changes Requested";
    case "commented":
      return "💬 Commented";
    case "dismissed":
      return "❌ Dismissed";
    case "pending":
      return "⏳ Pending";
    default:
      return state;
  }
}

/**
 * Group comments by file path.
 */
function groupCommentsByFile(
  comments: ProcessedReviewComment[]
): Record<string, ProcessedReviewComment[]> {
  const grouped: Record<string, ProcessedReviewComment[]> = {};

  for (const comment of comments) {
    if (!grouped[comment.path]) {
      grouped[comment.path] = [];
    }
    grouped[comment.path].push(comment);
  }

  // Sort comments within each file by line number
  for (const filePath of Object.keys(grouped)) {
    grouped[filePath].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }

  return grouped;
}

/**
 * Format a single review comment with context.
 */
function formatSingleComment(comment: ProcessedReviewComment): string {
  const lines: string[] = [];

  // Line reference
  const lineRef = comment.line ? `Line ${comment.line}` : "General";
  lines.push(`**${lineRef}** (by @${comment.reviewer}):`);
  lines.push("");

  // Diff context (code block)
  if (comment.diffHunk) {
    const language = detectLanguage(comment.path);
    lines.push("```" + language);
    lines.push(comment.diffHunk);
    lines.push("```");
    lines.push("");
  }

  // The actual feedback
  lines.push(`> ${comment.body.split("\n").join("\n> ")}`);

  return lines.join("\n");
}

/**
 * Detect programming language from file extension for syntax highlighting.
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    md: "markdown",
    sql: "sql",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    vue: "vue",
    svelte: "svelte",
  };

  return languageMap[ext || ""] || "diff";
}

/**
 * Format a summary of changes made for posting as a reply.
 */
export function formatReplyMessage(
  comment: ProcessedReviewComment,
  wasAddressed: boolean
): string {
  if (wasAddressed) {
    return `✅ Addressed this feedback in the latest commit.`;
  }
  return `⏳ Noted - will address this in a follow-up.`;
}

/**
 * Format a summary comment for the entire review.
 */
export function formatReviewSummaryReply(
  commentsAddressed: number,
  totalComments: number,
  changesSummary?: string
): string {
  const lines: string[] = [];

  lines.push("## 🤖 Claude Intern - Review Feedback Addressed");
  lines.push("");

  if (commentsAddressed === totalComments) {
    lines.push(`✅ All ${totalComments} comment(s) have been addressed in the latest commit.`);
  } else {
    lines.push(`📝 Addressed ${commentsAddressed} of ${totalComments} comment(s).`);
    if (commentsAddressed < totalComments) {
      lines.push("");
      lines.push("Some comments may require manual attention or clarification.");
    }
  }

  // Include changes summary if provided
  if (changesSummary) {
    lines.push("");
    lines.push(changesSummary);
  }

  lines.push("");
  lines.push("---");
  lines.push("*This response was automatically generated by [Claude Intern](https://github.com/danii1/claude-intern)*");

  return lines.join("\n");
}

/**
 * Create a minimal prompt for addressing a single comment.
 */
export function formatSingleCommentPrompt(
  comment: ProcessedReviewComment,
  repository: string,
  branch: string
): string {
  const lines: string[] = [];

  lines.push("# Address Single PR Review Comment");
  lines.push("");
  lines.push(`**Repository:** ${repository}`);
  lines.push(`**Branch:** \`${branch}\``);
  lines.push(`**File:** \`${comment.path}\``);
  if (comment.line) {
    lines.push(`**Line:** ${comment.line}`);
  }
  lines.push("");
  lines.push("## Code Context");
  lines.push("");

  if (comment.diffHunk) {
    const language = detectLanguage(comment.path);
    lines.push("```" + language);
    lines.push(comment.diffHunk);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Reviewer Feedback");
  lines.push("");
  lines.push(`> ${comment.body.split("\n").join("\n> ")}`);
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push("1. Make the minimal change needed to address this feedback");
  lines.push("2. Stage your changes with `git add .`");
  lines.push('3. Commit with message: `fix: address PR review feedback`');

  return lines.join("\n");
}
