# Cameo test monorepo

This repository contains a pnpm workspace with a React client, an Express server, and shared IR types aligned with a SysML v2-inspired IR for Block Definition Diagrams.

## Structure

- `apps/client`: Vite + React TypeScript shell for exploring workspaces.
- `apps/server`: Express TypeScript API serving workspace data and persistence flows.
- `packages/shared`: Shared TypeScript interfaces, schemas, and validators for the IR.
- `examples/workspaces`: Example workspace folders containing `workspace.json`, `model.json`, and `diagrams.json`.

## Getting started

Install dependencies (this bootstraps all workspace packages):

```bash
pnpm install
```

Run the development servers:

```bash
# start the API on http://localhost:3001
pnpm --filter @cameotest/server dev

# in another terminal, start the Vite dev server on http://localhost:5173
pnpm --filter @cameotest/client dev
```

Build all packages:

```bash
pnpm build
```

Start the compiled server:

```bash
pnpm start
```

## Workspace layout

Each workspace is a folder containing three JSON files:

- `workspace.json`: metadata (id, name, description, timestamps).
- `model.json`: IR elements and relationships.
- `diagrams.json`: diagram view state (nodes, edges, settings).

The server exposes REST endpoints under `/api/workspaces` to list, open, load, save, import, and duplicate workspaces.
