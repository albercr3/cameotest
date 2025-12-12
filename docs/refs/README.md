# Reference downloads

This directory centralizes external references for SysML v2 and the supporting web stack. Files are downloaded into `_downloaded` (gitignored) using the manifest-driven helper script.

## Manifest

References are defined in [`manifest.json`](./manifest.json) with fields:

- `name`: human-readable title.
- `url`: source location to download or reference.
- `filename`: saved name under the destination directory.
- `type`: `pdf`, `html`, or `repo` (for link-only entries).
- `purpose`: how the document informs design choices.
- `priority`: `authoritative` or `practical`.

The `destination` key controls where downloads are stored relative to `docs/refs/`.

## Usage

Download or refresh references locally:

```bash
./scripts/fetch-refs.sh
```

Force a redownload by setting `FORCE=1`:

```bash
FORCE=1 ./scripts/fetch-refs.sh
```

Downloads are placed in [`_downloaded`](./_downloaded/). This directory is gitignored and can be removed at any time; rerun the script to restore the files.
