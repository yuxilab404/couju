# 镜像 = 官方 node + 打包好的单文件服务端（ADR-0005）。前端不在镜像里，从挂载目录读。
FROM node:24-alpine
WORKDIR /app
COPY server.mjs /app/server.mjs
USER node
ENV NODE_ENV=production COUJU_HOST=0.0.0.0 COUJU_PORT=8790 COUJU_DATA_DIR=/data COUJU_WEB_DIR=/web/current
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8790/api/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server.mjs"]
