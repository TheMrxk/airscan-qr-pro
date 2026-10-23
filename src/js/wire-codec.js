// wire-codec.js — QR 物理层适配：把协议二进制帧 ↔ jsQR 能无损承载的文本
//
// 关键背景：jsQR 按 UTF-8/文本返回，裸二进制帧(含 0x00/非UTF8)会丢。必须编码成可打印文本。
//
// 当前默认（v0.4.0+）：**Base45(RFC9285) + QR Alphanumeric 模式**
//   Base45 字符集恰好是 QR Alphanumeric 字符集（每 QR 字符 5.5bit，Byte 模式 8bit），
//   实测比“Base64 + Byte 模式”省约 23% 容量（tests/base45 光学探针）。
//   wire 形态 = Base45(frameBytes) 本身，【无额外定界符】——Alphanumeric 集只有 45 个字符、
//   全被 Base45 用满，没有“空闲字符”当分隔符。jsQR 一次只返回一个 QR 的内容，接收端直接
//   对扫到的串做 Base45 解码，靠帧内 MAGIC("ASQP"→Base45 "SB8QCA") + 帧形状校验锁定。
//
// 向后兼容：仍识别旧 Base64+Byte 形态 "ASQP3.<b64>.E"（v0.2/0.3），按特征分流。
// v1/v2 更早的版本不再识别。

import { MAGIC } from "./protocol.js";
import { encodeBase45, decodeBase45 } from "./base45.js";

// Base45(MAGIC "ASQP") 的固定前缀，用于快速锚定本协议帧
const B45_MAGIC_PREFIX = "SB8QCA";

function hasMagic(bytes) {
  return bytes.length >= 4 &&
    bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}

// 二进制帧 → 送进 QR 的纯 Base45 文本（QR 端用 Alphanumeric 模式渲染）
export function encodeWire(frameBytes) {
  return encodeBase45(frameBytes);
}

// 告诉发送端：encodeWire 产出的文本要用哪种 QR 模式
export const WIRE_QR_MODE = "Alphanumeric";

// 扫码文本 → 二进制帧；无法识别返回 null。先试 Base45（当前），再试旧 Base64。
export function decodeWire(text) {
  if (!text || typeof text !== "string") return null;
  return tryBase45(text) || tryBase64(text);
}

function tryBase45(text) {
  const anchor = text.indexOf(B45_MAGIC_PREFIX);
  if (anchor < 0) return null;
  const okCh = (ch) => /[0-9A-Z $%*+\-./:]/.test(ch);
  // 向右扩展连续 Base45 字符
  let end = anchor + B45_MAGIC_PREFIX.length;
  while (end < text.length && okCh(text[end])) end++;
  // 向左收集合法字符（可能有画面噪声粘连；真实无噪声时 start=0 即帧首）
  let start = anchor;
  while (start > 0 && okCh(text[start - 1])) start--;

  // 合法 Base45 长度：3 的倍数（偶数字节）或余 2（末尾单字节组）；余 1 非法。
  // 在窗口内尝试不同左偏移（偶数个字符，保证魔数仍落在字节边界）与右截断，
  // 取首个解出合法帧的结果（容忍前后噪声粘连）。
  for (let ls = anchor; ls >= start; ls--) {
    if ((anchor - ls) % 2 !== 0) continue;
    for (let trim = 0; trim <= 10; trim++) {
      const len = end - ls - trim;
      if (len < B45_MAGIC_PREFIX.length || len % 3 === 1) continue;
      try {
        const bytes = decodeBase45(text.slice(ls, ls + len));
        if (hasMagic(bytes) && frameShapeOk(bytes)) return bytes;
      } catch { /* 下一候选 */ }
    }
  }
  return null;
}

// 粗校帧形状：至少够帧头，ver/type 合理
function frameShapeOk(bytes) {
  if (bytes.length < 6) return false;
  const ver = bytes[4], type = bytes[5];
  if (ver < 1 || ver > 10) return false;
  if (type !== 1 && type !== 2) return false;
  return true;
}

function tryBase64(text) {
  const m = text.match(/ASQP3\.([A-Za-z0-9+/]+={0,2})\./);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return hasMagic(u) ? u : null;
  } catch { return null; }
}

// 估算 Base45 wire 文本长度（选 QR 版本用）：每 2 字节 3 字符，尾单字节 2 字符
export function wireTextLen(frameByteLen) {
  const pairs = Math.floor(frameByteLen / 2);
  const tail = frameByteLen % 2;
  return pairs * 3 + (tail ? 2 : 0);
}
