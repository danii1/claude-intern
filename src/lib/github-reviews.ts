/**
 * GitHub Reviews API Client
 *
 * Handles fetching and responding to PR review comments via the GitHub API.
 */

import type {
  GitHubReviewComment,
  ProcessedReviewComment,
} from "../types/github-webhooks";
import { GitHubAppAuth } from "./github-app-auth";

export interface ReviewsClientConfig {
  token?: string;
  appAuth?: GitHubAppAuth;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  html_url: string;
}

export interface FileContent {
  path: string;
  content: string;
  sha: string;
}

/**
 * Client for interacting with GitHub's PR review APIs.
 */
export class GitHubReviewsClient {
  private baseUrl = "https://api.github.com";
  private token?: string;
  private appAuth?: GitHubAppAuth;

  constructor(config: ReviewsClientConfig = {}) {
    this.token = config.token || process.env.GITHUB_TOKEN;
    this.appAuth = config.appAuth;

    // Try to initialize app auth from environment if no token provided
    if (!this.token && !this.appAuth) {
      this.appAuth = GitHubAppAuth.fromEnvironment() ?? undefined;
    }
  }

  /**
   * Get authentication token for a repository.
   */
  private async getToken(owner: string, repo: string): Promise<string> {
    if (this.token) {
      return this.token;
    }

    if (this.appAuth) {
      return await this.appAuth.getTokenForRepository(owner, repo);
    }

    throw new Error(
      "No GitHub authentication configured. Set GITHUB_TOKEN or configure GitHub App."
    );
  }

  /**
   * Get the bot username for the current GitHub App installation.
   * Returns null if using personal access token or if unable to determine.
   */
  async getBotUsername(owner: string, repo: string): Promise<string | null> {
    try {
      // For GitHub App auth, get the app info directly
      if (this.appAuth) {
        const appInfo = await this.appAuth.getAppInfo();
        return `${appInfo.slug}[bot]`;
      }

      // For personal access tokens, try /user endpoint
      if (this.token) {
        const response = await fetch(`${this.baseUrl}/user`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "claude-intern",
          },
        });

        if (!response.ok) {
          return null;
        }

        const user = (await response.json()) as { login: string; type: string };

        // Only return if it's a Bot type
        if (user.type === "Bot") {
          return user.login;
        }
      }

