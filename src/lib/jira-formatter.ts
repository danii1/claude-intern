/**
 * JIRA comment and post formatting utilities
 * Handles conversion of text content to Atlassian Document Format (ADF)
 */

export class JiraFormatter {
  /**
   * Clean and format Claude's output for JIRA
   */
  static formatClaudeOutputForJira(output: string): string {
    // Remove ANSI escape codes and control characters
    let cleaned = output.replace(/\x1b\[[0-9;]*m/g, '');

    // Remove excessive whitespace and normalize line breaks
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim and limit length (JIRA comments have practical limits)
    cleaned = cleaned.trim();

    // If output is too long, truncate and add note
    const maxLength = 8000; // Conservative limit for JIRA comments
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength) + '\n\n[Output truncated due to length]';
    }

    // If output is very short or empty, provide a generic message
    if (cleaned.length < 50) {
      cleaned = 'Claude completed the implementation successfully. Please check the committed changes for details.';
    }

    return cleaned;
  }

  /**
   * Convert Claude's output text to ADF (Atlassian Document Format) content nodes
   */
  static formatClaudeOutputToADF(output: string): any[] {
    // Clean the output first
    let cleaned = output.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI codes
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    cleaned = cleaned.trim();

    // If output is very short or empty, provide a generic message
    if (cleaned.length < 50) {
      return [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Claude completed the implementation successfully. Please check the committed changes for details.'
        }]
      }];
    }

    // If output is too long, truncate
    const maxLength = 8000;
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength) + '\n\n[Output truncated due to length]';
    }

    const adfContent: any[] = [];
    const lines = cleaned.split('\n');
    let currentParagraph: string[] = [];
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let codeBlockLanguage = '';

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const text = currentParagraph.join(' ').trim();
        if (text) {
          adfContent.push({
            type: 'paragraph',
            content: JiraFormatter.parseTextWithFormatting(text)
          });
        }
        currentParagraph = [];
      }
    };

    const flushCodeBlock = () => {
      if (codeBlockContent.length > 0) {
        adfContent.push({
          type: 'codeBlock',
          attrs: { language: codeBlockLanguage || 'text' },
          content: [{
            type: 'text',
            text: codeBlockContent.join('\n')
          }]
        });
        codeBlockContent = [];
        codeBlockLanguage = '';
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Handle code blocks
      if (trimmedLine.startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          flushCodeBlock();
          inCodeBlock = false;
        } else {
          // Start of code block
          flushParagraph();
          inCodeBlock = true;
          codeBlockLanguage = trimmedLine.substring(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        continue;
      }

      // Handle headers
      if (trimmedLine.startsWith('#')) {
        flushParagraph();
        const level = Math.min(6, (trimmedLine.match(/^#+/) || [''])[0].length);
        const headerText = trimmedLine.replace(/^#+\s*/, '');

        adfContent.push({
          type: 'heading',
          attrs: { level },
          content: [{
            type: 'text',
            text: headerText
          }]
        });
        continue;
      }

      // Handle bullet lists
      if (trimmedLine.match(/^[-*+]\s/)) {
        flushParagraph();
        const listItems: any[] = [];
        let j = i;

        while (j < lines.length && lines[j].trim().match(/^[-*+]\s/)) {
          const itemText = lines[j].trim().replace(/^[-*+]\s/, '');
          listItems.push({
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: JiraFormatter.parseTextWithFormatting(itemText)
            }]
          });
          j++;
        }

        adfContent.push({
          type: 'bulletList',
          content: listItems
        });

        i = j - 1; // Adjust loop counter
        continue;
      }

      // Handle numbered lists
      if (trimmedLine.match(/^\d+\.\s/)) {
        flushParagraph();
        const listItems: any[] = [];
        let j = i;

        while (j < lines.length && lines[j].trim().match(/^\d+\.\s/)) {
          const itemText = lines[j].trim().replace(/^\d+\.\s/, '');
          listItems.push({
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: JiraFormatter.parseTextWithFormatting(itemText)
            }]
          });
          j++;
        }

        adfContent.push({
          type: 'orderedList',
          content: listItems
        });

        i = j - 1; // Adjust loop counter
        continue;
      }

      // Handle empty lines (paragraph breaks)
      if (trimmedLine === '') {
        flushParagraph();
        continue;
      }

      // Regular text - add to current paragraph
      currentParagraph.push(line);
    }

    // Flush any remaining content
    flushParagraph();
    flushCodeBlock();

    return adfContent.length > 0 ? adfContent : [{
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Implementation completed.'
      }]
    }];
  }

  /**
   * Parse text and apply basic formatting (bold, italic, code)
   */
  static parseTextWithFormatting(text: string): any[] {
    const content: any[] = [];
    let currentText = '';
    let i = 0;

    const flushText = () => {
      if (currentText) {
        content.push({
          type: 'text',
          text: currentText
        });
        currentText = '';
      }
    };

    while (i < text.length) {
      // Handle inline code
      if (text[i] === '`' && text[i + 1] !== '`') {
        flushText();
        const codeStart = i + 1;
        let codeEnd = text.indexOf('`', codeStart);
        if (codeEnd === -1) codeEnd = text.length;

        content.push({
          type: 'text',
          text: text.substring(codeStart, codeEnd),
          marks: [{ type: 'code' }]
        });

        i = codeEnd + 1;
        continue;
      }

      // Handle bold (**text**)
      if (text.substring(i, i + 2) === '**') {
        flushText();
        const boldStart = i + 2;
        const boldEnd = text.indexOf('**', boldStart);
        if (boldEnd !== -1) {
          content.push({
            type: 'text',
            text: text.substring(boldStart, boldEnd),
            marks: [{ type: 'strong' }]
          });
          i = boldEnd + 2;
          continue;
        }
      }

      // Handle italic (*text*)
      if (text[i] === '*' && text[i + 1] !== '*') {
        flushText();
        const italicStart = i + 1;
        const italicEnd = text.indexOf('*', italicStart);
        if (italicEnd !== -1) {
          content.push({
            type: 'text',
            text: text.substring(italicStart, italicEnd),
            marks: [{ type: 'em' }]
          });
          i = italicEnd + 1;
          continue;
        }
      }

      // Regular character
      currentText += text[i];
      i++;
    }

    flushText();
    return content.length > 0 ? content : [{ type: 'text', text: text }];
  }

  /**
   * Create ADF content for implementation comment
   */
  static createImplementationCommentADF(claudeOutput: string, taskSummary?: string): any[] {
    const content: any[] = [
      // Header with robot emoji and title
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [
          {
            type: 'emoji',
            attrs: { shortName: ':robot:', id: '1f916', text: '🤖' }
          },
          {
            type: 'text',
            text: ' Implementation Completed by Claude'
          }
        ]
      }
    ];

    // Add task summary if provided
    if (taskSummary) {
      content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Task: ',
            marks: [{ type: 'strong' }]
          },
          {
            type: 'text',
            text: taskSummary
          }
        ]
      });
    }

    // Add implementation summary header
    content.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Implementation Summary:',
          marks: [{ type: 'strong' }]
        }
      ]
    });

    // Add Claude's output formatted as ADF
    const formattedOutput = JiraFormatter.formatClaudeOutputToADF(claudeOutput);
    content.push(...formattedOutput);

    // Add disclaimer
    content.push({
      type: 'panel',
      attrs: { panelType: 'info' },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This implementation was generated automatically using Claude AI. Please review the changes before merging.',
              marks: [{ type: 'em' }]
            }
          ]
        }
      ]
    });

    return content;
  }

  /**
   * Create ADF content for clarity assessment comment
   */
  static createClarityAssessmentADF(assessment: any): any[] {
    const content: any[] = [
      // Header
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [
          {
            type: 'emoji',
            attrs: { shortName: ':robot:', id: '1f916', text: '🤖' }
          },
          {
            type: 'text',
            text: ' Automated Task Feasibility Assessment'
          }
        ]
      },
      // Score and status
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Clarity Score: ',
            marks: [{ type: 'strong' }]
          },
          {
            type: 'text',
            text: `${assessment.clarityScore}/10`
          }
        ]
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Status: ',
            marks: [{ type: 'strong' }]
          },
          ...(assessment.isImplementable ? [
            {
              type: 'emoji',
              attrs: { shortName: ':white_check_mark:', id: '2705', text: '✅' }
            },
            {
              type: 'text',
              text: ' Ready for implementation'
            }
          ] : [
            {
              type: 'emoji',
              attrs: { shortName: ':x:', id: '274c', text: '❌' }
            },
            {
              type: 'text',
              text: ' Needs fundamental clarification'
            }
          ])
        ]
      },
      // Summary
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Summary: ',
            marks: [{ type: 'strong' }]
          },
          {
            type: 'text',
            text: assessment.summary
          }
        ]
      }
    ];

    // Add issues if any
    if (assessment.issues && assessment.issues.length > 0) {
      content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Critical Issues Identified:',
            marks: [{ type: 'strong' }]
          }
        ]
      });

      const bulletList: any[] = [];
      assessment.issues.forEach((issue: any) => {
        const severityEmoji = issue.severity === 'critical' ? '🔴' : issue.severity === 'major' ? '🟡' : '🔵';
        bulletList.push({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `${severityEmoji} `
                },
                {
                  type: 'text',
                  text: issue.category,
                  marks: [{ type: 'strong' }]
                },
                {
                  type: 'text',
                  text: `: ${issue.description}`
                }
              ]
            }
          ]
        });
      });

      content.push({
        type: 'bulletList',
        content: bulletList
      });
    }

    // Add recommendations if any
    if (assessment.recommendations && assessment.recommendations.length > 0) {
      content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Recommendations:',
            marks: [{ type: 'strong' }]
          }
        ]
      });

      const orderedList: any[] = [];
      assessment.recommendations.forEach((rec: string) => {
        orderedList.push({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: rec
                }
              ]
            }
          ]
        });
      });

      content.push({
        type: 'orderedList',
        content: orderedList
      });
    }

    // Add success message for passing assessments
    if (assessment.isImplementable && assessment.clarityScore >= 7) {
      content.push({
        type: 'panel',
        attrs: { panelType: 'success' },
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '🎯 Excellent! This task description provides clear requirements and context for implementation.',
                marks: [{ type: 'strong' }]
              }
            ]
          }
        ]
      });
    } else if (assessment.isImplementable) {
      content.push({
        type: 'panel',
        attrs: { panelType: 'info' },
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '💡 This task is implementable, but could benefit from additional details for even clearer requirements.',
                marks: [{ type: 'em' }]
              }
            ]
          }
        ]
      });
    }

    // Add disclaimer
    content.push({
      type: 'panel',
      attrs: { panelType: 'note' },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This assessment focuses on basic implementability. Technical details, UI/UX patterns, and implementation specifics are expected to be inferred from existing codebase.',
              marks: [{ type: 'em' }]
            }
          ]
        }
      ]
    });

    return content;
  }
}