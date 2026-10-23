// lt-code.test.mjs — 喷泉码容错：随机丢 5%/15%/30% + 乱序 + 重复，必须 100% 解出
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitEqual, encodePacket, LTDecoder, describePacket, mulberry32,
} from "../src/js/lt-code.js";

// 生成可复现随机数（测试用，与 LT 内部 PRNG 独立）
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeData(n, seed = 1234) {
  const d = new Uint8Array(n);
  const r = rngFrom(seed);
  for (let i = 0; i < n; i++) d[i] = (r() * 256) | 0;
  return d;
}

// 完整传输模拟：喷泉码本质是无限包流——发送端持续产出包（窗口 window×K），
// 每个包独立按 lossRate 丢失、乱序、可能重复；接收端收够即自动解完（这正是真实
// "屏幕无限播放、手机持续收" 的模型，不是固定块数重传）。
function transmit(data, blockSize, { lossRate, window = 3.2, shuffle = true, dup = 0.1, seed = 99 }) {
  const { blocks, K, rawLen } = splitEqual(data, blockSize);
  const dec = new LTDecoder(K, blockSize);
  const rng = rngFrom(seed);

  const total = Math.ceil(K * window);
  let packets = [];
  for (let s = 1; s <= total; s++) {
    if (rng() < lossRate) continue; // 该帧没被摄像头抓到
    packets.push({ seed: s, payload: encodePacket(blocks, s) });
  }
  if (shuffle) {
    for (let i = packets.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [packets[i], packets[j]] = [packets[j], packets[i]];
    }
  }
  // 随机重复投递（同一帧被抓到多次）
  const orig = packets.slice();
  for (const p of orig) if (rng() < dup) packets.push({ ...p });

  for (const p of packets) dec.addPacket(p.seed, p.payload);
  return { dec, K, rawLen };
}

function check(data, blockSize, opts) {
  const { dec, rawLen } = transmit(data, blockSize, opts);
  assert.equal(dec.done, true,
    `未解完：${dec.decodedCount}/${dec.K}（loss=${opts.lossRate}）`);
  // 拼回并截断到原始长度
  const out = new Uint8Array(rawLen);
  const bs = blockSize;
  for (let i = 0; i < dec.K; i++) out.set(dec.blocks[i].subarray(0, Math.min(bs, rawLen - i * bs)), i * bs);
  assert.equal(out.length, data.length);
  for (let i = 0; i < data.length; i++) assert.equal(out[i], data[i], `字节 ${i} 不符`);
}

test("K 较小（16块）：5%/15%/30% 丢包全部还原", () => {
  const data = makeData(16 * 100, 7); // 1600B，bs=100 → K=16
  for (const loss of [0.05, 0.15, 0.30]) {
    check(data, 100, { lossRate: loss, seed: 100 + Math.round(loss * 1000) });
  }
});

test("K 中等（50块）：30% 丢包 + 乱序 + 重复还原", () => {
  const data = makeData(50 * 200, 55); // bs=200 → K=50
  check(data, 200, { lossRate: 0.30, shuffle: true, dup: 0.2, seed: 2024 });
});

test("K 较大（200块）：15% 丢包稳定还原", () => {
  const data = makeData(200 * 150, 88);
  check(data, 150, { lossRate: 0.15, window: 2.2, seed: 77 });
});

test("零丢包顺序到达：约 1.5K 包内可解完（c=0.2 实测）", () => {
  const data = makeData(40 * 200, 321);
  const { blocks, K } = splitEqual(data, 200);
  const dec = new LTDecoder(K, 200);
  let used = 0;
  for (let s = 1; s <= K * 3; s++) {
    dec.addPacket(s, encodePacket(blocks, s)); used++;
    if (dec.done) break;
  }
  assert.ok(dec.done);
  assert.ok(used < K * 1.8, `零丢包开销应在 ~1.5K 内，实际 ${used}/${K}`);
});

test("重复包被去重，不影响解码", () => {
  const data = makeData(40 * 200, 44);
  const { blocks, K } = splitEqual(data, 200);
  const dec = new LTDecoder(K, 200);
  // 窗口给足（2.5K 包），每个重复投递 5 次，去重后仍应解完
  for (let rep = 0; rep < 5; rep++)
    for (let s = 1; s <= Math.ceil(K * 2.5); s++)
      dec.addPacket(s, encodePacket(blocks, s));
  assert.equal(dec.done, true);
});

test("describePacket 同 seed 两端一致（确定性）", () => {
  const a = describePacket(4242, 50);
  const b = describePacket(4242, 50);
  assert.deepEqual(a, b);
  assert.ok(a.degree >= 1 && a.degree <= 50);
  assert.equal(new Set(a.neighbors).size, a.neighbors.length, "邻居无重复");
});

test("PRNG 确定性", () => {
  const r1 = mulberry32(1), r2 = mulberry32(1);
  assert.equal(r1(), r2());
  assert.equal(r1(), r2());
});

test("最后一块不足 blockSize 时零补齐，截断后还原", () => {
  const data = new TextEncoder().encode("最后一块短".repeat(50)); // 非整数倍
  const bs = 128;
  check(data, bs, { lossRate: 0.1, seed: 555 });
});
