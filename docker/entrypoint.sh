#!/bin/sh
# 容器启动：若没有证书则生成自签证书（CN 用局域网/localhost，10年有效），
# 然后执行 CMD（nginx）。证书挂载在 /certs，持久化后手机只需信任一次。
set -e
mkdir -p /certs
if [ ! -f /certs/cert.pem ] || [ ! -f /certs/key.pem ]; then
  echo "[airscan] 首次启动，生成自签证书 ..."
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /certs/key.pem -out /certs/cert.pem -days 3650 \
    -subj "/CN=airscan-qr.local" \
    -addext "subjectAltName=DNS:airscan-qr.local,DNS:localhost,IP:0.0.0.0" 2>/dev/null
  chmod 600 /certs/key.pem
fi
echo "[airscan] HTTPS 就绪：手机访问 https://<本机IP>:8443/receiver.html"
exec "$@"
