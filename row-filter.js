// Estimate each candidate scanline with short LZ77 chains and fixed Huffman
// prices. Only the winning candidate becomes history for the following row.
export function chooseLzRows(streams, stride, height) {
  const bytes = Buffer.allocUnsafe(stride * height);
  const heads = new Int32Array(65536).fill(-1);
  const previous = new Int32Array(32768);
  const trialHead = new Int32Array(65536);
  const trialStamp = new Uint32Array(65536);
  const trialPrevious = new Int32Array(stride);

  const lengthBits = new Uint8Array(259);
  const starts = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,259];
  for (let i = 0; i < 29; i++) {
    const extra = i < 8 || i === 28 ? 0 : 1 + ((i - 8) >> 2);
    lengthBits.fill((i <= 22 ? 7 : 8) + extra, starts[i], starts[i+1]);
  }
  const distanceBits = new Uint8Array(32769);
  for (let d = 1; d <= 32768; d++) distanceBits[d] = 5 + Math.max(0, 30 - Math.clz32(d - 1));
  function keyAt(p) {
    const v = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
    return Math.imul(v, 0x1e35a7bd) >>> 16;
  }
  let epoch = 0;
  for (let row = 0; row < height; row++) {
    const start = row * stride;
    const end = start + stride;
    let winner = 0, bestBits = Infinity;
    for (let f = 0; f < streams.length; f++) {
      streams[f].copy(bytes, start, start, end);
      epoch++;
      let bits = 0, p = start;
      while (p + 2 < end) {
        const h = keyAt(p);
        let match = trialStamp[h] === epoch ? trialHead[h] : heads[h];
        const floor = Math.max(0, p - 32768);
        const maximum = Math.min(258, end - p);
        let take = 1, cost = bytes[p] < 144 ? 8 : 9, saving = 0;
        for (let attempts = 0; attempts < 8 && match >= floor; attempts++) {
          if (bytes[match] === bytes[p] && bytes[match + take - 1] === bytes[p + take - 1]) {
            let n = 0;
            while (n < maximum && bytes[match + n] === bytes[p + n]) n++;
            if (n >= 3) {
              const price = lengthBits[n] + distanceBits[p - match];
              const benefit = 8 * n - price;
              if (benefit > saving) { take = n; cost = price; saving = benefit; }
              if (n === maximum) break;
            }
          }
          match = match >= start ? trialPrevious[match - start] : previous[match & 32767];
        }
        bits += cost;
        const next = p + take;
        for (; p < next && p + 2 < end; p++) {
          const k = keyAt(p);
          trialPrevious[p - start] = trialStamp[k] === epoch ? trialHead[k] : heads[k];
          trialHead[k] = p;
          trialStamp[k] = epoch;
        }
        p = next;
      }
      for (; p < end; p++) bits += bytes[p] < 144 ? 8 : 9;
      if (bits < bestBits) { bestBits = bits; winner = f; }
    }
    streams[winner].copy(bytes, start, start, end);
    for (let pos = Math.max(0, start - 2); pos + 2 < end; pos++) {
      const k = keyAt(pos);
      previous[pos & 32767] = heads[k];
      heads[k] = pos;
    }
  }
  return bytes;
}
