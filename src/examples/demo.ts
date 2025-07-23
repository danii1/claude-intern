#!/usr/bin/env node

/**
 * Demo script showing how to use claude-intern programmatically
 */

import { JiraClient } from '../lib/jira-client';
import { ClaudeFormatter } from '../lib/claude-formatter';
import { JiraIssue, JiraComment, LinkedResource, DetailedRelatedIssue, FormattedTaskDetails } from '../types/jira';

// Mock interface for demonstration
interface MockJiraClient {
  getIssue(key: string): Promise<JiraIssue>;
  getIssueComments(key: string): Promise<JiraComment[]>;
  extractLinkedResources(issue: JiraIssue): LinkedResource[];
  getRelatedWorkItems(issue: JiraIssue): Promise<DetailedRelatedIssue[]>;
  formatIssueDetails(issue: JiraIssue, comments: JiraComment[], linkedResources: LinkedResource[], relatedIssues?: DetailedRelatedIssue[]): FormattedTaskDetails;
}

async function demo(): Promise<void> {
  // This is a demo - you would use real credentials
  const mockClient: MockJiraClient = {
    async getIssue(key: string): Promise<JiraIssue> {
      return {
        id: '12345',
        key: key,
        self: `https://demo.atlassian.net/rest/api/3/issue/${key}`,
        fields: {
          summary: 'Implement user authentication system',
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'We need to implement a secure user authentication system with the following features:'
                  }
                ]
              },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'User registration and login'
                          }
                        ]
                      }
                    ]
                  },
                  {
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'Password hashing and validation'
                          }
                        ]
                      }
                    ]
                  },
                  {
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'Session management'
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          issuetype: {
            id: '1',
            name: 'Story',
            description: 'A user story',
            subtask: false
          },
          status: {
            id: '1',
            name: 'To Do',
            statusCategory: {
              id: 1,
              name: 'To Do',
              key: 'new',
              colorName: 'blue-gray'
            }
          },
          priority: {
            id: '2',
            name: 'High'
          },
          assignee: {
            accountId: 'user1',
            displayName: 'John Doe'
          },
          reporter: {
            accountId: 'user2',
            displayName: 'Jane Smith'
          },
          created: '2024-01-15T09:00:00.000Z',
          updated: '2024-01-15T14:20:00.000Z',
          labels: ['authentication', 'security'],
          components: [
            { id: '1', name: 'Backend' },
            { id: '2', name: 'API' }
          ],
          fixVersions: [],
          attachment: [
            {
              id: 'att1',
              filename: 'auth-flow-diagram.png',
              size: 245760,
              mimeType: 'image/png',
              content: 'https://demo.atlassian.net/secure/attachment/att1',
              created: '2024-01-15T10:30:00.000Z',
              author: {
                accountId: 'user3',
                displayName: 'Design Team'
              }
            }
          ],
          issuelinks: []
        },
        names: {
          'customfield_10001': 'Figma Design',
          'customfield_10002': 'Technical Specs'
        },
        renderedFields: {
          description: `<h2><a name="Objective"></a>Objective</h2>

<p>Enable TypeScript's <tt>strictNullChecks</tt> compiler option in the <b>packages/constants</b> package to improve type safety and eliminate potential null/undefined runtime errors.</p>

<h2><a name="Background"></a>Background</h2>

<p>This task is part of the broader initiative (
    <span class="jira-issue-macro" data-jira-key="SLAM-552" >
                <a href="https://disco-team.atlassian.net/browse/SLAM-552" class="jira-issue-macro-key issue-link"  title="Enable strictNullChecks in frontend packages" >
            <img class="icon" src="https://disco-team.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10307?size=medium" />
            SLAM-552
        </a>
                                                    <span class="aui-lozenge aui-lozenge-subtle aui-lozenge-complete jira-macro-single-issue-export-pdf">To Do</span>
            </span>
) to enable <tt>strictNullChecks</tt> across all frontend packages. The constants package contains shared constant values and configurations that are used throughout the application.</p>

<h2><a name="ImplementationSteps"></a>Implementation Steps</h2>

<ol>
	<li><b>Update TypeScript Configuration</b>
	<ul>
		<li>Add <tt>"strictNullChecks": true</tt> to the tsconfig.json file in packages/constants</li>
		<li>Ensure the setting inherits properly if using extends</li>
	</ul>
	</li>
	<li><b>Fix Compilation Errors</b>
	<ul>
		<li>Run <tt>tsc --noEmit</tt> to identify all strictNullChecks violations</li>
		<li>Address each error by adding proper null/undefined checks</li>
		<li>Update type annotations where necessary (e.g., <tt>string | null</tt>)</li>
	</ul>
	</li>
</ol>

<h2><a name="AcceptanceCriteria"></a>Acceptance Criteria</h2>

<ul>
	<li>[ ] <tt>strictNullChecks: true</tt> is enabled in packages/constants/tsconfig.json</li>
	<li>[ ] All TypeScript compilation errors are resolved</li>
	<li>[ ] No breaking changes to the constants API</li>
	<li>[ ] Existing functionality remains intact</li>
	<li>[ ] All tests pass</li>
	<li>[ ] Code review confirms proper null/undefined handling patterns</li>
</ul>`
        }
      };
    },

    async getIssueComments(key: string): Promise<JiraComment[]> {
      return [
        {
          id: '12345',
          author: {
            accountId: 'user4',
            displayName: 'Tech Lead'
          },
          body: {
            version: 1,
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Please use bcrypt for password hashing and JWT for session tokens. Also consider implementing rate limiting for login attempts.'
                  }
                ]
              }
            ]
          },
          created: '2024-01-15T14:20:00.000Z',
          updated: '2024-01-15T14:20:00.000Z'
        }
      ];
    },

    extractLinkedResources(issue: JiraIssue): LinkedResource[] {
      return [
        {
          type: 'custom_field_link',
          field: 'Figma Design',
          url: 'https://figma.com/file/auth-design',
          description: 'Figma Design'
        },
        {
          type: 'description_link',
          url: 'https://docs.company.com/auth-specs',
          description: 'External Link'
        }
      ];
    },

    async getRelatedWorkItems(issue: JiraIssue): Promise<DetailedRelatedIssue[]> {
      return [
        {
          key: 'SLAM-552',
          summary: 'Enable strictNullChecks in frontend packages',
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'This task is part of the broader initiative to enable strictNullChecks across all frontend packages. The constants package contains shared constant values and configurations that are used throughout the application.'
                  }
                ]
              }
            ]
          },
          renderedDescription: `<h2>Objective</h2><p>Enable TypeScript's <tt>strictNullChecks</tt> compiler option in the <b>packages/constants</b> package to improve type safety and eliminate potential null/undefined runtime errors.</p>`,
          issueType: 'Story',
          status: 'To Do',
          priority: 'High',
          assignee: 'John Doe',
          reporter: 'Jane Smith',
          created: '2024-01-15T09:00:00.000Z',
          updated: '2024-01-15T14:20:00.000Z',
          labels: ['typescript', 'strictNullChecks'],
          components: ['Frontend', 'Constants'],
          fixVersions: ['v2.1.0'],
          linkType: 'blocks',
          relationshipDirection: 'outward'
        }
      ];
    },

    formatIssueDetails(issue: JiraIssue, comments: JiraComment[], linkedResources: LinkedResource[], relatedIssues?: DetailedRelatedIssue[]): FormattedTaskDetails {
      const fields = issue.fields;
      return {
        key: issue.key,
        summary: fields.summary,
        description: fields.description,
        renderedDescription: issue.renderedFields?.description,
        issueType: fields.issuetype?.name,
        status: fields.status?.name,
        priority: fields.priority?.name,
        assignee: fields.assignee?.displayName,
        reporter: fields.reporter?.displayName,
        created: fields.created,
        updated: fields.updated,
        labels: fields.labels || [],
        components: fields.components?.map(c => c.name) || [],
        fixVersions: fields.fixVersions?.map(v => v.name) || [],
        linkedResources,
        relatedIssues: relatedIssues || [], // Add empty array for demo
        comments: comments.map(comment => ({
          id: comment.id,
          author: comment.author.displayName,
          body: comment.body,
          renderedBody: comment.renderedBody,
          created: comment.created,
          updated: comment.updated
        })),
        attachments: fields.attachment?.map(att => ({
          filename: att.filename,
          size: att.size,
          mimeType: att.mimeType,
          created: att.created,
          author: att.author.displayName,
          content: att.content
        })) || []
      };
    }
  };

  try {
    console.log('🎯 Claude Intern Demo');
    console.log('======================\n');

    const taskKey = 'DEMO-123';
    console.log(`📋 Fetching mock task: ${taskKey}`);

    // Simulate fetching task details
    const issue = await mockClient.getIssue(taskKey);
    const comments = await mockClient.getIssueComments(taskKey);
    const linkedResources = mockClient.extractLinkedResources(issue);
    const relatedIssues = await mockClient.getRelatedWorkItems(issue);

    // Format the task details
    const taskDetails = mockClient.formatIssueDetails(issue, comments, linkedResources, relatedIssues);

    console.log('\n📊 Task Summary:');
    console.log(`   Key: ${taskDetails.key}`);
    console.log(`   Summary: ${taskDetails.summary}`);
    console.log(`   Type: ${taskDetails.issueType}`);
    console.log(`   Status: ${taskDetails.status}`);
    console.log(`   Priority: ${taskDetails.priority}`);
    console.log(`   Linked Resources: ${linkedResources.length}`);
    console.log(`   Comments: ${taskDetails.comments.length}`);
    console.log(`   Attachments: ${taskDetails.attachments.length}`);

    // Format for Claude
    console.log('\n🤖 Formatting for Claude...');
    const jiraBaseUrl = 'https://demo.atlassian.net';
    const claudePrompt = ClaudeFormatter.formatTaskForClaude(taskDetails, jiraBaseUrl);

    // Save to file
    const outputFile = 'demo-task-details.md';
    ClaudeFormatter.saveFormattedTask(taskDetails, outputFile, jiraBaseUrl);

    console.log(`\n✅ Demo completed! Formatted task saved to: ${outputFile}`);
    console.log('\nFormatted content preview:');
    console.log('─'.repeat(50));
    console.log(claudePrompt.substring(0, 500) + '...');
    console.log('─'.repeat(50));

    console.log('\n💡 To use with real JIRA data:');
    console.log('   1. Set up your .env file with JIRA credentials');
    console.log('   2. Run: npm run dev YOUR-TASK-123');
    console.log('      (This will create a feature branch and run Claude automatically)');
    console.log('\n💡 To run Claude manually with the generated file:');
    console.log('   1. Create feature branch: git checkout -b feature/your-task-123');
    console.log('   2. Run Claude: claude -p --dangerously-skip-permissions --max-turns 10 < demo-task-details.md');

  } catch (error) {
    const err = error as Error;
    console.error('❌ Demo failed:', err.message);
  }
}

