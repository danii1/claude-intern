import { createSign } from "crypto";
import { readFileSync } from "fs";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
}

interface InstallationToken {
  token: string;
  expiresAt: Date;
}

interface InstallationCache {
  [key: string]: {
    installationId: number;
    token?: InstallationToken;
  };
}

/**
 * GitHub App authentication handler.
 *
 * GitHub Apps use a two-step authentication process:
 * 1. Generate a JWT signed with the App's private key
 * 2. Exchange the JWT for an installation access token for a specific repository
 *
 * Each organization should create their own GitHub App with these permissions:
 * - Repository permissions:
 *   - Contents: Read (to check branches)
 *   - Pull requests: Read and write (to create PRs)
 */
export class GitHubAppAuth {
  private appId: string;
  private privateKey: string;
  private baseUrl: string;
  private cache: InstallationCache = {};

  constructor(config: GitHubAppConfig, baseUrl = "https://api.github.com") {
    this.appId = config.appId;
    this.privateKey = config.privateKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Load GitHub App configuration from environment variables.
   * Returns null if not configured.
   */
  static fromEnvironment(): GitHubAppAuth | null {
    const appId = process.env.GITHUB_APP_ID;
    if (!appId) {
      return null;
    }

    const privateKey = GitHubAppAuth.loadPrivateKey();
    if (!privateKey) {
      return null;
    }

    return new GitHubAppAuth({ appId, privateKey });
  }

  /**
   * Load private key from file path or base64-encoded environment variable.
   */
  private static loadPrivateKey(): string | null {
    // Try file path first
    const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    if (keyPath) {
      try {
        return readFileSync(keyPath, "utf8");
      } catch (error) {
        console.error(`Failed to read GitHub App private key from ${keyPath}: ${error}`);
        return null;
      }
    }

    // Try base64-encoded key
    const keyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
    if (keyBase64) {
      try {
        return Buffer.from(keyBase64, "base64").toString("utf8");
      } catch (error) {
        console.error(`Failed to decode GitHub App private key from base64: ${error}`);
        return null;
      }
    }

    return null;
  }

  /**
   * Generate a JWT for authenticating as the GitHub App.
   * JWTs are valid for up to 10 minutes.
   */
  private generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT"
    };

    const payload = {
      iat: now - 60,        // Issued 60 seconds ago (to handle clock skew)
      exp: now + (10 * 60), // Expires in 10 minutes
      iss: this.appId
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const message = `${encodedHeader}.${encodedPayload}`;

    const signature = createSign("RSA-SHA256")
      .update(message)
      .sign(this.privateKey, "base64url");

    return `${message}.${signature}`;
  }

  /**
   * Base64url encode a string (JWT-compatible encoding).
   */
  private base64url(str: string): string {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Get the installation ID for a specific repository.
   */
  async getInstallationId(owner: string, repo: string): Promise<number> {
    const cacheKey = `${owner}/${repo}`;

    // Check cache first
    if (this.cache[cacheKey]?.installationId) {
      return this.cache[cacheKey].installationId;
    }

    const jwt = this.generateJWT();
    const url = `${this.baseUrl}/repos/${owner}/${repo}/installation`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "claude-intern"
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `GitHub App is not installed on repository ${owner}/${repo}. ` +
          `Please install the App at: https://github.com/apps/YOUR_APP_NAME/installations/new`
        );
      }
      const error = await response.json().catch(() => ({ message: "Unknown error" })) as any;
      throw new Error(`Failed to get installation for ${owner}/${repo}: ${error.message || response.statusText}`);
    }

    const data = await response.json() as any;
    const installationId = data.id;

    // Cache the installation ID
    this.cache[cacheKey] = { installationId };

    return installationId;
  }

  /**
   * Get an installation access token for a specific installation.
   * Tokens are valid for 1 hour.
   */
  async getInstallationToken(installationId: number): Promise<InstallationToken> {
    const jwt = this.generateJWT();
    const url = `${this.baseUrl}/app/installations/${installationId}/access_tokens`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "claude-intern"
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Unknown error" })) as any;
      throw new Error(`Failed to create installation access token: ${error.message || response.statusText}`);
    }

    const data = await response.json() as any;

    return {
      token: data.token,
      expiresAt: new Date(data.expires_at)
    };
  }

  /**
   * Get an access token for a specific repository.
   * This is the main method to use - it handles installation lookup and token caching.
   */
  async getTokenForRepository(owner: string, repo: string): Promise<string> {
    const cacheKey = `${owner}/${repo}`;
    const cached = this.cache[cacheKey];

    // Check if we have a valid cached token (with 5 min buffer)
    if (cached?.token) {
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (cached.token.expiresAt.getTime() > Date.now() + bufferMs) {
        return cached.token.token;
      }
    }

    // Get installation ID (may be cached)
    const installationId = await this.getInstallationId(owner, repo);

    // Get fresh token
    const token = await this.getInstallationToken(installationId);

    // Cache the token
    this.cache[cacheKey] = {
      installationId,
      token
    };

    return token.token;
  }
}
