# apps/api Dockerfile（R-03 配套，构建上下文为仓库根）
# 多阶段：build 阶段编译 + 生成 Prisma Client；runtime 阶段只带产物与生产依赖。
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=@agentforge/api --workspace=@agentforge/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace=@agentforge/shared && npm run build --workspace=@agentforge/api
RUN npx --prefix apps/api prisma generate

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace=@agentforge/api --workspace=@agentforge/shared
# 编译产物 + Prisma schema（迁移/生成用）+ 生成的 Prisma Client
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/node_modules/.prisma apps/api/node_modules/.prisma
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
EXPOSE 3001
WORKDIR /repo/apps/api
CMD ["node", "dist/index.js"]
