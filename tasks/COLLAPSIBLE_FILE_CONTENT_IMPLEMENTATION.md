# Collapsible File Content Implementation Plan

## Problem Statement
Currently, file content is displayed as large code blocks that:
- Dominate Slack conversations 
- Cannot be collapsed by users
- Create visual noise in channels
- Don't provide optimal syntax highlighting
- Can be overwhelming for large files (now up to 35,000 characters)

## Proposed Solution: Slack Snippets

Replace code block display with Slack's native `files.upload` API to create **snippets** that are:
- ✅ Automatically collapsible with "Show more" button
- ✅ Proper syntax highlighting based on file type
- ✅ Less intrusive in conversations
- ✅ Familiar developer UX
- ✅ Better handling of large content

## Technical Implementation Analysis

### 1. Slack files.upload API Requirements

```typescript
app.client.files.upload({
  channels: channelId,
  thread_ts: threadTs,          // Post in thread
  content: fileContent,         // String content
  filename: 'example.js',       // For syntax highlighting
  filetype: 'javascript',       // Explicit file type
  title: 'File Content',       // Snippet title
  initial_comment: 'Reading file: /path/to/file' // Optional comment
})
```

**Key Parameters:**
- `content` - The actual file content as string (preferred over `file` buffer)
- `filename` - Critical for syntax highlighting (e.g., 'component.tsx')
- `filetype` - Slack file type for highlighting ('javascript', 'typescript', 'python', etc.)
- `title` - Shows above the snippet
- `initial_comment` - Additional context
- `thread_ts` - Ensures it posts in the correct thread

### 2. Required Slack Bot Permissions

**Current permissions:** ✅ Already have these
- `files:write` - Required for files.upload
- `chat:write` - For thread posting

**Verification needed:** Check if bot token has `files:write` scope.

### 3. File Type Detection Strategy

**Enhanced mapping beyond current `getLanguageFromPath()`:**

```typescript
private getSlackFileType(filePath: string): { filetype: string; filename: string } {
  const ext = path.extname(filePath).toLowerCase().substring(1);
  const basename = path.basename(filePath) || 'content';
  
  const typeMap: Record<string, string> = {
    // Web technologies
    'js': 'javascript',
    'jsx': 'javascript', 
    'ts': 'typescript',
    'tsx': 'typescript',
    'html': 'html',
    'css': 'css',
    'scss': 'css',
    'json': 'json',
    
    // Backend languages
    'py': 'python',
    'rb': 'ruby',
    'php': 'php',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'cpp': 'cpp',
    'c': 'c',
    
    // Others
    'md': 'markdown',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell'
  };
  
  return {
    filetype: typeMap[ext] || 'text',
    filename: basename.includes('.') ? basename : `${basename}.${ext || 'txt'}`
  };
}
```

### 4. Integration Points

**Current flow:**
```
toolResult.content -> displayFileContent() -> formatAsCodeBlock() -> say()
```

**New flow:**
```
toolResult.content -> displayFileContent() -> uploadAsSnippet() -> files.upload()
```

**Modified `displayFileContent()` logic:**
1. Apply existing security checks ✅ (keep current)
2. Strip line numbers and system reminders ✅ (keep current) 
3. **NEW:** Check content size for snippet vs fallback
4. **NEW:** Extract/generate filename from content or context
5. **NEW:** Upload as snippet instead of returning formatted text
6. **NEW:** Handle upload errors with graceful fallback

### 5. Content Size Considerations

**Slack snippet limits:**
- **1MB total file size limit** for snippets
- **35,000 characters = ~35KB** (well under limit)
- **Current 50KB memory limit** may need adjustment for very large files

**Strategy:**
```typescript
if (cleanContent.length > 35000) {
  // Truncate to 35,000 chars (current logic) 
  // Add truncation note in snippet title
} else if (cleanContent.length < 100) {
  // Very small content - maybe use code block instead?
  // Or always use snippet for consistency
}
```

### 6. Error Handling & Fallbacks

**Potential failure points:**
1. `files.upload` API failure (rate limits, permissions, network)
2. Invalid file type detection
3. Content too large for snippet
4. Missing channel/thread context

