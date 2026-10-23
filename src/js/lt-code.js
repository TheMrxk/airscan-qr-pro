// lt-code.js — Luby Transform 喷泉码（M2/P1）
// 纯 ES Module，无依赖，浏览器与 Node(node:test) 通用。
//
// 设计要点：
// - 文件补齐切成 K 个等长 source block（最后一块零补齐，真实长度由 meta.fileLen 截断）。
// - 每个编码包只带 seed（=帧 frameSeq）。发送端/接收端用同一确定性 PRNG 由 seed
//   重现「度 + 邻居 block 列表」，所以无需在包里传邻居，省大量载荷。
// - 鲁棒孤波分布（Robust Soliton）抽度；接收端置信传播（BP）解码。
// - 收任意 K·(1+ε) 个不同包即可解出，无需 ACK、无需知道缺哪帧、天然抗丢帧/乱序/重复。
//
// 参数 c / delta 为可调项（§9 开放问题，真机数据后再标定），默认经典值 c=0.1, delta=0.001。

// ---------- 确定性 PRNG（mulberry32）：同 seed 两端序列完全一致 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 鲁棒孤波度分布 ----------
// 返回按给定 rng 抽一个度 d（1..K）的函数所需的 CDF。
function buildRobustSoliton(K, c, delta) {
  const S = c * Math.log(K / delta) * Math.sqrt(K); // 期望度峰值的辅助量
  const pivot = Math.max(1, Math.round(K / S));     // 尖峰位置（K/S 附近）
  const pdf = new Float64Array(K + 1);              // 1..K
  for (let d = 1; d <= K; d++) {
    // rho：理想孤波
    let rho = d === 1 ? 1 / K : 1 / (d * (d - 1));
    // tau：鲁棒修正
    let tau = 0;
    if (d < pivot) tau = S / (d * K);
    else if (d === pivot) tau = (S / K) * Math.log(S / delta);
    pdf[d] = rho + tau;
  }
  let sum = 0;
  for (let d = 1; d <= K; d++) sum += pdf[d];
  // 归一化为 CDF
  const cdf = new Float64Array(K + 1);
  let acc = 0;
  for (let d = 1; d <= K; d++) { acc += pdf[d] / sum; cdf[d] = acc; }
  cdf[K] = 1; // 消除浮点误差，保证能抽到 K
  return cdf;
}

function sampleDegree(rng, cdf, K) {
  const u = rng();
  for (let d = 1; d <= K; d++) if (u < cdf[d]) return d;
  return K;
}

// 无放回抽 degree 个不同邻居（Fisher–Yates 部分洗牌，确定性依赖 rng）
function sampleNeighbors(rng, K, degree) {
  const idx = Array.from({ length: K }, (_, i) => i);
  for (let i = 0; i < degree; i++) {
    const j = i + Math.floor(rng() * (K - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, degree);
}

// 由 seed 重现该编码包的 {degree, neighbors}。两端必须用完全相同的 K/c/delta。
export function describePacket(seed, K, c = 0.2, delta = 0.001) {
  const rng = mulberry32(seed);
  const cdf = buildRobustSoliton(K, c, delta);
  const degree = sampleDegree(rng, cdf, K);
  const neighbors = sampleNeighbors(rng, K, degree);
  return { degree, neighbors };
}

// ---------- 编码：生成第 seed 个 LT 包的 XOR payload ----------
export function encodePacket(blocks, seed, c = 0.2, delta = 0.001) {
  const K = blocks.length;
  const blockSize = blocks[0].length;
  const { neighbors } = describePacket(seed, K, c, delta);
  const out = new Uint8Array(blockSize);
  for (const n of neighbors) {
    const b = blocks[n];
    for (let i = 0; i < blockSize; i++) out[i] ^= b[i];
  }
  return out;
}

// ---------- 解码：置信传播（BP） ----------
// 用法：const dec = new LTDecoder(K, blockSize);
//       每收到一个包 dec.addPacket(seed, payload)；dec.blocks 解出后非 null。
export class LTDecoder {
  constructor(K, blockSize, c = 0.2, delta = 0.001) {
    this.K = K;
    this.blockSize = blockSize;
    this.c = c; this.delta = delta;
    this.blocks = new Array(K).fill(null);   // 解出的源块
    this.decodedCount = 0;
    this.seen = new Set();                    // 已处理 seed（去重）
    // 未决（尚未消成单邻居）的包：neighbors 为「仍未知」的源块索引，payload 为剩余 XOR
    this.pending = [];
  }

  get done() { return this.decodedCount === this.K; }
  get progress() { return this.decodedCount / this.K; }

  addPacket(seed, payloadIn) {
    seed = seed >>> 0;
    if (this.done || this.seen.has(seed)) return;
    if (!payloadIn || payloadIn.length !== this.blockSize) return; // 长度不符，丢弃
    this.seen.add(seed);

    // 拷贝一份，避免修改接收缓冲；先 XOR 掉所有「已知」源块
    const payload = new Uint8Array(this.blockSize);
    payload.set(payloadIn);
    const { neighbors } = describePacket(seed, this.K, this.c, this.delta);
    const unknown = [];
    for (const n of neighbors) {
      if (this.blocks[n]) {
        const b = this.blocks[n];
        for (let i = 0; i < this.blockSize; i++) payload[i] ^= b[i];
      } else unknown.push(n);
    }
    if (unknown.length === 0) return; // 纯冗余包
    if (unknown.length === 1) {
      this._recover(unknown[0], payload);
    } else {
      this.pending.push({ unknown, payload });
    }
  }

  // 解出一个源块，并在所有未决包中传播（消元）
  _recover(index, value) {
    if (this.blocks[index]) return;
    this.blocks[index] = value;
    this.decodedCount++;
    // 遍历未决列表，原地消元；产生新的度1包则递归
    const newly = [];
    const keep = [];
    for (const p of this.pending) {
      const pos = p.unknown.indexOf(index);
      if (pos >= 0) {
        for (let i = 0; i < this.blockSize; i++) p.payload[i] ^= value[i];
        p.unknown.splice(pos, 1);
        if (p.unknown.length === 1) newly.push(p);
        else if (p.unknown.length > 1) keep.push(p);
        // unknown.length===0：纯冗余，丢弃
      } else {
        keep.push(p);
      }
    }
    this.pending = keep;
    for (const p of newly) {
      if (this.done) break;
      this._recover(p.unknown[0], p.payload);
    }
  }
}

// 把字节数据切成 K 个等长块（最后一块零补齐），返回 {blocks, K, blockSize, rawLen}
export function splitEqual(data, blockSize) {
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
  const K = Math.max(1, Math.ceil(raw.length / blockSize));
  const blocks = new Array(K);
  for (let i = 0; i < K; i++) {
    const blk = new Uint8Array(blockSize);
    const start = i * blockSize;
    blk.set(raw.subarray(start, Math.min(start + blockSize, raw.length)));
    blocks[i] = blk;
  }
  return { blocks, K, blockSize, rawLen: raw.length };
}
