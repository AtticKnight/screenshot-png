import { crc32, deflateRawSync, deflateSync, inflateSync } from 'node:zlib';

import { compressOptimally } from './optimal.js';
import { compressWithZopfli } from './zopfli.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, above, corner) {
  const da = Math.abs(above - corner);
  const db = Math.abs(left - corner);
  const dc = Math.abs(left + above - 2 * corner);
  return da <= db && da <= dc ? left : db <= dc ? above : corner;
}

export function decodeRgba(file) {
  if (!file.subarray(0, 8).equals(signature)) throw new Error('Expected a PNG.');
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  if (file[24] !== 8 || file[25] !== 6 || file[28] !== 0) {
    throw new Error('Expected a noninterlaced 8-bit RGBA source.');
  }
  const data = [];
  for (let at = 8; at + 12 <= file.length;) {
    const size = file.readUInt32BE(at);
    if (at + 12 + size > file.length) throw new Error('Incomplete PNG chunk.');
    const type = file.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') data.push(file.subarray(at + 8, at + 8 + size));
    at += 12 + size;
    if (type === 'IEND') break;
  }
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('Incorrect image size.');
  const pixels = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const from = row + y;
    const mode = raw[from];
    if (mode === 0) {
      raw.copy(pixels, row, from + 1, from + 1 + stride);
      continue;
    }
    if (mode > 4) throw new Error('Unknown row filter.');
    for (let x = 0; x < stride; x++) {
      const pos = row + x;
      const left = x >= 4 ? pixels[pos - 4] : 0;
      const up = y ? pixels[pos - stride] : 0;
      const corner = y && x >= 4 ? pixels[pos - stride - 4] : 0;
      const prediction = mode === 1 ? left : mode === 2 ? up : mode === 3 ? (left + up) >> 1 : paeth(left, up, corner);
      pixels[pos] = raw[from + 1 + x] + prediction;
    }
  }
  return { width, height, pixels };
}

function chunk(name, data) {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(name, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function assemble(w, h, mode, stream, palette, transparency) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = mode;
  const parts = [signature, chunk('IHDR', header)];
  if (palette) parts.push(chunk('PLTE', palette));
  if (transparency?.length) parts.push(chunk('tRNS', transparency));
  parts.push(chunk('IDAT', stream), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function inspectColors(pixels) {
  const counts = new Map();
  let indexed = true;
  let gray = true;
  let opaque = true;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) gray = false;
    if (pixels[i + 3] !== 255) opaque = false;
    if (indexed) {
      const color = pixels.readUInt32LE(i);
      counts.set(color, (counts.get(color) ?? 0) + 1);
      if (counts.size > 256) indexed = false;
    }
    if (!indexed && !gray && !opaque) break;
  }
  return { counts, indexed, gray, opaque };
}

function paletteImage(pixels, colors) {
  const byColor = new Map();
  const table = Buffer.allocUnsafe(colors.length * 3);
  const alphas = Buffer.allocUnsafe(colors.length);
  let alphaLength = 0;
  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];
    byColor.set(color, i);
    table[3 * i] = color;
    table[3 * i + 1] = color >>> 8;
    table[3 * i + 2] = color >>> 16;
    alphas[i] = color >>> 24;
    if (alphas[i] !== 255) alphaLength = i + 1;
  }
  const data = Buffer.allocUnsafe(pixels.length / 4);
  for (let p = 0; p < data.length; p++) data[p] = byColor.get(pixels.readUInt32LE(4 * p));
  return { data, mode: 3, channels: 1, palette: table, transparency: alphas.subarray(0, alphaLength) };
}

function directImage(pixels, mode) {
  if (mode === 6) return { data: pixels, mode, channels: 4 };
  const channels = mode === 0 ? 1 : mode === 4 ? 2 : 3;
  const data = Buffer.allocUnsafe(pixels.length / 4 * channels);
  for (let i = 0, j = 0; i < pixels.length; i += 4) {
    data[j++] = pixels[i];
    if (mode === 2) {
      data[j++] = pixels[i + 1];
      data[j++] = pixels[i + 2];
    } else if (mode === 4) {
      data[j++] = pixels[i + 3];
    }
  }
  return { data, mode, channels };
}

const magnitude = Uint8Array.from({ length: 256 }, (_, x) => Math.min(x, 256 - x));
const tokenCost = Uint8Array.from(magnitude, x => x === 0 ? 0 : 2 + Math.floor(Math.log2(x)));

