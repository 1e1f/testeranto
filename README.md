---
status: todo
title: Readme.md
description: 'Feature: Readme.md'
---
# Testeranto

## What is it?

Testeranto is a Bun/TypeScript test runner that uses Docker as a multi-language process manager. You wrap your code in BDD (Given-When-Then), AAA (Arrange-Act-Assert), or TDT (Table-Driven Testing) semantics, run the tests, and pipe the results into an LLM context so AI agents can fix your code automatically.

In concrete terms it is:
- A **Bun server** that orchestrates test execution
- **Docker** as the runtime for each language (Node, Python, Java, Ruby, Go, Rust)
- A **VS Code extension** to manage the server and view results
- Six language-specific test packages: `tiposkripto` (TS/JS), `pitono` (Python), `golingvu` (Go), `rusto` (Rust), `kafe` (Java), `rubeno` (Ruby)

---

## Quick Start (trying it on this repo)

**Prerequisites:** [Bun](https://bun.sh) and [Docker Desktop](https://www.docker.com/products/docker-desktop/) must be installed and Docker must be running.

> **`docker` not found?** Docker Desktop installs to `/usr/local/bin`. If it's missing from your PATH: `export PATH="/usr/local/bin:$PATH"` (add to `~/.zshrc` to make it permanent).
>
> **Docker Desktop giving you trouble?** [OrbStack](https://orbstack.dev) is a lightweight macOS alternative that's fully compatible and tends to cause fewer problems. `brew install orbstack` or download from orbstack.dev.

```bash
# 1. Install dependencies
bun install

# 2. Build runtimes + CLI, create workspace, start server
bun run start
```

Or step by step:

```bash
bun install
bun run build   # esbuild runtimes + compile CLI binary + bun link
bun run init    # create testeranto/ workspace structure
bun run dev     # start the server in watch mode
```

---

## What happens when you run `testeranto dev`

The server reads `testeranto/testeranto.ts` in the current directory. That config file lists:
- **runtimes** — which language container to use and which test files to run
- **agents** — LLM personas that receive sliced test output
- **volumes** — what to mount into each container

The server builds Docker images, runs your tests inside them, and writes JSON reports to `testeranto/reports/`. The VS Code extension reads those reports and shows results in a sidebar.

This repo's config is at [testeranto/testeranto.ts](testeranto/testeranto.ts). It runs the example tests in:
- `src/lib/tiposkripto/tests/` — TypeScript (Node)
- `src/lib/pitono/examples/` — Python
- `src/lib/rubeno/examples/` — Ruby
- `src/java/test/` — Java

---

## Example: what a test looks like

Tests have three parts. Here's the TypeScript Circle test at [src/lib/tiposkripto/tests/circle/Circle.test.ts](src/lib/tiposkripto/tests/circle/Circle.test.ts):

**`implementation()`** — defines your test vocabulary (givens, whens, thens, etc.):
```typescript
givens: {
  WithRadius: (radius: number) => new Circle(radius),
},
whens: {
  doubleRadius: () => (circle: Circle) => circle.setRadius(circle.getRadius() * 2),
},
thens: {
  radiusIs: (expected: number) => (circle: Circle) => circle.getRadius() === expected,
},
```

**`specification()`** — composes that vocabulary into actual test cases:
```typescript
// BDD
Given.WithRadius(10)([When.doubleRadius()], [Then.radiusIs(20)])

// TDT (table-driven)
Confirm["circumferenceCalculation"]()([
  [Value.radius(1), Should.beCloseTo(2 * Math.PI)],
])

// AAA
Describe["a circle with radius"](5)([It["has correct circumference"]()])
```

**`adapter()`** — lifecycle hooks (`prepareAll`, `prepareEach`, `execute`, `verify`, `cleanupEach`, `cleanupAll`).

---

## Adding tests to your own project

1. Install the package for your language (e.g. `npm install tiposkripto` for TypeScript).
2. Create a `testeranto/testeranto.ts` config in your project root that lists your test files and the matching runtime.
3. Run `testeranto dev` from your project root.

---

## VS Code Extension

```bash
# Build and package the extension
bun run package:vsce

# Launch VS Code with the extension loaded from source
bun run launch:extension
```

The extension connects to the running testeranto server and shows test results, Docker processes, and agent output in the sidebar.

---

## Available scripts

| Script | What it does |
|---|---|
| `bun run build` | Full build: esbuild runtimes + compile CLI binary + `bun link` |
| `bun run build:runtimes` | esbuild the Node/web runtime files used inside Docker containers |
| `bun run build:cli` | Compile the `testeranto` CLI binary and link it globally |
| `bun run build:ext` | Package the VS Code extension as a `.vsix` |
| `bun run init` | Create `testeranto/` folder structure in current directory |
| `bun run dev` | Start the server in watch mode (runs from source, no compiled binary) |
| `bun run once` | Run tests once and exit |
| `bun run start` | `build` + `init` + `dev` — full one-shot start |
| `bun run start:ext` | `build:ext` + `start` — same but also builds the VS Code extension |
| `bun run launch:extension` | Open VS Code with the extension loaded from source |

---

## Cross-platform Docker note (macOS + Apple Silicon)

Node.js dependencies are installed **inside** Docker containers at build time. The host `node_modules` directory is intentionally **not** mounted into containers to avoid architecture incompatibility. Ensure your `package.json` and lock files are included in your Docker build context.

### Dockerfile stage errors

If you see `target stage "runtime" could not be found`:
- **Single-stage Dockerfile**: remove `targetStage` from your config entirely
- **Multi-stage Dockerfile**: set `targetStage` to match the actual stage name in your Dockerfile (e.g. `"builder"` or `"production"`)

---

## Philosophy

### Code structure

1. **Business logic classes** are pure and testable, delegating to utility functions.
2. **Utility functions** each live in their own file, organized by folder.
3. **External dependencies** are abstracted behind a thin wrapper with real and mock implementations.
4. **Tests** focus on the business logic class using testeranto's BDD/AAA/TDT patterns.

### Testing and packaging approach

Traditional:
1. Static analysis → unit tests → package → integration tests (all on the whole codebase at once)

Testeranto:
1. Break the application into "slices"
2. Package each test — producing artifacts that map outputs back to specific source files
3. Run all tests
4. Pass results + source files into an LLM context
5. LLM proposes changes
6. Changes trigger a rebuild and re-run of affected tests
7. Repeat

Packaging first lets you correlate test output to the exact source files that produced it, keeping LLM context focused on one slice at a time.
