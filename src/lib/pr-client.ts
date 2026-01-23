import type { AtlassianDocument, JiraIssue } from "../types/jira";
import { GitHubAppAuth } from "./github-app-auth";
import { Utils } from "./utils";

export interface PRInfo {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  repository: string;
}

export interface PRResult {
  success: boolean;
  url?: string;
  message: string;
}

export abstract class PRClient {
  protected token: string;
  protected baseUrl: string;

  constructor(token: string, baseUrl: string) {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  abstract createPullRequest(prInfo: PRInfo): Promise<PRResult>;

  protected createPRTitle(taskKey: string, taskSummary: string): string {
    return `[${taskKey}] ${taskSummary}`;
  }

  protected convertAtlassianDocumentToString(
    doc: AtlassianDocument | string
  ): string {
    if (typeof doc === "string") {
      return doc;
    }

    // Simple conversion - extract text content from Atlassian Document Format
    const extractText = (nodes: any[]): string => {
      if (!nodes) return "";

      return nodes
        .map((node) => {
          if (node.type === "text") {
            return node.text || "";
          }
          if (node.content) {
            return extractText(node.content);
          }
          return "";
        })
        .join("");
    };

    return extractText(doc.content);
  }

  protected createPRBody(
    issue: JiraIssue,
    implementationSummary?: string
  ): string {
    const lines = [
      `## JIRA Task: ${issue.key}`,
      "",
      `**Summary:** ${issue.fields.summary}`,
      "",
    ];

    if (implementationSummary) {
      lines.push("## Implementation Details");
      lines.push("");
      lines.push(implementationSummary);
      lines.push("");
    }

    lines.push("---");
    lines.push("*This PR was automatically created by Claude Intern*");

    return lines.join("\n");
  }
}

export class GitHubPRClient extends PRClient {
  constructor(token: string, baseUrl = "https://api.github.com") {
    super(token, baseUrl);
  }

  async createPullRequest(prInfo: PRInfo): Promise<PRResult> {
    try {
      const [owner, repo] = prInfo.repository.split("/");
      const url = `${this.baseUrl}/repos/${owner}/${repo}/pulls`;

      const response = await Utils.fetchWithRetry(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "claude-intern",
        },
        body: JSON.stringify({
          title: prInfo.title,
          body: prInfo.body,
          head: prInfo.sourceBranch,
          base: prInfo.targetBranch,
          draft: false,
        }),
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({ message: "Unknown error" }))) as any;
        return {
          success: false,
          message: `GitHub PR creation failed: ${
            errorData.message || response.statusText
          }`,
        };
      }

