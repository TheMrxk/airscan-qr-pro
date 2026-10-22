// protocol.js — AirScan-QR Pro 二进制帧协议（M1）
// 纯 ES Module，可在浏览器与 Node(node:test) 中复用，无任何外部依赖。
//
// 设计见《开发文档.md》§4。所有多字节整数小端序(LE)。
//   MetaFrame : magic(4) | ver(1) | flags(1) | taskId(2) | K(2) | blockSize(2)
//               | fileLen(4) | sha256(32) | nameLen(1) | name(UTF8)
//   DataFrame : magic(4) | ver(1) | flags(1) | taskId(2) | frameSeq(4)
//               | payload(...) | crc32(4)
//
// M1 阶段 DataFrame.payload = 原始文件分片（无 LT）；M2 起改为 LT 编码包，
// frameSeq 同时承担去重/进度职责，协议头不变，保证收发兼容。

export const MAGIC = new Uint8Array([0x41, 0x53, 0x51, 0x50]); // "ASQP"
export const PROTO_VER = 1;

// flags 位域
export const FLAG_COMPRESS_GZIP = 0x01;
export const FLAG_COMPRESS_RAW = 0x00;
export const FLAG_RESERVED_ZSTD = 0x02;

// ---------- CRC32（IEEE 802.3 多项式 0xEDB88320，查表） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- 小端读写工具 ----------
class Writer {
  constructor(size) { this.buf = new Uint8Array(size); this.dv = new DataView(this.buf.buffer); this.o = 0; }
  u8(v) { this.dv.setUint8(this.o, v); this.o += 1; }
  u16(v) { this.dv.setUint16(this.o, v, true); this.o += 2; }
  u32(v) { this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; }
  bytes(b) { this.buf.set(b, this.o); this.o += b.length; }
  get out() { return this.buf.slice(0, this.o); }
}
class Reader {
  constructor(buf) { this.buf = buf; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); this.o = 0; }
  get left() { return this.buf.length - this.o; }
  u8() { const v = this.dv.getUint8(this.o); this.o += 1; return v; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v >>> 0; }
  bytes(n) { const v = this.buf.slice(this.o, this.o + n); this.o += n; return v; }
}

function isMagic(b) {
  return b.length >= 4 && b[0] === MAGIC[0] && b[1] === MAGIC[1] &&
    b[2] === MAGIC[2] && b[3] === MAGIC[3];
}

// ---------- Meta 帧 ----------
export const META_FIXED_LEN = 4 + 1 + 1 + 2 + 2 + 2 + 4 + 32; // 不含 name
export const META_MAX_NAME = 200;

export function buildMetaFrame(meta) {
  // meta: {taskId, flags, K, blockSize, fileLen, sha256(Uint8Array 32), name(str)}
  const nameBytes = new TextEncoder().encode(meta.name || "");
  if (nameBytes.length > META_MAX_NAME) {
    throw new Error(`文件名过长(${nameBytes.length}>${META_MAX_NAME}B)，协议限制`);
  }
  if (!(meta.sha256 instanceof Uint8Array) || meta.sha256.length !== 32) {
    throw new Error("meta.sha256 必须是 32 字节 Uint8Array");
  }
  const w = new Writer(META_FIXED_LEN + 1 + nameBytes.length);
  w.bytes(MAGIC);
  w.u8(PROTO_VER);
  w.u8(meta.flags & 0xff);
  w.u16(meta.taskId & 0xffff);
  w.u16(meta.K & 0xffff);
  w.u16(meta.blockSize & 0xffff);
  w.u32(meta.fileLen >>> 0);
  w.bytes(meta.sha256);
  w.u8(nameBytes.length);
  w.bytes(nameBytes);
  return w.out;
}

export function parseMetaFrame(buf) {
  if (!isMagic(buf)) return null;
  if (buf.length < META_FIXED_LEN) return null;
  const r = new Reader(buf);
  r.bytes(4); // magic
  const ver = r.u8();
  const flags = r.u8();
  const taskId = r.u16();
  const K = r.u16();
  const blockSize = r.u16();
  const fileLen = r.u32();
  const sha256 = r.bytes(32);
  const nameLen = r.u8();
  if (r.left < nameLen) return null;
  const nameBytes = r.bytes(nameLen);
  const name = new TextDecoder().decode(nameBytes);
  return { ver, flags, taskId, K, blockSize, fileLen, sha256, name };
}

// ---------- Data 帧 ----------
export const DATA_HDR_LEN = 4 + 1 + 1 + 2 + 4; // magic+ver+flags+taskId+frameSeq
export const DATA_CRC_LEN = 4;

export function buildDataFrame(d) {
  // d: {flags, taskId, frameSeq, payload(Uint8Array)}
  const payload = d.payload || new Uint8Array(0);
  const w = new Writer(DATA_HDR_LEN + payload.length + DATA_CRC_LEN);
  w.bytes(MAGIC);
  w.u8(PROTO_VER);
  w.u8(d.flags & 0xff);
  w.u16(d.taskId & 0xffff);
  w.u32(d.frameSeq >>> 0);
  w.bytes(payload);
  w.u32(crc32(payload));
  return w.out;
}

