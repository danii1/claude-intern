import { describe, test, expect } from "bun:test";
import { JiraFormatter } from "../src/lib/jira-formatter";

describe("JiraFormatter - Markdown to ADF Conversion", () => {
  describe("Basic Text Formatting", () => {
    test("should convert bold text", () => {
      const markdown = "This is **bold text** in a sentence with enough content to pass the minimum length requirement.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[0].content).toEqual([
        { type: "text", text: "This is " },
        { type: "text", text: "bold text", marks: [{ type: "strong" }] },
        { type: "text", text: " in a sentence with enough content to pass the minimum length requirement." }
      ]);
    });

    test("should convert italic text", () => {
      const markdown = "This is *italic text* in a sentence with enough content to pass the minimum length requirement.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[0].content).toEqual([
        { type: "text", text: "This is " },
        { type: "text", text: "italic text", marks: [{ type: "em" }] },
        { type: "text", text: " in a sentence with enough content to pass the minimum length requirement." }
      ]);
    });

    test("should convert inline code", () => {
      const markdown = "Use the `console.log()` function when you need to debug your application output.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[0].content).toEqual([
        { type: "text", text: "Use the " },
        { type: "text", text: "console.log()", marks: [{ type: "code" }] },
        { type: "text", text: " function when you need to debug your application output." }
      ]);
    });

    test("should convert mixed formatting", () => {
      const markdown = "This has **bold**, *italic*, and `code` formatting in the same paragraph.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[0].content.length).toBe(7);
      expect(adf[0].content[1].marks).toEqual([{ type: "strong" }]);
      expect(adf[0].content[3].marks).toEqual([{ type: "em" }]);
      expect(adf[0].content[5].marks).toEqual([{ type: "code" }]);
    });

    test("should handle plain text without formatting", () => {
      const markdown = "This is plain text with no formatting but enough characters to meet the minimum.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[0].content).toEqual([
        { type: "text", text: "This is plain text with no formatting but enough characters to meet the minimum." }
      ]);
    });
  });

  describe("Headings", () => {
    test("should convert H1 heading", () => {
      const markdown = "# Main Title\n\nThis is content after the heading to meet minimum length.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf.length).toBeGreaterThanOrEqual(1);
      expect(adf[0].type).toBe("heading");
      expect(adf[0].attrs.level).toBe(1);
      expect(adf[0].content).toEqual([
        { type: "text", text: "Main Title" }
      ]);
    });

    test("should convert H2 heading", () => {
      const markdown = "## Subtitle\n\nContent after the subtitle to meet the minimum required length.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].type).toBe("heading");
      expect(adf[0].attrs.level).toBe(2);
    });

    test("should convert H3 heading", () => {
      const markdown = "### Section\n\nThis section has enough content to pass validation.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].type).toBe("heading");
      expect(adf[0].attrs.level).toBe(3);
    });

    test("should handle multiple headings with content", () => {
      const markdown = `# Title\n\nSome content here.\n\n## Subtitle\n\nMore content goes here.`;
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(4);
      expect(adf[0].type).toBe("heading");
      expect(adf[0].attrs.level).toBe(1);
      expect(adf[1].type).toBe("paragraph");
      expect(adf[2].type).toBe("heading");
      expect(adf[2].attrs.level).toBe(2);
      expect(adf[3].type).toBe("paragraph");
    });
  });

  describe("Lists", () => {
    test("should convert bullet list with dash", () => {
      const markdown = `- First item in our list\n- Second item in our list\n- Third item in our list`;
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("bulletList");
      expect(adf[0].content).toHaveLength(3);
      expect(adf[0].content[0].type).toBe("listItem");
      expect(adf[0].content[0].content[0].content[0].text).toBe("First item in our list");
    });

    test("should convert bullet list with asterisk", () => {
      const markdown = `* First item with asterisk marker\n* Second item with asterisk marker`;
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].type).toBe("bulletList");
      expect(adf[0].content).toHaveLength(2);
    });

    test("should convert bullet list with plus", () => {
      const markdown = `+ First item with plus sign marker\n+ Second item with plus sign marker`;
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].type).toBe("bulletList");
      expect(adf[0].content).toHaveLength(2);
    });

    test("should convert ordered list", () => {
      const markdown = `1. First step in the process\n2. Second step in the process\n3. Third step in the process`;
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("orderedList");
      expect(adf[0].content).toHaveLength(3);
      expect(adf[0].content[0].type).toBe("listItem");
      expect(adf[0].content[1].content[0].content[0].text).toBe("Second step in the process");
    });

    test("should handle list items with formatting", () => {
      const markdown = `- **Bold** item with emphasis\n- *Italic* item with emphasis\n- \`Code\` item with formatting`;
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].type).toBe("bulletList");
      expect(adf[0].content[0].content[0].content[0].marks).toEqual([{ type: "strong" }]);
      expect(adf[0].content[1].content[0].content[0].marks).toEqual([{ type: "em" }]);
      expect(adf[0].content[2].content[0].content[0].marks).toEqual([{ type: "code" }]);
    });
  });

  describe("Code Blocks", () => {
    test("should convert code block without language", () => {
      const markdown = "```\nconst x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\n```";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("codeBlock");
      expect(adf[0].attrs.language).toBe("text");
      expect(adf[0].content[0].text).toBe("const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;");
    });

    test("should convert code block with language", () => {
      const markdown = "```javascript\nconst x = 1;\nconst y = 2;\nconst z = 3;\n```";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].type).toBe("codeBlock");
      expect(adf[0].attrs.language).toBe("javascript");
      expect(adf[0].content[0].text).toBe("const x = 1;\nconst y = 2;\nconst z = 3;");
    });

    test("should handle multiple code blocks", () => {
      const markdown = "```js\ncode1();\nmore();\n```\n\nSome descriptive text here.\n\n```py\ncode2()\nmore()\n```";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(3);
      expect(adf[0].type).toBe("codeBlock");
      expect(adf[0].attrs.language).toBe("js");
      expect(adf[1].type).toBe("paragraph");
      expect(adf[2].type).toBe("codeBlock");
      expect(adf[2].attrs.language).toBe("py");
    });

    test("should preserve indentation in code blocks", () => {
      const markdown = "```\n  function foo() {\n    return true;\n  }\n  foo();\n```";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].content[0].text).toBe("  function foo() {\n    return true;\n  }\n  foo();");
    });
  });

  describe("Tables", () => {
    test("should convert simple table", () => {
      const markdown = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("table");
      expect(adf[0].attrs.isNumberColumnEnabled).toBe(false);
      expect(adf[0].attrs.layout).toBe("default");
    });

    test("should convert table header correctly", () => {
      const markdown = "| Name | Age | Location |\n|------|-----|----------|\n| Alice | 30 | New York |";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      const headerRow = adf[0].content[0];
      expect(headerRow.type).toBe("tableRow");
      expect(headerRow.content[0].type).toBe("tableHeader");
      expect(headerRow.content[0].content[0].content[0].text).toBe("Name");
      expect(headerRow.content[1].type).toBe("tableHeader");
      expect(headerRow.content[1].content[0].content[0].text).toBe("Age");
    });

    test("should convert table data rows correctly", () => {
      const markdown = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      const dataRow1 = adf[0].content[1];
      const dataRow2 = adf[0].content[2];

      expect(dataRow1.type).toBe("tableRow");
      expect(dataRow1.content[0].type).toBe("tableCell");
      expect(dataRow1.content[0].content[0].content[0].text).toBe("Alice");
      expect(dataRow1.content[1].content[0].content[0].text).toBe("30");

      expect(dataRow2.content[0].content[0].content[0].text).toBe("Bob");
      expect(dataRow2.content[1].content[0].content[0].text).toBe("25");
    });

    test("should handle table with formatting in cells", () => {
      const markdown = "| Feature | Status |\n|---------|--------|\n| **Auth** | `done` |";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      const dataRow = adf[0].content[1];
      expect(dataRow.content[0].content[0].content[0].text).toBe("Auth");
      expect(dataRow.content[0].content[0].content[0].marks).toEqual([{ type: "strong" }]);
      expect(dataRow.content[1].content[0].content[0].text).toBe("done");
      expect(dataRow.content[1].content[0].content[0].marks).toEqual([{ type: "code" }]);
    });

    test("should handle table with emojis", () => {
      const markdown = "| Status | Icon |\n|--------|------|\n| Done | ✅ |\n| Progress | 🔄 |";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].content[1].content[1].content[0].content[0].text).toBe("✅");
      expect(adf[0].content[2].content[1].content[0].content[0].text).toBe("🔄");
    });

    test("should handle table with varying column content", () => {
      const markdown = "| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| Long content here | x | y |";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].content).toHaveLength(3); // 1 header + 2 data rows
      expect(adf[0].content[0].content).toHaveLength(3); // 3 columns
      expect(adf[0].content[2].content[0].content[0].content[0].text).toBe("Long content here");
    });
  });

  describe("Mixed Content", () => {
    test("should handle heading followed by paragraph", () => {
      const markdown = "# Title\n\nThis is a paragraph with enough content to meet the minimum length requirement.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(2);
      expect(adf[0].type).toBe("heading");
      expect(adf[1].type).toBe("paragraph");
    });

    test("should handle list after paragraph", () => {
      const markdown = "Introduction text with sufficient content.\n\n- First item\n- Second item";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(2);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[1].type).toBe("bulletList");
    });

    test("should handle code block between paragraphs", () => {
      const markdown = "Before code block.\n\n```js\ncode();\nmore();\n```\n\nAfter code block.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(3);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[1].type).toBe("codeBlock");
      expect(adf[2].type).toBe("paragraph");
    });

    test("should handle complex document structure", () => {
      const markdown = `# Implementation Summary

I've completed the following tasks:

1. Created authentication module
2. Added **database migrations**
3. Implemented \`UserService\` class

## Code Changes

\`\`\`typescript
class UserService {
  async getUser(id: string) {
    return await db.users.findById(id);
  }
}
\`\`\`

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Unit Tests | ✅ Pass | All 50 tests passing |
| Integration | ✅ Pass | Database connected |

Implementation complete!`;

      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      // Verify structure
      expect(adf[0].type).toBe("heading"); // # Implementation Summary
      expect(adf[1].type).toBe("paragraph"); // I've completed...
      expect(adf[2].type).toBe("orderedList"); // 1. 2. 3.
      expect(adf[3].type).toBe("heading"); // ## Code Changes
      expect(adf[4].type).toBe("codeBlock"); // ```typescript
      expect(adf[5].type).toBe("heading"); // ## Test Results
      expect(adf[6].type).toBe("table"); // Table
      expect(adf[7].type).toBe("paragraph"); // Implementation complete!
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty string", () => {
      const markdown = "";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(1);
      expect(adf[0].content[0].text).toBe("Claude completed the implementation successfully. Please check the committed changes for details.");
    });

    test("should handle very short output", () => {
      const markdown = "Done";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].content[0].text).toBe("Claude completed the implementation successfully. Please check the committed changes for details.");
    });

    test("should handle multiple empty lines", () => {
      const markdown = "First paragraph with content.\n\n\n\nSecond paragraph with more content.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf).toHaveLength(2);
      expect(adf[0].type).toBe("paragraph");
      expect(adf[1].type).toBe("paragraph");
    });

    test("should strip ANSI color codes", () => {
      const markdown = "\x1b[32mGreen text\x1b[0m and normal text with enough length to pass validation.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      expect(adf[0].content[0].text).toBe("Green text and normal text with enough length to pass validation.");
    });

    test("should handle unclosed formatting markers", () => {
      const markdown = "This has **unclosed bold and *unclosed italic";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      // Should not crash, should handle gracefully
      expect(adf).toHaveLength(1);
      expect(adf[0].type).toBe("paragraph");
    });

    test("should truncate very long output", () => {
      const markdown = "a".repeat(10000);
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      // Collect all text from all paragraphs
      const allText = adf.map((node: any) =>
        node.content?.map((c: any) => c.text).join('') || ''
      ).join('');

      expect(allText.length).toBeLessThanOrEqual(8100); // maxLength + truncation message
      expect(allText).toContain("[Output truncated due to length]");
    });

    test("should handle table without separator line", () => {
      // Note: Our implementation is flexible and will parse tables even without
      // separator lines, treating the first row as headers. This is a feature!
      const markdown = "| Name | Age |\n| Alice | 30 |\n\nAdditional context text here.";
      const adf = JiraFormatter.formatClaudeOutputToADF(markdown);

      // Without separator, it still gets parsed as a table
      expect(adf[0].type).toBe("table");
      expect(adf[0].content).toHaveLength(2); // header + 1 data row
    });
  });

  describe("parseTextWithFormatting", () => {
    test("should handle nested formatting correctly", () => {
      const result = JiraFormatter.parseTextWithFormatting("Normal **bold *both* bold** normal");

      // Should have segments for: "Normal ", "bold *both* bold", " normal"
      expect(result.length).toBeGreaterThan(1);
      expect(result.some(node => node.marks?.[0]?.type === "strong")).toBe(true);
    });

    test("should handle adjacent formatting", () => {
      const result = JiraFormatter.parseTextWithFormatting("**bold***italic*");

      expect(result.length).toBeGreaterThan(1);
    });

    test("should handle empty string", () => {
      const result = JiraFormatter.parseTextWithFormatting("");

      expect(result).toEqual([{ type: "text", text: "" }]);
    });
  });

  describe("Claude Intern Comment Markers", () => {
    test("createImplementationCommentADF should include marker", () => {
      const output = "I've successfully implemented the feature";
      const taskSummary = "Add login functionality";

      const adf = JiraFormatter.createImplementationCommentADF(output, taskSummary);

      // Should have header with robot emoji
      expect(adf[0].type).toBe("heading");
      expect(adf[0].content[0].type).toBe("emoji");
      expect(adf[0].content[1].text).toContain("Implementation Completed by Claude");

      // Verify marker text is present (emoji is separate in ADF)
      const adfString = JSON.stringify(adf);
      expect(adfString).toContain("Implementation Completed by Claude");
      expect(adfString).toContain("🤖");
    });

    test("createClarityAssessmentADF should include marker", () => {
      const assessment = {
        clarityScore: 8,
        isImplementable: true,
        summary: "Task is clear and implementable",
        issues: [],
        recommendations: []
      };

      const adf = JiraFormatter.createClarityAssessmentADF(assessment);

      // Should have header with robot emoji
      expect(adf[0].type).toBe("heading");
      expect(adf[0].content[0].type).toBe("emoji");
      expect(adf[0].content[1].text).toContain("Automated Task Feasibility Assessment");

      // Verify marker text is present (emoji is separate in ADF)
      const adfString = JSON.stringify(adf);
      expect(adfString).toContain("Automated Task Feasibility Assessment");
      expect(adfString).toContain("🤖");
    });

    test("createIncompleteImplementationCommentADF should include marker", () => {
      const output = "Could not complete the task";
      const taskSummary = "Add login functionality";

      const adf = JiraFormatter.createIncompleteImplementationCommentADF(output, taskSummary);

      // Should have header with warning emoji
      expect(adf[0].type).toBe("heading");
      expect(adf[0].content[0].type).toBe("emoji");
      expect(adf[0].content[1].text).toContain("Implementation Incomplete");

      // Verify marker text is present (emoji is separate in ADF)
      const adfString = JSON.stringify(adf);
      expect(adfString).toContain("Implementation Incomplete");
      expect(adfString).toContain("⚠️");
    });

    test("all Claude Intern comments should have unique identifiable markers", () => {
      const implementationADF = JiraFormatter.createImplementationCommentADF("test");
      const assessmentADF = JiraFormatter.createClarityAssessmentADF({
        clarityScore: 5,
        isImplementable: true,
        summary: "test",
        issues: [],
        recommendations: []
      });
      const incompleteADF = JiraFormatter.createIncompleteImplementationCommentADF("test");

      // Each should have its unique header text for identification
      expect(implementationADF[0].content[1].text).toBe(" Implementation Completed by Claude");
      expect(assessmentADF[0].content[1].text).toBe(" Automated Task Feasibility Assessment");
      expect(incompleteADF[0].content[1].text).toBe(" Implementation Incomplete");

      // These text markers (without emoji) should be sufficient for filtering in getIssueComments
      const implementationStr = JSON.stringify(implementationADF);
      const assessmentStr = JSON.stringify(assessmentADF);
      const incompleteStr = JSON.stringify(incompleteADF);

      expect(implementationStr).toContain("Implementation Completed by Claude");
      expect(assessmentStr).toContain("Automated Task Feasibility Assessment");
      expect(incompleteStr).toContain("Implementation Incomplete");

      // And they should all have their respective emojis
      expect(implementationStr).toContain("🤖");
      expect(assessmentStr).toContain("🤖");
      expect(incompleteStr).toContain("⚠️");
    });
  });
});