      const data = (await response.json()) as any;
      return {
        success: true,
        url: data.html_url,
        message: `Pull request created successfully: ${data.html_url}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `GitHub PR creation failed: ${(error as Error).message}`,
      };
    }
  }
}

export class BitbucketPRClient extends PRClient {
  private workspace: string;

  constructor(
    token: string,
    workspace: string,
    baseUrl = "https://api.bitbucket.org/2.0"
  ) {
    super(token, baseUrl);
    this.workspace = workspace;
  }

  async createPullRequest(prInfo: PRInfo): Promise<PRResult> {
    try {
      const url = `${this.baseUrl}/repositories/${this.workspace}/${prInfo.repository}/pullrequests`;

      const response = await Utils.fetchWithRetry(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: prInfo.title,
          description: prInfo.body,
          source: {
            branch: {
              name: prInfo.sourceBranch,
            },
          },
          destination: {
            branch: {
              name: prInfo.targetBranch,
            },
          },
          close_source_branch: false,
        }),
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({ error: { message: "Unknown error" } }))) as any;
        return {
          success: false,
          message: `Bitbucket PR creation failed: ${
            errorData.error?.message || response.statusText
          }`,
        };
      }

      const data = (await response.json()) as any;
      return {
        success: true,
        url: data.links.html.href,
        message: `Pull request created successfully: ${data.links.html.href}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Bitbucket PR creation failed: ${(error as Error).message}`,
      };
    }
  }
}

export class PRManager {
  private githubClient?: GitHubPRClient;
  private githubAppAuth?: GitHubAppAuth;

  constructor() {
    // Initialize GitHub client - prefer personal token over App auth
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      this.githubClient = new GitHubPRClient(githubToken);
    } else {
      // Try GitHub App authentication
      const appAuth = GitHubAppAuth.fromEnvironment();
      if (appAuth) {
        this.githubAppAuth = appAuth;
        console.log("🔑 Using GitHub App authentication for PR creation");
      }
    }
  }

  private convertAtlassianDocumentToString(
    doc: AtlassianDocument | string
  ): string {
    if (typeof doc === "string") {
      return doc;
    }

    // Simple conversion - extract text content from Atlassian Document Format
    const extractText = (nodes: any[]): string => {
      if (!nodes) return "";

      return nodes
        .map((node) => {
          if (node.type === "text") {
            return node.text || "";
          }
          if (node.content) {
            return extractText(node.content);
          }
          return "";
        })
        .join("");
    };

    return extractText(doc.content);
  }

  async detectRepository(): Promise<{
    platform: "github" | "bitbucket" | "unknown";
    repository: string;
    workspace?: string;
  }> {
    try {
      // Get remote URL
      const { spawn } = await import("child_process");
      const git = spawn("git", ["remote", "get-url", "origin"]);

      let output = "";
      git.stdout.on("data", (data) => {
        output += data.toString();
      });

      return new Promise((resolve) => {
        git.on("close", () => {
          const remoteUrl = output.trim();

          if (remoteUrl.includes("github.com")) {
            // Extract owner/repo from GitHub URL
            const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
            if (match) {
              return resolve({
                platform: "github",
                repository: `${match[1]}/${match[2]}`,
              });
            }
          } else if (remoteUrl.includes("bitbucket.org")) {
            // Extract workspace/repo from Bitbucket URL
            const match = remoteUrl.match(
              /bitbucket\.org[:/]([^/]+)\/([^/.]+)/
            );
            if (match) {
              return resolve({
                platform: "bitbucket",
                repository: match[2],
                workspace: match[1], // This is the workspace
              });
            }
          }

          resolve({ platform: "unknown", repository: "" });
        });
      });
    } catch (error) {
      return { platform: "unknown", repository: "" };
    }
  }

  async createPullRequest(
    issue: JiraIssue,
    sourceBranch: string,
    targetBranch = "main",
    implementationSummary?: string
  ): Promise<PRResult> {
    const repoInfo = await this.detectRepository();

    if (repoInfo.platform === "unknown") {
      return {
        success: false,
        message: "Could not detect repository platform (GitHub or Bitbucket)",
      };
    }

    const prInfo: PRInfo = {
      title: this.createPRTitle(issue.key, issue.fields.summary),
      body: this.createPRBody(issue, implementationSummary),
      sourceBranch,
      targetBranch,
      repository: repoInfo.repository,
    };

    if (repoInfo.platform === "github") {
      // Use existing client with personal token
      if (this.githubClient) {
        return await this.githubClient.createPullRequest(prInfo);
      }

      // Use GitHub App authentication
      if (this.githubAppAuth) {
        try {
          const [owner, repo] = repoInfo.repository.split("/");
          const token = await this.githubAppAuth.getTokenForRepository(owner, repo);
          const client = new GitHubPRClient(token);
          return await client.createPullRequest(prInfo);
        } catch (error) {
          return {
            success: false,
            message: `GitHub App authentication failed: ${(error as Error).message}`,
          };
        }
      }

      return {
        success: false,
        message:
          "GitHub client not configured. Please set GITHUB_TOKEN or configure GitHub App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PATH).",
      };
    }

    if (repoInfo.platform === "bitbucket") {
      // Create Bitbucket client dynamically with detected workspace
      const bitbucketToken = process.env.BITBUCKET_TOKEN;

      if (!bitbucketToken) {
        return {
          success: false,
          message:
            "Bitbucket client not configured. Please set BITBUCKET_TOKEN environment variable.",
        };
      }

      if (!repoInfo.workspace) {
        return {
          success: false,
          message: "Could not detect Bitbucket workspace from git remote URL.",
        };
      }

      const bitbucketClient = new BitbucketPRClient(
        bitbucketToken,
        repoInfo.workspace
      );
      return await bitbucketClient.createPullRequest(prInfo);
    }

    // This shouldn't be reached since we handle unknown platform at the start
    return {
      success: false,
      message: "Unsupported repository platform.",
    };
  }

  private createPRTitle(taskKey: string, taskSummary: string): string {
    return `[${taskKey}] ${taskSummary}`;
  }

  private createPRBody(
    issue: JiraIssue,
    implementationSummary?: string
  ): string {
    const lines = [
      `## JIRA Task: ${issue.key}`,
      "",
      `**Summary:** ${issue.fields.summary}`,
      "",
    ];

    if (implementationSummary) {
      lines.push("## Implementation Details");
      lines.push("");
      lines.push(implementationSummary);
      lines.push("");
    }

    lines.push("---");
    lines.push("*This PR was automatically created by Claude Intern*");

    return lines.join("\n");
  }
}