// 返回 {ver,flags,taskId,frameSeq,payload,crcOk} 或 null（非有效帧/CRC失败）
export function parseDataFrame(buf) {
  if (!isMagic(buf)) return null;
  if (buf.length < DATA_HDR_LEN + DATA_CRC_LEN) return null;
  const r = new Reader(buf);
  r.bytes(4);
  const ver = r.u8();
  const flags = r.u8();
  const taskId = r.u16();
  const frameSeq = r.u32();
  const payload = r.bytes(buf.length - DATA_HDR_LEN - DATA_CRC_LEN);
  const crcGiven = r.u32();
  const crcOk = crcGiven === crc32(payload);
  if (!crcOk) return { ver, flags, taskId, frameSeq, payload, crcOk: false };
  return { ver, flags, taskId, frameSeq, payload, crcOk: true };
}

// ---------- 分片（M1：定长，最后一块不补齐；接收端按 frameSeq 重组） ----------
export function splitBlocks(data, blockSize) {
  const blocks = [];
  for (let i = 0; i < data.length; i += blockSize) {
    blocks.push(data.slice(i, i + blockSize));
  }
  return blocks;
}

// 生成 M1 全部数据帧（按顺序分片，无 LT）。
// flags 透传压缩标记；taskId 两字节随机。
export function buildDataFrames(meta, compressedData, onBlockSize) {
  const bs = meta.blockSize;
  const frames = [];
  const blocks = splitBlocks(compressedData, bs);
  if (blocks.length !== meta.K) {
    throw new Error(`分片数 ${blocks.length} 与 meta.K=${meta.K} 不一致`);
  }
  blocks.forEach((payload, i) => {
    frames.push(buildDataFrame({
      flags: meta.flags, taskId: meta.taskId, frameSeq: i, payload,
    }));
  });
  return frames;
}

// ---------- QR 字节容量表（ISO/IEC 18004 Byte 模式权威值，含模式指示+字符计数开销） ----------
// version(1-40) → [L, M, Q, H] 可容纳原始字节数。多来源(qr.technology/useqr.app/ISO)核对一致。
// 注意：qrcode-generator 对超长数据不抛错（静默容错），故必须由本表在协议层自行限长。
const RAW_CAPACITY = {
  1: [17, 14, 11, 7], 2: [32, 26, 20, 14], 3: [53, 42, 32, 24],
  4: [78, 62, 46, 34], 5: [106, 84, 60, 44], 6: [134, 106, 74, 58],
  7: [154, 122, 86, 64], 8: [192, 152, 108, 84], 9: [230, 180, 130, 98],
  10: [271, 213, 151, 119], 11: [321, 251, 177, 137], 12: [367, 287, 203, 155],
  13: [425, 331, 241, 177], 14: [458, 362, 258, 194], 15: [520, 412, 292, 220],
  16: [586, 450, 322, 250], 17: [644, 504, 364, 280], 18: [718, 560, 394, 310],
  19: [792, 624, 442, 338], 20: [858, 666, 482, 382], 21: [929, 711, 509, 403],
  22: [1003, 779, 565, 439], 23: [1091, 857, 611, 461], 24: [1171, 911, 661, 511],
  25: [1273, 997, 715, 535], 26: [1367, 1059, 751, 593], 27: [1465, 1125, 805, 625],
  28: [1528, 1190, 868, 658], 29: [1628, 1264, 908, 698], 30: [1732, 1370, 982, 742],
  31: [1840, 1452, 1030, 790], 32: [1952, 1538, 1112, 842],
  33: [2068, 1628, 1168, 898], 34: [2188, 1722, 1228, 958],
  35: [2303, 1809, 1283, 983], 36: [2431, 1911, 1351, 1051],
  37: [2563, 1989, 1423, 1093], 38: [2699, 2099, 1499, 1139],
  39: [2809, 2213, 1579, 1219], 40: [2953, 2331, 1663, 1273],
};
const EC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

// QR 内可承载的【数据帧 payload】安全上限 = 字节容量 - 帧头 - CRC。
export function qrPayloadCapacity(version, ecLevel = "L") {
  const row = RAW_CAPACITY[version];
  if (!row) throw new Error(`不支持的 QR 版本 ${version}`);
  const raw = row[EC_INDEX[ecLevel]];
  return Math.max(0, raw - DATA_HDR_LEN - DATA_CRC_LEN);
}

// M1 选档：给定 payload 需求字节，返回 {version, ec, capacity, blockSize}，
// 在不超容量前提下尽量选低版本（越好扫）；M1 用 L 级（距离换容量，靠 CRC/重扫兜底）。
export function chooseQrProfile(needBytes) {
  for (let v = 10; v <= 40; v++) {
    const cap = qrPayloadCapacity(v, "L");
    if (cap >= needBytes) return { version: v, ec: "L", capacity: RAW_CAPACITY[v][0], blockSize: cap };
  }
  // 超过 V40 单码上限：调用方应缩小 blockSize 到 V40 上限分更多块
  const v = 40;
  return { version: v, ec: "L", capacity: RAW_CAPACITY[v][0], blockSize: qrPayloadCapacity(v, "L") };
}
