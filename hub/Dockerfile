FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY hub/package.json hub/
COPY cli/package.json cli/
RUN npm ci -w hub -w cli --include-workspace-root=false
COPY hub hub
COPY cli cli
# пакет teambridge для сотрудников раздаётся самим хабом: /teambridge.tgz
RUN npm run build -w hub && npm run build -w cli \
 && cd cli && npm pack --pack-destination ../hub/public && mv ../hub/public/teambridge-*.tgz ../hub/public/teambridge.tgz \
 && cd .. && npm prune --omit=dev -w hub

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/hub/package.json hub/package.json
COPY --from=build /app/hub/dist hub/dist
COPY --from=build /app/hub/public hub/public
WORKDIR /app/hub
EXPOSE 8120
CMD ["node", "dist/main.js"]
