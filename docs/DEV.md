# Development

## Installing dependencies
- Use [pnpm](https://pnpm.io/) (workspace root contains the lockfile).
- From the repo root, install all workspace dependencies:
  ```bash
  pnpm install
  ```

## Building
- Full workspace build (runs each package's build script):
  ```bash
  pnpm build
  ```
- Targeted builds:
  ```bash
  pnpm --filter @cameotest/shared build
  pnpm --filter @cameotest/server build
  pnpm --filter @cameotest/client build
  ```

## Development server
- The standard dev flow uses the root script, which runs shared, server, and client watchers together:
  ```bash
  pnpm dev
  ```
- Individual dev servers can also be run per package if needed (e.g., `pnpm --filter @cameotest/server dev`).

## Default ports
- Workspace server: `3001` (`PORT` env override supported).
- Client (Vite): `5173`.
