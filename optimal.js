import { memory, input_pointer, output_pointer, prepare, compress_image } from './vendor/libdeflate.js';

const heap = new Uint8Array(memory.buffer);
const inputStart = input_pointer();
const outputStart = output_pointer();
const initialized = prepare(10) !== 0;

// libdeflate's near-optimal parser evaluates length and distance costs together.
// One compressor and two buffers are reused for the entire set of screenshots.
export function compressOptimally(raw) {
  if (!initialized || raw.length > 4 * 1024 * 1024) return undefined;
  heap.set(raw, inputStart);
  const size = compress_image(raw.length);
  return size ? Buffer.from(heap.subarray(outputStart, outputStart + size)) : undefined;
}
