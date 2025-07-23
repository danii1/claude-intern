import {
  JiraIssue,
  JiraComment,
  JiraCommentsResponse,
  LinkedResource,
  DetailedRelatedIssue,
  FormattedTaskDetails,
  JiraClientConfig,
  AtlassianDocument,
  AtlassianDocumentNode,
  JiraAttachment
} from '../types/jira';
import { JiraFormatter } from './jira-formatter';
import { JiraExtractor } from './jira-extractor';
import { assert } from 'console';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export class JiraClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.email = email;
    this.apiToken = apiToken;

    if (!this.apiToken || this.apiToken.length === 0) {
      throw new Error('API token is required');
    }
  }

  async jiraApiCall(method: string, url: string, body?: any): Promise<any> {
    const fullUrl = `${this.baseUrl}${url}`;
    console.log(`🌐 JIRA API Call: ${method} ${fullUrl}`);

    const authHeader = this.getAuthHeader();
    console.log(`🔐 Auth header: Basic ${authHeader.replace('Basic ', '').substring(0, 10)}...`);

    const response = await fetch(fullUrl, {
      method: method,
      body: body ? Buffer.from(JSON.stringify(body), 'utf-8') : undefined,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': authHeader
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ JIRA API Error: ${response.status} ${response.statusText}`);
      console.log(`   Error details: ${errorText}`);
      throw new Error(`JIRA API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (response.status === 204) {
      console.log(`📄 Received 204 No Content response for ${url}`);
      return null;
    }

    try {
      const jsonResponse = await response.json();
      console.log(`📄 Successfully parsed JSON response for ${url}`);
      return jsonResponse;
    } catch (jsonError) {
      console.error(`❌ Failed to parse JSON response for ${url}: ${jsonError}`);
      throw new Error(`Failed to parse JSON response: ${jsonError}`);
    }
  }

  async searchIssues(jql: string, startAt: number = 0, maxResults: number = 50): Promise<{ issues: JiraIssue[], total: number }> {
    const url = `/rest/api/3/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&expand=names,schema`;
    
    try {
      const response = await this.jiraApiCall('GET', url);
      console.log(`🔍 Found ${response.issues?.length || 0} issues (${response.total} total)`);
      
      return {
        issues: response.issues || [],
        total: response.total || 0
      };
    } catch (error) {
      console.error('Failed to search issues:', error);
      throw new Error(`Failed to search issues with JQL: ${jql}`);
    }
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    console.log(`🔍 Attempting to fetch issue: ${issueKey}`);
    console.log(`📡 JIRA Base URL: ${this.baseUrl}`);
    console.log(`👤 JIRA Email: ${this.email}`);
    console.log(`🔐 API Token: ${this.apiToken ? this.apiToken.substring(0, 4) + '...' + this.apiToken.slice(-4) : 'NOT SET'}`);

    // Test authentication by making a simple request first
    console.log(`🔐 Testing authentication...`);
    try {
      const authTest = await this.jiraApiCall('GET', '/rest/api/3/myself');
      console.log(`✅ Authentication successful - logged in as: ${authTest.displayName} (${authTest.emailAddress})`);
    } catch (authError) {
      console.log(`❌ Authentication test failed: ${authError}`);
      throw authError;
    }

    try {
      console.log(`⏳ Making request to JIRA API...`);
      // Use a simpler expand parameter to ensure we get the essential fields
      const response = await this.jiraApiCall('GET', `/rest/api/3/issue/${issueKey}?expand=renderedFields`);

      console.log(`✅ Successfully fetched issue ${issueKey}`);
      console.log(`📝 Issue summary: ${response.fields?.summary || 'No summary'}`);
      console.log(`🔍 Response keys: ${Object.keys(response)}`);
      console.log(`🔍 Has fields: ${!!response.fields}`);
      if (response.fields) {
        console.log(`🔍 Fields keys: ${Object.keys(response.fields)}`);
      } else {
        console.log(`⚠️  No fields found in response, this might indicate an API issue or permissions problem`);
        console.log(`🔍 Full response structure:`, JSON.stringify(response, null, 2));
      }

      // If fields is missing, try a fallback request without expand
      if (!response.fields) {
        console.log(`🔄 Retrying without expand parameter...`);
        const fallbackResponse = await this.jiraApiCall('GET', `/rest/api/3/issue/${issueKey}`);
        console.log(`🔍 Fallback response has fields: ${!!fallbackResponse.fields}`);
        if (fallbackResponse.fields) {
          // Add renderedFields manually if needed
          fallbackResponse.renderedFields = response.renderedFields || {};
          return fallbackResponse;
        }
      }

      return response;
    } catch (error) {
      console.error(`❌ Error fetching issue ${issueKey}:`, error);
      throw error;
    }
  }

  async getIssueComments(issueKey: string): Promise<JiraComment[]> {
    try {
      const response = await this.jiraApiCall('GET', `/rest/api/3/issue/${issueKey}/comment?expand=renderedBody`);

      // Handle null/undefined response (e.g., 204 No Content)
      if (!response) {
        console.log(`No comments found for ${issueKey} (empty response)`);
        return [];
      }

      // Handle non-object responses
      if (typeof response !== 'object') {
        console.warn(`Unexpected response type when fetching comments for ${issueKey}: ${typeof response}`);
        return [];
      }

      // Return comments array or empty array if no comments
      return response.comments || [];
    } catch (error) {
      console.warn(`Failed to fetch comments for ${issueKey}: ${error}`);
      return [];
    }
  }

  async getIssueAttachments(issueKey: string): Promise<any[]> {
    try {
      const issue = await this.getIssue(issueKey);
      return issue.fields.attachment || [];
    } catch (error) {
      console.warn(`Failed to fetch attachments for ${issueKey}: ${error}`);
      return [];
    }
  }

  /**
   * Download an attachment and save it locally
   */
  async downloadAttachment(attachment: JiraAttachment, outputDir: string): Promise<string> {
    try {
      console.log(`📎 Downloading attachment: ${attachment.filename}...`);

      // Create attachments directory if it doesn't exist
      mkdirSync(outputDir, { recursive: true });

      // Sanitize filename to avoid path traversal and filesystem issues
      const sanitizedFilename = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localPath = path.join(outputDir, sanitizedFilename);

      // Download the attachment content
      const response = await fetch(attachment.content, {
        headers: {
          'Authorization': this.getAuthHeader()
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
      }

      // Save to local file
      const buffer = await response.arrayBuffer();
      writeFileSync(localPath, Buffer.from(buffer));

      console.log(`✅ Downloaded attachment to: ${localPath}`);
      return localPath;
    } catch (error) {
      console.warn(`Failed to download attachment ${attachment.filename}: ${error}`);
      throw error;
    }
  }

  /**
   * Download all attachments for an issue
   */
  async downloadIssueAttachments(issueKey: string, outputDir: string): Promise<Map<string, string>> {
    const attachmentMap = new Map<string, string>();
    
    try {
      const attachments = await this.getIssueAttachments(issueKey);
      
      if (attachments.length === 0) {
        console.log(`📎 No attachments found for ${issueKey}`);
        return attachmentMap;
      }

      console.log(`📎 Found ${attachments.length} attachments for ${issueKey}`);

      for (const attachment of attachments) {
        try {
          const localPath = await this.downloadAttachment(attachment, outputDir);
          // Map original content URL to local path
          attachmentMap.set(attachment.content, localPath);
        } catch (error) {
          console.warn(`Skipping attachment ${attachment.filename}: ${error}`);
        }
      }

      console.log(`✅ Downloaded ${attachmentMap.size}/${attachments.length} attachments for ${issueKey}`);
    } catch (error) {
      console.warn(`Failed to download attachments for ${issueKey}: ${error}`);
    }

    return attachmentMap;
  }

  /**
   * Download all attachments referenced in HTML content (descriptions, comments, etc.)
   */
  async downloadAttachmentsFromContent(htmlContent: string, outputDir: string, existingMap?: Map<string, string>): Promise<Map<string, string>> {
    const attachmentMap = existingMap || new Map<string, string>();
    
    // Extract JIRA attachment URLs from HTML content
    // Pattern: /rest/api/[2|3]/attachment/content/[id] or full URLs
    const attachmentUrlPattern = /(?:https?:\/\/[^\/\s]+)?\/rest\/api\/[23]\/attachment\/content\/(\d+)/g;
    const urls = new Set<string>();
    
    let match;
    while ((match = attachmentUrlPattern.exec(htmlContent)) !== null) {
      const fullUrl = match[0].startsWith('http') ? match[0] : `${this.baseUrl}${match[0]}`;
      urls.add(fullUrl);
    }

    if (urls.size === 0) {
      return attachmentMap;
    }

    console.log(`📎 Found ${urls.size} attachment URLs in content`);

    for (const url of urls) {
      // Skip if already downloaded
      if (attachmentMap.has(url)) {
        continue;
      }

      try {
        // Extract attachment ID and create a temporary attachment object
        const idMatch = url.match(/\/attachment\/content\/(\d+)/);
        if (!idMatch) continue;

        const attachmentId = idMatch[1];
        
        // Fetch attachment metadata first to get filename
        const metadataUrl = url.replace('/content/', '/');
        const metadataResponse = await fetch(metadataUrl, {
          headers: { 'Authorization': this.getAuthHeader() }
        });

        if (!metadataResponse.ok) {
          console.warn(`Failed to fetch attachment metadata for ${attachmentId}`);
          continue;
        }

        const metadata = await metadataResponse.json() as any;
        
        // Create a fake attachment object for download
        const fakeAttachment = {
          id: attachmentId,
          filename: metadata.filename || `attachment-${attachmentId}`,
          content: url,
          size: metadata.size || 0,
          mimeType: metadata.mimeType || 'application/octet-stream',
          created: metadata.created || new Date().toISOString(),
          author: metadata.author || { displayName: 'Unknown' }
        };

        const localPath = await this.downloadAttachment(fakeAttachment, outputDir);
        attachmentMap.set(url, localPath);
        
        console.log(`✅ Downloaded embedded attachment: ${metadata.filename}`);
      } catch (error) {
        console.warn(`Failed to download attachment from ${url}: ${error}`);
      }
    }

    return attachmentMap;
  }

  /**
   * Get authentication header for API calls
   */
  private getAuthHeader(): string {
    if (this.apiToken.includes(':')) {
      return `Basic ${Buffer.from(this.apiToken).toString('base64')}`;
    } else {
      return `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`;
    }
  }

  extractLinkedResources(issue: JiraIssue): LinkedResource[] {
    return JiraExtractor.extractLinkedResources(issue);
  }


  /**
   * Fetch detailed information about related work items (linked issues, subtasks, parent tasks)
   */
  async getRelatedWorkItems(issue: JiraIssue): Promise<DetailedRelatedIssue[]> {
    return JiraExtractor.getRelatedWorkItems(issue, this.getIssue.bind(this));
  }


  /**
   * Post a comment to a JIRA issue
   */
  async postComment(issueKey: string, comment: string): Promise<void> {
    try {
      console.log(`💬 Posting comment to issue ${issueKey}...`);

      const commentBody = {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: comment
                }
              ]
            }
          ]
        }
      };

      await this.jiraApiCall('POST', `/rest/api/3/issue/${issueKey}/comment`, commentBody);
      console.log(`✅ Successfully posted comment to ${issueKey}`);
    } catch (error) {
      console.warn(`Failed to post comment to ${issueKey}: ${error}`);
      throw error;
    }
  }

  /**
   * Post a rich text implementation comment to a JIRA issue
   */
  async postImplementationComment(issueKey: string, claudeOutput: string, taskSummary?: string): Promise<void> {
    try {
      console.log(`💬 Posting implementation comment to issue ${issueKey}...`);

      const content = JiraFormatter.createImplementationCommentADF(claudeOutput, taskSummary);

      const commentBody = {
        body: {
          type: 'doc',
          version: 1,
          content: content
        }
      };

      await this.jiraApiCall('POST', `/rest/api/3/issue/${issueKey}/comment`, commentBody);
      console.log(`✅ Successfully posted implementation comment to ${issueKey}`);
    } catch (error) {
      console.warn(`Failed to post implementation comment to ${issueKey}: ${error}`);
      throw error;
    }
  }

  /**
   * Post a rich text clarity assessment comment to a JIRA issue
   */
  async postClarityComment(issueKey: string, assessment: any): Promise<void> {
    try {
      console.log(`💬 Posting clarity assessment to issue ${issueKey}...`);

      const content = JiraFormatter.createClarityAssessmentADF(assessment);

      const commentBody = {
        body: {
          type: 'doc',
          version: 1,
          content: content
        }
      };

      await this.jiraApiCall('POST', `/rest/api/3/issue/${issueKey}/comment`, commentBody);
      console.log(`✅ Successfully posted clarity assessment to ${issueKey}`);
    } catch (error) {
      console.warn(`Failed to post clarity assessment to ${issueKey}: ${error}`);
      throw error;
    }
  }

  /**
   * Transition an issue to a new status
   */
  async transitionIssue(issueKey: string, statusName: string): Promise<void> {
    try {
      console.log(`🔄 Transitioning ${issueKey} to "${statusName}"...`);

      // First, get available transitions for the issue
      const transitionsResponse = await this.jiraApiCall('GET', `/rest/api/3/issue/${issueKey}/transitions`);
      const transitions = transitionsResponse.transitions;

      // Find the transition that matches the desired status
      const targetTransition = transitions.find((transition: any) => 
        transition.to.name.toLowerCase() === statusName.toLowerCase()
      );

      if (!targetTransition) {
        const availableStatuses = transitions.map((t: any) => t.to.name).join(', ');
        throw new Error(`Status "${statusName}" not available for ${issueKey}. Available: ${availableStatuses}`);
      }

      // Perform the transition
      const transitionBody = {
        transition: {
          id: targetTransition.id
        }
      };

      await this.jiraApiCall('POST', `/rest/api/3/issue/${issueKey}/transitions`, transitionBody);
      console.log(`✅ Successfully transitioned ${issueKey} to "${statusName}"`);
    } catch (error) {
      console.warn(`Failed to transition ${issueKey} to "${statusName}": ${error}`);
      throw error;
    }
  }

  formatIssueDetails(issue: JiraIssue, comments: JiraComment[], linkedResources: LinkedResource[], relatedIssues: DetailedRelatedIssue[] = []): FormattedTaskDetails {
    return JiraExtractor.formatIssueDetails(issue, comments, linkedResources, relatedIssues);
  }
}