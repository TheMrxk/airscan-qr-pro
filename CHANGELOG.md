# 更新日志（Changelog）

格式参考 Keep a Changelog，版本号遵循语义化版本（里程碑映射：M1=0.1.x / M2=0.2.x / M3=0.3.x）。
版本号唯一来源是仓库根目录 `VERSION`，用 `python3 tools/sync_version.py` 同步到页面/manifest/SW，
发版步骤见《开发文档.md》§11。标签打在可真机验收的提交上。

## [v0.4.0] — 2026-10-23 · Base45 字母数字编码 +30% 载荷、渲染提速、速率显示、息屏保持

### 编码升级（核心提速）：Base64+Byte → Base45+Alphanumeric
- 新增 `src/js/base45.js`（RFC 9285，含官方向量、奇偶长度、含 0x00/0xff 往返单测）。
- **实测推翻文档原假设**：Base45 串走 Byte 模式比 Base64 更占空间；但 Base45 字符集恰是
  QR 字母数字模式字符集子集（每字符 5.5bit vs Byte 8bit），故 **Base45 + Alphanumeric 模式**
  比 Base64+Byte 省约 23% 比特、**单帧净载荷实测 +30%**（V10/15/20/25：241/483/809/1213B）。
- wire 形态改为**纯 Base45 串无定界符**（Alphanumeric 集 45 字符全被 Base45 用满，无空闲
  分隔符；靠帧内 MAGIC 编码前缀 `SB8QCA` 锚定 + 合法长度%3≠1 + 帧形状校验锁定）。
  解码容忍前后噪声粘连（左右扩展+右截断多候选）。
- 接收端**向后兼容旧 ASQP3(base64) 帧**；新增 Alphanumeric 容量表（库二分探测锁定版本得到）。
- 新增 `wirePayloadCapacityB45/alphaCapacity`；发送端 QR 渲染改用 Alphanumeric 模式。

### 发送端
- 矩阵渲染改离屏 canvas 单码预渲染 + drawImage（`paintMatrixFast`），3×3 高帧率更快。
- **Wake Lock 屏幕常亮**：播放期间阻止息屏，切后台返回自动重新申请，停止时释放；不支持静默跳过。
- 密度档位标注更新为真实净载荷。

### 接收端
- 新增**实时速率（KB/s）与预计剩余时间**（整体平均 + 近 1 秒解块速率平滑，LT 成批解出也稳定）。

### 测试（共 54 项，连跑 3 轮稳定）
- base45 8 项（RFC 向量/奇偶/0x00/1-300B 全覆盖/非法处理/比特占用对比）；
- wire 测试改 Base45 并保留 ASQP3 兼容用例、净载荷 +30% 断言；
- M2/M3 光学对拍改 Alphanumeric 渲染。

### 设计备注
- 原计划的"发送端逐格静默降级"取消：纯单向链路无 ACK，发送端无法知道某格读不动，
  抗短板靠用户统一降密度档（这是单向协议的固有约束）。

[Unreleased]: ../../compare/v0.4.0...HEAD
[v0.4.0]: ../../releases/tag/v0.4.0
[v0.3.0]: ../../releases/tag/v0.3.0
[v0.2.0]: ../../releases/tag/v0.2.0
[v0.1.1]: ../../releases/tag/v0.1.1
[v0.1.0]: ../../releases/tag/v0.1.0

## [v0.3.0] — 2026-10-23 · M3 多码矩阵双端落地（手机端 ×4/×9 提速）

### 背景
开哥确认**接收设备是手机、目标文件 >1MB**。P4 屏录/桌面客户端路线对手机不成立
（getDisplayMedia 仅桌面浏览器支持），故手机摄像头链路的最优解是把 M3 多码矩阵做到双端：
一屏 2×2/3×3 个 QR 并行 + LT 喷泉，理论吞吐 ×4/×9。

### 新增
- **发送端矩阵档位**：设置页可选 1×1 / 2×2 / 3×3；`paintMatrix`（matrix.js）同屏渲染
  N² 个码，整屏同步（全 META 或全 DATA，绝不混播），每 tick 消费 N² 个递增 seed；
  canvas 单格带 quiet zone 与邻格隔离。
