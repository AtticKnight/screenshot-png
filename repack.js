import { deflateSync } from 'node:zlib';

// Binary package-merge computes optimal length-limited Huffman codes. At each
// level, merge pairs from the preceding list and admit individual symbols again.
function optimalLengths(freq, limit) {
  const active = [];
  for (let i = 0; i < freq.length; i++) if (freq[i]) active.push({ w: freq[i], leaf: i });
  const result = new Uint8Array(freq.length);
  if (active.length < 2) {
    result[active.length ? active[0].leaf : 0] = 1;
    return result;
  }
  active.sort((a, b) => a.w - b.w || a.leaf - b.leaf);
  // Ordinary Huffman coding is already optimal when its deepest leaf fits.
  // Merge the sorted leaf and internal queues, then recover lengths in one
  // reverse pass. Package-merge below handles the binding length limit.
  const n = active.length;
  const weights = new Float64Array(2 * n - 1);
  const parents = new Int32Array(weights.length);
  const depths = new Uint16Array(weights.length);
  for (let i = 0; i < n; i++) weights[i] = active[i].w;
  let leafIndex = 0, branchIndex = n, next = n;
  function takeMinimum() {
    if (leafIndex < n && (branchIndex === next || weights[leafIndex] <= weights[branchIndex])) {
      return leafIndex++;
    }
    return branchIndex++;
  }
  for (; next < weights.length; next++) {
    const left = takeMinimum(), right = takeMinimum();
    weights[next] = weights[left] + weights[right];
    parents[left] = parents[right] = next;
  }
  let deepest = 0;
  for (let i = weights.length - 2; i >= 0; i--) {
    depths[i] = depths[parents[i]] + 1;
    if (i < n && depths[i] > deepest) deepest = depths[i];
  }
  if (deepest <= limit) {
    for (let i = 0; i < n; i++) result[active[i].leaf] = depths[i];
    return result;
  }
  const take = 2 * active.length - 2;
  let list = active;
  for (let depth = 1; depth < limit; depth++) {
    const packs = [];
    for (let i = 0; i + 1 < list.length; i += 2)
      packs.push({ w: list[i].w + list[i + 1].w, left: list[i], right: list[i + 1] });
    const merged = [];
    let l = 0,
      p = 0;
    while (merged.length < take && (l < active.length || p < packs.length)) {
      if (p >= packs.length || (l < active.length && active[l].w <= packs[p].w))
        merged.push(active[l++]);
      else merged.push(packs[p++]);
    }
    list = merged;
  }
  if (list.length < take) throw Error('Too many symbols for maximum code length.');
  function add(node) {
    if (node.leaf !== undefined) {
      result[node.leaf]++;
      return;
    }
    add(node.left);
    add(node.right);
  }
  for (let i = 0; i < take; i++) add(list[i]);
  return result;
}
// Serialize the literal and distance code lengths with RFC 1951's repeat codes.
function encodeCodebook(lit, dist, final, optimizeRuns = false) {
  let nl = lit.length,
    distanceCount = dist.length;
  while (nl > 257 && !lit[nl - 1]) nl--;
  while (distanceCount > 1 && !dist[distanceCount - 1]) distanceCount--;
  const sequence = [...lit.subarray(0, nl), ...dist.subarray(0, distanceCount)],
    groups = [];
  function add(s, v = 0, b = 0) {
    groups.push({ s, v, b });
  }
  for (let i = 0; i < sequence.length; ) {
    const a = sequence[i];
    let j = i + 1;
    while (j < sequence.length && sequence[j] === a) j++;
    let count = j - i;
    if (!a) {
      while (count >= 11) {
        const n = Math.min(138, count);
        add(18, n - 11, 7);
        count -= n;
      }
      if (count >= 3) {
        const n = Math.min(10, count);
        add(17, n - 3, 3);
        count -= n;
      }
    } else {
      add(a);
      count--;
      while (count >= 3) {
        const n = Math.min(count, 6);
        add(16, n - 3, 2);
        count -= n;
      }
    }
    while (count-- > 0) add(a);
    i = j;
  }
  function write(tokens) {
    const frequencies = new Uint32Array(19);
    for (const token of tokens) frequencies[token.s]++;
    const tree = prefixTree(optimalLengths(frequencies, 7), false);
    let count = 19;
    while (count > 4 && !tree.lens[codeLengthOrder[count - 1]]) count--;
    const writer = new BitWriter(256);
    writer.write(final, 1);
    writer.write(2, 2);
    writer.write(nl - 257, 5);
    writer.write(distanceCount - 1, 5);
    writer.write(count - 4, 4);
    for (let i = 0; i < count; i++) writer.write(tree.lens[codeLengthOrder[i]], 3);
    for (const token of tokens) {
      printSymbol(writer, tree, token.s);
      writer.write(token.v, token.b);
    }
    return { writer, prices: tree.lens };
  }
  let best = write(groups).writer;
  if (!optimizeRuns) return best;

  // A zero run may use a literal, repeat the preceding zero, or use either zero
  // repeat instruction. Find its cheapest encoding at current Huffman prices.
  const runs = new Uint16Array(sequence.length);
  for (let i = sequence.length - 1; i >= 0; i--) {
    runs[i] = 1 + (sequence[i] === sequence[i + 1] ? runs[i + 1] : 0);
  }
  const starts = [
    Array(19).fill(5),
    Array.from({ length: 19 }, (_, i) => i < 16 ? 6 : 3),
  ];
  for (let prices of starts) {
    for (let pass = 0; pass < 4; pass++) {
      const costs = new Uint16Array(sequence.length + 1);
      const kinds = new Uint8Array(sequence.length);
      const lengths = new Uint8Array(sequence.length);
      for (let i = sequence.length - 1; i >= 0; i--) {
        const literal = sequence[i];
        let bestCost = prices[literal] + costs[i + 1];
        let kind = literal, length = 1;
        function compare(symbol, minimum, maximum, extraBits) {
          const limit = Math.min(maximum, runs[i]);
          for (let n = minimum; n <= limit; n++) {
            const cost = costs[i + n] + prices[symbol] + extraBits;
            if (cost < bestCost) {
              bestCost = cost;
              kind = symbol;
              length = n;
            }
          }
        }
        if (i && sequence[i - 1] === literal) compare(16, 3, 6, 2);
        if (literal === 0) {
          compare(17, 3, 10, 3);
          compare(18, 11, 138, 7);
        }
        costs[i] = bestCost;
        kinds[i] = kind;
        lengths[i] = length;
      }
      const tokens = [];
      for (let i = 0; i < sequence.length; i += lengths[i]) {
        const symbol = kinds[i];
        const bits = symbol === 16 ? 2 : symbol === 17 ? 3 : symbol === 18 ? 7 : 0;
        const value = bits ? lengths[i] - (symbol === 18 ? 11 : 3) : 0;
        tokens.push({ s: symbol, v: value, b: bits });
      }
      const trial = write(tokens);
      if (trial.writer.at < best.at) best = trial.writer;
      const next = Array.from(trial.prices, (price) => price || 7);
      if (next.every((price, i) => price === prices[i])) break;
      prices = next;
    }
  }
  return best;
}
function chooseCodebook(raw, start, end, lengthPath, distancePath, block) {
  const litCounts = new Uint32Array(286),
    distCounts = new Uint32Array(30);
  let extra = 0;
  for (let i = start; i < end; ) {
    const len = lengthPath[i];
    if (!len) {
      litCounts[raw[i++]]++;
      continue;
    }
    const d = distancePath[i],
      lengthSymbol = symbolForLength[len],
      distanceSymbol = symbolForDistance[d];
    litCounts[lengthSymbol]++;
    distCounts[distanceSymbol]++;
    extra += lengthExtra[lengthSymbol - 257] + distanceExtra[distanceSymbol];
    i += len;
  }
  litCounts[256]++;
  const lit = optimalLengths(litCounts, 15),
    dist = optimalLengths(distCounts, 15);
  const header = encodeCodebook(lit, dist, block.final);
  let total = header.at + extra;
  for (let i = 0; i < lit.length; i++) total += litCounts[i] * lit[i];
  for (let i = 0; i < dist.length; i++) total += distCounts[i] * dist[i];
  let current = block.dataStart - block.header + extra;
  for (let i = 0; i < litCounts.length; i++) {
    if (litCounts[i]) current += litCounts[i] * (block.literal.lens[i] || Infinity);
  }
  for (let i = 0; i < distCounts.length; i++) {
    if (distCounts[i]) current += distCounts[i] * (block.distance.lens[i] || Infinity);
  }
  if (Math.min(total, current) >= block.dataEnd - block.header) return { original: true };
  if (total < current)
    return { header, literal: prefixTree(lit, false), distance: prefixTree(dist, false) };
  return null;
}
// Index earlier triples in descending position order. The chain search compares
// bytes before accepting a match, including on hash collisions.
function priorOccurrences(raw, runs, stride) {
  const shortHeads = new Int32Array(131072), longHeads = new Int32Array(131072);
  const short = new Int32Array(raw.length), long = new Int32Array(raw.length);
  shortHeads.fill(-1); longHeads.fill(-1);
  short.fill(-1); long.fill(-1);
  for (let i = 0; i + 2 < raw.length; i++) {
    // The second index distinguishes repeated prefixes by their following bytes or run boundary.
    const leading = raw[i] | (raw[i + 1] << 8) | (raw[i + 2] << 16);
    const key = Math.imul(leading, -1640531527) >>> 15;
    short[i] = shortHeads[key]; shortHeads[key] = i;
    if (i + 13 < raw.length) {
      const span = runs[i], edge = i + span;
      const following = span >= 4 && span < 258 && edge + 3 < raw.length
        ? span | (raw[edge] << 8) | (raw[edge + 1] << 16) | (raw[edge + 3] << 24)
        : raw[i + 4] | (raw[i + 7] << 8) | (raw[i + 13] << 16);
      const longer = (Math.imul(leading, -1640531527) ^ Math.imul(following, 16777619)) >>> 15;
      long[i] = longHeads[longer]; longHeads[longer] = i;
    }
  }
  const rows = stride > 0 ? [1, 2, 3, 4, 6, 8, 12, 16, 24].map(n => n * stride).filter(d => d <= 32768) : [];
  return { short, long, rows };
}