// Compare whole-image filters with row-wise predictors. A row of constant residuals
// compresses well even when the byte is large, so our second estimator discounts runs.
function filteredImages(image, width, height) {
  const { data, channels } = image;
  const stride = width * channels;
  const outputStride = stride + 1;
  const streams = Array.from({ length: 7 }, () => Buffer.allocUnsafe(outputStride * height));
  const [plain, sub, up, avg, paethStream, byMagnitude, byRuns] = streams;
  const sums = new Float64Array(5);
  const runs = new Float64Array(5);
  for (let y = 0; y < height; y++) {
    const dst = y * outputStride;
    const src = y * stride;
    for (let f = 0; f < 5; ++f) streams[f][dst] = f;
    for (let x = 0; x < stride; x++) {
      const pos = src + x;
      const byte = data[pos];
      const left = x >= channels ? data[pos - channels] : 0;
      const above = y ? data[pos - stride] : 0;
      const corner = y && x >= channels ? data[pos - stride - channels] : 0;
      const p = dst + x + 1;
      plain[p] = byte;
      sub[p] = byte - left;
      up[p] = byte - above;
      avg[p] = byte - ((left + above) >> 1);
      paethStream[p] = byte - paeth(left, above, corner);
    }
    // Sample every channel on alternate pixels. The phase changes on each row.
    for (let f = 0; f < 5; f++) {
      const stream = streams[f];
      let magnitudeTotal = 0, symbolTotal = 0, last = -1;
      for (let x = (y & 1) * channels; x < stride; x += 2 * channels) {
        for (let c = 0; c < channels; c++) {
          const b = stream[dst + x + c + 1];
          magnitudeTotal += magnitude[b];
          if (last !== b) symbolTotal += 4 + tokenCost[b];
          last = b;
        }
      }
      sums[f] = magnitudeTotal;
      runs[f] = symbolTotal;
    }
    let a = 0, b = 0;
    for (let f = 1; f < 5; f++) {
      if (sums[f] < sums[a]) a = f;
      if (runs[f] < runs[b]) b = f;
    }
    streams[a].copy(byMagnitude, dst, dst, dst + outputStride);
    streams[b].copy(byRuns, dst, dst, dst + outputStride);
  }
  return streams;
}

function candidatesFor(image, w, h, effort, streams) {
  const order = streams.map((raw, index) => ({
    index, bytes: deflateSync(raw, { level: 3, memLevel: 9 }).length,
  })).sort((a, b) => a.bytes - b.bytes);
  const indices = new Set(order.slice(0, effort).map(candidate => candidate.index));
  if (image.mode === 2 || image.mode === 6) indices.add(4);
  const candidates = [];
  for (const index of indices) {
    const raw = streams[index];
    const packed = deflateSync(raw, { level: 9, memLevel: 8 });
    const png = assemble(w, h, image.mode, packed, image.palette, image.transparency);
    candidates.push({ png, raw, image, index });
  }
  return candidates;
}

// Compare complete strips against the same prefix dictionary. Fixed Paeth, for
// example, can work well across a soft shadow and poorly in a table of flat fills.
// Previous choices become the dictionary for the next group of rows.
function chooseStrips(streams, w, h, channels, stripHeight, history, level) {
  const stride = w * channels + 1;
  const selected = Buffer.allocUnsafe(stride * h);
  for (let y = 0; y < h; y += stripHeight) {
    const start = y * stride;
    const end = Math.min(h, y + stripHeight) * stride;
    const options = { level, memLevel: 7 };
    if (start) options.dictionary = selected.subarray(Math.max(0, start - history), start);
    let best = null, bestSize = Infinity;
    const tried = [];
    for (const stream of streams) {
      const strip = stream.subarray(start, end);
      if (tried.some(previous => previous.equals(strip))) continue;
      tried.push(strip);
      const size = deflateRawSync(strip, options).length;
      if (size < bestSize) {
        best = strip;
        bestSize = size;
      }
    }
    best.copy(selected, start);
  }
  return selected;
}


