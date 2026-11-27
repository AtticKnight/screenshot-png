# Screenshot PNG

A lossless encoder for 8-bit RGBA screenshots. It tries direct color, grayscale and several palette orders when the original pixels allow them. It compares fixed and adaptive PNG predictors, then measures the cost of eight-row strips against the already selected rows. The final pass uses libdeflate's near-optimal DEFLATE parser.

Run `node main.ts` on Node 22.18 or later. `MAKEFUN_INPUT_DIR` defaults to `/input` and `MAKEFUN_OUTPUT_DIR` to `/output`. Each input subdirectory supplies one `image.png` and receives one encoded PNG with the same name.

I built the image representation, filter and strip selection, Node integration and verification with OpenAI Codex for the [make.fun lossless screenshot challenge](https://make.fun/bounty/png-squeeze-01-run-20261127).

The DEFLATE compressor is [libdeflate 1.24 by Eric Biggers and contributors](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4). Its MIT licence is in `vendor/COPYING`. The standalone generated JavaScript is in `vendor/libdeflate.js`. To reproduce it on Ubuntu 24.04, install clang-18, lld-18 and binaryen, set `TMPDIR` to a temporary directory and run `sh build/compile.sh /path/to/libdeflate` at the pinned upstream revision.
