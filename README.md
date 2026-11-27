# Screenshot PNG

A lossless JavaScript encoder for 8-bit RGBA screenshots. It tests grayscale, indexed color and direct color, and keeps the smallest complete PNG it produces. It preserves all four channels, including the RGB values of fully transparent pixels.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` from every subdirectory under `MAKEFUN_INPUT_DIR` and writes the same name and subdirectory under `MAKEFUN_OUTPUT_DIR`. Those directories default to `/input` and `/output`.

## Encoding

The encoder compares grayscale, indexed and direct-color representations. It ranks row filters and strips with Node's zlib, then tests small changes to a strip with the nearby scanlines on both sides. A JavaScript implementation of libdeflate's level-12 parser compresses the highest-ranked layouts.

A second parser recovers the LZ77 matches from several compressed representations of the same input. It searches alternative match starts and distances and chooses a path using the cost of the literals, distances and length codes. It can also move block boundaries, build length-limited Huffman trees with package-merge and shorten the repeat instructions in their headers. Dense images use a smaller search budget.

The bundled libdeflate JavaScript was generated from the MIT-licensed upstream implementation. Its license is in `vendor/COPYING`. The source and build recipe are public. [Upstream libdeflate](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) · [Compiler invocation and build script](https://github.com/AtticKnight/screenshot-png/blob/581504201bc18ca451698597c7aff183d94f6815/build/compile.sh)

## Verification

On Node 22.18, the normal entry point produced identical bytes on repeated runs. The official decoder recovered every RGBA pixel across eight published practice screenshots and eight independently generated screenshots. Practice output totaled 481,270 bytes and scored 795,021 in 53.68 and 54.02 seconds. The independent set totaled 1,278,211 bytes and scored 777,644 in 48.00 and 47.79 seconds. The same job ran 15 compressor round trips and 100 recompression round trips with WebAssembly disabled. [Verification job and full measurements](https://github.com/AtticKnight/screenshot-png/actions/runs/46029473273/job/140609309489)

I developed and tested the image representation, predictor selection, DEFLATE reparser and integration with OpenAI Codex for the [make.fun screenshot challenge](https://make.fun/bounty/png-squeeze-01-run-20261127).