const lengthBase = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const lengthExtra = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const distanceBase = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const distanceExtra = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const symbolForLength = new Uint16Array(259);
const symbolForDistance = new Uint8Array(32769);
for (let i = 0; i < lengthBase.length; i++)
  symbolForLength.fill(257 + i, lengthBase[i], i === 28 ? 259 : lengthBase[i + 1]);
for (let i = 0; i < distanceBase.length; i++)
  symbolForDistance.fill(i, distanceBase[i], i === 29 ? 32769 : distanceBase[i + 1]);

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
  }
  peek(n) {
    const pos = this.at >>> 3,
      shift = this.at & 7,
      b = this.bytes;
    const v = b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16);
    return (v >>> shift) & ((1 << n) - 1);
  }
  read(n) {
    const value = this.peek(n);
    this.at += n;
    return value;
  }
}
class BitWriter {
  constructor(size) {
    this.bytes = Buffer.alloc(Math.max(size, 32));
    this.at = 0;
  }
  write(value, n) {
    if (!n) return;
    let pos = this.at >>> 3,
      shift = this.at & 7;
    if (pos + 3 >= this.bytes.length) {
      const bigger = Buffer.alloc(this.bytes.length * 2);
      this.bytes.copy(bigger);
      this.bytes = bigger;
    }
    const v = (value & ((1 << n) - 1)) << shift;
    this.bytes[pos] |= v;
    if (shift + n > 8) this.bytes[pos + 1] |= v >>> 8;
    if (shift + n > 16) this.bytes[pos + 2] |= v >>> 16;
    this.at += n;
  }
  copy(reader, from, to) {
    reader.at = from;
    while (from < to) {
      const n = Math.min(16, to - from);
      this.write(reader.read(n), n);
      from += n;
    }
  }
}
function prefixTree(lengths, forReading = true) {
  const lens = Uint8Array.from(lengths),
    counts = new Uint16Array(16),
    starts = new Uint16Array(16);
  let max = 1,
    code = 0;
  for (const n of lens)
    if (n) {
      counts[n]++;
      max = Math.max(max, n);
    }
  for (let n = 1; n <= max; n++) {
    code = (code + counts[n - 1]) << 1;
    starts[n] = code;
  }
  const lookup = forReading ? new Uint16Array(1 << max) : null,
    reverse = new Uint16Array(lens.length);
  for (let sym = 0; sym < lens.length; sym++) {
    const n = lens[sym];
    if (!n) continue;
    let a = starts[n]++,
      b = 0;
    for (let j = 0; j < n; j++) {
      b = (b << 1) | (a & 1);
      a >>>= 1;
    }
    reverse[sym] = b;
    if (forReading) for (let i = b; i < lookup.length; i += 1 << n) lookup[i] = (sym << 4) | n;
  }
  return { lens, max, lookup, reverse };
}
function symbol(reader, tree) {
  const found = tree.lookup[reader.peek(tree.max)];
  if (!found) throw Error('Missing DEFLATE prefix code.');
  reader.at += found & 15;
  return found >>> 4;
}
const fixedLiteral = prefixTree(
  Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
);
const fixedDistance = prefixTree(Array(32).fill(5));
function readTrees(reader) {
  const literalCount = reader.read(5) + 257,
    distanceCount = reader.read(5) + 1,
    codeCount = reader.read(4) + 4;
  const lens = new Uint8Array(19);
  for (let i = 0; i < codeCount; i++) lens[codeLengthOrder[i]] = reader.read(3);
  const tree = prefixTree(lens),
    all = [];
  while (all.length < literalCount + distanceCount) {
    const s = symbol(reader, tree);
    if (s < 16) {
      all.push(s);
      continue;
    }
    const rep = s === 16 ? 3 + reader.read(2) : s === 17 ? 3 + reader.read(3) : 11 + reader.read(7);
    const value = s === 16 ? all[all.length - 1] : 0;
    if (value === undefined || all.length + rep > literalCount + distanceCount)
      throw Error('Invalid DEFLATE code lengths.');
    for (let j = 0; j < rep; j++) all.push(value);
  }
  return [prefixTree(all.slice(0, literalCount)), prefixTree(all.slice(literalCount))];
}
// Recover block boundaries and the LZ77 parse from a zlib-wrapped stream. The
// only streams passed here are generated inside this encoder for the same input.
function readPlan(packed, rawSize, retainBlocks) {
  const bytes = packed.subarray(2, -4),
    reader = new BitReader(bytes);
  const blocks = [],
    positions = [],
    lengths = [],
    distances = [];
  let pos = 0,
    final = 0;
  do {
    const header = reader.at,
      start = pos;
    final = reader.read(1);
    const type = reader.read(2);
    if (type === 0) {
      reader.at = (reader.at + 7) & ~7;
      const len = reader.read(16),
        nl = reader.read(16);
      if (((len ^ nl) & 65535) !== 65535) throw Error('Invalid stored block length.');
      reader.at += len * 8;
      pos += len;
      if (retainBlocks) blocks.push({ header, type, start, end: pos, final });
      continue;
    }
    if (type === 3) throw Error('Reserved DEFLATE block type.');
    const [literal, distance] = type === 1 ? [fixedLiteral, fixedDistance] : readTrees(reader);
    const dataStart = reader.at;
    while (true) {
      const t = symbol(reader, literal);
      if (t < 256) {
        pos++;
        continue;
      }
      if (t === 256) break;
      const l = t - 257,
        len = lengthBase[l] + reader.read(lengthExtra[l]);
      const d = symbol(reader, distance),
        dist = distanceBase[d] + reader.read(distanceExtra[d]);
      if (!Number.isInteger(len) || !Number.isInteger(dist) || dist > pos)
        throw Error('Invalid DEFLATE match.');
      positions.push(pos);
      lengths.push(len);
      distances.push(dist);
      pos += len;
    }
    if (retainBlocks)
      blocks.push({ header, dataStart, dataEnd: reader.at, type, start, end: pos, final, literal, distance });
    if (pos > rawSize || reader.at > 8 * bytes.length) throw Error('Stream exceeds expected size.');
  } while (!final);
  if (pos !== rawSize || Math.ceil(reader.at / 8) !== bytes.length)
    throw Error('DEFLATE length mismatch.');
  return {
    blocks,
    positions: Int32Array.from(positions),
    lengths: Uint16Array.from(lengths),
    distances: Uint16Array.from(distances),
  };
}
function printSymbol(writer, tree, s) {
  const n = tree.lens[s];
  if (!n) throw Error('Absent symbol in chosen block.');
  writer.write(tree.reverse[s], n);
}
export function extendMatch(raw, words, runs, pos, dist, known, max) {
  let n = known;
  if (runs[pos] > n && raw[pos] === raw[pos - dist]) {
    n = Math.max(n, Math.min(max, runs[pos], runs[pos - dist]));
  }
  if (n === max || raw[pos + n] !== raw[pos + n - dist]) return n;
  // Big-endian words place the first differing byte at the most significant end.
  const source = pos - dist;
  while (n + 4 <= max) {
    const different = words.getUint32(pos + n) ^ words.getUint32(source + n);
    if (different) return n + (Math.clz32(different) >>> 3);
    n += 4;
  }
  while (n < max && raw[pos + n] === raw[source + n]) n++;
  return n;
}
// Reparse several native LZ77 factorizations under the starter stream's exact
// Huffman prices. Every old match and literal remains available. Matches found
// by another parser can be shortened or extended anywhere they overlap a cut.
// Model the likely change in tree lengths when a reparsed block uses a symbol
// more or less often. Keep some weight on this block's actual integer codes.
// A dominant symbol occupies one branch, so condition the remaining alphabet
// on the other branch to respect Huffman's one-bit minimum.
function blendedPrices(frequencies, original, fallback) {
  let total = 0, largest = 0, peak = -1;
  for (let i = 0; i < frequencies.length; i++) {
    const count = frequencies[i];
    total += count;
    if (count > largest) { largest = count; peak = i; }
  }
  const weights = new Uint8Array(frequencies.length);
  for (let i = 0; i < weights.length; i++) {
    const before = original[i] || fallback(i);
    if (!total) { weights[i] = before * 8; continue; }
    const count = frequencies[i] + 0.35;
    let ideal;
    if (largest * 2 > total) {
      ideal = i === peak ? 1 : 1 + Math.log2((total - largest + 0.35 * (weights.length - 1)) / count);
    } else {
      ideal = Math.log2((total + 0.35 * weights.length) / count);
    }
    const bits = 0.32 * before + 0.68 * Math.min(15, Math.max(1, ideal));
    weights[i] = Math.round(8 * bits);
  }
  return weights;
}

