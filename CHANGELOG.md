# 更新日志（Changelog）

格式参考 Keep a Changelog，版本号遵循语义化版本（里程碑映射：M1=0.1.x / M2=0.2.x / M3=0.3.x）。
版本号唯一来源是仓库根目录 `VERSION`，用 `python3 tools/sync_version.py` 同步到页面/manifest/SW，
发版步骤见《开发文档.md》§11。标签打在可真机验收的提交上。

## [v0.1.1] — 2026-10-23 · M1 真机首测修复（协议 v2，不兼容 v0.1.0）

### 修复（阻断性）
- **META/DATA 帧误锁（真机乱码根因）**：两种帧同魔数、无类型字段，接收端未锁定时
  把长 DATA 帧当 META 解析，解出乱码文件名和假长度（截图中的 3408848.4KB/16块）。
  协议帧头新增 **type 字节**（1=META/2=DATA），`PROTO_VER` 1→2、wire 前缀 `ASQP1.`→`ASQP2.`，
  解析端严格按 type 分流并交叉拒绝；新增 `peekFrameType` 不解 CRC 即可分流。
- **META 健壮性**：文件名改 UTF-8 fatal 严格解码；加 K/blockSize/fileLen 合理性范围校验，
  损坏/伪造帧不再解出离谱元数据。
- **发送端块大小改为精确容量反推**（新增 `wirePayloadCapacity/rawQrCapacity`），
  替代旧的经验公式 `(cap-20)*3/4`；编码后对所有帧做**越界硬校验**，超长直接报错不播坏码
  （qrcode-generator 超长静默容错是真机丢包隐患）。
- 接收端改为**中心方形 ROI 裁剪解码**（约 0.82 短边），解码像素量大降、跟帧率提升、抗背景干扰。

### 新增
- 接收端方形取景瞄准框（78% 宽）+ 识别成功变绿的实时反馈 + 对准提示文案。
- 任务信息大小自适应显示（B/KB/MB），不再固定 KB 出现 3408848.4KB。
- 发送 QR 静区 margin 3→4（符合 QR 规范，高密度高熵码更稳）；密度档位标注更新为真实净载荷。
- 新增 3 项 v2 回归单测（DATA↔META 交叉拒绝、坏 META 拒绝、容量反推不越界），共 29 项全过。

### 验证（node 光学对拍，jsQR 真实解码）
- 8KB 中文 gzip 后单块 V15 往返字节完全一致；
- **100KB 真随机数据 forceRaw，V25 满密度 111 帧全部读回，0 失败 0 CRC 坏**。
- 待真机复核：高熵内容在高密度+光学链路下的实际捕获率（node 合成图对高熵图案偏敏感，以真机为准）。

[Unreleased]: ../../compare/v0.1.1...HEAD
[v0.1.1]: ../../releases/tag/v0.1.1
[v0.1.0]: ../../releases/tag/v0.1.0

## [v0.1.0] — 2026-10-23 · M1 首个可验收版本

### 新增（协议与编码）
- 协议层 `protocol.js`：二进制帧、CRC32（已知向量 0xCBF43926）、ISO 权威 QR 容量表
  RAW_CAPACITY（V1–40 × L/M/Q/H）、自适应选档。
- `compressor.js`：原生 CompressionStream gzip 自适应（压缩后 ≥98% 自动走 raw），
  flags 位随帧传递，老浏览器天然降级。
- `packet.js`：文件→压缩→分片→帧→重组全链路 + 整文件 SHA-256 校验。
- `qr-encode.js`：qrcode-generator 的 Byte 模式封装 + canvas 渲染。
- `wire-codec.js`：QR 边界 Base64 适配层（`ASQP1.<b64>.E` 定界格式），
  解决 jsQR 按 UTF-8 解码导致裸二进制帧丢失的实测硬伤（固化为约束单测）。

### 新增（双端与部署）
- `sender.html` / `receiver.html`：网页两端，选文件→播放 QR 序列 /
  摄像头→收集帧→SHA-256 校验→下载；密度 V10–25、帧率可调，META 周期插播。
- PWA：manifest + Service Worker（cache-first 全量离线缓存）+ QR 风格图标。
- `serve.py`：免 Docker 的局域网 HTTPS 测试服务（自动自签证书，打印局域网 IP）。
- Docker 一键部署：nginx 容器（容器内纯 HTTP:80，主机映射 8443），
  HTTPS 由 Cloudflare 边缘终结（airscan.10v.cc，CF 可信证书无自签警告）。
- **物理隔离离线发送端** `release/airscan-sender-standalone.html`：
  单文件 ~78KB，内联全部 JS 与二维码库，零外部请求，U 盘拷入内网双击即用；
  由 `tools/build_standalone_sender.py` 从 src/ 构建，同时放一份在站点根目录
  （nginx attachment 头，访问即下载）。

### 实测结论（2026-10-22 真机/对拍坐实）
- jsQR 按 UTF-8 解码：含 0x00/非法 UTF-8 字节时返回空串；Base64 字母表完全无损
  → 二进制帧必须在 QR 边界 Base64（后续 M1.x 评估 Base45 省 ~6% 膨胀）。
- qrcode-generator 超长数据静默容错不抛错 → 容量必须协议层自行限长。
- 端到端光学对拍（画 QR→jsQR 读回）：8KB 中文文本 gzip 后单块 V15 字节完全一致，
  压缩约 28 倍。M1 甜区锚点：中文高冗余文本约 28 倍压缩比。
- 单码容量权威值：V40-L=2953B、V25-L=1273B、V10-L=271B（Byte 模式含开销）。

### 测试
- `tests/` 26 项 node:test 全过：CRC 已知向量、帧往返、坏帧 CRC、200KB 往返、
  wire 含 0x00/高字节无损、噪声提取、QR 解码边界约束固化。

### 文档
- 《开发文档.md》补齐：部署形态定稿（Cloudflare 边缘 HTTPS）、
  standalone 离线发送端定位、版本管理规范、M1 进度看板勾销。
- `DEPLOY.md`：域名访问 + 局域网直连两套入口、standalone 下载说明。
