# AirScan-QR Pro

屏幕二维码流 × 摄像头 的物理隔离文件传输工具——基于 [topcss/AirScan-QR](https://github.com/topcss/AirScan-QR)（MIT）的性能爆改版。

纯静态、零后端、**100% 离线、数据不出端**。目标：从原版几 KB/s 提升到稳定 **80 KB/s+**，甜区 500KB。

## 🚀 一条命令部署成 PWA（推荐）

电脑装好 Docker，和手机同一 WiFi：

```bash
docker compose up -d --build
```

手机浏览器（iPhone 用 Safari / 安卓用 Chrome）打开：
- 接收：`https://<电脑IP>:8443/receiver.html`
- 发送：`https://<电脑IP>:8443/sender.html`

首次点「高级→仍要访问」信任自签证书，再在 Safari/Chrome 菜单**添加到主屏幕**，即当 App 用（全屏、可离线）。
完整步骤见 **[DEPLOY.md](DEPLOY.md)**。

不用 Docker：`python3 serve.py`（自动自签 HTTPS）。

## 快速开始
- 开发与方案以 **[开发文档.md](开发文档.md)** 为唯一权威（架构/协议/里程碑/验收闸）。
- 原版离线参考：`reference/upstream/`（只读）。
- 编解码逻辑单测：`node --test tests/`。

## 里程碑
- **M1（P0）** ✅ 协议层：二进制帧 + CRC32 + gzip + 高密度 QR + base64 物理层适配 + 网页收发 + PWA/Docker
- **M2（P1）**：真·LT 喷泉码，丢帧零交互，500KB 稳定
- **M3（P2）**：2×2/3×3 多码矩阵 + Worker/WASM，冲 80KB/s
- **M4（P4）**：独立客户端，屏录 + 原始字节解码，MB 级大文件

## 目录
```
src/          发送/接收页 + js 协议模块 + 本地化 vendor + PWA(manifest/sw/icons)
tests/        协议/压缩/帧/QR边界 单测（26+）
docker/       nginx + 容器自签证书 entrypoint
reference/    原版离线包与本地 vendor（只读基线）
docs/         上游部署说明、真机测速记录
serve.py      免 Docker 的 HTTPS 测试服务
```

## 状态
M1 协议层 + 网页/PWA 已跑通（26 单测 + 端到端光学对拍），待真机测速调参。

## License
MIT（继承上游，保留原作者 topcss 声明；新增代码标注 Pro）。