function pricesFromParse(raw, block, plan, firstMatch) {
  const literals = new Uint32Array(286), distances = new Uint32Array(30);
  let at = block.start, match = firstMatch;
  while (match < plan.positions.length && plan.positions[match] < at) match++;
  while (at < block.end) {
    if (match < plan.positions.length && plan.positions[match] === at) {
      const length = plan.lengths[match], distance = plan.distances[match];
      literals[symbolForLength[length]]++;
      distances[symbolForDistance[distance]]++;
      match++;
      at += length;
    } else {
      literals[raw[at++]]++;
    }
  }
  literals[256]++;
  return [
    blendedPrices(literals, block.literal.lens, i => i < 256 ? 12 : 10),
    blendedPrices(distances, block.distance.lens, () => 8),
  ];
}

function reprice(raw, base, alternateStreams, prior, runs, depthLimit, extraStarts, fractional = false, selected = null) {
  const words = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const units = fractional ? 8 : 1;
  const lengthBits = lengthExtra.map(n => n * units), distanceBitsForSymbol = distanceExtra.map(n => n * units);
  const plans = [
    readPlan(base, raw.length, true),
    ...alternateStreams.map((x) => readPlan(x, raw.length, false)),
  ];
  const blocks = plans[0].blocks;
  const events = new Uint8Array(raw.length);
  for (const plan of plans) {
    for (let j = 0; j < plan.positions.length; j++) {
      const at = plan.positions[j], end = at + plan.lengths[j];
      for (let p = Math.max(0, at - 4); p <= Math.min(raw.length - 1, at + 4); p++) events[p] = 1;
      if (end < raw.length) events[end] = 1;
      if (end > 2) events[end - 2] = 1;
      if (end > 4) events[end - 4] = 1;
    }
  }
  if (base.length < 85000 && raw.length <= extraStarts * 2 && extraStarts) {
    for (let i = 1; i + 2 < raw.length; i++) {
      if (raw[i - 1] !== raw[i] || runs[i] <= 3 || (i & 31) === 0) events[i] = 1;
    }
  } else if (base.length < 185000 && extraStarts) {
    // Spread a fixed number of extra starts across the input. Existing matches
    // always remain eligible, even on unusually noisy screenshots.
    const interval = Math.max(1, Math.ceil(raw.length / extraStarts));
    let next = 1;
    for (let i = 1; i + 2 < raw.length; i++) {
      if (i < next || events[i]) continue;
      if (raw[i - 1] !== raw[i] || runs[i] <= 3 || (i & 31) === 0) {
        events[i] = 1;
        next = i + interval;
      }
    }
  }
  const costs = new Int32Array(raw.length + 1),
    lengthPath = new Uint16Array(raw.length),
    distancePath = new Uint16Array(raw.length);
  const writer = new BitWriter(base.length),
    reader = new BitReader(base.subarray(2, -4));
  const streamEnds = plans.map(() => 0),
    cursors = new Int32Array(plans.length);
  const capacity = plans.length + depthLimit + 21 + prior.rows.length;
  const candidates = new Uint16Array(capacity),
    reach = new Uint16Array(capacity),
    prices = new Uint16Array(capacity);
  const bestLengths = new Uint16Array(259),
    bestCosts = new Int32Array(259),
    high = 1 << 28;
  const probeBudget = raw.length > 1400000 ? 5000000 : 7200000;
  let probesLeft = 0;
  for (const block of blocks) {
    const { start, end, type, final, literal, distance } = block;
    probesLeft += Math.ceil(probeBudget * (end - start) / raw.length);
    if (type === 0) {
      writeStored(writer, raw, start, end, final);
      continue;
    }
    if (selected && !selected.has(start)) {
      writer.copy(reader, block.header, block.dataEnd);
      for (let i = 0; i < plans.length; i++) {
        const positions = plans[i].positions;
        while (streamEnds[i] < positions.length && positions[streamEnds[i]] < end) streamEnds[i]++;
      }
      continue;
    }
    // Price unused symbols provisionally. Before emitting the chosen tokens,
    // chooseCodebook checks that every symbol has an actual output code.
    const [literalPrices, distancePrices] = fractional
      ? pricesFromParse(raw, block, plans[0], streamEnds[0])
      : [Uint8Array.from({ length: 286 }, (_, i) => literal.lens[i] || (i < 256 ? 12 : 10)),
         Uint8Array.from({ length: 30 }, (_, i) => distance.lens[i] || 8)];
    const minDistanceCost = new Uint8Array(31);
    minDistanceCost[30] = 255;
    for (let k = 29; k >= 0; k--) {
      const bits = distancePrices[k];
      minDistanceCost[k] = Math.min(minDistanceCost[k + 1], bits ? bits + distanceBitsForSymbol[k] : 255);
    }
    const lenCost = new Int32Array(259);
    for (let j = 3; j <= 258; j++) {
      const sym = symbolForLength[j],
        l = literalPrices[sym];
      lenCost[j] = l ? l + lengthBits[sym - 257] : high;
    }
    // UI elements can recur at a useful displacement that is neither a full
    // row nor the nearest occurrence of their first three bytes. Keep a small
    // set of common displacements from independent parses of this block.
    const displacementWeights = new Map();
    for (let s = 0; s < plans.length; s++) {
      const plan = plans[s];
      let idx = streamEnds[s];
      while (idx < plan.positions.length && plan.positions[idx] < end) {
        const dist = plan.distances[idx], length = plan.lengths[idx];
        if (dist >= 8 && length >= 5) {
          const weight = Math.min(48, length) * (s === 0 ? 2 : 1);
          displacementWeights.set(dist, (displacementWeights.get(dist) || 0) + weight);
        }
        idx++;
      }
      streamEnds[s] = idx;
      cursors[s] = idx - 1;
    }
    const frequent = [...displacementWeights]
      .filter(([d, weight]) => weight >= 75 && !prior.rows.includes(d))
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([d]) => d);
    const usefulDistances = [...prior.rows, ...frequent].sort((a, b) => a - b);
    costs[end] = 0;
    const suffixMinimum = new Int32Array(512), prefixMinimum = new Int32Array(512);
    function remember(pos) {
      const slot = pos & 511;
      let best = pos;
      if (pos < end && (pos & 7) !== 7) {
        const next = suffixMinimum[(pos + 1) & 511];
        if (costs[next] < costs[best]) best = next;
      }
      suffixMinimum[slot] = best;
      if ((pos & 7) === 0) {
        best = pos;
        const stop = Math.min(end, pos + 7);
        for (let i = pos; i <= stop; i++) {
          if (costs[i] < costs[best]) best = i;
          prefixMinimum[i & 511] = best;
        }
      }
    }
    function minimumPosition(left, right) {
      if (left === right) return left;
      const lower = left & ~7, upper = right & ~7;
      if (lower === upper) {
        if (left === lower) return prefixMinimum[right & 511];
        if ((right & 7) === 7) return suffixMinimum[left & 511];
        let best = left;
        for (let p = left + 1; p <= right; p++) if (costs[p] < costs[best]) best = p;
        return best;
      }
      let best = suffixMinimum[left & 511];
      for (let p = lower + 8; p < upper; p += 8) {
        const other = suffixMinimum[p & 511];
        if (costs[other] < costs[best]) best = other;
      }
      const tail = prefixMinimum[right & 511];
      return costs[tail] < costs[best] ? tail : best;
    }
    const prefixCosts = new Int32Array(29), prefixLengths = new Uint16Array(29);
    remember(end);
    for (let at = end - 1; at >= start; at--) {
      const literalCost = literalPrices[raw[at]];
      let best = literalCost ? Math.min(high, costs[at + 1] + literalCost) : high,
        bestLength = 0,
        bestDistance = 0;
      if (events[at] && at + 3 <= end) {
        let count = 0,
          max = 0;
        for (let si = 0; si < plans.length; si++) {
          const plan = plans[si];
          let idx = cursors[si];
          while (idx >= 0 && plan.positions[idx] > at) idx--;
          cursors[si] = idx;
          if (idx < 0) continue;
          const startM = plan.positions[idx],
            remaining = startM + plan.lengths[idx] - at;
          if (remaining <= 0) continue;
          const dist = plan.distances[idx],
            distanceSymbol = symbolForDistance[dist],
            symbolCost = distancePrices[distanceSymbol];
          if (!symbolCost) continue;
          let alreadySeen = false;
          for (let j = 0; j < count; j++)
            if (candidates[j] === dist) {
              alreadySeen = true;
              break;
            }
          if (alreadySeen) continue;
          const limit = Math.min(258, end - at);
          const len = extendMatch(raw, words, runs, at, dist, Math.min(remaining, limit), limit);
          if (len < 3) continue;
          candidates[count] = dist;
          reach[count] = len;
          prices[count++] = symbolCost + distanceBitsForSymbol[distanceSymbol];
          max = Math.max(max, len);
        }

        const limit = Math.min(258, end - at);
        let fullCost = 255;
        for (let j = 0; j < count; j++)
          if (reach[j] === limit) fullCost = Math.min(fullCost, prices[j]);
        // Aligned scanlines can be farther back than the nearest hash-chain entries.
        for (const dist of usefulDistances) {
          if (dist > at) break;
          const price = distancePrices[symbolForDistance[dist]] + distanceBitsForSymbol[symbolForDistance[dist]];
          if (fullCost <= price) continue;
          const from = at - dist;
          if (raw[from] !== raw[at] || raw[from + 1] !== raw[at + 1] || raw[from + 2] !== raw[at + 2]) continue;
          let need = 2;
          for (let j = 0; j < count; j++) {
            if (candidates[j] === dist) { need = limit; break; }
            if (prices[j] <= price && reach[j] > need) need = reach[j];
          }
          if (need >= limit || raw[from + need] !== raw[at + need]) continue;
          const len = extendMatch(raw, words, runs, at, dist, 3, limit);
          if (len <= need) continue;
          candidates[count] = dist; reach[count] = len; prices[count++] = price;
          max = Math.max(max, len);
          if (len === limit) fullCost = Math.min(fullCost, price);
        }
        let chain = prior.long, last = chain[at];
        const longLimit = 12;
        for (let step = 0; step < depthLimit + longLimit && probesLeft > 0; step++, last = chain[last]) {
          if (step === longLimit) { chain = prior.short; last = chain[at]; }
          if (last < 0 || at - last > 32768) {
            if (step < longLimit) { step = longLimit - 1; continue; }
            break;
          }
          probesLeft--;
          const dist = at - last,
            distanceSymbol = symbolForDistance[dist],
            distanceBits = distancePrices[distanceSymbol];
          if (fullCost <= minDistanceCost[distanceSymbol]) {
            if (step < longLimit) { step = longLimit - 1; continue; }
            break;
          }
          if (!distanceBits) continue;
          const distancePrice = distanceBits + distanceBitsForSymbol[distanceSymbol];
          let minimumLength = 2,
            alreadySeen = false;
          for (let j = 0; j < count; j++) {
            if (candidates[j] === dist) {
              alreadySeen = true;
              break;
            }
            if (prices[j] <= distancePrice) minimumLength = Math.max(minimumLength, reach[j]);
          }
          if (
            alreadySeen ||
            minimumLength >= limit ||
            raw[last + minimumLength] !== raw[at + minimumLength] ||
            raw[last] !== raw[at] ||
            raw[last + 1] !== raw[at + 1] ||
            raw[last + 2] !== raw[at + 2]
          )
            continue;
          const n = extendMatch(raw, words, runs, at, dist, 3, limit);
          if (n <= minimumLength) continue;
          candidates[count] = dist;
          reach[count] = n;
          prices[count++] = distancePrice;
          max = Math.max(max, n);
          if (n === limit) fullCost = Math.min(fullCost, distancePrice);
        }
        if (count && max <= 28) {
          let v = high,
            chosen = 0;
          for (let j = 3; j <= max; j++) {
            const w = costs[at + j] + lenCost[j];
            if (w < v) {
              v = w;
              chosen = j;
            }
            bestCosts[j] = v;
            bestLengths[j] = chosen;
          }
          for (let j = 0; j < count; j++) {
            const len = reach[j],
              val = bestCosts[len] + prices[j];
            if (val < best) {
              best = val;
              bestLength = bestLengths[len];
              bestDistance = candidates[j];
            }
          }
        } else if (count) {
          let prefixCost = high, selected = 0;
          const lastSymbol = symbolForLength[max] - 257;
          for (let k = 0; k <= lastSymbol; k++) {
            prefixCosts[k] = prefixCost;
            prefixLengths[k] = selected;
            if (k === lastSymbol) break;
            const left = lengthBase[k], right = lengthBase[k + 1] - 1;
            const pos = minimumPosition(at + left, at + right);
            const price = costs[pos] + lenCost[left];
            if (price < prefixCost) {
              prefixCost = price;
              selected = pos - at;
            }
          }
          for (let j = 0; j < count; j++) {
            const cap = reach[j], k = symbolForLength[cap] - 257, left = lengthBase[k];
            const pos = minimumPosition(at + left, at + cap);
            let price = costs[pos] + lenCost[left], length = pos - at;
            if (prefixCosts[k] <= price) {
              price = prefixCosts[k];
              length = prefixLengths[k];
            }
            if (price + prices[j] < best) {
              best = price + prices[j];
              bestLength = length;
              bestDistance = candidates[j];
            }
          }
        }
      }
      costs[at] = best;
      remember(at);
      lengthPath[at] = bestLength;
      distancePath[at] = bestDistance;
    }
    if (costs[start] >= high) throw Error('Lost the input parse.');

    const improved = chooseCodebook(raw, start, end, lengthPath, distancePath, block);
    if (improved?.original) {
      writer.copy(reader, block.header, block.dataEnd);
      continue;
    }
    if (improved) writer.copy(new BitReader(improved.header.bytes), 0, improved.header.at);
    else writer.copy(reader, block.header, block.dataStart);
    const literalOut = improved?.literal || literal,
      distanceOut = improved?.distance || distance;
    for (let i = start; i < end; ) {
      const len = lengthPath[i];
      if (!len) {
        printSymbol(writer, literalOut, raw[i++]);
        continue;
      }
      const dist = distancePath[i],
        lengthSymbol = symbolForLength[len],
        distanceSymbol = symbolForDistance[dist];
      printSymbol(writer, literalOut, lengthSymbol);
      writer.write(len - lengthBase[lengthSymbol - 257], lengthExtra[lengthSymbol - 257]);
      printSymbol(writer, distanceOut, distanceSymbol);
      writer.write(dist - distanceBase[distanceSymbol], distanceExtra[distanceSymbol]);
      i += len;
    }
    printSymbol(writer, literalOut, 256);
  }
  const result = Buffer.concat([
    base.subarray(0, 2),
    writer.bytes.subarray(0, (writer.at + 7) >>> 3),
    base.subarray(-4),
  ]);
  return result.length <= base.length ? result : base;
}

