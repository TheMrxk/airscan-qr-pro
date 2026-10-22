#!/usr/bin/env python3
"""AirScan-QR Pro 局域网 HTTPS 静态服务器（仅测试/内网用）。

为什么需要：浏览器只在 HTTPS 或 localhost 下允许 getUserMedia 摄像头。
手机通过 http://局域网IP 打开接收端会被禁用摄像头，故用本脚本起一个自签 HTTPS。

用法：
    python3 serve.py                # 默认服务 src/，端口 8443，自动生成自签证书
    python3 serve.py --port 4443 --root src
手机：浏览器访问 https://<电脑局域网IP>:8443/receiver.html
     首次会提示证书不受信任 → 点「高级 / 继续访问」即可（内网自签证书，正常）。

注意：自签证书仅用于内网测试，不要用于公网，也不要入库 cert.pem/key.pem。
"""
from __future__ import annotations

import argparse
import http.server
import os
import ssl
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def ensure_cert(cert: Path, key: Path) -> None:
    if cert.exists() and key.exists():
        return
    print("[serve] 生成自签证书（10 年有效, CN=localhost）...")
    try:
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(cert), "-days", "3650",
            "-subj", "/CN=localhost",
        ], check=True, capture_output=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        sys.exit(
            "无法生成证书，请先安装 openssl，或手动放置 cert.pem/key.pem。\n" + str(e)
        )


def lan_ip() -> str:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 内网工具：允许 SharedArrayBuffer 等未来需求，禁缓存便于迭代
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--root", default="src", help="静态根目录（默认 src）")
    args = ap.parse_args()

    root = (HERE / args.root).resolve()
    os.chdir(root)
    cert = HERE / "cert.pem"
    key = HERE / "key.pem"
    ensure_cert(cert, key)

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    ip = lan_ip()
    print("=" * 56)
    print(f"  AirScan-QR Pro HTTPS 服务已启动（根目录 {args.root}）")
    print(f"  本机自测 : https://localhost:{args.port}/sender.html")
    print(f"  手机接收 : https://{ip}:{args.port}/receiver.html")
    print(f"  手机发送 : https://{ip}:{args.port}/sender.html")
    print("  手机首次打开点「高级 → 继续访问」信任自签证书。Ctrl+C 停止。")
    print("=" * 56)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] 已停止")


if __name__ == "__main__":
    main()
