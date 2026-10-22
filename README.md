# AirScan-QR Pro

屏幕二维码流 × 摄像头 的物理隔离文件传输工具——基于 [topcss/AirScan-QR](https://github.com/topcss/AirScan-QR)（MIT）的性能爆改版。

纯静态、零后端、100% 离线，所有编解码在浏览器本地完成，数据不出端。
目标：从原版几 KB/s 提升到稳定 **80 KB/s+**，甜区从 30KB 提到 500KB。

## 快速开始
- 开发与方案以 **[开发文档.md](开发文档.md)** 为唯一权威（架构/协议/里程碑/验收闸都在里面）。
- 原版离线可运行参考：`reference/upstream/`（只读，含已本地化的 4 个 vendor）。
- Pro 代码在 `src/`，编解码/喷泉码逻辑单测在 `tests/`（M1 起逐步落地）。

## 里程碑
- **M1（P0）**：去 Base64 改 byte 模式 + 传输前压缩 + 高密度 QR（V25~40），单码跑通
- **M2（P1）**：真·LT 喷泉码，丢帧零交互，500KB 稳定
- **M3（P2）**：2×2/3×3 多码矩阵 + Worker/WASM 解码，冲 80KB/s

## 状态
立项 / 文档与基线就绪，M1 待开发（2026-10-22）。

## 目录
```
src/        Pro 新代码（sender/receiver + js 模块），M1 起
tests/      编解码/压缩/喷泉码往返单测（node:test）
reference/  原版离线包与本地 vendor（只读基线）
docs/       上游部署说明、真机测速记录
```

## 离线
双击 html 或任意静态服务器即可；手机走局域网摄像头时用 `reference/upstream/https_server.py`（可选）。
禁止任何 CDN 外链，第三方库一律本地化到 `vendor/`。

## License
MIT（继承上游，保留原作者 topcss 声明；新增代码标注 Pro）。
