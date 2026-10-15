FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY hub/package.json hub/
COPY cli/package.json cli/
RUN npm ci -w hub -w cli --include-workspace-root=false
COPY hub hub
COPY cli cli
# публичный сертификат центра команды (только .crt; ключи в образ не попадают)
COPY deploy/tls/ca.crt hub/public/ca.crt
# пакет teambridge раздаётся хабом с номером версии и опубликованной SHA-256 (/SHA256SUMS)
RUN npm run build -w hub && npm run build -w cli \
 && cd cli && npm pack --pack-destination ../hub/public \
 && cd ../hub/public && sha256sum teambridge-*.tgz > SHA256SUMS \
 && cd /app && npm prune --omit=dev -w hub

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/hub/package.json hub/package.json
COPY --from=build /app/hub/dist hub/dist
COPY --from=build /app/hub/public hub/public
WORKDIR /app/hub
# не от root
USER node
EXPOSE 8120
CMD ["node", "dist/main.js"]