- **接收端自动矩阵识别**：META 的 flags 高 4 位携带矩阵阶数（`encodeMatrixFlag/decodeMatrixN`），
  手机锁定任务后**无需手选**，自动按 N×N 等分切格（matrixCells）并显示网格引导线/对准提示。
- **Web Worker 解码池**（`js/decoder-worker.js` + DecoderPool）：矩阵各格在后台线程并行
  jsQR 解码，避免单线程阻塞 UI；按硬件并发数取 worker，单格 1.5s 超时保护，worker 不可用自动回退主线程。
- 接收 ROI 矩阵时取短边 0.92（格更大更清晰），单码沿用 0.82；busy 锁防帧堆积。
- sw.js 离线缓存补 lt-code/matrix/decoder-worker。

### 测试（共 44 项，连跑 3 轮稳定）
- `matrix-flag.test.mjs`：阶数编解码、与 gzip 压缩位互不覆盖（0x31=gzip+3×3）、旧 flags 默认 1×1。
- `m3-matrix-optical`：2×2(V20,20%丢格)/3×3(V15,30%丢格) 整图切分**真画 QR→jsQR→BP** 字节一致，
  并断言 META 携带正确阶数。
- packet LT 往返改确定性 PRNG（消除 Math.random 偶发尾部失败），200KB 用例窗口放宽。

### 待真机标定（诚实边界）
- 等分切格假设**手机与屏幕尽量平行正对**；倾斜透视会让等分线对不齐格边界。
  真机若有透视误差，下一版做引导框微调/透视校正（已预留）。
- 3×3 每格物理 QR 更小，对屏幕清晰度/对焦要求更高；建议回家先 2×2 验证，再上 3×3。
- Worker transfer 缓冲、单格超时在真机的实际帧率待测速记录。

## [v0.2.0] — 2026-10-23 · M2 真·LT 喷泉码（协议 v3）

### 核心升级：从"定长分片轮播"到"喷泉码"，消灭漏帧交互
- 新增 `src/js/lt-code.js`：鲁棒孤波度分布（Robust Soliton）+ mulberry32 确定性 PRNG
  + 置信传播（BP）解码器。每个编码包只带 seed（=frameSeq），两端同 seed 重现度与邻居，
  不占额外载荷。
- **发送端无限喷泉流**：seed 单调递增持续产包，META 每 24 包插播一次；不再循环固定块表。
- **接收端 LTReceiver**：收任意约 1.4K 个有效包（c=0.2，真机参数）即自动 BP 解出，
  漏扫/乱序/重复都无需重传、无需知道缺哪帧；进度按"已解出源块/K"显示。
- 最后一块零补齐到等长 block，META 新增 `compressedLen(4B)` 用于接收端截断（协议升 v3，
  wire 前缀 `ASQP2.`→`ASQP3.`，不兼容 v2/v1）。

### 参数（node 模拟实测标定，真机再调）
- 度参数 **c=0.2 / delta=0.001**：小 K（40 块）下零丢包约 1.4K、30% 丢包平均 1.41K/最差 1.82K 包，
  综合优于经典默认 c=0.1（后者小 K 约 2K 开销）。

### 测试（共 41 项）
- `lt-code.test.mjs` 8 项：5%/15%/**30% 丢包** + 乱序 + 重复 100% 还原；K=16/50/200；
  确定性 seed；零补齐截断。
- `packet` 全链路改为 LT：gzip/raw/JSON/小文件/200KB+，raw+30%丢包+乱序字节一致。
- **M2 光学对拍**（真画 QR→jsQR 读回→丢包→BP）：12KB V25 20%丢、30KB V25 30%丢均无损。

### M3 预备（协议/渲染层已就绪，UI 暂不开放，待真机透视标定）
- 新增 `src/js/matrix.js`：N×N 多码矩阵渲染 `paintMatrix` + 接收等分切格 `matrixCells`。
- `m3-matrix-optical.test.mjs`：**2×2（V20,20%丢格）与 3×3（V15,30%丢格）整图切分
  光学对拍字节一致**，2×2 传 20 块仅 12 个 tick（吞吐接近 ×4）。
- 暂不在双端开放矩阵档位：等分切格依赖手机正对屏幕，透视/手抖校正需真机数据（v0.3.0 已落地双端）。

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