// Give literals and matches one slot each, so the block search can move a cut
// without splitting a match or changing the decoded bytes.
function tokenize(raw, packed, plan = readPlan(packed, raw.length, true)) {
  let size = raw.length;
  for (const n of plan.lengths) size -= n - 1;
  const symbols = new Uint16Array(size),
    distanceSymbols = new Uint8Array(size),
    len = new Uint16Array(size),
    dist = new Uint16Array(size),
    blockMarks = [];
  let at = 0,
    j = 0,
    t = 0,
    bi = 0;
  while (at < raw.length) {
    while (bi < plan.blocks.length && plan.blocks[bi].end <= at) {
      blockMarks.push(t);
      bi++;
    }
    if (j < plan.positions.length && at === plan.positions[j]) {
      const n = plan.lengths[j],
        d = plan.distances[j++];
      symbols[t] = symbolForLength[n];
      distanceSymbols[t] = symbolForDistance[d] + 1;
      len[t] = n;
      dist[t] = d;
      at += n;
    } else {
      symbols[t] = raw[at++];
    }
    t++;
  }
  if (t !== size) throw Error('Token count mismatch.');
  return { symbols, distanceSymbols, len, dist, size, blockMarks };
}
// Estimate the bit cost of neighboring token ranges from their histograms. Try
// several header costs, then compare the resulting partitions with exact trees.
function recommendCuts(tokens, grain) {
  const cuts = new Set([0, tokens.size, ...tokens.blockMarks]);
  for (let i = grain; i < tokens.size; i += grain) cuts.add(i);
  const points = Array.from(cuts).sort((a, b) => a - b);
  const chunks = [];
  for (let u = 1; u < points.length; u++) {
    const hist = new Uint32Array(316),
      start = points[u - 1],
      end = points[u];
    let distanceCount = 0;
    for (let t = start; t < end; t++) {
      hist[tokens.symbols[t]]++;
      if (tokens.distanceSymbols[t]) {
        hist[285 + tokens.distanceSymbols[t]]++;
        distanceCount++;
      }
    }
    const codes = [],
      counts = [];
    for (let k = 0; k < hist.length; k++)
      if (hist[k]) {
        codes.push(k);
        counts.push(hist[k]);
      }
    chunks.push({ codes, counts, n: end - start, d: distanceCount });
  }
  const fees = [320, 600, 920],
    allCosts = fees.map(() => new Float64Array(points.length).fill(Infinity)),
    paths = fees.map(() => new Uint32Array(points.length));
  for (const a of allCosts) a[0] = 0;
  const freq = new Uint32Array(316),
    entropy = new Float64Array(tokens.size + 2);
  for (let i = 1; i < entropy.length; i++) entropy[i] = i * Math.log2(i);
  for (let end = 1; end < points.length; end++) {
    freq.fill(0);
    let totalLit = 0,
      totalDist = 0,
      litTerms = 0,
      distTerms = 0,
      used = 0,
      maxL = 0,
      maxD = 0;
    for (let start = end - 1; start >= 0 && start >= end - 56; start--) {
      const ch = chunks[start];
      totalLit += ch.n;
      totalDist += ch.d;
      for (let p = 0; p < ch.codes.length; p++) {
        const c = ch.codes[p],
          old = freq[c],
          n = old + ch.counts[p];
        freq[c] = n;
        if (!old) used++;
        if (c < 286) {
          litTerms += entropy[n] - entropy[old];
          maxL = Math.max(maxL, n);
        } else {
          distTerms += entropy[n] - entropy[old];
          maxD = Math.max(maxD, n);
        }
      }
      // A one-bit code is the shortest representable even in a very skewed alphabet.
      const bestPossible = (tot, terms, max) => {
        if (!tot) return 0;
        const base = entropy[tot] - terms;
        if (2 * max <= tot) return base;
        return tot + entropy[tot - max] - terms + entropy[max];
      };
      const payload =
        bestPossible(totalLit, litTerms, maxL) + bestPossible(totalDist, distTerms, maxD);
      for (let i = 0; i < fees.length; i++) {
        const val = allCosts[i][start] + payload + fees[i] + 1.2 * used;
        if (val < allCosts[i][end]) {
          allCosts[i][end] = val;
          paths[i][end] = start;
        }
      }
    }
  }
  return paths.map((parents) => {
    const groups = [];
    let end = points.length - 1;
    while (end > 0) {
      const a = parents[end];
      groups.unshift([points[a], points[end]]);
      end = a;
    }
    return groups;
  });
}
// Price a fixed or dynamic block, including its header and extra bits.
function segmentPlan(tokens, start, end, memo) {
  const key = start + ',' + end;
  if (memo.has(key)) return memo.get(key);
  const litCounts = new Uint32Array(286),
    distCounts = new Uint32Array(30);
  let extra = 0;
  for (let i = start; i < end; i++) {
    const s = tokens.symbols[i];
    litCounts[s]++;
    if (tokens.distanceSymbols[i]) {
      const d = tokens.distanceSymbols[i] - 1;
      distCounts[d]++;
      extra += lengthExtra[s - 257] + distanceExtra[d];
    }
  }
  litCounts[256]++;
  const lit = optimalLengths(litCounts, 15),
    dist = optimalLengths(distCounts, 15),
    header = encodeCodebook(lit, dist, 0);
  let bits = header.at + extra,
    fixed = 3 + extra;
  for (let i = 0; i < 286; i++) {
    bits += litCounts[i] * lit[i];
    fixed += litCounts[i] * fixedLiteral.lens[i];
  }
  for (let i = 0; i < 30; i++) {
    bits += distCounts[i] * dist[i];
    fixed += distCounts[i] * 5;
  }
  const out =
    fixed <= bits
      ? { start, end, bits: fixed, literal: fixedLiteral, distance: fixedDistance }
      : {
          start,
          end,
          bits,
          header,
          literal: prefixTree(lit, false),
          distance: prefixTree(dist, false),
        };
  memo.set(key, out);
  return out;
}
function emitSegment(w, b, tokens, final) {
  if (b.header) {
    w.write(final, 1);
    w.copy(new BitReader(b.header.bytes), 1, b.header.at);
  } else {
    w.write(final, 1);
    w.write(1, 2);
  }
  for (let i = b.start; i < b.end; i++) {
    const s = tokens.symbols[i];
    printSymbol(w, b.literal, s);
    if (s < 257) continue;
    const d = tokens.distanceSymbols[i] - 1;
    w.write(tokens.len[i] - lengthBase[s - 257], lengthExtra[s - 257]);
    printSymbol(w, b.distance, d);
    w.write(tokens.dist[i] - distanceBase[d], distanceExtra[d]);
  }
  printSymbol(w, b.literal, 256);
}
function writeSegments(tokens, layout, base) {
  const w = new BitWriter(base.length);
  for (let j = 0; j < layout.length; j++) {
    emitSegment(w, layout[j], tokens, j === layout.length - 1 ? 1 : 0);
  }
  return Buffer.concat([
    base.subarray(0, 2),
    w.bytes.subarray(0, (w.at + 7) >>> 3),
    base.subarray(-4),
  ]);
}
// Combine cuts proposed by different entropy penalties. A block may span a cut
// that one estimate preferred, or end at a cut borrowed from another estimate.
function combineLayouts(tokens, layouts, memo) {
  const cuts = new Set([0, tokens.size, ...tokens.blockMarks]);
  const predecessors = new Map();
  function offer(start, end) {
    if (!predecessors.has(end)) predecessors.set(end, new Set());
    predecessors.get(end).add(start);
  }
  for (const layout of layouts) {
    for (const [a, b] of layout) {
      cuts.add(a); cuts.add(b); offer(a, b);
    }
  }
  const original = [0, ...tokens.blockMarks, tokens.size].filter((v, i, all) => i === 0 || v !== all[i - 1]);
  for (let i = 1; i < original.length; i++) offer(original[i - 1], original[i]);
  const points = [...cuts].sort((a, b) => a - b);
  const costs = new Map([[0, 0]]), parent = new Map();
  for (let j = 1; j < points.length; j++) {
    const end = points[j];
    for (let i = Math.max(0, j - 4); i < j; i++) offer(points[i], end);
    let best = Infinity;
    for (const start of predecessors.get(end)) {
      const block = segmentPlan(tokens, start, end, memo);
      const price = costs.get(start) + block.bits;
      if (price < best) { best = price; parent.set(end, block); }
    }
    costs.set(end, best);
  }
  const result = [];
  for (let end = tokens.size; end > 0;) {
    const block = parent.get(end); result.push(block); end = block.start;
  }
  return result.reverse();
}
// Rebuild block headers only when the new boundaries reduce the byte count.
function repartition(raw, base, grain = 320) {
  const tokens = tokenize(raw, base);
  if (tokens.size < 5) return base;
  const memo = new Map();
  const layouts = recommendCuts(tokens, grain);
  const best = combineLayouts(tokens, layouts, memo);
  // Improve estimated cuts using exact prefix-code and header costs at nearby token boundaries.
  for (let idx = 1; idx < best.length; idx++) {
    const a = best[idx - 1],
      b = best[idx];
    let cut = a.end,
      cost = a.bits + b.bits,
      pa = a,
      pb = b;
    const width = Math.min(grain, Math.floor((b.end - a.start) / 3));
    for (const step of [
      -width,
      -Math.floor(width / 2),
      -Math.floor(width / 4),
      Math.floor(width / 4),
      Math.floor(width / 2),
      width,
    ]) {
      const pos = cut + step;
      if (pos <= a.start || pos >= b.end || !step) continue;
      const left = segmentPlan(tokens, a.start, pos, memo),
        right = segmentPlan(tokens, pos, b.end, memo);
      if (left.bits + right.bits < cost) {
        pa = left;
        pb = right;
        cost = left.bits + right.bits;
      }
    }
    best[idx - 1] = pa;
    best[idx] = pb;
  }
  // The same cut can move again when its neighbors have changed. Finish with
  // narrower offsets to find shifts smaller than a coarse histogram chunk.
  for (let j = best.length - 1; j > 0; j--) {
    const a = best[j - 1], b = best[j];
    let score = a.bits + b.bits;
    const step = Math.max(1, Math.floor(grain / 14));
    for (const off of [-2 * step, -step, step, 2 * step]) {
      const at = a.end + off;
      if (at <= a.start || at >= b.end) continue;
      const left = segmentPlan(tokens, a.start, at, memo);
      const right = segmentPlan(tokens, at, b.end, memo);
      if (left.bits + right.bits < score) {
        score = left.bits + right.bits; best[j - 1] = left; best[j] = right;
      }
    }
  }
  const out = writeSegments(tokens, best, base);
  return out.length < base.length ? out : base;
}

