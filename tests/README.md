# Test Directory Structure

This directory contains the test suite for the Claude Code Slack Bot.

## Directory Organization

```
tests/
├── unit/                   # Unit tests for individual components
│   ├── handlers/          # Handler classes (SlackHandler, ClaudeHandler, etc.)
│   ├── utils/             # Utility functions and helpers
│   └── managers/          # Manager classes (McpManager, WorkingDirectoryManager, etc.)
├── integration/           # Integration tests between components
│   ├── slack-flow/        # End-to-end Slack message flows
│   ├── permission-flow/   # Permission system integration tests
│   └── mcp-integration/   # MCP server integration tests
├── smoke/                 # Quick safety checks (run after each change)
├── performance/           # Performance regression tests
├── fixtures/              # Test data and mock files
├── debug/                 # Relocated debug test files (reference only)
├── setup.ts              # Global test configuration
└── README.md             # This file
```

## Test Types

### Smoke Tests (`tests/smoke/`)
Quick validation tests that verify basic functionality:
- Bot responds to messages
- File uploads work
- Permission system functions
- MCP servers load

**Purpose:** Run after every code change to ensure nothing is broken.
**Command:** `npm run test:smoke`

### Unit Tests (`tests/unit/`)
Test individual components in isolation:
- Each class and its methods
- Error handling
- Edge cases
- Input validation

**Coverage Target:** > 80% line coverage

### Integration Tests (`tests/integration/`)
Test component interactions:
- Slack message → Claude response flow
- Permission request → approval → execution
- File upload → processing → display

### Performance Tests (`tests/performance/`)
Monitor performance regressions:
- Response time limits
- Memory usage boundaries
- Concurrent operation limits

## Running Tests

```bash
# Run all tests
npm test

# Run specific test types
npm run test:smoke
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Test Naming Conventions

- **Test files:** `*.test.ts`
- **Describe blocks:** Component or function name
- **Test cases:** Should describe expected behavior

Example:
```typescript
describe('SlackHandler', () => {
  describe('handleMessage', () => {
    it('should process valid message events', async () => {
      // Test implementation
    });
  });
});
```

## Mock Strategy

- **External APIs:** Mock Slack API, Claude SDK
- **File System:** Mock file operations in tests
- **Network:** Mock HTTP requests
- **Time:** Use Jest fake timers where needed

## Safety Requirements

1. **Test Isolation:** Each test should be independent
2. **No Side Effects:** Tests should not modify global state
3. **Environment Cleanup:** Clean up after each test
4. **Resource Management:** No resource leaks

## Performance Targets

- **Smoke Tests:** Complete in < 30 seconds
- **Unit Tests:** Complete in < 2 minutes
- **Integration Tests:** Complete in < 5 minutes
- **Full Suite:** Complete in < 10 minutes