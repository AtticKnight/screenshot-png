#!/bin/sh
set -eu
src=$1
test "$(git -C "$src" rev-parse HEAD)" = bd64b2f0553d4f1ef4e6627647c5d9fc8c71ffc0
mkdir -p vendor
set -- build/zopfli-port.c
for file in "$src"/src/zopfli/*.c; do
  case "$file" in */zopfli_bin.c) continue ;; esac
  set -- "$@" "$file"
done
emcc -O3 -I"$src/src" "$@" -sENVIRONMENT=node -sSINGLE_FILE=1 -sFILESYSTEM=0 \
  -sMODULARIZE=1 -sWASM_ASYNC_COMPILATION=0 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_compress_zlib","_result_pointer"]' \
  -o vendor/zopfli.cjs
cmp vendor/ZOPFLI-LICENSE "$src/COPYING"
