# AirScan-QR Pro —— 一条命令部署的 PWA（HTTP 静态托管，HTTPS 由 Cloudflare 在边缘终结）
# 与其他项目一致：容器内纯 HTTP:80，映射到主机高端口；域名经 CF 反代提供可信 HTTPS。
FROM nginx:1.27-alpine

# 站点静态文件（PWA：html/js/vendor/icons/manifest/sw）
COPY src/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
