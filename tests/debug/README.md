# Debug Test Files

This directory contains the original debug test files that were used during development and troubleshooting of the permission system. These files have been preserved for reference and historical context.

## File Descriptions

Based on Phase 0 analysis, these test files validate:

### Permission System Tests
- **`debug-permission-test.js`** - Single focused test with maximum debug logging for permission system troubleshooting
- **`simple-permission-test.js`** - Basic permission flow testing that simulates Slack message → Claude response → permission request flow
- **`test-actual-permission.js`** - Tests actual permission implementation to replicate exact user-reported scenarios
- **`test-exact-failing-command.js`** - Edge case testing for specific failing command patterns and error conditions
- **`test-full-permission-flow.js`** - Complete end-to-end testing: Request → Approve → Execute with specific tools (Bash, GitHub, Read)
- **`test-just-bash.js`** - Focused testing of only the Bash tool with maximum logging to isolate bash-specific issues
- **`test-permissions.js`** - Core permission functionality testing with GitHub tool permissions and approval workflows

### Configuration Tests  
- **`test-local-config.js`** - Local configuration integration testing - validates `.claude/settings.json` loading, caching, and permission rules

## Key Test Scenarios Preserved

From the analysis, these tests validated:
- Permission request → approval → execution flow
- Local config file loading and caching  
- Tool-specific permission handling (Bash, GitHub, Read)
- Edge case command validation
- Permission persistence and reuse

## Usage

These files are **FOR REFERENCE ONLY**. They use the old testing patterns and are not part of the new Jest test suite.

For modern equivalents, see:
- `tests/smoke/permissions.test.ts` - Basic permission system smoke tests
- `tests/integration/permission-flow/` - Modern permission flow integration tests

## Historical Context

These tests were created during the development of the permission system to debug specific issues with:
- Claude Code tool execution
- Slack permission prompts
- Local configuration file handling
- MCP server integration

They represent valuable debugging scenarios that should be considered when implementing proper Jest-based tests.

## Migration Status

- ✅ **Files relocated** from root directory to `tests/debug/`
- ✅ **Analysis completed** - functionality catalogued in Phase 0
- ✅ **Key scenarios identified** for proper test implementation
- 🔄 **Modern tests in progress** - Jest-based equivalents being developed

## Safety Note

These files were confirmed safe to move in Phase 0 analysis:
- No production code references found
- No imports by `src/` files  
- Development/debugging only usage
- No CI/CD integration dependencies