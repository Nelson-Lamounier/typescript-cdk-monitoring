<!-- @format -->

# Jest Template Initialization - Troubleshooting Guide

## Error 1: Template Is Undefined

### Error Summary

- **Error Type**: Runtime TypeError during test suite initialization
- **Error Message**: `TypeError: Cannot read properties of undefined (reading 'findResources')`
- **Context**: Occurs when accessing `template` or calling functions that use `template` in `describe` blocks before `beforeAll()` executes

### Root Cause Analysis

- **Why It Happened**:
  - Jest executes all code in `describe` blocks during initialization phase, before any `beforeAll()` hooks run
  - The `template` variable is declared but not yet assigned when describe-level code executes
  - Function calls at describe-level that depend on `template` execute with undefined value
- **Related Factors**: Conditional test registration patterns, helper functions called during initialization, direct template property access

### Resolution Steps

1. Move all `template` access into `it()` blocks or hook functions (`beforeAll`, `beforeEach`)
2. Replace immediate function calls with arrow function definitions:

   ```typescript
   // Before
   const count = countResourcesOfType(template, "AWS::EC2::VPC");

   // After
   const getCount = () => countResourcesOfType(template, "AWS::EC2::VPC");
   ```

3. Replace conditional test registration with conditional execution:

   ```typescript
   // Before
   if (natCount > 0) {
     it("test", () => {});
   }

   // After
   it("test (if NAT exists)", () => {
     if (getNatCount() === 0) return;
   });
   ```

4. Clear Jest caches: `rm -rf .jest-cache coverage dist/tests`

### Prevention

Use arrow functions for helpers that access template, never call them during describe-level initialization

### Related Issues

See Error 2 (IIFE patterns), Error 3 (conditional registration)

---

## Error 2: IIFE Causes Undefined Access

### Error Summary

- **Error Type**: Runtime TypeError during initialization
- **Error Message**: `TypeError: Cannot read properties of undefined`
- **Context**: Immediately Invoked Function Expressions (IIFE) in describe blocks execute during initialization

### Root Cause Analysis

- **Why It Happened**:
  - IIFE pattern `(() => { return template.method(); })()` executes immediately
  - Parentheses at end cause function to run during describe-level initialization
- **Related Factors**: Trying to cache computed values, attempting to DRY up test code incorrectly

### Resolution Steps

1. Remove IIFE patterns from describe blocks
2. Convert to arrow function definitions:

   ```typescript
   // Before
   const result = (() => template.findResources())();

   // After
   const getResult = () => template.findResources();
   ```

3. Call the arrow function inside test blocks where needed

### Prevention

Never use IIFE patterns in describe blocks; use arrow function definitions instead

### Related Issues

See Error 1 (template undefined), Error 4 (ESLint detection)

---

## Error 3: Conditional Test Registration Fails

### Error Summary

- **Error Type**: Runtime TypeError or tests not registered
- **Error Message**: `TypeError: Cannot read properties of undefined` or tests silently skip
- **Context**: Using `if` statements to conditionally register `it()` blocks based on template state

### Root Cause Analysis

- **Why It Happened**:
  - Condition evaluation happens during initialization when template is undefined
  - Tests inside `if` blocks may never register or crash during registration
- **Related Factors**: Environment-specific tests, optional resource checks

### Resolution Steps

1. Move condition check inside the test:

   ```typescript
   // Before
   if (getNatCount() > 0) {
     it("should have NAT", () => {
       /* test */
     });
   }

   // After
   it("should have NAT (if NAT exists)", () => {
     if (getNatCount() === 0) return;
     /* test */
   });
   ```

2. Update test name to indicate it's conditional (add "if condition" suffix)
3. Use early return to skip test when condition not met

### Prevention

Always register tests unconditionally; use early returns for conditional execution inside tests

### Related Issues

See Error 1 (template undefined)

---

## Error 4: ESLint Not Detecting Issues

### Error Summary

- **Error Type**: Configuration issue - linter not catching template access
- **Error Message**: No ESLint errors despite problematic template access
- **Context**: ESLint fails to flag template access in describe blocks

### Root Cause Analysis

- **Why It Happened**:
  - Custom rules not loaded or not configured correctly
  - File pattern mismatch (ESLint config not targeting test files)
  - ESLint server not restarted after configuration changes
- **Related Factors**: Glob pattern mismatch, plugin not installed, cache issues

### Resolution Steps

1. Verify dependencies installed: `eslint-plugin-jest`, custom rules file exists
2. Check file pattern in `eslint.config.mjs` includes test files: `**/*.test.ts`
3. Verify custom rules loaded:
   ```javascript
   const localRules = require("./.eslint-local-rules.mjs");
   plugins: {
     local: localRules;
   }
   ```
4. Restart ESLint server in IDE or run: `yarn eslint --print-config <test-file>`
5. Clear node cache: `rm -rf node_modules/.cache && yarn install`

### Prevention

Add ESLint pre-commit hooks to catch configuration issues early

### Related Issues

See Error 5 (pre-commit hook), Error 6 (lint-staged)

---

## Error 5: Pre-commit Hook Not Running

### Error Summary

