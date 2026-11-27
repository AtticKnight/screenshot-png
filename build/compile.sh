#!/bin/sh
set -eu
# Run from the repository root. Pass a checkout of the exact upstream revision.
source_dir=$1
PATH=/usr/lib/llvm-18/bin:$PATH
export PATH
test "$(git -C "$source_dir" rev-parse HEAD)" = 96836d7d9d10e3e0d53e6edb54eb908514e336c4
mkdir -p vendor
clang-18 --target=wasm32-unknown-unknown -O3 -flto -ffreestanding -nostdlib \
  -mno-bulk-memory -mno-sign-ext -DFREESTANDING -DNDEBUG -I"$source_dir" \
  build/port.c "$source_dir/lib/utils.c" "$source_dir/lib/adler32.c" \
  "$source_dir/lib/zlib_compress.c" "$source_dir/lib/deflate_compress.c" \
  -fuse-ld=/usr/bin/wasm-ld-18 -Wl,--no-entry -Wl,--export-memory -Wl,-z,stack-size=1048576 \
  -Wl,--initial-memory=83886080 -Wl,--max-memory=83886080 \
  -Wl,--export=prepare -Wl,--export=input_pointer -Wl,--export=output_pointer \
  -Wl,--export=compress_image -o "$TMPDIR/libdeflate.wasm"
wasm2js "$TMPDIR/libdeflate.wasm" -O3 -o "$TMPDIR/libdeflate.js"
{
  echo '/* libdeflate 1.24, Copyright 2016 Eric Biggers and 2024 Google LLC.'
  echo ' * Generated JavaScript. Licence in vendor/COPYING. Rebuild with build/compile.sh. */'
  cat "$TMPDIR/libdeflate.js"
} > vendor/libdeflate.js
cmp vendor/COPYING "$source_dir/COPYING"
