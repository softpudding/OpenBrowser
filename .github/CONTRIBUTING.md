# Contributing to OpenBrowser

Thank you for your interest in contributing to OpenBrowser! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Contributor License Agreement](#contributor-license-agreement)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)

## Code of Conduct

Be respectful and inclusive. We welcome contributions from everyone.

## Contributor License Agreement

Before we can accept your contributions, you need to sign a Contributor License Agreement (CLA). This is a legal document that ensures you have the right to contribute your code and grants the project the necessary licenses to use your contribution.

### Why Do We Need a CLA?

1. **Legal Protection**: Protects both contributors and the project from intellectual property disputes
2. **LGPL Compatibility**: OpenBrowser is licensed under LGPL-3.0, which requires clear licensing terms for contributions
3. **Patent Grant**: Provides patent protection for all users of the project
4. **Future Flexibility**: Allows the project to update to newer license versions if needed

### Which CLA Should I Sign?

| Your Situation | CLA Required |
|----------------|--------------|
| Individual contributing on your own time | [Individual CLA](./CLA_INDIVIDUAL.md) |
| Employee contributing as part of your job | [Corporate CLA](./CLA_CORPORATE.md) |
| Both individual and work contributions | Sign both CLAs |

### How to Sign

#### Option 1: Automatic (Recommended)

When you open a Pull Request, the CLA Assistant bot will automatically check if you've signed the CLA. If not, it will guide you through the one-click signing process using your GitHub account.

#### Option 2: Manual

1. Fork the repository
2. Create a signature file:
   - Individual: `.github/cla-signatures/individual/<your-username>.md`
   - Corporate: `.github/cla-signatures/corporate/<organization-name>.md`
3. Copy the template from the relevant CLA document
4. Fill in your information
5. Submit a Pull Request

### CLA Documents

- [Individual CLA](./CLA_INDIVIDUAL.md) - For individual contributors
- [Corporate CLA](./CLA_CORPORATE.md) - For companies/organizations
- [CLA Setup Guide](./CLA_SETUP.md) - Technical setup details

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/OpenBrowser.git
   cd OpenBrowser
   ```
3. Install dependencies:
   ```bash
   # Python dependencies
   uv sync

   # Extension dependencies
   cd extension && npm install && cd ..
   ```

## Development Setup

### Server (Python)

```bash
# Install with dev dependencies
uv sync --group dev

# Run the server
uv run local-chrome-server serve

# Run tests
uv run pytest

# Type checking
uv run mypy server/
```

### Extension (TypeScript)

```bash
cd extension

# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build

# Type checking
npm run typecheck
```

## Pull Request Process

1. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards

3. **Test your changes**:
   - Run the test suite
   - Test manually if applicable
   - Check type errors

4. **Commit your changes** with clear messages:
   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve issue with X"
   git commit -m "docs: update README"
   ```

5. **Push and create a Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **CLA Check**: The CLA Assistant bot will check if you've signed the CLA. If not, follow the instructions to sign.

7. **Code Review**: Maintainers will review your PR. Address any feedback.

8. **Merge**: Once approved and CI passes, your PR will be merged.

## Coding Standards

### Python

- **Line length**: 88 characters (black/ruff)
- **Target**: Python 3.12+
- **Type hints**: Required (strict mypy)
- **Formatting**: Use ruff for linting and formatting
- **Imports**: Sorted via ruff (isort compatible)

### TypeScript

- **Target**: ES2022
- **Strict mode**: Enabled
- **Path alias**: Use `@/*` for `src/*`
- **No type suppression**: Avoid `as any`, `@ts-ignore`, `@ts-expect-error`

### General

- Write clear, self-documenting code
- Add comments for complex logic
- Update documentation when changing behavior
- Write tests for new functionality

## Questions?

- Open an issue: https://github.com/softpudding/OpenBrowser/issues
- Read the documentation: Check `README.md` and `DESIGN.md`

---

Thank you for contributing to OpenBrowser!