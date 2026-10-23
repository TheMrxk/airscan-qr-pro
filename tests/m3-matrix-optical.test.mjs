// m3-matrix-optical.test.mjs — 多码矩阵端到端光学对拍：
// 发送端一屏 N×N 个 LT 包 → 合成整图 → 接收端按格切分 → 各格 jsQR 解码
// → 喂同一个 LTReceiver（带随机丢格）→ 必须字节一致还原。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const qrcode = require("../src/vendor/qrcode.js");
const jsQR = require("../reference/vendor/jsQR.min.js");
const { paintMatrix, matrixCells } = await import("../src/js/matrix.js");
const { packFile, makeLtFrame, unpackMeta, unpackData, LTReceiver } = await import("../src/js/packet.js");
const { encodeWire, decodeWire } = await import("../src/js/wire-codec.js");
const {
  wirePayloadCapacity, peekFrameType, FRAME_TYPE_META, FRAME_TYPE_DATA,
} = await import("../src/js/protocol.js");

// node 端没有 canvas，用 ImageData 风格缓冲区模拟 ctx
function makeCtx(size) {
  const d = new Uint8ClampedArray(size * size * 4).fill(255);
  return {
    d, size,
    fillStyle: "#fff",
    fillRect(x, y, w, h) { fill(d, size, x, y, w, h, 255); },
  };
}
// paintMatrix 用 "#000" 画黑块；这里包一层把 fillStyle 切换映射到 0/255
function makeCanvasCtx(size) {
  const d = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255; }
  const ctx = {
    d, size, _style: "#fff",
    set fillStyle(s) { this._style = s; },
    get fillStyle() { return this._style; },
    fillRect(x, y, w, h) {
      const v = this._style === "#000" ? 0 : 255;
      x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
      w = Math.round(w); h = Math.round(h);
      for (let yy = y; yy < y + h && yy < size; yy++) {
        for (let xx = x; xx < x + w && xx < size; xx++) {
          const i = (yy * size + xx) * 4;
          d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
        }
      }
    },
  };
  return ctx;
}

function buildQrs(texts, version) {
  return texts.map((t) => {
    const q = qrcode(version, "L");
    q.addData(t, "Byte"); q.make();
    return q;
  });
}

function readCell(d, full, rect) {
  // 从整图裁出 rect（sx,sy,size）→ jsQR
  const s = rect.size;
  const cell = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const si = ((rect.sy + y) * full + (rect.sx + x)) * 4;
      const di = (y * s + x) * 4;
      cell[di] = d[si]; cell[di + 1] = d[si + 1]; cell[di + 2] = d[si + 2]; cell[di + 3] = 255;
    }
  }
  const r = jsQR(cell, s, s, { inversionAttempts: "attemptBoth" });
  return r ? r.data : null;
}

// 完整矩阵传输：每 tick 渲染 N² 个 LT 包（第一屏全 META），接收端逐格读，随机丢格
async function matrixTransfer(sizeKB, version, n, cellLoss, seed) {
  const data = new Uint8Array(sizeKB * 1024);
  for (let i = 0; i < data.length; i += 65536)
    webcrypto.getRandomValues(data.subarray(i, Math.min(i + 65536, data.length)));
  const bs = wirePayloadCapacity(version, "L");
  const packed = await packFile({ name: "m.bin", data, blockSize: bs, taskId: 3, forceRaw: true });
  const recv = new LTReceiver(packed.meta);

  // 让单格物理尺寸足够大（jsQR 可解）：整图 = N² 个格，每格约 360px
  const CELL_PX = 380;
  const FULL = CELL_PX * n;
  const cells = matrixCells(FULL / 2, FULL / 2, FULL, n, 0);
  let rngState = seed >>> 0;
  const rnd = () => {
    rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // tick 0：整屏 META（每格都放 meta，确保锁定）
  {
    const qrs = buildQrs(new Array(n * n).fill(encodeWire(packed.metaFrame)), version);
    const ctx = makeCanvasCtx(FULL);
    paintMatrix(ctx, FULL, n, qrs);
    let locked = false;
    for (const rect of cells) {
      const scan = readCell(ctx.d, FULL, rect);
      if (scan) {
        const f = decodeWire(scan);
        if (f && peekFrameType(f) === FRAME_TYPE_META && unpackMeta(f)) { locked = true; }
      }
    }
    assert.ok(locked, `N=${n} META 矩阵格至少一格应锁定`);
  }

  // 后续 tick：每 tick N² 个连续 seed 的 DATA 包
  let nextSeed = 1;
  let ticks = 0;
  const maxTicks = packed.meta.K * 4;
  while (!recv.done && ticks < maxTicks) {
    const texts = [];
    for (let k = 0; k < n * n; k++) { texts.push(encodeWire(makeLtFrame(packed, nextSeed))); nextSeed++; }
    const qrs = buildQrs(texts, version);
    const ctx = makeCanvasCtx(FULL);
    paintMatrix(ctx, FULL, n, qrs);
    for (let g = 0; g < cells.length; g++) {
      if (rnd() < cellLoss) continue; // 该格这一屏没抓到
      const scan = readCell(ctx.d, FULL, cells[g]);
      if (!scan) continue;
      const f = decodeWire(scan);
      if (!f || peekFrameType(f) !== FRAME_TYPE_DATA) continue;
      const d = unpackData(f);
      if (d && !recv.seenPacket(d.frameSeq)) recv.feed(d.frameSeq, d.payload, d.taskId);
    }
    ticks++;
  }
  assert.ok(recv.done, `N=${n} ${sizeKB}KB 应收敛：${recv.decodedBlocks}/${packed.meta.K}（ticks=${ticks}）`);
  const out = await recv.assemble();
  assert.equal(out.length, data.length);
  for (let i = 0; i < data.length; i++) assert.equal(out[i], data[i]);
  return { K: packed.meta.K, ticks, uniq: recv.dec.seen.size };
}

test("2×2 矩阵 + 20% 随机丢格，光学切分解码后 LT 还原一致", async () => {
  const r = await matrixTransfer(12, 20, 2, 0.20, 101);
  console.log(`  2×2: K=${r.K} ticks=${r.ticks} 唯一包=${r.uniq}`);
});

test("3×3 矩阵 + 30% 随机丢格，光学切分解码后 LT 还原一致", async () => {
  const r = await matrixTransfer(24, 15, 3, 0.30, 202); // V15 格更小，验证分割鲁棒
  console.log(`  3×3: K=${r.K} ticks=${r.ticks} 唯一包=${r.uniq}`);
});

test("matrixCells 行列布局正确", () => {
  const c = matrixCells(100, 100, 100, 2, 0);
  assert.equal(c.length, 4);
  assert.deepEqual([c[0].sx, c[0].sy], [50, 50]);   // 左上
  assert.equal(c[3].sx, 100);                        // 右下 x
  assert.ok(c.every((x) => x.size === 50));
});
