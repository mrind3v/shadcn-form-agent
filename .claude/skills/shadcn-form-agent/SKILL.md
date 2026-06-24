```markdown
# shadcn-form-agent Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `shadcn-form-agent` TypeScript codebase. It covers file organization, code style, commit message patterns, and testing approaches to ensure consistency and maintainability throughout the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `formAgent.ts`, `userInputHandler.ts`

### Import Style
- Use **relative imports** for internal modules.
  - Example:
    ```typescript
    import { validateForm } from './validateForm';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    export function validateForm(data: FormData) { ... }
    ```

### Commit Messages
- Follow the **Conventional Commits** standard.
- Use the `feat` prefix for new features.
  - Example: `feat: add validation for email input`

## Workflows

### Creating a New Feature
**Trigger:** When adding a new feature to the codebase  
**Command:** `/new-feature`

1. Create a new TypeScript file using camelCase naming.
2. Implement the feature using named exports.
3. Import dependencies using relative paths.
4. Write or update corresponding test files (`*.test.ts`).
5. Commit changes with a message like: `feat: [short description of feature]`.

### Refactoring Code
**Trigger:** When improving or restructuring existing code  
**Command:** `/refactor`

1. Identify the code to refactor.
2. Update file names to camelCase if needed.
3. Ensure all imports are relative.
4. Use named exports consistently.
5. Run all tests to verify correctness.
6. Commit with a message like: `feat: refactor [component or function name] for clarity`.

### Writing Tests
**Trigger:** When adding or updating tests  
**Command:** `/write-test`

1. Create or update test files using the `*.test.ts` pattern.
2. Write tests for each exported function or component.
3. Use the project's preferred (undetected) testing framework.
4. Run tests to ensure they pass.
5. Commit with a message like: `feat: add tests for [feature or function]`.

## Testing Patterns

- Test files follow the `*.test.ts` naming convention.
- Each exported function or module should have corresponding tests.
- The specific testing framework is not detected, but standard TypeScript testing practices apply.
- Example test file:
  ```typescript
  import { validateForm } from './validateForm';

  test('validates required fields', () => {
    // test implementation
  });
  ```

## Commands
| Command        | Purpose                                   |
|----------------|-------------------------------------------|
| /new-feature   | Start the process to add a new feature    |
| /refactor      | Begin a code refactor workflow            |
| /write-test    | Add or update tests for a module/function |
```