// Shrinking a dynamic header can change the alignment of later stored blocks.
function writeStored(writer, raw, start, end, final) {
  writer.write(final, 1);
  writer.write(0, 2);
  writer.write(0, (8 - (writer.at & 7)) & 7);
  writer.write(end - start, 16);
  writer.write((end - start) ^ 65535, 16);
  for (let i = start; i < end; i++) writer.write(raw[i], 8);
}

// The code that minimizes weighted payload length need not minimize a DEFLATE
// block. Equalizing neighboring low counts can shorten the run-length-coded tree.
function regularizedCounts(counts, softness, fillHoles) {
  const weights = Float64Array.from(counts);
  let last = counts.length - 1;
  while (last > 0 && !counts[last]) last--;
  for (let begin = 0; begin <= last;) {
    if (!counts[begin]) { begin++; continue; }
    let sum = counts[begin], end = begin + 1;
    for (; end <= last; end++) {
      const count = counts[end], average = sum / (end - begin);
      if (!count && (!fillHoles || end === last || !counts[end + 1] || average > 2.9)) break;
      if (Math.abs(count - average) > Math.max(softness, average * softness * 0.14)) break;
      sum += count;
    }
    if (end - begin >= 3) {
      const mean = Math.max(0.5, sum / (end - begin));
      weights.fill(mean, begin, end);
    }
    begin = end;
  }
  return weights;
}
function blockBooks(counts) {
  const out = [];
  const signatures = new Set();
  for (const [softness, fill, depth] of [[0, false, 15], [0, false, 11],
      [1.0, false, 15], [2.3, true, 15], [4.0, true, 12], [7.0, true, 10]]) {
    const freq = softness ? regularizedCounts(counts, softness, fill) : counts;
    const lengths = optimalLengths(freq, depth);
    const signature = Buffer.from(lengths).toString('base64');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    let cost = 0;
    for (let i = 0; i < counts.length; i++) cost += counts[i] * lengths[i];
    out.push({ lengths, cost });
  }
  return out;
}
function tuneHeaders(raw, base) {
  const plan = readPlan(base, raw.length, true);
  const reader = new BitReader(base.subarray(2, -4));
  const writer = new BitWriter(base.length);
  let match = 0;
  for (const block of plan.blocks) {
    if (block.type === 0) {
      writeStored(writer, raw, block.start, block.end, block.final);
      continue;
    }
    const firstMatch = match;
    const lc = new Uint32Array(286), dc = new Uint32Array(30);
    let extra = 0;
    for (let at = block.start; at < block.end;) {
      if (match < plan.positions.length && plan.positions[match] === at) {
        const n = plan.lengths[match], d = plan.distances[match++];
        const ls = symbolForLength[n], ds = symbolForDistance[d];
        lc[ls]++; dc[ds]++; extra += lengthExtra[ls - 257] + distanceExtra[ds];
        at += n;
      } else lc[raw[at++]]++;
    }
    lc[256]++;
    let original = null, best = null;
    let bestBits = block.dataEnd - block.header;
    if (block.type === 2) {
      const runHeader = encodeCodebook(block.literal.lens, block.distance.lens, block.final, true);
      const bits = runHeader.at + block.dataEnd - block.dataStart;
      if (bits < bestBits) { original = runHeader; bestBits = bits; }
    }
    const finalists = [];
    const literals = blockBooks(lc), distances = blockBooks(dc);
    for (const l of literals) for (const d of distances) {
      const dataBits = l.cost + d.cost + extra;
      if (dataBits + 25 >= bestBits) continue;
      const header = encodeCodebook(l.lengths, d.lengths, block.final);
      const bits = dataBits + header.at;
      if (bits < bestBits) { best = { l, d, header }; bestBits = bits; }
      finalists.push({ l, d, dataBits, bits });
    }
    finalists.sort((a, b) => a.bits - b.bits);
    for (const { l, d, dataBits } of finalists.slice(0, 2)) {
      const header = encodeCodebook(l.lengths, d.lengths, block.final, true);
      const bits = header.at + dataBits;
      if (bits < bestBits) { best = { l, d, header }; bestBits = bits; }
    }
    if (!best) {
      if (original) writer.copy(new BitReader(original.bytes), 0, original.at);
      else writer.copy(reader, block.header, block.dataStart);
      writer.copy(reader, block.dataStart, block.dataEnd);
      continue;
    }
    writer.copy(new BitReader(best.header.bytes), 0, best.header.at);
    const literal = prefixTree(best.l.lengths, false), distance = prefixTree(best.d.lengths, false);
    let j = firstMatch;
    for (let at = block.start; at < block.end;) {
      if (j < match && plan.positions[j] === at) {
        const n = plan.lengths[j], d = plan.distances[j++];
        const ls = symbolForLength[n], ds = symbolForDistance[d];
        printSymbol(writer, literal, ls);
        writer.write(n - lengthBase[ls - 257], lengthExtra[ls - 257]);
        printSymbol(writer, distance, ds);
        writer.write(d - distanceBase[ds], distanceExtra[ds]);
        at += n;
      } else printSymbol(writer, literal, raw[at++]);
    }
    printSymbol(writer, literal, 256);
  }
  const result = Buffer.concat([
    base.subarray(0, 2),
    writer.bytes.subarray(0, (writer.at + 7) >>> 3),
    base.subarray(-4),
  ]);
  return result.length < base.length ? result : base;
}

