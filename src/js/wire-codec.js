// wire-codec.js — QR 物理层适配：把协议二进制帧 ↔ jsQR 能无损承载的文本
//
// 关键背景（2026-10-22 实测）：jsQR 内部按 UTF-8 解码，裸二进制帧(含 0x00/非UTF8)
// 会被丢弃返回空串；而 Base64 字符集(A-Za-z0-9+/=)走 QR Byte 模式可被 jsQR 无损还原。
// 故网页链路在 QR 边界统一做 Base64；P4 客户端(zbar 原始字节)可跳过本层（enc=raw）。
//
// 为让接收端能从一帧扫码文本里稳定切出 payload，每条扫码行用前缀/帧界定：
//   "ASQP2." + base64(payload) + ".E"
// 前缀含协议魔数与协议大版本（PROTO_VER=2）；base64 字符集不含 '.'，故 '.' 可作安全定界。
// v1 前缀 ASQP1. 为 v0.1.0 旧帧（无 type 字段，有 meta/data 误锁 bug），直接不识别。

import { MAGIC } from "./protocol.js";

const PREFIX = "ASQP2."; // MAGIC ASCII("ASQP") + 协议版本2 + '.'
const SUFFIX = ".E";

function bytesToB64(u8) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}
function b64ToBytes(s) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// 二进制帧 → 送进 QR 的文本
export function encodeWire(frameBytes) {
  return PREFIX + bytesToB64(frameBytes) + SUFFIX;
}

// 扫码得到的文本 → 二进制帧；不是本协议帧返回 null。
// 容忍画面里读到的空白/前后噪声，只截取首个完整 PREFIX...SUFFIX。
export function decodeWire(text) {
  if (!text || typeof text !== "string") return null;
  const s = text.replace(/\s+/g, "");
  const start = s.indexOf(PREFIX);
  if (start < 0) return null;
  const body = s.slice(start + PREFIX.length);
  const end = body.indexOf(".");
  if (end < 0) return null;
  const b64 = body.slice(0, end);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const bytes = b64ToBytes(b64);
    // 二次确认魔数，防止误命中
    if (bytes.length < 4 ||
        bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] ||
        bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) return null;
    return bytes;
  } catch {
    return null;
  }
}

// 估算给定原始字节帧编码成 wire 文本后的长度（选 QR 版本用）。
export function wireTextLen(frameByteLen) {
  return PREFIX.length + SUFFIX.length + Math.ceil(frameByteLen / 3) * 4;
}