// Estimate each row with the same 32 KiB history of already selected rows.
// Matches at another horizontal offset count as well as matches directly above.
// The short hash chains bound work on repeated text and large flat fills.
function chooseRowsByMatches(streams, stride, height) {
  const selected = Buffer.allocUnsafe(stride * height);
  const heads = new Int32Array(65536).fill(-1);
  const previous = new Int32Array(32768);
  const local = new Int32Array(65536);
  const stamps = new Int32Array(65536);
  const distanceCost = new Uint8Array(32769);
  for (let d = 1; d < distanceCost.length; d++)
    distanceCost[d] = 5 + Math.max(0, Math.floor(Math.log2(d)) - 1);
  const lengthCost = new Uint8Array(259);
  for (let n = 3; n < lengthCost.length; n++)
    lengthCost[n] = 6 + Math.max(0, Math.floor(Math.log2(n - 2)) - 2);
  const literalCost = Uint8Array.from(magnitude, (size, symbol) =>
    symbol === 0 ? 2 : Math.min(11, 4 + Math.ceil(Math.log2(size + 1))));

  function hash(at) {
    return ((selected[at] * 251 + selected[at + 1]) * 251 + selected[at + 2]) & 65535;
  }
  function matchLength(at, from, limit) {
    let n = 0;
    while (n < limit && selected[at + n] === selected[from + n]) n++;
    return n;
  }

  let stamp = 0;
  for (let y = 0; y < height; y++) {
    const start = y * stride, end = start + stride;
    let bestFilter = 0, bestCost = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      streams[filter].copy(selected, start, start, end);
      stamp++;
      let bits = 0;
      for (let pos = start; pos < end;) {
        if (pos + 2 >= end) {
          bits += literalCost[selected[pos++]];
          continue;
        }
        const bucket = hash(pos);
        const limit = Math.min(258, end - pos);
        let bestLength = 2, bestDistance = 0;
        if (stamps[bucket] === stamp && pos - local[bucket] <= 32768) {
          const from = local[bucket];
          const length = matchLength(pos, from, limit);
          if (length > bestLength) {
            bestLength = length;
            bestDistance = pos - from;
          }
        }
        let from = heads[bucket];
        for (let probe = 0; probe < 4 && from >= 0 && pos - from <= 32768 && bestLength < limit; probe++) {
          if (selected[pos + bestLength] === selected[from + bestLength]) {
            const length = matchLength(pos, from, limit);
            if (length > bestLength) {
              bestLength = length;
              bestDistance = pos - from;
            }
          }
          from = previous[from & 32767];
        }
        const useMatch = bestLength >= 4 || (bestLength === 3 && bestDistance <= 128);
        const next = pos + (useMatch ? bestLength : 1);
        bits += useMatch ? lengthCost[bestLength] + distanceCost[bestDistance] : literalCost[selected[pos]];
        const sampleStep = next - pos >= 12 ? 3 : 1;
        for (let p = pos; p < next && p + 2 < end; p += sampleStep) {
          const key = hash(p);
          local[key] = p;
          stamps[key] = stamp;
        }
        pos = next;
      }
      if (bits < bestCost) { bestCost = bits; bestFilter = filter; }
    }
    streams[bestFilter].copy(selected, start, start, end);
    for (let p = Math.max(0, start - 2); p + 2 < end; p++) {
      const key = hash(p);
      previous[p & 32767] = heads[key];
      heads[key] = p;
    }
  }
  return selected;
}

export function encodeScreenshot(file) {
  const { width, height, pixels } = decodeRgba(file);
  const { counts, indexed, gray, opaque } = inspectColors(pixels);
  let strongest, chosenStreams;
  function compare(image, effort = 3) {
    const streams = filteredImages(image, width, height);
    for (const candidate of candidatesFor(image, width, height, effort, streams)) {
      if (!strongest || candidate.png.length < strongest.png.length) {
        strongest = candidate;
        chosenStreams = streams;
      }
    }
  }
  if (gray) compare(directImage(pixels, opaque ? 0 : 4), 4);
  // A dense gray ramp already has an ordered one-byte representation.
  if (indexed && (!gray || counts.size < 96)) {
    const colors = Array.from(counts.keys());
    compare(paletteImage(pixels, colors));
    const luma = c => (c & 255) * 3 + ((c >>> 8) & 255) * 6 + ((c >>> 16) & 255);
    const sorted = colors.slice().sort((a, b) => luma(a) - luma(b) || a - b);
    if (sorted.some((c,i) => c !== colors[i])) compare(paletteImage(pixels, sorted));
    const frequent = colors.slice().sort((a, b) => counts.get(b) - counts.get(a) || a - b);
    if (frequent.some((c,i) => c !== colors[i])) compare(paletteImage(pixels, frequent));
  }
  // Small opaque flat palettes avoid repeating a full three-channel filter search.
  if (!gray && (!indexed || !opaque || counts.size > 64)) compare(directImage(pixels, opaque ? 2 : 6), 4);
  let result = strongest.png;
  function refine(raw, image, compressor) {
    const packed = compressor(raw);
    if (!packed) return Infinity;
    const png = assemble(width, height, image.mode, packed, image.palette, image.transparency);
    if (png.length < result.length) result = png;
    return png.length;
  }
  const image = strongest.image;
  const alternatives = chosenStreams;
  const wide = chooseStrips(alternatives, width, height, image.channels, 8, 32768, 5);
  const narrow = chooseStrips(alternatives, width, height, image.channels, 2, 3 * (width * image.channels + 1), 3);
  const layouts = [strongest.raw, wide, narrow];
  if (image.mode !== 3) layouts.push(chooseRowsByMatches(alternatives, width * image.channels + 1, height));
  const distinct = layouts.filter((raw, i) => layouts.slice(0, i).every(previous => !raw.equals(previous)));
  let bestRaw = distinct[0], bestSize = Infinity;
  for (const raw of distinct) {
    const size = refine(raw, image, compressOptimally);
    if (size < bestSize) { bestSize = size; bestRaw = raw; }
  }
  // The entropy-model pass spends most of its time parsing the remaining tokens.
  // On large residual streams use the already measured near-optimal parse.
  // This fixed input-derived budget applies identically across all screenshots.
  if (bestSize <= 128 * 1024) refine(bestRaw, image, raw => compressWithZopfli(raw, bestSize < 49152 ? 4 : 2));
  return result;
}
