// compressor.js — 传输前压缩自适应（M1）
// 浏览器原生 CompressionStream/DecompressionStream（Chrome80+/Safari16.4+），
// 不引任何第三方库；不支持时自动降级 raw。
//
// 策略：gzip 后只有“实打实变小”才用 gzip（随机/已压缩数据 gzip 反而变大），
// 否则原样 raw。返回 {flags, data}，flags 与 protocol.FLAG_* 对应。

import { FLAG_COMPRESS_GZIP, FLAG_COMPRESS_RAW } from "./protocol.js";

export function supportsCompressionStream() {
  return typeof globalThis.CompressionStream === "function" &&
    typeof globalThis.DecompressionStream === "function";
}

async function gzipBytes(data) {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([data]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(data) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 压缩：返回 {flags, data}。
// forceRaw=true 时跳过 gzip（用于调试/兼容）。
export async function compress(data, { forceRaw = false } = {}) {
  if (!forceRaw && supportsCompressionStream()) {
    try {
      const gz = await gzipBytes(data);
      // 加 gzip 头尾开销约18B，只有收益明显(>2%)才采用，避免压缩噪声
      if (gz.length > 0 && gz.length < data.length * 0.98) {
        return { flags: FLAG_COMPRESS_GZIP, data: gz };
      }
    } catch {
      // 压缩异常则降级 raw
    }
  }
  return { flags: FLAG_COMPRESS_RAW, data: new Uint8Array(data) };
}

// 解压：按 flags 选择；raw 原样返回（拷贝语义由调用方保证）。
export async function decompress(data, flags) {
  if ((flags & FLAG_COMPRESS_GZIP) === FLAG_COMPRESS_GZIP) {
    if (!supportsCompressionStream()) {
      throw new Error("当前浏览器不支持 gzip 解压（需 Safari 16.4+/Chrome 80+）");
    }
    return gunzipBytes(data);
  }
  return new Uint8Array(data);
}
