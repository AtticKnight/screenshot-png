import { readFileSync, writeFileSync } from 'node:fs';

// libdeflate's workspace and input/output limits keep these four-byte reads inside
// the heap. DataView preserves the C little-endian unaligned word loads. The bulk
// operations below use typed-array intrinsics only when C overlap semantics agree.
function patch(source) {
  const old=' var HEAPU32 = new Uint32Array(buffer);';
  const insert='\n var packedWords = new DataView(buffer);';
  if(!source.includes(old))throw Error('missed heap declaration');
  source=source.replace(old,old+insert);
  const reads=/HEAPU8\[(\$\d+(?:_\d+)?)(?: \+ (\d+))? \| 0\] \| HEAPU8\[\1 \+ (\d+) \| 0\] << 8 \| \(HEAPU8\[\1 \+ (\d+) \| 0\] << 16 \| HEAPU8\[\1 \+ (\d+) \| 0\] << 24\)/g;
  let changes=0;
  source=source.replace(reads,(whole,pointer,offset,second,third,fourth)=>{
    const start=Number(offset||0);
    if(+second!==start+1||+third!==start+2||+fourth!==start+3)return whole;
    changes++;return `packedWords.getInt32(${pointer}${start?' + '+start:''}, true)`;
  });
  if(changes!==236)throw Error('unexpected word count '+changes);
  const entries=[[' function $11($0_1, $1_1) {',`  if (($0_1 >>> 0) <= HEAPU8.length && ($1_1 >>> 0) <= HEAPU8.length - $0_1) {
   HEAPU8.fill(0, $0_1, $0_1 + $1_1);
   return $0_1;
  }`],[' function $12($0_1, $1_1, $2_1) {',`  if (($2_1 >>> 0) <= HEAPU8.length && ($0_1 >>> 0) <= HEAPU8.length - $2_1 &&
      ($1_1 >>> 0) <= HEAPU8.length - $2_1 && ($0_1 <= $1_1 || $0_1 - $1_1 >= $2_1)) {
   HEAPU8.copyWithin($0_1, $1_1, $1_1 + $2_1);
   return $0_1;
  }`],[' function $13($0_1, $1_1, $2_1) {',`  if (($2_1 >>> 0) <= HEAPU8.length && ($0_1 >>> 0) <= HEAPU8.length - $2_1 &&
      ($1_1 >>> 0) <= HEAPU8.length - $2_1) {
   HEAPU8.copyWithin($0_1, $1_1, $1_1 + $2_1);
   return;
  }`]];
  for(const [needle,body] of entries){if(source.split(needle).length!==2)throw Error('unrecognized bulk routine');source=source.replace(needle,needle+'\n'+body);}
  return source;
}

const path = process.argv[2];
if (!path) throw new Error('Pass the path to the generated JavaScript.');
writeFileSync(path, patch(readFileSync(path, 'utf8')));
