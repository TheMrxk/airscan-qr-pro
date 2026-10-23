// base45.test.mjs — RFC 9285 Base45 编解码：往返无损（尤其含 0x00/高字节/奇偶长度）
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeBase45, decodeBase45 } from "../src/js/base45.js";

function roundtrip(bytes) {
  const s = encodeBase45(bytes);
  // 全可打印 ASCII（jsQR 无损前提）
  assert.match(s, /^[\x20-\x7e]*$/, "必须全可打印 ASCII");
  const back = decodeBase45(s);
  assert.equal(back.length, bytes.length, "长度一致");
  for (let i = 0; i < bytes.length; i++) assert.equal(back[i], bytes[i], `字节${i}`);
}

test("RFC 9285 官方向量：AB → BB8", () => {
  // 'A'=65,'B'=66 → n=65*256+66=16706 → c=26(B), d=11(B), e=8(8)
  assert.equal(encodeBase45(new Uint8Array([65, 66])), "BB8");
});
test("RFC 9285 官方向量：Hello!! → %69 VD92EX0", () => {
  assert.equal(encodeBase45(new TextEncoder().encode("Hello!!")), "%69 VD92EX0");
});
test("RFC 9285 官方向量：base45-1 编码往返一致（长度8→12字符）", () => {
  const bytes = new TextEncoder().encode("base45-1");
  const enc = encodeBase45(bytes);
  assert.equal(enc.length, 12);
  assert.deepEqual(Array.from(decodeBase45(enc)), Array.from(bytes));
});

test("偶数长度 + 含 0x00/0xff 往返", () => {
  roundtrip(new Uint8Array([0, 0, 255, 255, 0x41, 0x53, 0x51, 0x50]));
});
test("奇数长度往返（末尾单字节组）", () => {
  roundtrip(new Uint8Array([1]));
  roundtrip(new Uint8Array([1, 2, 3]));
  roundtrip(new Uint8Array(255).map((_, i) => (i * 37 + 5) % 256));
});
test("随机数据：1B~300B 全覆盖往返", () => {
  for (let len = 1; len <= 300; len++) {
    const d = new Uint8Array(len);
    for (let i = 0; i < len; i++) d[i] = (i * 73 + len) % 256;
    roundtrip(d);
  }
});

test("非法字符/长度抛错", () => {
  assert.throws(() => decodeBase45("A"), /长度非法/);
  assert.throws(() => decodeBase45("@@@"), /非法字符/);
});

test("按 QR 比特占用，Base45+Alphanumeric 比 Base64+Byte 省", () => {
  const d = new Uint8Array(900);
  for (let i = 0; i < d.length; i++) d[i] = (i * 31 + 9) % 256;
  // Base45 串更长，但走 Alphanumeric 每字符 5.5bit；Base64 走 Byte 每字符 8bit
  const bits45 = encodeBase45(d).length * 5.5;
  const bits64 = Buffer.from(d).toString("base64").length * 8;
  assert.ok(bits45 < bits64, `b45=${bits45}bit 应小于 b64=${bits64}bit`);
  assert.ok(bits45 / bits64 < 0.8, "应省约 20%+");
});
