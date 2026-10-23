// decoder-worker.js — Web Worker：在后台线程用 jsQR 解码一个二维码图像区域。
// 主线程把一帧视频（或矩阵切出的某一格）的 ImageData 发来，这里同步返回文本或 null。
// 多码矩阵时主线程起多个 Worker 并行解码不同格，避免 jsQR 单线程阻塞 UI。
//
// 注意：本文件位于 js/ 下，importScripts 相对路径要回到 vendor/。
// 接收端永远走 http(s)（摄像头权限要求），Worker 可用；standalone 仅发送端不涉及。
importScripts("../vendor/jsQR.min.js");

self.addEventListener("message", (e) => {
  const { id, data, width, height } = e.data || {};
  let text = null;
  try {
    const res = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
    if (res && res.data) text = res.data;
  } catch (err) {
    text = null;
  }
  self.postMessage({ id, text });
});
