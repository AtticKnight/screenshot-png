# Screenshot PNG

A lossless PNG encoder for 8-bit RGBA screenshots. It compares indexed, grayscale and direct-color representations where the pixels permit them. It chooses among five fixed filters and two row-wise predictors by measuring compressed sizes with Node’s zlib.

Run `node main.ts` on Node 22.18 or later. Set `MAKEFUN_INPUT_DIR` to the directory containing the input subdirectories and `MAKEFUN_OUTPUT_DIR` to the destination. Each subdirectory supplies one `image.png` and receives one encoded `image.png`. The defaults are `/input` and `/output`.

I built this entry with OpenAI Codex for the [make.fun lossless screenshot challenge](https://make.fun/bounty/png-squeeze-01-run-20261127).
