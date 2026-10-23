// wire-codec.test.mjs — QR 物理层适配：默认 Base45(Alphanumeric)，兼容旧 Base64(ASQP3)
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWire, decodeWire, wireTextLen } from "../src/js/wire-codec.js";
import { buildDataFrame, buildMetaFrame, parseMetaFrame, parseDataFrame, wirePayloadCapacityB45, alphaCapacity, FRAME_TYPE_META, FRAME_TYPE_DATA } from "../src/js/protocol.js";

test("含0x00/高字节的数据帧：wire往返字节完全一致（Base45）", () => {
  const payload = new Uint8Array(900);
  for (let i = 0; i < 900; i++) payload[i] = (i * 37 + 11) % 256; // 含0和255
  const frame = buildDataFrame({ flags: 1, taskId: 9, frameSeq: 777, payload });
  const text = encodeWire(frame);
  assert.ok(text.startsWith("SB8QCA"), "Base45 帧应以 MAGIC 的编码开头");
  assert.doesNotMatch(text, /[^\x20-\x7e]/, "wire 文本应全为可打印 ASCII");
  assert.ok(/^[0-9A-Z $%*+\-./:]+$/.test(text), "应全为 Base45 字符（可走 Alphanumeric）");
  const back = decodeWire(text);
  assert.deepEqual(Array.from(back), Array.from(frame));
});

test("向后兼容：旧 Base64 形态 ASQP3 帧也能解", () => {
  const payload = new Uint8Array(900);
  for (let i = 0; i < 900; i++) payload[i] = (i * 37 + 11) % 256;
  const frame = buildDataFrame({ flags: 1, taskId: 9, frameSeq: 777, payload });
  // 手工构造旧 ASQP3 base64 帧
  const b64 = Buffer.from(frame).toString("base64");
  const oldText = "ASQP3." + b64 + ".E";
  const back = decodeWire(oldText);
  assert.deepEqual(Array.from(back), Array.from(frame), "旧帧字节一致还原");
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
  assert.equal(decodeWire("ASQP4.@@@not45.E"), null); // 非 Base45 帧形态
  assert.equal(decodeWire("HELLOWORLD"), null);          // 无 MAGIC 编码前缀
  assert.equal(decodeWire("ASQP1.AAA=.E"), null); // v1 旧帧（无type字段）必须拒绝
  assert.equal(decodeWire("ASQP2.AAA=.E"), null); // v2 旧帧（无compressedLen）必须拒绝
  assert.equal(decodeWire(""), null);
  assert.equal(decodeWire(null), null);
});

test("【v2回归】DATA 帧绝不被当作 META 解析（v0.1.0 真机乱码根因）", () => {
  // 构造一个很长的 DATA 帧（payload 远超 META 固定长度，最容易被误读）
  const payload = new Uint8Array(900);
  for (let i = 0; i < 900; i++) payload[i] = (i * 37 + 11) % 256;
  const dataFrame = buildDataFrame({ flags: 1, taskId: 1234, frameSeq: 5, payload });
  assert.equal(parseMetaFrame(dataFrame), null, "DATA 帧 parseMetaFrame 必须返回 null");
  const d = parseDataFrame(dataFrame);
  assert.equal(d.crcOk, true);
  assert.equal(d.type, FRAME_TYPE_DATA);

  // 反向：META 帧不能被当 DATA
  const sha = new Uint8Array(32).fill(0x7f);
  const metaFrame = buildMetaFrame({ taskId: 1, flags: 0, K: 3, blockSize: 900, fileLen: 2000, sha256: sha, name: "a.bin" });
  assert.equal(parseDataFrame(metaFrame), null, "META 帧 parseDataFrame 必须返回 null");
  const m = parseMetaFrame(metaFrame);
  assert.equal(m.type, FRAME_TYPE_META);
  assert.equal(m.name, "a.bin");
});

test("【v2回归】损坏/伪造 META（离谱长度、非法UTF8名）被拒绝", () => {
  const sha = new Uint8Array(32).fill(0x7f);
  assert.equal(parseMetaFrame(buildMetaFrame({ taskId: 1, flags: 0, K: 0, blockSize: 900, fileLen: 2000, sha256: sha, name: "a.bin" })), null, "K=0 拒绝");
  assert.equal(parseMetaFrame(buildMetaFrame({ taskId: 1, flags: 0, K: 3, blockSize: 999999, fileLen: 2000, sha256: sha, name: "a.bin" })), null, "blockSize 离谱拒绝");
});

test("wirePayloadCapacityB45 反推的 blockSize 编码后不超 Alphanumeric 容量", async () => {
  for (const v of [10, 15, 20, 25]) {
    const bs = wirePayloadCapacityB45(v);
    const frame = buildDataFrame({ flags: 1, taskId: 1, frameSeq: 0, payload: new Uint8Array(bs) });
    const text = encodeWire(frame);
    assert.ok(text.length <= alphaCapacity(v), `V${v}: wire ${text.length} > alpha容量 ${alphaCapacity(v)}`);
  }
});

test("Base45+Alphanumeric 比旧 Base64+Byte 单帧净载荷更大（约+30%）", () => {
  const oldBs = [178, 364, 619, 928]; // v0.3 base64 净载荷（记录值）
  [10, 15, 20, 25].forEach((v, i) => {
    assert.ok(wirePayloadCapacityB45(v) > oldBs[i], `V${v}: ${wirePayloadCapacityB45(v)} 应大于旧 ${oldBs[i]}`);
  });
});

test("wireTextLen 为纯 Base45 长度（每2字节3字符，尾单字节2字符）", () => {
  assert.equal(wireTextLen(900), 1350); // 450 对 ×3
  assert.equal(wireTextLen(901), 1352); // +1 尾字节组 2 字符
});