**Fallback strategy:**
```typescript
try {
  await uploadAsSnippet(content, filePath, channel, thread_ts);
} catch (snippetError) {
  this.logger.warn('Snippet upload failed, falling back to code block', { error: snippetError });
  // Fall back to current code block method
  return this.createCodeBlockFallback(content, filePath);
}
```

### 7. Implementation Architecture

**New method structure:**
```typescript
private async uploadFileContentSnippet(
  content: string,
  filePath: string | null,
  channelId: string, 
  threadTs: string,
  toolUseId?: string
): Promise<void> {
  
  // 1. Security validation (existing)
  // 2. Content cleaning (existing) 
  // 3. Size check and truncation
  // 4. File type detection
  // 5. Snippet upload
  // 6. Error handling with fallback
}

// Modified existing method
private displayFileContent(content: string, toolUseId?: string): string | null {
  // This method now returns null and handles upload internally
  // OR returns fallback code block text if snippet upload fails
}
```

### 8. User Experience Improvements

**Snippet title strategies:**
- `📄 File Content` (generic)
- `📄 /path/to/file.js` (if path detected)
- `📄 File Content (showing 1,234 of 5,678 characters)` (if truncated)

**Initial comment options:**
- `Claude read this file content` 
- `File content from Read tool` (technical)
- No comment (cleaner)

### 9. Testing Strategy

**Test scenarios:**
1. **Small files (<100 chars)** - ensure snippet still works
2. **Medium files (1,000-10,000 chars)** - optimal case
3. **Large files (35,000+ chars)** - truncation handling
4. **Various file types** - syntax highlighting verification
5. **Unknown file types** - fallback to 'text' type
6. **Upload failures** - fallback to code blocks
7. **Security blocked content** - existing security handling
8. **No file path detected** - generic filename generation

### 10. Migration Considerations

**Backward compatibility:**
- Keep existing `formatToolResult()` as fallback
- Existing security and filtering logic unchanged
- Same thread posting behavior
- Same error logging and monitoring

**Feature flag approach:**
```typescript
private readonly USE_SNIPPETS_FOR_FILE_CONTENT = true; // Easy toggle

private async handleToolResult(...) {
  if (this.USE_SNIPPETS_FOR_FILE_CONTENT && this.isFileContent(toolResult)) {
    await this.uploadFileContentSnippet(...);
  } else {
    // Current code block approach
    const formatted = this.displayFileContent(...);
    if (formatted) await say({ text: formatted, thread_ts: threadTs });
  }
}
```

## Implementation Priority

### Phase 1 (Core functionality)
1. ✅ Create `getSlackFileType()` method
2. ✅ Create `uploadFileContentSnippet()` method  
3. ✅ Integrate with existing `handleToolResult()` flow
4. ✅ Basic error handling with code block fallback

### Phase 2 (Polish)
5. ✅ Enhanced filename generation from content analysis
6. ✅ Optimized title and comment text
7. ✅ Comprehensive testing with various file types

### Phase 3 (Optional)
8. ⏸️  Smart size-based snippet vs code block decisions
9. ⏸️  User preference configuration
10. ⏸️ Analytics on snippet usage vs fallbacks

## Success Criteria

1. **Primary**: File content appears as collapsible snippets in Slack threads
2. **UX**: Conversations are less cluttered with large code blocks
3. **Functionality**: Syntax highlighting works for common file types
4. **Reliability**: Graceful fallback to code blocks on snippet failures  
5. **Performance**: No degradation in response times
6. **Security**: All existing security filtering continues to work

## Risk Assessment

**Low risk:**
- ✅ Additive change (existing fallback preserved)
- ✅ Uses standard Slack API
- ✅ No changes to core Claude integration
- ✅ Easy to disable via feature flag

**Medium risk:**
- ⚠️  Slack API rate limits (but files.upload has generous limits)
- ⚠️  User preference (some may prefer code blocks)
- ⚠️  Different UX pattern (but better for large content)

**Mitigation:**
- Comprehensive fallback strategy
- Feature flag for easy disable
- Gradual rollout capability
- Monitoring of snippet vs fallback usage

## Questions for Review

1. **Should very small content (< 100 chars) still use snippets for consistency?**
2. **What's the ideal snippet title format?**
3. **Should we add an initial comment or keep it clean?**
4. **Any concerns about changing from code blocks to snippets UX?**
5. **Should this be behind a feature flag initially?**