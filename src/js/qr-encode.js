// qr-encode.js — QR 生成封装（qrcode-generator，Byte 模式，版本自适应/锁定）
// 纯 ES Module 包装，浏览器通过 <script src="../vendor/qrcode.js"> 引入全局 qrcode；
// Node 单测用 createRequire 引本地 vendor。
//
// 关键：qrcode-generator 对超长数据【不抛异常】（静默容错），
// 所以调用方必须用 protocol.qrPayloadCapacity 自行限长，本模块也做一次断言保护。

import { qrPayloadCapacity } from "./protocol.js";

// 兼容浏览器全局与 Node
function getQrcodeLib() {
  if (globalThis.qrcode) return globalThis.qrcode;
  throw new Error("未找到 qrcode 库（请先加载 vendor/qrcode.js）");
}

// 生成 QR 实例（不渲染），typeNumber=0 让库自动选版本（限长时用指定版本）。
export function makeQr(payload, { version = 0, ecLevel = "L" } = {}) {
  const qr = getQrcodeLib()(version, ecLevel);
  // addData(buf, "Byte")：二进制直塞，避免 Base64 的 33% 膨胀
  qr.addData(toUint8(payload), "Byte");
  qr.make();
  // 显式指定版本时做容量保护（库本身不报错，需自查）
  if (version > 0) {
    const cap = qrPayloadCapacity(version, ecLevel);
    if (payload.length > cap) {
      throw new Error(`payload ${payload.length}B 超过 V${version}-${ecLevel} 上限 ${cap}B`);
    }
  }
  return qr;
}

function toUint8(d) {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (Array.isArray(d)) return new Uint8Array(d);
  return new Uint8Array(d);
}

// 画到 canvas（发送端用）。cellPx 为每模块像素，margin 为静默区模块数。
export function drawToCanvas(payload, canvas, {
  version = 0, ecLevel = "L", cellPx = 4, margin = 2, fg = "#000", bg = "#fff",
} = {}) {
  const qr = makeQr(payload, { version, ecLevel });
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cellPx;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + margin) * cellPx, (r + margin) * cellPx, cellPx, cellPx);
      }
    }
  }
  return { size, modules: n };
}

// 自动选能放下 payload 的最低版本（L 级），返回 {version}。
export function fitVersion(byteLen, ecLevel = "L") {
  for (let v = 1; v <= 40; v++) {
    if (byteLen <= qrPayloadCapacity(v, ecLevel)) return v;
  }
  return 0; // 单码放不下
}
