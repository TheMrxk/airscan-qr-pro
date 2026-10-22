// packet.js — 文件 ↔ 帧序列 的高层打包/解包（M1）
// 串起 compressor + protocol，对 sender/receiver/UI 暴露简单接口。
//
// M1：顺序定长分片（无 LT）。M2 接入喷泉码时只替换内部分片策略，
// 帧头与 meta 不变。

import {
  buildMetaFrame, parseMetaFrame,
  buildDataFrame, parseDataFrame,
  buildDataFrames, qrPayloadCapacity, PROTO_VER,
} from "./protocol.js";
import { compress, decompress } from "./compressor.js";

async function sha256(bytes) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return new Uint8Array(digest);
  }
  // Node 单测兜底
  const { createHash } = await import("node:crypto");
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

// 把文件打包成 {metaFrame, dataFrames, meta}。
// 入参：{name, data(Uint8Array), taskId?, blockSize?, forceRaw?}
// 不显式给 blockSize 时，按目标 QR 档位（默认让单码尽量大但留摄像头余量）选。
export async function packFile({
  name, data, taskId = null,
  blockSize = null, ecLevel = "L",
  forceRaw = false,
}) {
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { flags, data: payloadData } = await compress(raw, { forceRaw });

  // M1 选保守档位：默认 V25-L 单码 payload（摄像头好扫），不直接顶 V40。
  // 块大小不超该档位 payload 上限。
  let bs = blockSize;
  if (!bs) {
    const prof = chooseQrProfileForScan(25, ecLevel);
    bs = prof.blockSize;
  }
  const K = Math.max(1, Math.ceil(payloadData.length / bs));
  const tId = taskId == null ? Math.floor(Math.random() * 0xffff) : taskId & 0xffff;
  const digest = await sha256(raw);

  const meta = {
    taskId: tId, flags, K, blockSize: bs,
    fileLen: raw.length, sha256: digest, name: name || "file.bin",
  };
  const metaFrame = buildMetaFrame(meta);
  const dataFrames = buildDataFrames(meta, payloadData);
  return { meta, metaFrame, dataFrames };
}

// 接收端：喂 metaFrame（可重复，锁定首个任务）→ 返回 meta。
export function unpackMeta(frame) {
  const m = parseMetaFrame(frame);
  return m; // null = 还不是有效 meta
}

// 接收端：解一个数据帧 → {frameSeq,payload,crcOk}
export function unpackData(frame) {
  const d = parseDataFrame(frame);
  if (!d || !d.crcOk) return null;
  return { taskId: d.taskId, frameSeq: d.frameSeq, payload: d.payload, ver: d.ver };
}

// 用收齐的 K 个有序块重组并校验，返回原始文件 Uint8Array。
// blocks: 按 frameSeq 排好的 payload 数组（M1 等齐 K 个）。
export async function assembleFile(meta, blocks) {
  if (blocks.length !== meta.K) {
    throw new Error(`块数不足：${blocks.length}/${meta.K}`);
  }
  const total = meta.blockSize * (meta.K - 1) +
    blocks[meta.K - 1].length;
  // 用各块实际长度拼，最后一块不补齐；总长按压缩数据 = Σ块长
  const compressed = concat(blocks);
  const raw = await decompress(compressed, meta.flags);
  if (raw.length !== meta.fileLen) {
    throw new Error(`解压后长度不符：${raw.length}/${meta.fileLen}`);
  }
  const digest = await sha256(raw);
  if (!bytesEqual(digest, meta.sha256)) {
    throw new Error("SHA-256 校验失败，文件损坏");
  }
  return raw;
}

export function concat(arrs) {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// M1 扫描档位（保守，优先识别率）。version 越大容量越大但越难扫。
export function chooseQrProfileForScan(version = 25, ecLevel = "L") {
  return { version, ec: ecLevel, blockSize: qrPayloadCapacity(version, ecLevel) };
}

export { PROTO_VER };