// Find a change in the local literal and distance distributions without changing
// any LZ match. Screenshots often switch abruptly from text to a photo or gradient.
function estimateInternalCut(tokens, start, end, logCount) {
  const length = end - start;
  if (length < 1000) return undefined;
  const left = new Int32Array(316), right = new Int32Array(316);
  let distances = 0;
  for (let i = start; i < end; i++) {
    right[tokens.symbols[i]]++;
    const d = tokens.distanceSymbols[i];
    if (d) { right[285 + d]++; distances++; }
  }
  let rightTerms = 0, leftTerms = 0, movedDistances = 0;
  for (const count of right) rightTerms += logCount[count];
  const original = logCount[length] + logCount[distances] - rightTerms;
  const step = Math.max(64, Math.ceil(length / 72));
  let bestGain = 0, bestCut = start;
  function move(symbol) {
    const a = left[symbol]++, b = right[symbol]--;
    leftTerms += logCount[a + 1] - logCount[a];
    rightTerms += logCount[b - 1] - logCount[b];
  }
  for (let i = start; i < end - 120; i++) {
    move(tokens.symbols[i]);
    if (tokens.distanceSymbols[i]) {
      move(285 + tokens.distanceSymbols[i]);
      movedDistances++;
    }
    const n = i + 1 - start;
    if (n < 120 || n % step !== 0) continue;
    const splitCost = logCount[n] + logCount[length - n] +
      logCount[movedDistances] + logCount[distances - movedDistances] - leftTerms - rightTerms;
    const gain = original - splitCost;
    if (gain > bestGain) { bestGain = gain; bestCut = i + 1; }
  }
  return bestGain > 170 ? { start, end, cut: bestCut, step, gain: bestGain } : undefined;
}

