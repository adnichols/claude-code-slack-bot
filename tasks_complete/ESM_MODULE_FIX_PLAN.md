# ES Module Compatibility Fix Plan

## Problem Analysis

The production build fails with:
```
Error [ERR_REQUIRE_ESM]: require() of ES Module /home/anichols/code/claude-code-slack-bot/node_modules/@anthropic-ai/claude-code/sdk.mjs not supported.
```

**Root Cause:**
- The `@anthropic-ai/claude-code` package is an ES module (`.mjs` file)
- Our project compiles to CommonJS (`"module": "commonjs"` in tsconfig.json)
- Node.js cannot `require()` ES modules - it can only `import` them

**What happens:**
1. TypeScript source: `import { query } from '@anthropic-ai/claude-code'`
2. Compiled CommonJS: `const { query } = require('@anthropic-ai/claude-code')`  
3. Node.js error: Cannot require an ES module

## Solution: Convert Project to ES Modules

### Step 1: Update package.json
Add the `type` field to declare this as an ES module project:

```json
{
  "name": "claude-code-slack",
  "version": "1.0.0",
  "type": "module",
  "description": "",
  // ... rest of configuration
}
```

### Step 2: Update tsconfig.json
Change the module system to output ES modules:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",  // Changed from "commonjs"
    "lib": ["ES2020"],
    // ... rest of configuration remains the same
  }
}
```

### Step 3: Verify Build and Test
1. Run `npm run build` to ensure TypeScript compiles correctly
2. Run `npm run prod` to verify ES module imports work
3. Test basic functionality to ensure no regressions

## Expected Results

**Before Fix:**
- TypeScript compiles to: `const { query } = require('@anthropic-ai/claude-code')`
- Node.js throws ERR_REQUIRE_ESM error

**After Fix:**
- TypeScript compiles to: `import { query } from '@anthropic-ai/claude-code'`
- Node.js successfully imports the ES module
- Production build runs without module system errors

## Compatibility Notes

- This change makes the entire project an ES module
- All compiled JavaScript files will use `import`/`export` instead of `require`/`module.exports`
- Should be fully backward compatible with existing TypeScript source code
- No changes needed to existing import statements in source files

## Risk Assessment

**Low Risk Changes:**
- Modern Node.js (v18+) has excellent ES module support
- TypeScript handles the compilation differences transparently
- No breaking changes to the actual application logic

**Testing Required:**
- Verify build process completes successfully
- Confirm production startup works
- Basic smoke test of core functionality (Slack connectivity, Claude integration)