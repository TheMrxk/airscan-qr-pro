// wire-codec.test.mjs — QR 物理层 base64 适配：裸二进制帧必须能借文本无损往返
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWire, decodeWire, wireTextLen } from "../src/js/wire-codec.js";
import { buildDataFrame, buildMetaFrame, MAGIC } from "../src/js/protocol.js";

test("含0x00/高字节的数据帧：wire往返字节完全一致", () => {
  const payload = new Uint8Array(900);
  for (let i = 0; i < 900; i++) payload[i] = (i * 37 + 11) % 256; // 含0和255
  const frame = buildDataFrame({ flags: 1, taskId: 9, frameSeq: 777, payload });
  const text = encodeWire(frame);
  assert.ok(text.startsWith("ASQP1."));
  assert.ok(text.endsWith(".E"));
  assert.doesNotMatch(text, /[^\x20-\x7e]/, "wire 文本应全为可打印 ASCII");
  const back = decodeWire(text);
  assert.deepEqual(Array.from(back), Array.from(frame));
});

test("meta 帧同样无损", () => {
  const sha = new Uint8Array(32).fill(0x7f);
  const frame = buildMetaFrame({ taskId: 1, flags: 0, K: 3, blockSize: 900, fileLen: 2000, sha256: sha, name: "a.bin" });
  const back = decodeWire(encodeWire(frame));
  assert.deepEqual(Array.from(back), Array.from(frame));
});

test("从带噪声/空白的扫码文本中提取帧", () => {
  const frame = buildDataFrame({ flags: 0, taskId: 1, frameSeq: 1, payload: new Uint8Array([1, 2, 3]) });
  const text = "  画面噪声 \n" + encodeWire(frame) + " 尾部杂字";
  const back = decodeWire(text);
  assert.deepEqual(Array.from(back), Array.from(frame));
});

test("非本协议文本返回 null", () => {
  assert.equal(decodeWire("https://example.com"), null);
  assert.equal(decodeWire("ASQP1.@@@notbase64.E"), null);
  assert.equal(decodeWire(""), null);
  assert.equal(decodeWire(null), null);
});

test("wireTextLen 为 base64 膨胀+定界长度", () => {
  const len = wireTextLen(900);
  // 900B → base64 1200 字符 + 前缀6 + 后缀2
  assert.equal(len, 1208);
});