// Preserve every original block that cannot be written in fewer bits. Stored
// blocks retain their alignment when a preceding dynamic block changes length.
function splitDenseBlocks(raw, base) {
  const plan = readPlan(base, raw.length, true), tokens = tokenize(raw, base, plan);
  const marks = [0, ...tokens.blockMarks, tokens.size];
  if (marks.length !== plan.blocks.length + 1) return base;
  const logCount = new Float64Array(Math.max(...marks.slice(1).map((m,i) => m - marks[i])) + 1);
  for (let n = 1; n < logCount.length; n++) logCount[n] = n * Math.log2(n);
  const proposals = [];
  for (let i = 0; i < plan.blocks.length; i++) {
    if (plan.blocks[i].type === 0) continue;
    const p = estimateInternalCut(tokens, marks[i], marks[i + 1], logCount);
    if (p) proposals.push({ ...p, blockIndex: i });
  }
  const changes = new Map(), memo = new Map();
  for (const p of proposals.sort((a,b) => b.gain - a.gain).slice(0, 18)) {
    const b = plan.blocks[p.blockIndex];
    let size = b.dataEnd - b.header;
    const delta = Math.max(1, Math.floor(p.step / 2));
    for (const cut of [p.cut, p.cut - delta, p.cut + delta]) {
      if (cut <= p.start || cut >= p.end) continue;
      const first = segmentPlan(tokens, p.start, cut, memo);
      const second = segmentPlan(tokens, cut, p.end, memo);
      if (first.bits + second.bits < size) {
        changes.set(p.blockIndex, [first, second]);
        size = first.bits + second.bits;
      }
    }
  }
  if (!changes.size) return base;
  const w = new BitWriter(base.length), old = new BitReader(base.subarray(2, -4));
  for (let i = 0; i < plan.blocks.length; i++) {
    const b = plan.blocks[i], parts = changes.get(i);
    if (parts) {
      emitSegment(w, parts[0], tokens, 0);
      emitSegment(w, parts[1], tokens, b.final);
    } else if (b.type === 0) {
      writeStored(w, raw, b.start, b.end, b.final);
    } else {
      w.copy(old, b.header, b.dataEnd);
    }
  }
  const compressed = Buffer.concat([
    base.subarray(0, 2), w.bytes.subarray(0, (w.at + 7) >>> 3), base.subarray(-4),
  ]);
  return compressed.length < base.length ? compressed : base;
}

