// matrix-flag.test.mjs — 矩阵阶数编码进 flags 高位，与压缩位互不干扰
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeMatrixFlag, decodeMatrixN, FLAG_COMPRESS_GZIP,
} from "../src/js/protocol.js";

test("矩阵阶数编解码：1×1→0高位，2×2/3×3 往返", () => {
  assert.equal(decodeMatrixN(encodeMatrixFlag(1)), 1);
  assert.equal(decodeMatrixN(encodeMatrixFlag(2)), 2);
  assert.equal(decodeMatrixN(encodeMatrixFlag(3)), 3);
  assert.equal(encodeMatrixFlag(1), 0, "单码不占高位，兼容旧版");
});

test("压缩位与矩阵高位互不覆盖", () => {
  // 低 4 位 gzip=0x01，高 4 位矩阵 n=3 → 0x30，合并 0x31
  const flags = FLAG_COMPRESS_GZIP | encodeMatrixFlag(3);
  assert.equal(flags & 0x0f, 0x01, "压缩位保留");
  assert.equal(decodeMatrixN(flags), 3, "矩阵阶数可解");
  assert.equal(flags, 0x31);
  // gzip + 2×2
  const f2 = FLAG_COMPRESS_GZIP | encodeMatrixFlag(2);
  assert.equal(f2 & 0x0f, 0x01);
  assert.equal(decodeMatrixN(f2), 2);
});

test("旧 flags（无矩阵高位）默认按 1×1", () => {
  assert.equal(decodeMatrixN(0), 1);
  assert.equal(decodeMatrixN(1), 1); // gzip 但无矩阵
});
