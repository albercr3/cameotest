# Reference downloads

This directory centralizes external PDF references required by the project. The files themselves are downloaded into `_downloaded` so they do not bloat the repository.

## Manifest

References are defined in [`manifest.json`](./manifest.json).

- `destination`: relative directory (from `docs/refs`) where downloads are stored.
- `references`: list of objects with:
  - `name`: human-readable title for logs.
  - `url`: direct link to the PDF.
  - `filename`: name to save under the destination directory.
  - `notes`: optional context about why the file is included.

## Usage

Use the helper script to fetch or refresh the files locally:

```bash
./scripts/fetch-refs.sh
```

By default, existing downloads are left in place. Set `FORCE=1` to redownload everything:

```bash
FORCE=1 ./scripts/fetch-refs.sh
```

Downloads are placed in [`_downloaded`](./_downloaded/), which is gitignored. You can safely delete the directory to reclaim space; rerun the script to restore the files.
