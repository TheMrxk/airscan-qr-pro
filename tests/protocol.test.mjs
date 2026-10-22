// protocol.test.mjs — CRC32 / 帧编解码 / 容量表（node --test）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crc32, buildMetaFrame, parseMetaFrame,
  buildDataFrame, parseDataFrame, splitBlocks,
  qrPayloadCapacity, chooseQrProfile, MAGIC,
} from "../src/js/protocol.js";

test("crc32 已知向量", () => {
  // "123456789" → 0xCBF43926
  const b = new TextEncoder().encode("123456789");
  assert.equal(crc32(b), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("meta 帧往返 + 小端字段", () => {
  const sha = new Uint8Array(32).fill(0xAB);
  const f = buildMetaFrame({
    taskId: 0x1234, flags: 1, K: 7, blockSize: 1200,
    fileLen: 8192, sha256: sha, name: "测试.txt",
  });
  const m = parseMetaFrame(f);
  assert.equal(m.taskId, 0x1234);
  assert.equal(m.flags, 1);
  assert.equal(m.K, 7);
  assert.equal(m.blockSize, 1200);
  assert.equal(m.fileLen, 8192);
  assert.equal(m.name, "测试.txt");
  assert.deepEqual(Array.from(m.sha256), Array.from(sha));
});

test("meta 拒绝坏 magic / 截断", () => {
  assert.equal(parseMetaFrame(new Uint8Array([1, 2, 3])), null);
  const bad = new Uint8Array(100);
  assert.equal(parseMetaFrame(bad), null);
});

test("data 帧往返 + CRC 校验，篡改必失败", () => {
  const payload = new Uint8Array([0, 1, 2, 250, 255]);
  const f = buildDataFrame({ flags: 0, taskId: 5, frameSeq: 0x10001, payload });
  const d = parseDataFrame(f);
  assert.equal(d.crcOk, true);
  assert.equal(d.frameSeq, 0x10001);
  assert.equal(d.taskId, 5);
  assert.deepEqual(Array.from(d.payload), Array.from(payload));
  // 篡改一个 payload 字节 → CRC 失败
  const tampered = f.slice();
  tampered[f.length - 6] ^= 0xFF;
  assert.equal(parseDataFrame(tampered).crcOk, false);
});

test("splitBlocks 定长且最后一块不补齐", () => {
  const data = new Uint8Array(2500);
  const blks = splitBlocks(data, 1200);
  assert.equal(blks.length, 3);
  assert.deepEqual([blks[0].length, blks[1].length, blks[2].length], [1200, 1200, 100]);
});

test("QR 容量表：V40-L≈2.9KB，payload=容量-头-CRC", () => {
  const cap = qrPayloadCapacity(40, "L");
  assert.ok(cap > 2900 && cap < 2953, `V40-L payload=${cap}`);
  assert.ok(qrPayloadCapacity(25, "L") > qrPayloadCapacity(25, "M"));
});

test("chooseQrProfile 按需求选最低可行版本", () => {
  const small = chooseQrProfile(100);
  assert.equal(small.ec, "L");
  assert.ok(small.blockSize >= 100);
  assert.ok(small.version <= 15);
  const huge = chooseQrProfile(5000); // 超单码 → V40 上限
  assert.equal(huge.version, 40);
});

test("magic 常量 = ASQP", () => {
  assert.deepEqual(Array.from(MAGIC), [0x41, 0x53, 0x51, 0x50]);
});
