# 部署与使用（PWA / Docker）

一条命令把 AirScan-QR Pro 部署成 PWA，手机加主屏即用，像原生 App。

> 版本查看：页面副标题处显示当前版本号；历史变更见仓库 `CHANGELOG.md`。

## 一、电脑（发送端 / 服务器）

要求：装了 Docker。

```bash
# 在项目根目录
docker compose up -d --build
```

容器内为纯 HTTP 服务（80），映射到主机 **8443**。HTTPS 由 Cloudflare 在边缘终结：

- **正式入口（推荐）**：域名 `airscan.10v.cc` 经 Cloudflare 反代 `主机IP:8443`
  （回源协议 HTTP/Flexible），手机访问 `https://airscan.10v.cc/receiver.html`，
  CF 可信证书，**无自签警告**，PWA 可直接安装。
- **局域网直连**：`http://<电脑IP>:8443/receiver.html` 可打开页面，
  但非 localhost 的 HTTP 站点浏览器**禁用摄像头**，仅适合电脑本机调试。

查看电脑局域网 IP：
- Linux：`hostname -I` 或 `ip a`（形如 `192.168.x.x`）
- Windows：`ipconfig`
- macOS：`ipconfig getifaddr en0`

停止 / 看日志：
```bash
docker compose down
docker compose logs -f
```

## 二、物理隔离场景：离线单文件发送端

内网隔离电脑只需一个文件（零安装零联网）：

- 在可联网设备打开 `https://airscan.10v.cc/airscan-sender-standalone.html`
  （站点配置了下载头，访问即下载，约 78KB），或直接取仓库 `release/` 里的同名文件。
- U 盘拷入内网电脑 → 双击用 Chrome/Edge 打开 → 选文件/粘贴文本 → 播放二维码。
- 接收方手机仍用 `https://airscan.10v.cc/receiver.html` 扫码。
- 开发者重新构建：`python3 tools/build_standalone_sender.py`（从 src/ 内联生成，自动同步站点副本）。

## 三、手机（接收端）

1. 用浏览器打开接收页（**iPhone：Safari**；**安卓：Chrome**）
2. 点 **开启摄像头 → 允许**（必须走 https 域名）
3. （PWA 安装，可选但推荐）
   - iPhone Safari：底部分享 → **添加到主屏幕**
   - 安卓 Chrome：右上菜单 → **添加到主屏幕 / 安装应用**
   之后桌面出现「AirScan」图标，点开全屏运行、可离线打开，体验等同 App。
4. 升级提示：SW 缓存按版本号管理，发版后重新打开页面会自动更新到新版（旧缓存自动清除）。

## 四、传输一次文件

1. 电脑打开发送页（或双击 standalone 单文件）→ 选文件/粘贴文本 → 密度先选 **V15**、帧率 **8** → 开始播放
2. 手机打开 receiver（或主屏图标）→ 摄像头对准屏幕二维码
3. 进度到 100% → 出现绿色「接收完成」→ 点 **保存文件**
4. 识别不稳就降密度（V10）、降帧率（4–5）、缩短距离、避免反光；很稳再升 V20/V25

## 五、不用 Docker（开发 / 快速测试）

```bash
python3 serve.py            # 自动生成自签证书，https://0.0.0.0:8443（手机测摄像头用）
# 或纯 http（仅电脑本机 localhost 可用摄像头，手机不行）
cd src && python3 -m http.server 8123
```

## 六、常见问题

- **手机打不开页面**：确认网络可达、电脑防火墙放行 8443、用 `https://` 域名不是 http://IP。
- **没有"添加到主屏幕"**：必须 HTTPS（走 CF 域名即可）；iPhone 只能用 Safari 的分享菜单。
- **摄像头黑屏/拒绝**：非 localhost 的 HTTP 站点浏览器禁用摄像头，务必走 https 域名。
- **数据安全**：全程本地处理，不连任何业务服务器，断网可用（PWA 缓存后）。standalone 场景文件字节只出现在二维码画面里，网页托管位置不接触文件内容。
