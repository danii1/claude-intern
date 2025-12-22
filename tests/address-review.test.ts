import { describe, test, expect } from "bun:test";

/**
 * Extract Claude's summary from its output.
 * This is a copy of the function from address-review.ts for testing purposes.
 */
function extractClaudeSummary(output: string): string {
  const MAX_LENGTH = 500;

  // Remove ANSI color codes
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, "");

  // Helper to truncate if needed
  const truncate = (text: string): string => {
    return text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) + "..." : text;
  };

  // Try to find a "Summary" section (## Summary or ## summary)
  const summaryMatch = cleanOutput.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##|\n---|\z)/i);
  if (summaryMatch && summaryMatch[1].trim()) {
    return truncate(summaryMatch[1].trim());
  }

  // Try to find "Changes Made" section (### Changes Made:)
  const changesMatch = cleanOutput.match(/###\s*Changes Made:?\s*\n+([\s\S]*?)(?=\n###|\n##|\n---|\z)/i);
  if (changesMatch && changesMatch[1].trim()) {
    const text = `**Changes Made:**\n${changesMatch[1].trim()}`;
    return truncate(text);
  }

  // Look for a paragraph after "Perfect!" or "I've successfully"
  const successMatch = cleanOutput.match(/(?:Perfect!|I've successfully[^\n]*)\s*\n+([\s\S]*?)(?=\n##|\n###|\z)/);
  if (successMatch && successMatch[1].trim()) {
    return truncate(successMatch[1].trim());
  }

  // Fallback: return a generic message
  return "Addressed review feedback by implementing the requested changes.";
}

describe("Address Review - Claude Summary Extraction", () => {
  test("should extract ## Summary section", () => {
    const output = `
Perfect! I've successfully addressed the PR feedback.

## Summary

I've successfully removed the \`@disco/utils/float-number\` utility and replaced all its usages with the native \`toFixed()\` function.

## Changes Made

1. Removed files
2. Updated packages

## Verification

All tests pass.
`;

    const summary = extractClaudeSummary(output);
    expect(summary).toContain("removed the `@disco/utils/float-number` utility");
    expect(summary).not.toContain("## Changes Made");
  });

  test("should extract ### Changes Made section", () => {
    const output = `
Great! I've addressed the feedback.

### Changes Made:

1. **Removed files:**
   - \`packages/utils/src/float-number.ts\`
   - \`packages/utils/src/float-number.test.ts\`

2. **Updated packages:**
   - Updated state-management
   - Updated frontend

### Verification:

All good!
`;

    const summary = extractClaudeSummary(output);
    expect(summary).toContain("**Changes Made:**");
    expect(summary).toContain("Removed files:");
    expect(summary).not.toContain("### Verification:");
  });

  test("should extract paragraph after 'Perfect!'", () => {
    const output = `
Perfect! I've successfully addressed the PR feedback.

Here's a summary of the changes made: I removed the custom utility and replaced it with native toFixed().

## Details

More info here...
`;

    const summary = extractClaudeSummary(output);
    expect(summary).toContain("Here's a summary of the changes made");
    expect(summary).not.toContain("## Details");
  });

  test("should extract paragraph after 'I've successfully'", () => {
    const output = `
I've successfully completed the requested changes!

The main change was removing the fixFloatingPoint utility and using native JavaScript methods instead.

## Technical Details

Blah blah...
`;

    const summary = extractClaudeSummary(output);
    expect(summary).toContain("The main change was removing");
    expect(summary).not.toContain("## Technical Details");
  });

  test("should truncate long ## Summary sections to 500 chars", () => {
    const longText = "This is a very long summary that contains way too much text. ".repeat(20); // ~1200 chars
    const output = `Perfect! I've done it.

## Summary

${longText}

## More Details

Other info.`;

    const summary = extractClaudeSummary(output);
    expect(summary.length).toBeLessThanOrEqual(503); // 500 + "..."
    expect(summary).not.toContain("## More Details"); // Should stop at next section
  });

  test("should remove ANSI color codes from Summary section", () => {
    const output = `Perfect! I've successfully addressed the feedback.

## Summary

\x1b[1mBold text here\x1b[0m with colors removed.

## More Details

Other stuff.`;

    const summary = extractClaudeSummary(output);
    expect(summary).not.toMatch(/\x1b/);
    expect(summary).toContain("Bold text here");
  });

  test("should return fallback for unstructured output", () => {
    const output = "Just some random text without clear structure.";

    const summary = extractClaudeSummary(output);
    expect(summary).toBe("Addressed review feedback by implementing the requested changes.");
  });

  test("should handle real Claude output example", () => {
    const output = `
Perfect! I've successfully addressed the PR feedback. Here's a summary of the changes made:

## Summary

I've successfully removed the \`@disco/utils/float-number\` utility and replaced all its usages with the native \`toFixed()\` function as requested by the reviewer.

### Changes Made:

1. **Removed files:**
   - \`packages/utils/src/float-number.ts\` - The custom utility function
   - \`packages/utils/src/float-number.test.ts\` - Associated tests

2. **Updated \`packages/state-management/src/reducers/rightsManagement.ts\`:**
   - Removed the import of \`fixFloatingPoint\`
   - Replaced \`fixFloatingPoint()\` calls with \`parseFloat(number.toFixed(10))\`

3. **Updated \`packages/frontend/src/views/components/common/tracks/track-writers/index.tsx\`:**
   - Removed the import of \`fixFloatingPoint\`
   - Replaced the \`fixFloatingPoint()\` calls with \`parseFloat(...toFixed(10))\`

### Verification:

- ✅ All packages compile successfully
- ✅ \`@disco/state-management\` compiles without errors
- ✅ \`disco-frontend\` compiles without errors

The changes have been committed and are ready for review.
`;

    const summary = extractClaudeSummary(output);
    expect(summary).toContain("removed the `@disco/utils/float-number` utility");
    expect(summary).toContain("replaced all its usages");
    expect(summary).not.toContain("### Changes Made:");
  });
});