      return null;
    } catch (error) {
      // Failed to determine bot username, return null
      return null;
    }
  }

  /**
   * Make an authenticated API request.
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    owner: string,
    repo: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getToken(owner, repo);
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "claude-intern",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({
        message: "Unknown error",
      }))) as { message?: string };
      throw new Error(
        `GitHub API error (${response.status}): ${error.message || response.statusText}`
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Get details of a pull request.
   */
  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequestInfo> {
    return this.apiRequest<PullRequestInfo>(
      "GET",
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      owner,
      repo
    );
  }

  /**
   * Get all review comments on a pull request.
   */
  async getPullRequestReviewComments(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubReviewComment[]> {
    // GitHub paginates results, so we need to fetch all pages
    const comments: GitHubReviewComment[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const pageComments = await this.apiRequest<GitHubReviewComment[]>(
        "GET",
        `/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=${perPage}&page=${page}`,
        owner,
        repo
      );

      comments.push(...pageComments);

      if (pageComments.length < perPage) {
        break;
      }

      page++;
    }

    return comments;
  }

  /**
   * Get all reviews for a pull request.
   */
  async getReviews(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Array<{
    id: number;
    state: string;
    body: string | null;
    user: { login: string };
    submitted_at: string;
  }>> {
    return this.apiRequest<Array<{
      id: number;
      state: string;
      body: string | null;
      user: { login: string };
      submitted_at: string;
    }>>(
      "GET",
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      owner,
      repo
    );
  }

  /**
   * Get review comments for a specific review.
   */
  async getReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
    reviewId: number
  ): Promise<GitHubReviewComment[]> {
    // Get all PR comments and filter by review ID
    const allComments = await this.getPullRequestReviewComments(
      owner,
      repo,
      prNumber
    );
    return allComments.filter((c) => c.pull_request_review_id === reviewId);
  }

  /**
   * Reply to a review comment.
   */
  async replyToComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string
  ): Promise<GitHubReviewComment> {
    return this.apiRequest<GitHubReviewComment>(
      "POST",
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
      owner,
      repo,
      { body }
    );
  }

  /**
   * Create a new review comment.
   */
  async createReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    commitId: string,
    path: string,
    line: number,
    side: "LEFT" | "RIGHT" = "RIGHT"
  ): Promise<GitHubReviewComment> {
    return this.apiRequest<GitHubReviewComment>(
      "POST",
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      owner,
      repo,
      {
        body,
        commit_id: commitId,
        path,
        line,
        side,
      }
    );
  }

  /**
   * Post a general comment on a pull request (issue comment, not review comment).
   */
  async postPullRequestComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.apiRequest(
      "POST",
      `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      owner,
      repo,
      { body }
    );
  }

  /**
   * Get issue comments (conversation tab comments) for a pull request.
   */
  async getIssueComments(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Array<{
    id: number;
    body: string;
    user: { login: string };
    created_at: string;
    updated_at: string;
  }>> {
    return this.apiRequest<Array<{
      id: number;
      body: string;
      user: { login: string };
      created_at: string;
      updated_at: string;
    }>>(
      "GET",
      `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      owner,
      repo
    );
  }

  /**
   * Add a reaction to a review comment.
   * Supported reactions: +1, -1, laugh, confused, heart, hooray, rocket, eyes
   */
  async addReactionToComment(
    owner: string,
    repo: string,
    commentId: number,
    reaction: string
  ): Promise<void> {
    await this.apiRequest(
      "POST",
      `/repos/${owner}/${repo}/pulls/comments/${commentId}/reactions`,
      owner,
      repo,
      { content: reaction }
    );
  }

  /**
   * Get reactions for a review comment.
   */
  async getCommentReactions(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<Array<{ content: string; user: { login: string } }>> {
    return this.apiRequest<Array<{ content: string; user: { login: string } }>>(
      "GET",
      `/repos/${owner}/${repo}/pulls/comments/${commentId}/reactions`,
      owner,
      repo
    );
  }

  /**
   * Add a reaction to an issue comment (conversation tab comment).
   * Supported reactions: +1, -1, laugh, confused, heart, hooray, rocket, eyes
   */
  async addReactionToIssueComment(
    owner: string,
    repo: string,
    commentId: number,
    reaction: string
  ): Promise<void> {
    await this.apiRequest(
      "POST",
      `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`,
      owner,
      repo,
      { content: reaction }
    );
  }

  /**
   * Get reactions for an issue comment (conversation tab comment).
   */
  async getIssueCommentReactions(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<Array<{ content: string; user: { login: string } }>> {
    return this.apiRequest<Array<{ content: string; user: { login: string } }>>(
      "GET",
      `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`,
      owner,
      repo
    );
  }

  /**
   * Request a re-review from reviewers.
   */
  async requestReReview(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    await this.apiRequest(
      "POST",
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      owner,
      repo,
      { reviewers }
    );
  }

  /**
   * Get the diff for a pull request.
   */
  async getPullRequestDiff(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<string> {
    const token = await this.getToken(owner, repo);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "claude-intern",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get PR diff: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Get file content from the repository.
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<FileContent | null> {
    try {
      const data = await this.apiRequest<{
        path: string;
        sha: string;
        content: string;
        encoding: string;
      }>(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
        owner,
        repo
      );

      // GitHub returns base64-encoded content
      const content =
        data.encoding === "base64"
          ? Buffer.from(data.content, "base64").toString("utf-8")
          : data.content;

      return {
        path: data.path,
        content,
        sha: data.sha,
      };
    } catch (error) {
      // File might not exist in this ref
      return null;
    }
  }

  /**
   * Convert raw GitHub review comments to processed format.
   */
  processComments(comments: GitHubReviewComment[]): ProcessedReviewComment[] {
    return comments.map((comment) => ({
      id: comment.id,
      path: comment.path,
      line: comment.line ?? comment.original_line,
      side: comment.side,
      diffHunk: comment.diff_hunk,
      body: comment.body,
      reviewer: comment.user.login,
      isReply: comment.in_reply_to_id !== undefined,
    }));
  }

  /**
   * Get the latest unaddressed review comments.
   * Filters out comments that have been replied to by the PR author.
   */
  async getUnaddressedComments(
    owner: string,
    repo: string,
    prNumber: number,
    prAuthor: string
  ): Promise<ProcessedReviewComment[]> {
    const allComments = await this.getPullRequestReviewComments(
      owner,
      repo,
      prNumber
    );

    // Build a set of comment IDs that have been addressed
    // (i.e., the PR author has replied to them)
    const addressedCommentIds = new Set<number>();

    for (const comment of allComments) {
      if (
        comment.user.login === prAuthor &&
        comment.in_reply_to_id !== undefined
      ) {
        addressedCommentIds.add(comment.in_reply_to_id);
      }
    }

    // Filter to unaddressed comments from reviewers (not the PR author)
    const unaddressed = allComments.filter(
      (comment) =>
        comment.user.login !== prAuthor &&
        !addressedCommentIds.has(comment.id) &&
        !comment.in_reply_to_id // Don't include reply chains
    );

    return this.processComments(unaddressed);
  }
}
