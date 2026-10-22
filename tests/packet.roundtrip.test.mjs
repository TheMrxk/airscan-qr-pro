// packet.roundtrip.test.mjs — 文件级全链路：pack → 帧序列化/解析 → assemble，SHA-256 一致
import { test } from "node:test";
import assert from "node:assert/strict";
import { packFile, unpackMeta, unpackData, assembleFile } from "../src/js/packet.js";
import { compress, decompress, supportsCompressionStream } from "../src/js/compressor.js";

async function roundtrip(name, data) {
  const packed = await packFile({ name, data, taskId: 42 });
  // meta 帧可被解析
  const meta = unpackMeta(packed.metaFrame);
  assert.ok(meta, "meta 帧解析失败");
  assert.equal(meta.name, name);
  assert.equal(meta.taskId, 42);
  assert.equal(packed.dataFrames.length, meta.K, "数据帧数应=K");

  // 模拟摄像头扫到的字节流：逐帧 parse（M1 不允许丢帧，但要能处理乱序后重排）
  const got = packed.dataFrames.map((f) => unpackData(f));
  assert.ok(got.every((x) => x && x.crcOk !== false), "所有帧 CRC 必须通过");

  // 按 frameSeq 重排后组装
  got.sort((a, b) => a.frameSeq - b.frameSeq);
  const blocks = got.map((x) => x.payload);
  const out = await assembleFile(meta, blocks);
  assert.equal(out.length, data.length, "还原长度一致");
  assert.deepEqual(Array.from(out), Array.from(data), "字节完全一致");
  return { meta, packed };
}

test("支持 gzip（运行环境应原生支持）", () => {
  assert.equal(supportsCompressionStream(), true, "Node 18+ 应有 CompressionStream");
});

test("文本日志：压缩后明显变小且完整还原", async () => {
  const text = ("2026-10-22 INFO 心跳正常 studyschedule=10000\n".repeat(500));
  const data = new TextEncoder().encode(text);
  const { meta, packed } = await roundtrip("app.log", data);
  assert.equal(meta.flags & 0x01, 0x01, "应走 gzip");
  // 压缩后总载荷应显著小于原文
  const wireBytes = packed.dataFrames.reduce((s, f) => s + f.length, 0);
  assert.ok(wireBytes < data.length * 0.3, `压缩收益不足 wire=${wireBytes}`);
});

test("JSON 文件往返", async () => {
  const obj = { users: Array.from({ length: 200 }, (_, i) => ({ id: i, name: "张三" + i })) };
  await roundtrip("data.json", new TextEncoder().encode(JSON.stringify(obj)));
});

test("随机字节（抗压缩）：自动降级 raw 仍无损", async () => {
  const data = new Uint8Array(40000);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 256) | 0;
  const { meta } = await roundtrip("random.bin", data);
  // 随机数据 gzip 不划算 → flags 应为 raw(0)
  assert.equal(meta.flags & 0x01, 0, "随机数据应走 raw");
});

test("小文件单块往返", async () => {
  await roundtrip("tiny.txt", new TextEncoder().encode("hello 物理隔离"));
});

test("大文件 200KB 多块往返（M1 甜区验证）", async () => {
  // 半结构化高冗余数据，模拟真实日志/代码
  const data = new TextEncoder().encode(
    "function add(a,b){return a+b;} // 这是一段重复的代码注释用于压缩测试\n".repeat(4000)
  );
  assert.ok(data.length > 200_000);
  const { meta, packed } = await roundtrip("big.js", data);
  assert.ok(meta.K >= 2, "应切成多块");
  assert.ok(packed.dataFrames.length === meta.K);
});

test("坏帧（CRC 失败）被丢弃", async () => {
  const packed = await packFile({ name: "x.txt", data: new Uint8Array(5000) });
  const f = packed.dataFrames[0].slice();
  f[f.length - 6] ^= 0xFF;
  assert.equal(unpackData(f), null, "CRC 失败应返回 null");
});

test("compress/decompress 直连往返", async () => {
  const raw = new TextEncoder().encode("压缩测试".repeat(100));
  const { flags, data } = await compress(raw);
  const back = await decompress(data, flags);
  assert.deepEqual(Array.from(back), Array.from(raw));
});
