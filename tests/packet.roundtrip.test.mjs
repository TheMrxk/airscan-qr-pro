// packet.lt-roundtrip.test.mjs — M2 文件级全链路：pack → LT 帧流 → 喂解码器 → assemble，SHA-256 一致
import { test } from "node:test";
import assert from "node:assert/strict";
import { packFile, makeLtFrame, unpackMeta, unpackData, LTReceiver } from "../src/js/packet.js";
import { compress, decompress, supportsCompressionStream } from "../src/js/compressor.js";
import { wirePayloadCapacityB45 } from "../src/js/protocol.js";

// 确定性 PRNG（测试可复现，不用 Math.random 避免偶发）
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 模拟真机"发送端无限播 + 接收端持续收"：每个包独立按 lossRate 丢，收够自动 done。
// maxWindowK 是宽松上限（防死循环），不是固定窗口——LT 是概率解码，这样断言才稳定。
// 返回 {receiver, meta, received}。
async function receive(name, data, { blockSize, lossRate = 0, maxWindowK = 6, seedStart = 1, shuffle = false, rngSeed = 42 } = {}) {
  const packed = await packFile({ name, data, taskId: 42, blockSize });
  const meta = unpackMeta(packed.metaFrame);
  assert.ok(meta, "meta 帧解析失败");
  assert.equal(meta.name, name);
  assert.equal(meta.taskId, 42);

  const recv = new LTReceiver(meta);
  const rng = makeRng(rngSeed);
  const cap = seedStart + Math.ceil(meta.K * maxWindowK);
  const frames = [];
  for (let s = seedStart; s < cap; s++) {
    if (rng() < lossRate) continue;
    frames.push(makeLtFrame(packed, s));
    if (frames.length >= meta.K * maxWindowK) break;
  }
  if (shuffle) {
    const r2 = makeRng(rngSeed ^ 0x9e3779b9);
    for (let i = frames.length - 1; i > 0; i--) {
      const j = Math.floor(r2() * (i + 1));
      [frames[i], frames[j]] = [frames[j], frames[i]];
    }
  }

  let received = 0;
  for (const f of frames) {
    const d = unpackData(f);
    assert.ok(d, "CRC 必须通过（无信道噪声时）");
    if (!recv.seenPacket(d.frameSeq)) received++;
    recv.feed(d.frameSeq, d.payload, d.taskId);
    if (recv.done) break;
  }
  return { recv, meta, packed, received };
}

test("支持 gzip（运行环境应原生支持）", () => {
  assert.equal(supportsCompressionStream(), true, "Node 18+ 应有 CompressionStream");
});

test("文本日志：gzip 后 LT 收够即还原，SHA-256 一致", async () => {
  const text = ("2026-10-22 INFO 心跳正常 studyschedule=10000\n".repeat(500));
  const data = new TextEncoder().encode(text);
  const bs = wirePayloadCapacityB45(20);
  const { recv, meta, received } = await receive("app.log", data, { blockSize: bs });
  assert.equal(meta.flags & 0x01, 0x01, "应走 gzip");
  assert.ok(recv.done, `应收够解完：${recv.decodedBlocks}/${meta.K}`);
  const out = await recv.assemble();
  assert.deepEqual(Array.from(out), Array.from(data));
  // 喷泉码开销：有效唯一包数应在约 1.8K 以内
  assert.ok(received < meta.K * 1.8, `开销过大 ${received}/${meta.K}`);
});

test("JSON 文件往返", async () => {
  const obj = { users: Array.from({ length: 200 }, (_, i) => ({ id: i, name: "张三" + i })) };
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const bs = wirePayloadCapacityB45(20);
  const { recv } = await receive("data.json", data, { blockSize: bs });
  assert.ok(recv.done);
  assert.deepEqual(Array.from(await recv.assemble()), Array.from(data));
});

test("随机字节（抗压缩）：降级 raw + 30% 丢包 + 乱序，仍 100% 还原", async () => {
  const data = new Uint8Array(60000);
  globalThis.crypto.getRandomValues(data); // 真随机，gzip 无法压缩
  const bs = wirePayloadCapacityB45(20);
  const { recv, meta } = await receive("random.bin", data, { blockSize: bs, lossRate: 0.3, maxWindowK: 4, shuffle: true });
  assert.equal(meta.flags & 0x01, 0, "随机数据应走 raw");
  assert.equal(meta.compressedLen, data.length, "raw 时 compressedLen=fileLen");
  assert.ok(recv.done, `30%丢包下应收够：${recv.decodedBlocks}/${meta.K}`);
  assert.deepEqual(Array.from(await recv.assemble()), Array.from(data));
});

test("小文件单块（K=1）往返", async () => {
  const data = new TextEncoder().encode("hello 物理隔离");
  const bs = wirePayloadCapacityB45(15);
  const { recv } = await receive("tiny.txt", data, { blockSize: bs, maxWindowK: 3 });
  assert.ok(recv.done);
  assert.deepEqual(Array.from(await recv.assemble()), Array.from(data));
});

test("大文件 200KB+ 高冗余，多块 LT 还原", async () => {
  const data = new TextEncoder().encode(
    "function add(a,b){return a+b;} // 这是一段重复的代码注释用于压缩测试\n".repeat(4000)
  );
  assert.ok(data.length > 200_000);
  const bs = wirePayloadCapacityB45(25);
  const { recv, meta } = await receive("big.js", data, { blockSize: bs, lossRate: 0.15, maxWindowK: 5, shuffle: true, rngSeed: 314 });
  assert.ok(meta.K >= 2, "应切成多块");
  assert.ok(recv.done, `${recv.decodedBlocks}/${meta.K}`);
  assert.deepEqual(Array.from(await recv.assemble()), Array.from(data));
});

test("坏帧（CRC 失败）unpackData 返回 null，不污染解码器", async () => {
  const packed = await packFile({ name: "x.txt", data: new Uint8Array(5000), blockSize: 300 });
  const f = makeLtFrame(packed, 1).slice();
  f[f.length - 6] ^= 0xFF;
  assert.equal(unpackData(f), null, "CRC 失败应返回 null");
});

test("compress/decompress 直连往返", async () => {
  const raw = new TextEncoder().encode("压缩测试".repeat(100));
  const { flags, data } = await compress(raw);
  const back = await decompress(data, flags);
  assert.deepEqual(Array.from(back), Array.from(raw));
});
