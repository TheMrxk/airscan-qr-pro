// qr.limit.test.mjs — 固化关键实测结论：jsQR 只可靠承载可打印文本，裸二进制拿不回。
// 这决定了协议必须在 QR 边界做 二进制→可打印字符(Base64/Base45) 适配。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const qrcode = require("../src/vendor/qrcode.js");
const jsQR = require("../reference/vendor/jsQR.min.js");

function render(qr, scale = 6, margin = 4) {
  const n = qr.getModuleCount(), size = (n + margin * 2) * scale;
  const d = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c))
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const y = (r + margin) * scale + dy, x = (c + margin) * scale + dx;
      const i = (y * size + x) * 4; d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
    }
  return { d, size };
}
const lat = (u) => { let s = ""; for (const b of u) s += String.fromCharCode(b); return s; };
function decodeText(str, mode = "Byte") {
  const q = qrcode(0, "L");
  q.addData(str, mode); q.make();
  const im = render(q);
  const r = jsQR(im.d, im.size, im.size, { inversionAttempts: "attemptBoth" });
  return r ? r.data : null;
}

test("vendor 库可用", () => {
  assert.equal(typeof qrcode, "function");
  assert.equal(typeof jsQR, "function");
});

test("普通可打印 ASCII 无损", () => {
  const s = "ASQP|hello-binary-12345";
  assert.equal(decodeText(s), s);
});

test("完整 Base64 字母表(A-Za-z0-9+/)无损 —— 协议走 base64 可行", () => {
  const s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  assert.equal(decodeText(s), s);
});

test("长 base64 串(模拟整帧编码后)无损", () => {
  const raw = Buffer.from ? Buffer.from : (u8) => u8;
  const bin = new Uint8Array(900);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 37 + 11) % 256;
  const b64 = (typeof Buffer !== "undefined")
    ? Buffer.from(bin).toString("base64")
    : btoa(String.fromCharCode(...bin));
  const got = decodeText(b64);
  assert.ok(got, "长 base64 必须被识别");
  assert.equal(got, b64, "base64 文本逐字符一致");
  // 且能解回原字节
  const back = typeof Buffer !== "undefined"
    ? new Uint8Array(Buffer.from(got, "base64"))
    : Uint8Array.from(atob(got), (c) => c.charCodeAt(0));
  assert.equal(back.length, bin.length);
  let diff = 0; for (let i = 0; i < bin.length; i++) if (back[i] !== bin[i]) diff++;
  assert.equal(diff, 0);
});

test("【约束】裸二进制(含0x00/非UTF8)jsQR 拿不回 → 必须先做可打印编码", () => {
  const bin = [0x41, 0x53, 0x00, 0xFF, 0x80, 0x0A, 0xC8];
  const got = decodeText(lat(Uint8Array.from(bin)));
  // 不是完整还原（空串或被 UTF-8 替换），证明不能裸传
  const ok = got != null && got.length === bin.length &&
    [...got].every((ch, i) => (ch.charCodeAt(0) & 0xff) === bin[i]);
  assert.equal(ok, false, "裸二进制不应能无损取回");
});
