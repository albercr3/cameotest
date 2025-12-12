#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${ROOT_DIR}/docs/refs/manifest.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to parse ${MANIFEST}" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download references" >&2
  exit 1
fi

if [[ ! -f "${MANIFEST}" ]]; then
  echo "Manifest not found at ${MANIFEST}" >&2
  exit 1
fi

destination_name=$(jq -r '.destination // "_downloaded"' "${MANIFEST}")
DEST_DIR="${ROOT_DIR}/docs/refs/${destination_name}"
mkdir -p "${DEST_DIR}"

FORCE="${FORCE:-0}"

jq -c '.references[]' "${MANIFEST}" | while read -r entry; do
  url=$(jq -r '.url' <<<"${entry}")
  filename=$(jq -r '.filename' <<<"${entry}")
  name=$(jq -r '.name' <<<"${entry}")

  if [[ -z "${url}" || "${url}" == "null" || -z "${filename}" || "${filename}" == "null" ]]; then
    echo "Skipping malformed entry: ${entry}" >&2
    continue
  fi

  target="${DEST_DIR}/${filename}"
  if [[ "${FORCE}" != "1" && -s "${target}" ]]; then
    echo "Skipping ${name} (already exists at ${target})"
    continue
  fi

  echo "Downloading ${name} from ${url}"
  curl --fail --location --output "${target}" "${url}"
done

echo "All references processed. Files are in ${DEST_DIR}."
