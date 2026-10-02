# Contributing to Wellth.ai

Thank you for your interest in contributing to Wellth.ai! This document provides guidelines and instructions for contributing to our HIPAA-compliant healthcare expense management platform.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Security Guidelines](#security-guidelines)
- [Pull Request Process](#pull-request-process)
- [Documentation](#documentation)
- [Code Review Checklist](#code-review-checklist)

## Code of Conduct

### Our Standards

- **Respectful Communication:** Treat all contributors with respect
- **Constructive Feedback:** Provide helpful, actionable feedback in reviews
- **Collaboration:** Work together to build the best healthcare finance tool
- **Privacy First:** Never share PHI or real user data in issues or PRs
- **Security Focus:** Report vulnerabilities responsibly (see [SECURITY.md](docs/security/SECURITY.md))

## Getting Started

### Prerequisites

Before contributing, ensure you have:

- Node.js 18+ and npm installed
- Git configured with your name and email
- A Supabase account for testing
- Familiarity with React, TypeScript, and PostgreSQL

### Development Setup

1. **Fork the repository**

   ```bash
   # Navigate to https://github.com/wellthaifounder/claude-supabase-starter
   # Click "Fork" button
   ```

2. **Clone your fork**

   ```bash
   git clone https://github.com/YOUR_USERNAME/claude-supabase-starter.git
   cd wellth-ai
   ```

3. **Add upstream remote**

   ```bash
   git remote add upstream https://github.com/wellthaifounder/claude-supabase-starter.git
   ```

4. **Install dependencies**

   ```bash
   npm install
   ```

5. **Set up environment**

   ```bash
   cp .env.example .env
   # Edit .env with your development credentials
   ```

6. **Run migrations**

   ```bash
   npx supabase link --project-ref your-test-project-ref
   npx supabase db push
   ```

7. **Start development server**
   ```bash
   npm run dev
   ```

## Development Workflow

### Branch Naming

Use descriptive branch names following these patterns:

- `feature/description` - New features (e.g., `feature/multi-account-support`)
- `bugfix/description` - Bug fixes (e.g., `bugfix/transaction-sync-error`)
- `security/description` - Security improvements (e.g., `security/enhance-phi-redaction`)
- `docs/description` - Documentation updates (e.g., `docs/api-edge-functions`)
- `refactor/description` - Code refactoring (e.g., `refactor/simplify-hsa-logic`)

### Commit Messages

Follow conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `security`: Security improvements
- `perf`: Performance improvements
- `chore`: Maintenance tasks

**Examples:**

```bash
feat(transactions): add bulk import from CSV
fix(bills): resolve duplicate bill detection issue
security(auth): implement session timeout
docs(api): document plaid-sync-transactions edge function
```

### Keeping Your Fork Updated

```bash
# Fetch upstream changes
git fetch upstream

# Merge upstream main into your local main
git checkout main
git merge upstream/main

# Update your fork
git push origin main
```

## Coding Standards

### TypeScript

- **Strict mode required:** All TypeScript must pass strict type checking
- **Explicit types:** Provide explicit return types for exported functions
- **Interfaces over types:** Use `interface` for object shapes
- **Zod for validation:** Use Zod schemas for runtime validation

```typescript
// Good
interface User {
  id: string;
  email: string;
  name: string;
}

export async function getUser(id: string): Promise<User | null> {
  // Implementation
}

// Bad
export async function getUser(id) {
  // Implementation
}
```

### React Patterns

- **Function components only:** No class components
- **Hooks at top:** All hooks before any conditional logic
- **Custom hooks:** Extract reusable logic into custom hooks
- **React Query:** Use React Query for server state
- **Event handler naming:** Use `handle` prefix (e.g., `handleClick`, `handleSubmit`)

```typescript
// Good
export function ExpenseList() {
  const { data: expenses } = useQuery({
    queryKey: ['expenses'],
    queryFn: fetchExpenses
  });

  const handleDelete = async (id: string) => {
    // Implementation
  };

  return (
    // JSX
  );
}
```

### Component Structure

```typescript
// 1. Imports
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// 2. Types/Interfaces
interface Props {
  userId: string;
}

// 3. Component
export function Component({ userId }: Props) {
  // 4. Hooks
  const [state, setState] = useState();
  const { data } = useQuery(...);

  // 5. Event handlers
  const handleEvent = () => {};

  // 6. Effects
  useEffect(() => {}, []);

  // 7. Render
  return (...);
}
```

### Naming Conventions

- **Components:** PascalCase (`BillReview`, `ExpenseForm`)
- **Hooks:** camelCase with `use` prefix (`useSessionTimeout`, `useExpenses`)
- **Utils/Functions:** camelCase (`calculateTotal`, `formatCurrency`)
- **Constants:** SCREAMING_SNAKE_CASE (`MAX_FILE_SIZE`, `API_ENDPOINT`)
- **Files:** Match component name (`BillReview.tsx`, `useExpenses.ts`)

### Styling

- **Tailwind classes only:** Use Tailwind utility classes
- **Design tokens:** Reference design system tokens (via CSS variables)
- **Mobile-first:** Write mobile styles first, then tablet/desktop
- **Semantic colors:** Use `primary`, `secondary`, etc. (not hardcoded colors)

```tsx
// Good
<button className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md">
  Submit
</button>

// Bad
<button className="bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 rounded-md">
  Submit
</button>
```

### Error Handling

**Always use error sanitization utilities:**

```typescript
import { handleError, logError } from "@/utils/errorHandler";

try {
  await riskyOperation();
} catch (error) {
  // Development logging only, no PHI in production
  logError("Operation failed", error, { context: "specific-operation" });

  // User-facing generic message
  handleError(
    error,
    "specific-operation",
    toast,
    "Failed to complete operation",
  );
}
```

### Security Requirements

1. **Never commit secrets** - Use `.env` for all credentials
2. **Validate all inputs** - Use Zod schemas for form validation
3. **No PHI in logs** - Use `logError` utility for safe logging
4. **Sanitize errors** - Use `handleError` for user-facing messages
5. **RLS policies** - All new tables must have RLS policies
6. **Explicit user checks** - Verify `user_id` in queries (defense in depth)

```typescript
// Good - Explicit user check
const { data } = await supabase
  .from("expenses")
  .select("*")
  .eq("user_id", user.id); // Explicit ownership check

// Still safe (RLS enforces), but explicit is better
const { data } = await supabase.from("expenses").select("*");
```

## Testing Requirements

### Unit Tests

- Write unit tests for utility functions
- Use Node's built-in test runner (`node:test`); tests live beside the code as `*.test.ts`
- Aim for >80% coverage on business logic

### Integration Tests

- Test edge functions with mock Supabase client
- Verify RLS policies work correctly
- Test authentication flows

### Accessibility Testing

- All components must pass WCAG 2.1 AA
- Test with keyboard navigation
- Test with screen reader (NVDA/JAWS)
- Verify color contrast ratios

### Running Tests

```bash
npm test              # Run all tests (node --test src/lib/*.test.ts)
```

## Pull Request Process

### Before Submitting

1. **Ensure tests pass**

   ```bash
   npm run lint
   npm run build
   npm run test
   ```

2. **Update documentation**
   - Update relevant docs in `docs/`
   - Add JSDoc comments for complex functions
   - Update CHANGELOG.md

3. **Verify no secrets**
   ```bash
   git diff main --name-only | xargs grep -l "SUPABASE_KEY\|STRIPE_SECRET\|PLAID_SECRET"
   ```

### PR Template

Use this template for all pull requests:

```markdown
## Description

[Brief description of changes]

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update

## Related Issues

Fixes #[issue number]

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Accessibility tested
- [ ] Manual testing completed

## Security Checklist

- [ ] No secrets committed
- [ ] Input validation added
- [ ] Error sanitization implemented
- [ ] RLS policies updated (if applicable)
- [ ] No PHI in logs

## Documentation

- [ ] Code comments added
- [ ] docs/ updated
- [ ] CHANGELOG.md updated

## Screenshots (if applicable)

[Add screenshots]
```

### PR Guidelines

- **Keep PRs focused:** One feature or fix per PR
- **Small PRs:** Prefer smaller, reviewable PRs (<500 lines)
- **Descriptive titles:** Use conventional commit format
- **Link issues:** Reference related GitHub issues
- **Request reviews:** Tag appropriate reviewers

### Review Process

1. **Automated checks:** CI/CD runs linting, tests, build
2. **Code review:** At least one maintainer approval required
3. **Security review:** Security-related changes need security team review
4. **Testing:** Manual testing for UI changes
5. **Merge:** Squash and merge into main

## Documentation

### When to Update Docs

- **New features:** Add to `docs/features/`
- **API changes:** Update `docs/api/`
- **Database changes:** Update `docs/database/schema.md`
- **Security changes:** Update `docs/security/`
- **Configuration changes:** Update `.env.example` and `docs/getting-started/environment-variables.md`

### Documentation Standards

- Use Markdown for all docs
- Include code examples
- Add links to related documentation
- Keep language clear and concise
- Update table of contents

## Code Review Checklist

Use this checklist when reviewing PRs:

### Functionality

- [ ] Code works as described
- [ ] No unintended side effects
- [ ] Edge cases handled
- [ ] Error handling implemented

### Code Quality

- [ ] Follows coding standards
- [ ] No code duplication
- [ ] Functions are focused and small
- [ ] Variable names are clear
- [ ] Comments explain "why" not "what"

### Testing

- [ ] Tests added for new code
- [ ] All tests pass
- [ ] Coverage maintained or improved

### Security

- [ ] No secrets in code
- [ ] Input validation present
- [ ] Error messages sanitized
- [ ] RLS policies correct
- [ ] No PHI exposure

### Performance

- [ ] No N+1 queries
- [ ] Database queries optimized
- [ ] Proper caching implemented
- [ ] No unnecessary re-renders

### Accessibility

- [ ] Keyboard navigation works
- [ ] ARIA labels present
- [ ] Color contrast sufficient
- [ ] Screen reader friendly

### Documentation

- [ ] Code comments added
- [ ] docs/ updated
- [ ] CHANGELOG.md updated
- [ ] README.md updated (if needed)

## Questions or Issues?

- **Documentation:** Check [docs/](docs/)
- **Questions:** Open a [GitHub Discussion](https://github.com/wellthaifounder/claude-supabase-starter/discussions)
- **Bugs:** Open a [GitHub Issue](https://github.com/wellthaifounder/claude-supabase-starter/issues)
- **Security:** Email security@wellth.ai

## License

By contributing to Wellth.ai, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to Wellth.ai! Your efforts help us build better healthcare finance tools for everyone.
