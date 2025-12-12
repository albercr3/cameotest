# Cameo test monorepo

This repository contains a small pnpm workspace with a React client, an Express server, and shared IR types.

## Structure

- `apps/client`: Vite + React TypeScript shell for exploring workspaces
- `apps/server`: Express TypeScript API serving workspace data
- `packages/shared`: Shared TypeScript interfaces for workspace IR
- `examples/workspaces`: Example workspace definitions consumed by the API

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
