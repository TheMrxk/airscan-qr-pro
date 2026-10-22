# AirScan-QR Pro —— 一条命令部署的 PWA（HTTPS + 静态托管）
# 用法见 docker-compose.yml / README。镜像只含静态文件与 nginx，无外部请求。
FROM nginx:1.27-alpine

# 生成自签证书需要 openssl（alpine 自带 libcrypto，补 openssl CLI）
RUN apk add --no-cache openssl

# 站点静态文件（PWA：html/js/vendor/icons/manifest/sw）
COPY src/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 证书在容器启动时生成到 /certs（挂载卷持久化，重建不重复点信任）
VOLUME ["/certs"]

EXPOSE 8443
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