// Demo function showing the new ADF formatting
function demoADFFormatting() {
  // Sample Claude output with markdown-style formatting
  const sampleClaudeOutput = `
# Implementation Summary

I have successfully implemented the user authentication feature with the following changes:

## Changes Made

### 1. Authentication Service
- Created **AuthService** class in \`src/services/auth.ts\`
- Implemented JWT token validation
- Added password hashing using *bcrypt*

### 2. Database Schema
- Added users table with the following fields:
  - id (primary key)
  - email (unique)
  - password_hash
  - created_at

### 3. API Endpoints
Created the following REST endpoints:

1. **POST /api/auth/login** - User login
2. **POST /api/auth/register** - User registration  
3. **GET /api/auth/profile** - Get user profile
4. **POST /api/auth/logout** - User logout

## Code Examples

Here's the main authentication function:

\`\`\`typescript
async function authenticateUser(email: string, password: string): Promise<User | null> {
  const user = await User.findOne({ email });
  if (!user) return null;
  
  const isValid = await bcrypt.compare(password, user.password_hash);
  return isValid ? user : null;
}
\`\`\`

## Testing

- Added unit tests for all authentication functions
- Tested with both valid and invalid credentials
- Verified JWT token expiration handling

## Next Steps

The authentication system is now ready for production. Consider these improvements:

- Add two-factor authentication
- Implement password reset functionality
- Add rate limiting for login attempts

*Implementation completed successfully!*
`;

  // Create a mock JiraClient to access the private method
  const jiraClient = new JiraClient('https://example.atlassian.net', 'test@example.com', 'fake-token');

  // Access the private method for demonstration (this would normally be called internally)
  const adfContent = (jiraClient as any).formatClaudeOutputToADF(sampleClaudeOutput);

  console.log('Sample Claude Output:');
  console.log('===================');
  console.log(sampleClaudeOutput);

  console.log('\n\nFormatted as ADF:');
  console.log('================');
  console.log(JSON.stringify(adfContent, null, 2));
}

// Export for testing
export { demoADFFormatting };

// Run demo if this file is executed directly
if (require.main === module) {
  demoADFFormatting();
}

export { demo }; 