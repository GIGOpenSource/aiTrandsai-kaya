#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APPID="__UNI__859C11F"
DEST="$ROOT/iosStudio/HBuilder-Hello/HBuilder-Hello/Pandora/apps/${APPID}/www"

CANDIDATES=(
  "$ROOT/unpackage/resources/${APPID}/www"
  "$ROOT/unpackage/dist/build/app-plus"
  "$ROOT/dist/build/app-plus"
)

SRC=""
for p in "${CANDIDATES[@]}"; do
  if [[ -f "$p/manifest.json" ]]; then
    SRC="$p"
    break
  fi
done

if [[ -z "$SRC" ]]; then
  echo "未找到 HBuilder 编译产物。请先在 HBuilderX 发行 App 资源，或确认以下目录之一存在 manifest.json："
  printf '  %s\n' "${CANDIDATES[@]}"
  exit 1
fi

mkdir -p "$DEST"
rsync -a --delete --exclude '.gitkeep' "$SRC/" "$DEST/"
touch "$DEST/.gitkeep"
echo "已同步: $SRC -> $DEST"
