# Claude Intern - TypeScript Source

This directory contains the TypeScript source code for Claude Intern.

## Structure

```
src/
├── index.ts              # Main CLI entry point
├── lib/                  # Core library modules
│   ├── jira-client.ts    # JIRA API client
│   ├── claude-formatter.ts # Claude prompt formatter
│   └── utils.ts          # Utility functions
├── types/                # TypeScript type definitions
│   ├── index.ts          # Main types export
│   └── jira.ts           # JIRA-specific interfaces
└── examples/             # Example usage
    └── demo.ts           # Demo script with mock data
```

## Development

### Prerequisites

- Node.js 18+
- TypeScript (installed as dev dependency)

### Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Development mode (watch for changes)
npm run watch

# Run with ts-node (development)
npm run dev TASK-123

# Clean build directory
npm run clean
```

### Type Definitions

The project includes comprehensive TypeScript interfaces:

- **JiraIssue**: Complete JIRA issue structure
- **JiraComment**: Comment data with Atlassian Document Format
- **LinkedResource**: External links and references
- **FormattedTaskDetails**: Processed task data for Claude
- **AtlassianDocument**: Rich text document structure

### Adding New Features

1. Add types to `src/types/jira.ts` if needed
2. Implement functionality in appropriate `src/lib/` module
3. Update main CLI in `src/index.ts` if adding new options
4. Build and test: `npm run build && npm test`

### Code Style

- Use TypeScript strict mode
- Prefer interfaces over types for object definitions
- Use proper error handling with typed catch blocks
- Document public methods with JSDoc comments
- Follow existing naming conventions
