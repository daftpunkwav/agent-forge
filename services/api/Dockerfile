# services/api Dockerfile（R-03 配套，构建上下文为仓库根）
# 多阶段：build 阶段编译 + 生成 Prisma Client；runtime 阶段只带产物与生产依赖。
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/foundation/package.json packages/foundation/package.json
COPY services/api/package.json services/api/package.json
COPY services/llm/package.json services/llm/package.json
COPY services/identity/package.json services/identity/package.json
COPY services/content/package.json services/content/package.json
COPY services/community/package.json services/community/package.json
COPY services/agent/package.json services/agent/package.json
RUN npm ci \
  --workspace=@core/contracts --workspace=@core/foundation --workspace=@core/llm \
  --workspace=@core/identity --workspace=@core/content --workspace=@core/community \
  --workspace=@core/agent --workspace=@core/api
COPY packages/contracts packages/contracts
COPY packages/foundation packages/foundation
COPY services/api services/api
COPY services/llm services/llm
COPY services/identity services/identity
COPY services/content services/content
COPY services/community services/community
COPY services/agent services/agent
RUN npm run build \
  --workspace=@core/contracts --workspace=@core/foundation --workspace=@core/llm \
  --workspace=@core/identity --workspace=@core/content --workspace=@core/community \
  --workspace=@core/agent --workspace=@core/api
RUN npx --prefix services/api prisma generate

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /repo/packages/foundation/package.json packages/foundation/package.json
COPY --from=build /repo/services/api/package.json services/api/package.json
COPY --from=build /repo/services/llm/package.json services/llm/package.json
COPY --from=build /repo/services/identity/package.json services/identity/package.json
COPY --from=build /repo/services/content/package.json services/content/package.json
COPY --from=build /repo/services/community/package.json services/community/package.json
COPY --from=build /repo/services/agent/package.json services/agent/package.json
RUN npm ci --omit=dev \
  --workspace=@core/contracts --workspace=@core/foundation --workspace=@core/llm \
  --workspace=@core/identity --workspace=@core/content --workspace=@core/community \
  --workspace=@core/agent --workspace=@core/api
# 编译产物 + Prisma schema（迁移/生成用）+ 生成的 Prisma Client
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/packages/foundation/dist packages/foundation/dist
COPY --from=build /repo/services/llm/dist services/llm/dist
COPY --from=build /repo/services/identity/dist services/identity/dist
COPY --from=build /repo/services/content/dist services/content/dist
COPY --from=build /repo/services/community/dist services/community/dist
COPY --from=build /repo/services/agent/dist services/agent/dist
COPY --from=build /repo/services/api/dist services/api/dist
COPY --from=build /repo/services/api/prisma services/api/prisma
COPY --from=build /repo/services/api/node_modules/.prisma services/api/node_modules/.prisma
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
EXPOSE 8181
WORKDIR /repo/services/api
CMD ["node", "dist/index.js"]