// Dense images can still have a few text or flat-color sections. Reparse a
// bounded selection of whole DEFLATE blocks and retain the other original bits.
function localDenseParse(raw, packed, stride) {
  const plan = readPlan(packed, raw.length, true);
  const candidates = [];
  for (const block of plan.blocks) {
    const length = block.end - block.start;
    const bytes = (block.dataEnd - block.header) / 8;
    const density = bytes / length;
    if (block.type === 0 || length < 5000 || length > 300000 ||
        density < 0.012 || density > 0.84) continue;
    const merit = Math.sqrt(length) * (1 - density) * Math.min(1, density * 8);
    candidates.push({ start: block.start, length, merit });
  }
  candidates.sort((a, b) => b.merit - a.merit || a.start - b.start);
  let budget = 310000;
  const selected = new Set();
  for (const block of candidates) {
    if (selected.size >= 6 || block.length > budget) continue;
    budget -= block.length;
    selected.add(block.start);
  }
  if (!selected.size) return packed;
  const runs = new Uint16Array(raw.length);
  for (let i = raw.length - 1; i >= 0; i--) {
    runs[i] = raw[i] === raw[i + 1] ? Math.min(258, runs[i + 1] + 1) : 1;
  }
  const prior = priorOccurrences(raw, runs, stride);
  const alternatives = [deflateSync(raw, { level: 3, memLevel: 8 })];
  return reprice(raw, packed, alternatives, prior, runs, 36, 0, true, selected);
}
export function repack(raw, packed, stride = 0) {
  if (packed.length > 175000) {
    const localized = localDenseParse(raw, packed, stride);
    return packed.length > 245000 ? splitDenseBlocks(raw, tuneHeaders(raw, localized))
      : tuneHeaders(raw, repartition(raw, localized, 460));
  }
  const alternatives = [
    deflateSync(raw, { level: 1, memLevel: 9 }),
    deflateSync(raw, { level: 5, memLevel: 8 }),
    deflateSync(raw, { level: 9, memLevel: 9 }),
  ];
  const runs = new Uint16Array(raw.length);
  for (let i = raw.length - 1; i >= 0; i--) {
    runs[i] = raw[i] === raw[i + 1] ? Math.min(258, runs[i + 1] + 1) : 1;
  }
  const prior = priorOccurrences(raw, runs, stride);
  const large = raw.length > 1400000;
  const first = reprice(raw, packed, alternatives, prior, runs, large ? 52 : 80, large ? 65000 : 125000);
  const grouped = repartition(raw, first, packed.length < 180000 ? 240 : 380);
  const best = packed.length < 180000
    ? reprice(raw, grouped, [packed, alternatives[0], alternatives[1]], prior, runs, large ? 38 : 62, large ? 42000 : 85000, true)
    : grouped;
  const tuned = tuneHeaders(raw, best);
  // The fractional parse changes token counts and the best places to switch
  // Huffman tables. Reprice candidate boundaries on that final token sequence.
  const finalGrain = tuned.length < 55000 ? 150 : 300;
  const regrouped = repartition(raw, tuned, finalGrain);
  return regrouped === tuned ? tuned : tuneHeaders(raw, regrouped);
}
