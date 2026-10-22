# 部署与使用（PWA / Docker）

一条命令把 AirScan-QR Pro 部署成内网 PWA，手机加主屏即用，像原生 App。

## 一、电脑（发送端 / 服务器）

要求：装了 Docker；和手机在同一 WiFi。

```bash
# 在项目根目录
docker compose up -d --build
```

容器内自动生成自签证书并在 **8443** 起 HTTPS。查看电脑局域网 IP：
- Linux：`hostname -I` 或 `ip a`（形如 `192.168.x.x`）
- Windows：`ipconfig`
- macOS：`ipconfig getifaddr en0`

假设电脑 IP 为 `192.168.1.55`：
- 发送页：`https://192.168.1.55:8443/sender.html`
- 接收页：`https://192.168.1.55:8443/receiver.html`

停止 / 看日志：
```bash
docker compose down
docker compose logs -f
```

> 证书存在 docker 卷 `airscan_certs` 里，重建容器不变，手机只需信任一次。
> 换端口：改 docker-compose.yml 的端口映射，如 `"9000:8443"`。

## 二、手机（接收端）

1. 连**同一个 WiFi**，用浏览器打开接收页
   - **iPhone：Safari**；**安卓：Chrome**
2. 首次提示「证书不受信任」→ 点 **高级 / 显示详情 → 仍要访问**（内网自签证书，正常）
3. 点 **开启摄像头 → 允许**
4. （PWA 安装，可选但推荐）
   - iPhone Safari：底部分享 → **添加到主屏幕**
   - 安卓 Chrome：右上菜单 → **添加到主屏幕 / 安装应用**
   之后桌面出现「AirScan」图标，点开全屏运行、可离线打开，体验等同 App。

## 三、传输一次文件

1. 电脑打开 sender.html → 选文件/粘贴文本 → 密度先选 **V15**、帧率 **8** → 开始播放
2. 手机打开 receiver.html（或主屏图标）→ 摄像头对准屏幕二维码
3. 进度到 100% → 出现绿色「接收完成」→ 点 **保存文件**
4. 识别不稳就降密度（V10）、降帧率（4–5）、缩短距离、避免反光；很稳再升 V20/V25

## 四、不用 Docker（开发 / 快速测试）

```bash
python3 serve.py            # 自动生成自签证书，https://0.0.0.0:8443
# 或纯 http（仅电脑本机 localhost 可用摄像头，手机不行）
cd src && python3 -m http.server 8123
```

## 五、常见问题

- **手机打不开页面**：确认同一 WiFi、电脑防火墙放行 8443、用 `https://` 不是 http。
- **没有"添加到主屏幕"**：必须 HTTPS 且通过证书警告；iPhone 只能用 Safari 的分享菜单。
- **摄像头黑屏/拒绝**：非 localhost 的 HTTP 站点浏览器禁用摄像头，务必走 https。
- **数据安全**：全程本地处理，不连任何外部服务器，断网可用（PWA 缓存后）。
