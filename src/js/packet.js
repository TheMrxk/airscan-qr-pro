// packet.js — 文件 ↔ 喷泉码帧序列 的高层打包/解包（M2：LT）
// 串起 compressor + protocol + lt-code，对 sender/receiver/UI 暴露简单接口。
//
// M2 架构：
//   发送：文件→(压缩)→补齐切 K 个等长 source block→每个播放时刻按 seed 现算 LT 编码包→帧
//        seed 单调递增（就是帧的 frameSeq），无限产生，屏幕循环播放；META 周期插播。
//   接收：META 锁定→建 LTReceiver→每收到一个不同 seed 的包就喂入→BP 解码→
//        收任意 ~1.4K 个有效包即解出→截断到 compressedLen→解压→SHA256 校验。
// 无需 ACK、无需知道缺哪帧，天然抗丢帧/乱序/重复。

import {
  buildMetaFrame, parseMetaFrame,
  buildDataFrame, parseDataFrame,
  encodeMatrixFlag,
} from "./protocol.js";
import { compress, decompress } from "./compressor.js";
import { splitEqual, encodePacket, LTDecoder } from "./lt-code.js";

async function sha256(bytes) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return new Uint8Array(digest);
  }
  // Node 单测兜底
  const { createHash } = await import("node:crypto");
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

// 把文件打包成 LT 发送上下文。
// 入参：{name, data(Uint8Array), taskId?, blockSize, forceRaw?}
// 返回：{meta, metaFrame, blocks(等长补齐), K, blockSize}
// 不预生成所有帧——LT 包用 makeLtFrame(seed) 现算（无限流）。
export async function packFile({
  name, data, taskId = null,
  blockSize, forceRaw = false, matrixN = 1,
}) {
  if (!blockSize || blockSize < 1) throw new Error("LT 必须显式给 blockSize（按 QR 密度反推）");
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { flags: compFlags, data: payloadData } = await compress(raw, { forceRaw });
  const flags = (compFlags & 0x0f) | encodeMatrixFlag(matrixN); // 低4位压缩 + 高4位矩阵阶数

  const { blocks, K } = splitEqual(payloadData, blockSize);
  const tId = taskId == null ? Math.floor(Math.random() * 0xffff) : taskId & 0xffff;
  const digest = await sha256(raw);

  const meta = {
    taskId: tId, flags, K, blockSize,
    fileLen: raw.length, compressedLen: payloadData.length, sha256: digest,
    name: name || "file.bin",
  };
  const metaFrame = buildMetaFrame(meta);
  return { meta, metaFrame, blocks, K, blockSize };
}

// 现算第 seed 个 LT 编码包的数据帧（发送端每个播放时刻调用）
export function makeLtFrame(packed, seed) {
  const payload = encodePacket(packed.blocks, seed);
  return buildDataFrame({
    flags: packed.meta.flags, taskId: packed.meta.taskId, frameSeq: seed, payload,
  });
}

// 接收端：喂 metaFrame → 返回 meta（null=还不是有效 meta）
export function unpackMeta(frame) {
  return parseMetaFrame(frame);
}

// 解一个数据帧 → {frameSeq(=seed),payload,crcOk}；CRC 坏/类型错返回 null
export function unpackData(frame) {
  const d = parseDataFrame(frame);
  if (!d || !d.crcOk) return null;
  return { taskId: d.taskId, frameSeq: d.frameSeq, payload: d.payload, ver: d.ver };
}

// 接收端 LT 收集器：锁定 meta 后建一个，逐包喂入，done 后取文件。
export class LTReceiver {
  constructor(meta) {
    this.meta = meta;
    this.dec = new LTDecoder(meta.K, meta.blockSize);
  }
  get progress() { return this.dec.progress; }
  get decodedBlocks() { return this.dec.decodedCount; }
  get done() { return this.dec.done; }
  seenPacket(seed) { return this.dec.seen.has(seed); }
  // 喂入一个 CRC 正确、taskId 匹配的数据包
  feed(seed, payload, taskId) {
    if (taskId !== this.meta.taskId) return;
    this.dec.addPacket(seed, payload);
  }
  // 解出全部块 → 截断到 compressedLen → 解压 → 长度+SHA256 校验 → 原始文件
  async assemble() {
    if (!this.dec.done) throw new Error(`LT 未解完：${this.dec.decodedCount}/${this.meta.K}`);
    const { K, blockSize, compressedLen } = this.meta;
    const compressed = new Uint8Array(compressedLen);
    for (let i = 0; i < K; i++) {
      const blk = this.dec.blocks[i];
      compressed.set(blk.subarray(0, Math.min(blockSize, compressedLen - i * blockSize)), i * blockSize);
    }
    const raw = await decompress(compressed, this.meta.flags);
    if (raw.length !== this.meta.fileLen) {
      throw new Error(`解压后长度不符：${raw.length}/${this.meta.fileLen}`);
    }
    const digest = await sha256(raw);
    if (!bytesEqual(digest, this.meta.sha256)) throw new Error("SHA-256 校验失败，文件损坏");
    return raw;
  }
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export { PROTO_VER } from "./protocol.js";
