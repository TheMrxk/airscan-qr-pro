# AirScan-QR Pro · 物理隔离内网发送端（离线单文件）

## 这是什么
`airscan-sender-standalone.html` 是**完全自包含的发送端**：一个 HTML 文件，
内联了全部 JS 与二维码库（约 78KB），**零外部请求、无需联网、无需安装、无需起服务**。

专为「内网/隔离电脑往外取文件」设计：U 盘把这一个文件拷进内网，双击用 Chrome/Edge 打开即可。

## 用法（内网发送方）
1. 用 U 盘/刻录机把 `airscan-sender-standalone.html` 拷入内网电脑（单向拷入即可）。
2. 双击，用 Chrome / Edge 打开（无需联网）。
3. 选择文件或粘贴文本 → 选密度（先 V15）、帧率（先 8）→ 开始播放。
4. 屏幕开始刷二维码，保持页面在前台、屏幕常亮。

## 接收方
- 可联网手机：浏览器打开 `https://airscan.10v.cc/receiver.html`，加主屏当 App，对准内网屏幕扫码。
- 数据路径：内网屏幕 → 摄像头（单向），网页托管在哪不影响数据安全，文件内容全程不出现在任何服务器。

## 重新生成（开发者）
修改 src/ 后：
```bash
python3 tools/build_standalone_sender.py
# → release/airscan-sender-standalone.html
```

## 注意
- 离线单文件只含**发送端**（接收端需要摄像头权限，浏览器在 file:// 下不允许，故走 HTTPS 页面）。
- 不要直接把单文件拖到手机当接收端用；接收请用 receiver 页。
