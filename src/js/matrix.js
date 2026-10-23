// matrix.js — 多码矩阵布局（M3/P2）
// 一屏渲染 N×N 个 QR，每个承载同一 LT 任务的不同 seed 包，单屏吞吐 ×N²。
//
// 约定：
// - 矩阵所有格【同步】：某一 tick 要么全格播同一个 META（帮晚到接收端锁定），
//   要么各格播连续的 N² 个 DATA(seed) 包；绝不混播（接收端按格切分时类型一致）。
// - 格间留白边（每格自带 quiet zone），既是 QR 规范也方便接收端按等分切格。
// - 手机正对屏幕拍摄为 M3 基本假设；倾斜/透视畸变的校正留待后续（见开发文档 §3 阶段三）。

// 在 canvas ctx 上画 N×N 矩阵。
// qrs: 长度 N*N 的 qrcode 实例数组（已 addData+make），行优先。
// canvasSize: 画布像素边长（正方形）。
export function paintMatrix(ctx, canvasSize, n, qrs) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  const cellPx = canvasSize / n;          // 每格在画布上的像素边长
  const margin = 4;                         // 每格 quiet zone（模块数）
  ctx.fillStyle = "#000";
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const qr = qrs[i * n + j];
      if (!qr) continue;
      const modules = qr.getModuleCount();
      const modulePx = Math.floor(cellPx / (modules + margin * 2));
      const ox = j * cellPx;
      const oy = i * cellPx;
      for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(
              ox + (c + margin) * modulePx,
              oy + (r + margin) * modulePx,
              modulePx, modulePx
            );
          }
        }
      }
    }
  }
}

// 接收端：给定矩阵阶数 n 与中心方形 ROI 边长（摄像头像素），
// 返回 n*n 个 {sx, sy, size} 源裁剪矩形（行优先），供 drawImage 逐格裁出解码。
// 中心点 (cx, cy)。默认不内缩（insetRatio=0）：接收端按完整等分格裁剪，
// 靠每格自身 quiet zone 与邻格隔离；真机若有透视/手抖，可由调用方传入小比例微调
// （注意内缩只缩小采样框、不能切掉格内 QR，故应配合重采样而非简单平移）。
export function matrixCells(cx, cy, side, n, insetRatio = 0) {
  const cell = side / n;
  const inset = cell * insetRatio;
  const cells = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cells.push({
        sx: Math.round(cx - side / 2 + j * cell + inset),
        sy: Math.round(cy - side / 2 + i * cell + inset),
        size: Math.round(cell - inset * 2),
      });
    }
  }
  return cells;
}
