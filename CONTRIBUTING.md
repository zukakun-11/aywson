# Contributing to aywson

Thanks for your interest in contributing to aywson! This document provides guidelines and instructions for contributing.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/threepointone/aywson.git
   cd aywson
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run tests**

   ```bash
   npm test
   ```

4. **Build the project**

   ```bash
   npm run build
   ```

## Project Structure

```
src/
├── index.ts       # Main library exports (parse, get, set, merge, etc.)
├── index.test.ts  # Library tests
├── cli.ts         # CLI entry point
├── cli-lib.ts     # CLI implementation
└── cli.test.ts    # CLI tests
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Before submitting a PR, run:

```bash
npm run check
```

This will run both Biome and TypeScript type checking.

## Running Tests

Tests are written with [Vitest](https://vitest.dev/):

```bash
# Run tests once
npm test

# Run tests in watch mode
npm test -- --watch
```

## Submitting Changes

1. **Fork the repository** and create a new branch for your changes.

2. **Make your changes** with clear, focused commits.

3. **Add tests** for any new functionality or bug fixes.

4. **Run the checks** to ensure everything passes:

   ```bash
   npm run check
   npm test
   ```

5. **Submit a pull request** with a clear description of your changes.

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs. If your PR includes user-facing changes:

1. Run `npx changeset` to create a changeset
2. Select the appropriate semver bump (patch, minor, major)
3. Write a brief description of the change
4. Commit the generated changeset file with your PR

## Reporting Issues

Found a bug or have a feature request? Please [open an issue](https://github.com/threepointone/aywson/issues) with:

- A clear description of the problem or suggestion
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- JSONC input/output examples if applicable

## License

By contributing to aywson, you agree that your contributions will be licensed under the MIT License.
