# Task List: Claude File Content Display Fix

Based on the implementation plan in `CLAUDE_FILE_CONTENT_DISPLAY_FIX.md`

## Relevant Files

- `src/slack-handler.ts` - Main Slack message processing logic; handles `user` messages with `tool_result` content with comprehensive security validation, advanced content formatting, error handling, and rate limiting protection (lines 422-1450+ contain user message handling, security validation, content formatting, error handling, and tool result processing) - **IMPLEMENTATION COMPLETE**
- `src/claude-handler.ts` - Claude SDK integration; already has comprehensive logging for tool use tracking (lines 194-224 track tool uses)
- `src/types.ts` - Type definitions; may need additional types for tool result handling
- `src/logger.ts` - Logging utility; already used extensively for debugging message flow
- `test-files/` - Sample files for testing Read tool functionality
  - `sample-code.js` - JavaScript file for testing content display
  - `sample-data.json` - JSON data file for testing  
  - `sample-readme.md` - Markdown file for testing
  - `safe-content.js` - Clean JavaScript file for testing safe content display
  - `unsafe-api-keys.js` - Test file with API keys and tokens (should be blocked)
  - `unsafe-aws-credentials.env` - Environment file with AWS credentials (should be blocked)
  - `unsafe-github-secrets.yaml` - YAML with GitHub tokens and private keys (should be blocked)
  - `unsafe-secrets.txt` - Text file with JWT tokens and sensitive strings (should be blocked)
  - `large-file.js` - 277KB JavaScript file for testing size limits (should be blocked)
  - `binary-test.bin` - 5KB binary file for testing binary content handling (Read tool prevents access)

### Notes

- No existing test framework detected in codebase (no test files or test scripts in package.json)
- Current codebase uses comprehensive logging for debugging (Logger class) 
- Security validation is critical - must prevent credential exposure
- File content truncation needed to prevent Slack API rate limiting
- **KEY FINDING**: File content arrives in `type: "user"` messages with `tool_result` content per investigation

## Tasks

- [x] 1.0 Add User Message Handler for Tool Results
  - [x] 1.1 Add `else if (message.type === 'user')` condition in slack-handler.ts message processing loop (after line 373)
  - [x] 1.2 Implement `handleUserMessage()` method to process tool result content from user messages
  - [x] 1.3 Extract `tool_result` content from message.message.content array structure
  - [x] 1.4 Add logging to track user message processing and tool result extraction

- [x] 2.0 Implement Security Validation System  
  - [x] 2.1 Create `isSafeToDisplay()` method with comprehensive credential detection patterns
  - [x] 2.2 Add regex patterns for API keys, JWT tokens, AWS credentials, GitHub tokens, Slack tokens, private keys
  - [x] 2.3 Implement `isPathSafe()` method with directory traversal protection
  - [x] 2.4 Add sensitive pattern detection for passwords, secrets, and long hex strings
  - [x] 2.5 Test security validation with sample files containing various credential types

- [x] 3.0 Add Content Formatting and Display Logic
  - [x] 3.1 Create `displayFileContent()` method with 400 character truncation limit  
  - [x] 3.2 Implement `truncateContent()` with smart line-break truncation
  - [x] 3.3 Add `getLanguageFromPath()` for syntax highlighting hints
  - [x] 3.4 Format content as code blocks with proper escaping for Slack
  - [x] 3.5 Add `shouldDisplayToolResult()` method to filter Read tool results only

- [x] 4.0 Add Error Handling and Rate Limiting Protection
  - [x] 4.1 Add 50KB memory limit protection in displayFileContent()
  - [x] 4.2 Implement rate limiting delays for large content (500ms for >1000 chars)
  - [x] 4.3 Add comprehensive try-catch error handling with graceful fallbacks
  - [x] 4.4 Create fallback messages for oversized content and security blocks
  - [x] 4.5 Add cleanup and recovery mechanisms to prevent bot crashes

- [x] 5.0 Test and Validate Implementation
  - [x] 5.1 Test with sample files in test-files/ directory (sample-code.js, sample-data.json, sample-readme.md)
  - [x] 5.2 Create test files with API keys, passwords, tokens to verify security blocking
  - [x] 5.3 Test with large files (>50KB) to verify size limits and truncation
  - [x] 5.4 Test with binary files to ensure appropriate handling
  - [x] 5.5 Verify no regression in existing functionality (tool use, assistant messages, todo handling)
  - [x] 5.6 Test end-to-end: user asks to read file → file content displays in Slack thread