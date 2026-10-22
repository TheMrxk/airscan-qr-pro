# AirScan-QR Pro

**当前版本：v0.1.0**（变更历史见 [CHANGELOG.md](CHANGELOG.md)）

屏幕二维码流 × 摄像头 的物理隔离文件传输工具——基于 [topcss/AirScan-QR](https://github.com/topcss/AirScan-QR)（MIT）的性能爆改版。

纯静态、零后端、**100% 离线、数据不出端**。目标：从原版几 KB/s 提升到稳定 **80 KB/s+**，甜区 500KB。

## 🚀 一条命令部署成 PWA（推荐）

电脑装好 Docker：

```bash
docker compose up -d --build
```

容器为纯 HTTP（80→主机8443），HTTPS 由 Cloudflare 边缘终结。手机浏览器（iPhone 用 Safari / 安卓用 Chrome）打开：
- 接收：`https://airscan.10v.cc/receiver.html`
- 发送：`https://airscan.10v.cc/sender.html`

CF 可信证书无警告，在 Safari/Chrome 菜单**添加到主屏幕**即当 App 用（全屏、可离线）。
完整步骤见 **[DEPLOY.md](DEPLOY.md)**。

不用 Docker（开发）：`python3 serve.py`（自动自签 HTTPS，局域网手机可测摄像头）。

## 🔌 物理隔离场景（离线单文件发送端）

内网隔离电脑零安装：下载 `airscan-sender-standalone.html`（~78KB 单文件，内联全部库，
零联网），U 盘拷入双击即用；接收方手机仍访问线上接收页。
- 直接下载：`https://airscan.10v.cc/airscan-sender-standalone.html`
- 源码构建：`python3 tools/build_standalone_sender.py`（产物在 `release/`）

## 快速开始
- 开发与方案以 **[开发文档.md](开发文档.md)** 为唯一权威（架构/协议/里程碑/验收闸/版本规范）。
- 原版离线参考：`reference/upstream/`（只读）。
- 编解码逻辑单测：`node --test tests/`。

## 里程碑
- **M1（P0）v0.1.0** ✅ 协议层：二进制帧 + CRC32 + gzip + 高密度 QR + base64 物理层适配 + 网页收发 + PWA/Docker + 离线单文件发送端（待真机测速调参）
- **M2（P1）v0.2.x**：真·LT 喷泉码，丢帧零交互，500KB 稳定
- **M3（P2）v0.3.x**：2×2/3×3 多码矩阵 + Worker/WASM，冲 80KB/s
- **M4（P4）**：独立客户端，屏录 + 原始字节解码，MB 级大文件

## 目录
```
VERSION / CHANGELOG.md   版本号唯一来源 / 版本历史
src/                     发送/接收页 + js 协议模块 + 本地化 vendor + PWA(manifest/sw/icons)
tools/                   sync_version.py(版本同步) + build_standalone_sender.py(离线单文件构建)
release/                 离线单文件构建产物（入库可分发）
tests/                   协议/压缩/帧/QR边界 单测（26 项）
docker/                  nginx 配置（容器纯HTTP，CF边缘HTTPS）
reference/               原版离线包与本地 vendor（只读基线）
docs/                    上游部署说明、真机测速记录
serve.py                 免 Docker 的 HTTPS 开发服务
```

## 发版流程
改 `VERSION` → 写 CHANGELOG → `python3 tools/sync_version.py` →
`python3 tools/build_standalone_sender.py` → `node --test tests/` → 提交并打 tag。

## License
MIT（继承上游，保留原作者 topcss 声明；新增代码标注 Pro）。
