#!/bin/sh
set -eu
src=$1
test "$(git -C "$src" rev-parse HEAD)" = bd64b2f0553d4f1ef4e6627647c5d9fc8c71ffc0
mkdir -p vendor
# Keep this deterministic change local to the build directory.
# Limiting the hash-chain walk bounds the search cost on flat screenshot rows.
work=$(mktemp -d)
cp -R "$src/src" "$work/src"
python3 - "$work/src/zopfli/util.h" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
source = path.read_text()
old = '#define ZOPFLI_MAX_CHAIN_HITS 8192'
assert source.count(old) == 1
path.write_text(source.replace(old, '#define ZOPFLI_MAX_CHAIN_HITS 384'))
PY
set -- build/zopfli-port.c
for file in "$work"/src/zopfli/*.c; do
  case "$file" in */zopfli_bin.c) continue ;; esac
  set -- "$@" "$file"
done
emcc -O3 -I"$work/src" "$@" -sENVIRONMENT=node -sSINGLE_FILE=1 -sFILESYSTEM=0 \
  -sMODULARIZE=1 -sWASM_ASYNC_COMPILATION=0 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_compress_zlib","_result_pointer"]' \
  -o vendor/zopfli.cjs
cmp vendor/ZOPFLI-LICENSE "$src/COPYING"
