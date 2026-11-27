# Screenshot PNG

A lossless encoder for 8-bit RGBA screenshots. It chooses among direct color, grayscale and palette representations. Fixed PNG filters, per-row predictors, and strips selected against previous rows compete on actual compressed size. A near-optimal libdeflate parse ranks the remaining layouts. Compact streams get an additional two-pass Zopfli parse.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` per input subdirectory and writes a PNG of the same name and subdirectory to the output. The environment variables `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` default to `/input` and `/output`. It runs offline with the two checked-in compressors.

## Rebuild the compressors

On Ubuntu 24.04 install clang-18, lld-18, emscripten and Python 3. From this repository's root run the following commands with clean checkouts of the pinned upstream revisions.

```sh
sh build/native-lib.sh /path/to/libdeflate
sh build/zopfli.sh /path/to/zopfli
sha256sum vendor/libdeflate.wasm vendor/zopfli.cjs
```

The [libdeflate source](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) supplies the MIT-licensed level-12 parser. Its WebAssembly module has SHA-256 `9cc3dce3905a01aaf132c22aad6bfb6fdb61cc67eb0b03f1a856423cb9694a99`. The [Zopfli source](https://github.com/google/zopfli/tree/bd64b2f0553d4f1ef4e6627647c5d9fc8c71ffc0) supplies the Apache-2.0 optimal parser. Its single-file Emscripten build has SHA-256 `2205cc3f6ab5a60c0d0e98e080d77989da169d4f75a2d397cacabc0415c1f60e`. The search cap, SIMD match comparison and precomputed symbol costs are applied to a temporary copy of the upstream source.

I developed and tested the image representation, prediction, integration and local compressor changes with OpenAI Codex for the [make.fun screenshot challenge](https://make.fun/bounty/png-squeeze-01-run-20261127). The [independent benchmark run](https://github.com/AtticKnight/screenshot-png/actions/runs/45988940358/job/140471552477) verifies every decoded RGBA pixel on the published eight screenshots and on eight generated from a separate fixed seed.