- **Error Type**: Git hook execution failure
- **Error Message**: Hook does not execute on commit, or "permission denied"
- **Context**: Husky pre-commit hook fails to run validation scripts

### Root Cause Analysis

- **Why It Happened**:
  - Hook file not executable (`chmod +x` not applied)
  - Husky not initialized properly (`.git/hooks` not configured)
  - Hook script has syntax errors or references non-existent scripts
- **Related Factors**: Husky version mismatch (v4 vs v9), incorrect installation

### Resolution Steps

1. Verify hook exists and is executable:
   ```bash
   ls -la .husky/pre-commit
   chmod +x .husky/pre-commit
   ```
2. Test hook manually: `./.husky/pre-commit`
3. Reinitialize Husky if needed:
   ```bash
   rm -rf .git/hooks
   npx husky init
   ```
4. Verify `package.json` has prepare script: `"prepare": "husky"`

### Prevention

Add hook verification to CI/CD pipeline to ensure hooks are properly configured

### Related Issues

See Error 6 (lint-staged)

---

## Error 6: Lint-Staged Not Running on Test Files

### Error Summary

- **Error Type**: Configuration issue - lint-staged skips test files
- **Error Message**: No linting output despite staged test file changes
- **Context**: Committing test files does not trigger lint-staged checks

### Root Cause Analysis

- **Why It Happened**:
  - File glob pattern in `package.json` lint-staged config doesn't match test files
  - Lint-staged not installed or not called from pre-commit hook
- **Related Factors**: File pattern specificity, staged vs unstaged files

### Resolution Steps

1. Verify `package.json` lint-staged configuration:
   ```json
   "lint-staged": {
     "**/*.test.ts": ["eslint --fix", "bash scripts/validate-test-patterns.sh"]
   }
   ```
2. Test manually: `npx lint-staged --dry-run`
3. Ensure pre-commit hook calls lint-staged: `npx lint-staged`
4. Stage test file and verify: `git add test.test.ts && npx lint-staged`

### Prevention

Use broad glob patterns for test files (`**/*.test.ts`) to catch all test locations

### Related Issues

See Error 5 (pre-commit hook), Error 4 (ESLint detection)

---

## Quick Reference

### Jest Test Lifecycle

```
Initialization → Setup (beforeAll) → Test Execution (it)
    ❌               ✅                    ✅
  template         template              template
  undefined        defined               defined
```

### Safe Patterns

```typescript
// ✅ Arrow function definition
const getCount = () => countResourcesOfType(template, "AWS::EC2::VPC");

// ✅ Access in test
it("test", () => {
  const count = getCount();
  expect(count).toBe(1);
});

// ✅ Conditional execution
it("test (if condition)", () => {
  if (!checkCondition(template)) return;
  // test code
});
```

### Unsafe Patterns

```typescript
// ❌ Direct access
const count = countResourcesOfType(template, "AWS::EC2::VPC");

// ❌ IIFE
const result = (() => template.findResources())();

// ❌ Conditional registration
if (someCondition) {
  it("test", () => {});
}
```

### Diagnostic Commands

```bash
# Check for template access issues
yarn test:validate-patterns

# Run ESLint on tests
yarn lint tests/

# Check specific file
yarn eslint tests/unit/connectivity/networking-connectivity.test.ts

# Clear caches
rm -rf .jest-cache coverage dist/tests node_modules/.cache

# Debug ESLint config
yarn eslint --print-config <test-file>

# Test pre-commit hook
./.husky/pre-commit

# Test lint-staged
npx lint-staged --dry-run
```

### Verification Checklist

- [ ] No template access in describe blocks (outside it/beforeAll)
- [ ] Helper functions defined as arrow functions, not called immediately
- [ ] Conditional tests use early returns, not conditional registration
- [ ] Test names indicate conditional nature ("if condition")
- [ ] ESLint detects template access violations
- [ ] Pre-commit hook blocks commits with errors
- [ ] Lint-staged runs on test file changes

### File Structure

```
monitoring-iac/
├── .eslint-local-rules.mjs          # Custom rules: no-template-in-describe, no-iife-in-describe
├── eslint.config.mjs                # ESLint config with Jest plugin + custom rules
├── .husky/pre-commit                # Git hook running lint-staged + pattern validator
├── scripts/validate-test-patterns.sh # Shell script detecting problematic patterns
└── package.json                     # lint-staged config
```

### ESLint Rules Active

| Rule                            | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `local/no-template-in-describe` | Detects template access in describe blocks |
| `local/no-iife-in-describe`     | Prevents immediately invoked functions     |
| `jest/no-conditional-in-test`   | Flags conditional logic in tests           |
| `no-use-before-define`          | Catches variable use before initialization |

---

## Summary

**Primary Cause**: Accessing `template` during Jest's initialization phase (describe blocks) before `beforeAll()` assigns it.

**Primary Solution**: Move all template access into `it()` blocks or hooks; use arrow function definitions instead of immediate calls.

**Detection Layers**: ESLint (real-time), pattern validator (on commit), pre-commit hooks (automatic), CI/CD (final gate).

**Key Principle**: Never execute code that depends on `template` during test suite initialization.
