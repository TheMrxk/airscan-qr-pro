// M2 端到端光学对拍：pack→逐帧真画 QR→jsQR 读回（带随机丢包）→LTReceiver→SHA256 校验
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
const require = createRequire(import.meta.url);
const qrcode = require("../src/vendor/qrcode.js");
const jsQR = require("../src/vendor/jsQR.min.js");
const { packFile, makeLtFrame, unpackMeta, unpackData, LTReceiver } = await import("../src/js/packet.js");
const { encodeWire, decodeWire } = await import("../src/js/wire-codec.js");
const { wirePayloadCapacity, peekFrameType, FRAME_TYPE_META, FRAME_TYPE_DATA } = await import("../src/js/protocol.js");

function render(qr, scale=8, margin=4) {
  const n=qr.getModuleCount(),size=(n+margin*2)*scale;
  const d=new Uint8ClampedArray(size*size*4).fill(255);
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const y=(r+margin)*scale+dy,x=(c+margin)*scale+dx;const i=(y*size+x)*4;d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=255;}
  return {d,size};
}
function opticalRead(text){
  const q=qrcode(0,"L");q.addData(text,"Byte");q.make();
  const im=render(q);
  const r=jsQR(im.d,im.size,im.size,{inversionAttempts:"attemptBoth"});
  return r?r.data:null;
}
function rand(s){let a=s>>>0;return()=>{a|=0;a=a+0x6d2b79f5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

async function run(sizeKB, version, loss, seed) {
  const data=new Uint8Array(sizeKB*1024);
  // 分块填真随机（getRandomValues 单次上限 65536）
  for(let i=0;i<data.length;i+=65536)webcrypto.getRandomValues(data.subarray(i,Math.min(i+65536,data.length)));
  const bs=wirePayloadCapacity(version,"L");
  const packed=await packFile({name:"rand.bin",data,blockSize:bs,taskId:7,forceRaw:true});
  const K=packed.meta.K;
  const recv=new LTReceiver(packed.meta);
  const rng=rand(seed);
  let sent=0, readFail=0, lost=0, dup=0, t0=Date.now();

  // 先确保光学读到 META（最多试 5 次）
  let metaLocked=false;
  for(let t=0;t<5 && !metaLocked;t++){
    const scan=opticalRead(encodeWire(packed.metaFrame));
    if(scan){const f=decodeWire(scan);if(f&&peekFrameType(f)===FRAME_TYPE_META){const m=unpackMeta(f);if(m)metaLocked=true;}}
  }
  if(!metaLocked){console.log("✖ META 光学锁定失败");process.exit(1);}

  // 持续发 LT 包直到 done；上限 5K 包
  for(let s=1;s<=K*5 && !recv.done;s++){
    sent++;
    if(rng()<loss){lost++;continue;}
    const text=encodeWire(makeLtFrame(packed,s));
    const scan=opticalRead(text);
    if(!scan){readFail++;continue;}
    const f=decodeWire(scan);
    if(!f||peekFrameType(f)!==FRAME_TYPE_DATA)continue;
    const d=unpackData(f);
    if(!d){readFail++;continue;} // unpackData 内部已做类型+CRC 过滤
    if(!recv.seenPacket(d.frameSeq))recv.feed(d.frameSeq,d.payload,d.taskId);
  }
  const ms=Date.now()-t0;
  if(!recv.done){console.log(`✖ ${sizeKB}KB V${version} loss${loss}: 未解完 ${recv.decodedBlocks}/${K}`);process.exit(1);}
  const out=await recv.assemble();
  const ok=out.length===data.length&&out.every((b,i)=>b===data[i]);
  console.log(`${ok?"✓":"✗"} ${sizeKB}KB raw V${version} K=${K} 光学loss=${loss}: 发${sent} 丢${lost} 读失败${readFail} →解出, 收${recv.dec.seen.size}唯一包 用时${ms}ms ${ok?"字节一致":"损坏!"}`);
  if(!ok)process.exit(1);
}

await run(12, 25, 0.20, 11);
await run(30, 25, 0.30, 22);
console.log("\nM2 光学喷泉对拍全部通过");
