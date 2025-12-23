/**
 * JIRA data extraction and processing utilities
 * Handles extraction of linked resources, related work items, and data formatting
 */

import {
  JiraIssue,
  JiraComment,
  LinkedResource,
  DetailedRelatedIssue,
  FormattedTaskDetails,
  AtlassianDocument
} from '../types/jira';

export class JiraExtractor {
  /**
   * Extract linked resources from a JIRA issue
   */
  static extractLinkedResources(issue: JiraIssue): LinkedResource[] {
    const linkedResources: LinkedResource[] = [];

    try {
      const fields = issue.fields || {};

      // Check custom fields for links
      Object.keys(fields).forEach(fieldKey => {
        try {
          const fieldValue = fields[fieldKey];
          const fieldName = issue.names?.[fieldKey] || fieldKey;

          if (fieldValue && typeof fieldValue === 'string') {
            // Look for URLs in custom fields
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urls = fieldValue.match(urlRegex);
            if (urls) {
              urls.forEach(url => {
                linkedResources.push({
                  type: 'custom_field_link',
                  field: fieldName,
                  url: url,
                  description: JiraExtractor.categorizeLink(url)
                });
              });
            }
          } else if (fieldValue && typeof fieldValue === 'object' && 'content' in fieldValue) {
            // Handle rich text fields that might contain links
            const documentContent = (fieldValue as AtlassianDocument).content;
            if (documentContent && Array.isArray(documentContent)) {
              try {
                const content = JSON.stringify(documentContent);
                const urlRegex = /(https?:\/\/[^\s"]+)/g;
                const urls = content.match(urlRegex);
                if (urls) {
                  urls.forEach(url => {
                    linkedResources.push({
                      type: 'rich_text_link',
                      field: fieldName,
                      url: url,
                      description: JiraExtractor.categorizeLink(url)
                    });
                  });
                }
              } catch (jsonError) {
                console.warn(`Failed to process rich text content for field ${fieldName}: ${jsonError}`);
              }
            }
          }
        } catch (fieldError) {
          console.warn(`Failed to process field ${fieldKey}: ${fieldError}`);
        }
      });

      // Check issue links
      if (fields.issuelinks) {
        fields.issuelinks.forEach(link => {
          try {
            if (link.outwardIssue) {
              linkedResources.push({
                type: 'issue_link',
                linkType: link.type.outward,
                issueKey: link.outwardIssue.key,
                summary: link.outwardIssue.fields.summary,
                description: `${link.type.outward} issue`
              });
            }
            if (link.inwardIssue) {
              linkedResources.push({
                type: 'issue_link',
                linkType: link.type.inward,
                issueKey: link.inwardIssue.key,
                summary: link.inwardIssue.fields.summary,
                description: `${link.type.inward} issue`
              });
            }
          } catch (linkError) {
            console.warn(`Failed to process issue link: ${linkError}`);
          }
        });
      }

      // Check web links in description
      if (fields.description && typeof fields.description === 'object' && 'content' in fields.description) {
        try {
          const documentContent = (fields.description as AtlassianDocument).content;
          if (documentContent && Array.isArray(documentContent)) {
            const content = JSON.stringify(documentContent);
            const urlRegex = /(https?:\/\/[^\s"]+)/g;
            const urls = content.match(urlRegex);
            if (urls) {
              urls.forEach(url => {
                linkedResources.push({
                  type: 'description_link',
                  url: url,
                  description: JiraExtractor.categorizeLink(url)
                });
              });
            }
          }
        } catch (descError) {
          console.warn(`Failed to process description links: ${descError}`);
        }
      }
    } catch (error) {
      console.warn(`Failed to extract linked resources: ${error}`);
    }

    // Deduplicate linked resources
    return JiraExtractor.deduplicateLinkedResources(linkedResources);
  }

  /**
   * Deduplicate linked resources by URL and issue key, keeping the most informative version
   */
  private static deduplicateLinkedResources(resources: LinkedResource[]): LinkedResource[] {
    const seen = new Map<string, LinkedResource>();

    // Priority order for resource types (higher priority = more informative)
    const typePriority = {
      'issue_link': 4,        // Issue links are most informative
      'custom_field_link': 3, // Custom field links have field context
      'rich_text_link': 2,    // Rich text links have field context
      'description_link': 1   // Description links are least specific
    };

    resources.forEach(resource => {
      // Create a unique key for deduplication
      let key: string;
      if (resource.url) {
        // For URL-based resources, use the URL as the key
        key = resource.url;
      } else if (resource.issueKey) {
        // For issue links, use the issue key as the key
        key = `issue:${resource.issueKey}`;
      } else {
        // Fallback to a combination of type and description
        key = `${resource.type}:${resource.description}`;
      }

      const existing = seen.get(key);
      if (!existing) {
        // First occurrence, add it
        seen.set(key, resource);
      } else {
        // Duplicate found, keep the one with higher priority
        const existingPriority = typePriority[existing.type] || 0;
        const currentPriority = typePriority[resource.type] || 0;

        if (currentPriority > existingPriority) {
          // Current resource has higher priority, replace the existing one
          seen.set(key, resource);
        } else if (currentPriority === existingPriority) {
          // Same priority, prefer the one with more context (field information)
          if (resource.field && !existing.field) {
            seen.set(key, resource);
          }
        }
        // If existing has higher priority, keep it (do nothing)
      }
    });

    const deduplicated = Array.from(seen.values());

    if (resources.length !== deduplicated.length) {
      console.log(`🔗 Deduplicated linked resources: ${resources.length} → ${deduplicated.length}`);
    }

    return deduplicated;
  }

  /**
   * Categorize a link URL for better description
   */
  private static categorizeLink(url: string): string {
    if (url.includes('github.com')) return 'GitHub Repository/Issue';
    if (url.includes('confluence')) return 'Confluence Documentation';
    if (url.includes('figma.com')) return 'Figma Design';
    if (url.includes('docs.google.com')) return 'Google Document';
    if (url.includes('drive.google.com')) return 'Google Drive File';
    if (url.includes('notion.so')) return 'Notion Page';
    if (url.includes('miro.com')) return 'Miro Board';
    return 'External Link';
  }

  /**
   * Process related work items from a JIRA issue using a provided getIssue function
   */
  static async getRelatedWorkItems(
    issue: JiraIssue, 
    getIssueFunction: (key: string) => Promise<JiraIssue>
  ): Promise<DetailedRelatedIssue[]> {
    const relatedIssues: DetailedRelatedIssue[] = [];
    const fields = issue.fields || {};

    try {
      // Fetch linked issues
      if (fields.issuelinks && fields.issuelinks.length > 0) {
        console.log(`🔗 Found ${fields.issuelinks.length} linked issues, fetching details...`);

        for (const link of fields.issuelinks) {
          try {
            if (link.outwardIssue) {
              const detailedIssue = await getIssueFunction(link.outwardIssue.key);
              const relatedIssue = JiraExtractor.formatRelatedIssue(
                detailedIssue,
                link.type.outward,
                'outward'
              );
              relatedIssues.push(relatedIssue);
            }

            if (link.inwardIssue) {
              const detailedIssue = await getIssueFunction(link.inwardIssue.key);
              const relatedIssue = JiraExtractor.formatRelatedIssue(
                detailedIssue,
                link.type.inward,
                'inward'
              );
              relatedIssues.push(relatedIssue);
            }
          } catch (linkError) {
            console.warn(`Failed to fetch linked issue details: ${linkError}`);
          }
        }
      }

      // Fetch subtasks
      if (fields.subtasks && fields.subtasks.length > 0) {
        console.log(`📋 Found ${fields.subtasks.length} subtasks, fetching details...`);

        for (const subtask of fields.subtasks) {
          try {
            const detailedSubtask = await getIssueFunction(subtask.key);
            const relatedIssue = JiraExtractor.formatRelatedIssue(
              detailedSubtask,
              'Subtask',
              'subtask'
            );
            relatedIssues.push(relatedIssue);
          } catch (subtaskError) {
            console.warn(`Failed to fetch subtask details: ${subtaskError}`);
          }
        }
      }

      // Fetch parent task if this is a subtask
      if (fields.parent) {
        console.log(`📋 Found parent task, fetching details...`);

        try {
          const detailedParent = await getIssueFunction(fields.parent.key);
          const relatedIssue = JiraExtractor.formatRelatedIssue(
            detailedParent,
            'Parent Task',
            'parent'
          );
          relatedIssues.push(relatedIssue);
        } catch (parentError) {
          console.warn(`Failed to fetch parent task details: ${parentError}`);
        }
      }

      // Fetch epic if this issue belongs to an epic
      if (fields.epic && fields.epic.key) {
        console.log(`🎯 Found epic, fetching details...`);

        try {
          const detailedEpic = await getIssueFunction(fields.epic.key);
          const relatedIssue = JiraExtractor.formatRelatedIssue(
            detailedEpic,
            'Epic',
            'parent'
          );
          relatedIssues.push(relatedIssue);
        } catch (epicError) {
          console.warn(`Failed to fetch epic details: ${epicError}`);
        }
      }

      // Check for epic link in custom field (common pattern)
      const epicLinkField = fields.customfield_10014 || fields['Epic Link'];
      if (epicLinkField && typeof epicLinkField === 'string') {
        console.log(`🎯 Found epic link in custom field, fetching details...`);

        try {
          const detailedEpic = await getIssueFunction(epicLinkField);
          const relatedIssue = JiraExtractor.formatRelatedIssue(
            detailedEpic,
            'Epic',
            'parent'
          );
          relatedIssues.push(relatedIssue);
        } catch (epicError) {
          console.warn(`Failed to fetch epic from custom field: ${epicError}`);
        }
      }

      console.log(`✅ Successfully fetched ${relatedIssues.length} related work items`);
      return relatedIssues;

    } catch (error) {
      console.warn(`Error fetching related work items: ${error}`);
      return relatedIssues; // Return what we have so far
    }
  }

  /**
   * Format a JIRA issue as a detailed related issue
   */
  private static formatRelatedIssue(
    issue: JiraIssue,
    linkType: string,
    direction: 'inward' | 'outward' | 'subtask' | 'parent'
  ): DetailedRelatedIssue {
    const fields = issue.fields || {};

    return {
      key: issue.key || 'Unknown',
      summary: fields.summary || 'No summary',
      description: fields.description,
      renderedDescription: issue.renderedFields?.description,
      issueType: fields.issuetype?.name || 'Unknown',
      status: fields.status?.name || 'Unknown',
      priority: fields.priority?.name,
      assignee: fields.assignee?.displayName,
      reporter: fields.reporter?.displayName || 'Unknown',
      created: fields.created || '',
      updated: fields.updated || '',
      labels: fields.labels || [],
      components: fields.components?.map(c => c?.name || 'Unknown') || [],
      fixVersions: fields.fixVersions?.map(v => v?.name || 'Unknown') || [],
      linkType,
      relationshipDirection: direction
    };
  }

  /**
   * Format complete issue details for consumption
   */
  static formatIssueDetails(
    issue: JiraIssue, 
    comments: JiraComment[], 
    linkedResources: LinkedResource[], 
    relatedIssues: DetailedRelatedIssue[] = []
  ): FormattedTaskDetails {
    const fields = issue.fields || {};

    return {
      key: issue.key || 'Unknown',
      summary: fields.summary || 'No summary',
      description: fields.description,
      renderedDescription: issue.renderedFields?.description,
      issueType: fields.issuetype?.name || 'Unknown',
      status: fields.status?.name || 'Unknown',
      priority: fields.priority?.name,
      assignee: fields.assignee?.displayName,
      reporter: fields.reporter?.displayName || 'Unknown',
      created: fields.created || '',
      updated: fields.updated || '',
      labels: fields.labels || [],
      components: fields.components?.map(c => c?.name || 'Unknown') || [],
      fixVersions: fields.fixVersions?.map(v => v?.name || 'Unknown') || [],
      linkedResources,
      relatedIssues,
      comments: comments.map(comment => ({
        id: comment.id || 'unknown',
        author: comment.author?.displayName || 'Unknown',
        body: comment.body || '',
        renderedBody: comment.renderedBody,
        created: comment.created || '',
        updated: comment.updated || ''
      })),
      attachments: fields.attachment?.map(att => ({
        filename: att?.filename || 'unknown',
        size: att?.size || 0,
        mimeType: att?.mimeType || 'unknown',
        created: att?.created || '',
        author: att?.author?.displayName || 'Unknown',
        content: att?.content || ''
      })) || []
    };
  }

  /**
   * Extract plain text from Atlassian Document Format
   */
  static extractTextFromADF(doc: AtlassianDocument | string | undefined): string {
    if (!doc) {
      return "";
    }

    if (typeof doc === "string") {
      return doc;
    }

    // Recursively extract text content from ADF nodes
    const extractText = (nodes: any[], isTopLevel = false): string => {
      if (!nodes) return "";

      return nodes
        .map((node, index) => {
          if (node.type === "text") {
            return node.text || "";
          }
          if (node.type === "paragraph") {
            // Add newline after paragraphs (except the last one at top level)
            const text = node.content ? extractText(node.content) : "";
            return isTopLevel && index < nodes.length - 1 ? text + "\n" : text;
          }
          if (node.type === "heading") {
            // Add newline after headings
            const text = node.content ? extractText(node.content) : "";
            return isTopLevel ? text + "\n" : text;
          }
          if (node.content) {
            return extractText(node.content);
          }
          return "";
        })
        .join("");
    };

    return extractText(doc.content || [], true);
  }
}