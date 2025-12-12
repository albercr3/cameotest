# Reference management notes

- Keep the manifest authoritative for all external PDFs used by the project.
- Prefer stable, versioned URLs (e.g., RFC or tagged specification releases) to avoid unexpected content drift.
- If a reference must be replaced, update the manifest entry and rerun the fetch script with `FORCE=1` so the cached copy is refreshed.
- Large files are acceptable, but consider adding a short note explaining why the reference is necessary.
