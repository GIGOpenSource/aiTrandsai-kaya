#!/bin/sh
# DCloud / Google Sign-In 等预编译 framework 不带 dSYM。
# Archive 上传会按 binary UUID 检查；对已嵌入的 framework 补生成同 UUID 的 dSYM 包。
set -e

FRAMEWORKS_DIR="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"
DSYM_DIR="${DWARF_DSYM_FOLDER_PATH}"

if [ -z "${FRAMEWORKS_DIR}" ] || [ ! -d "${FRAMEWORKS_DIR}" ]; then
  echo "note: no Frameworks dir, skip vendored dSYM generation"
  exit 0
fi

if [ -z "${DSYM_DIR}" ]; then
  echo "note: DWARF_DSYM_FOLDER_PATH empty, skip vendored dSYM generation"
  exit 0
fi

mkdir -p "${DSYM_DIR}"

for fw in "${FRAMEWORKS_DIR}"/*.framework; do
  [ -d "${fw}" ] || continue
  name="$(basename "${fw}" .framework)"
  binary="${fw}/${name}"
  [ -f "${binary}" ] || continue

  dsym="${DSYM_DIR}/${name}.framework.dSYM"
  dwarf="${dsym}/Contents/Resources/DWARF/${name}"
  if [ -f "${dwarf}" ]; then
    echo "note: dSYM already exists for ${name}"
    continue
  fi

  echo "note: generating dSYM for ${name}"
  xcrun dsymutil "${binary}" -o "${dsym}" || echo "warning: dsymutil failed for ${name}"
done
