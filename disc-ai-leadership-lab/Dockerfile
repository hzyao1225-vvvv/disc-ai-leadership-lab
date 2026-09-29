# syntax=docker/dockerfile:1.6
#
# DISC × AI 镜像实验室 - voice-server Dockerfile
# 部署到 Fly.io 获得永久 HTTPS + WSS URL（如 disc-ai-leadership-lab.fly.dev）
#
# ── 部署步骤 ──────────────────────────────────────────────────
#  1. 安装 flyctl:    https://fly.io/docs/hands-on/install-flyctl/
#  2. fly auth login
#  3. fly launch --no-deploy         # 首次会写入/确认 fly.toml
#  4. fly secrets set LLM_API_KEY=sk-xxx \
#                     DASHSCOPE_API_KEY=sk-xxx \
#                     DASHSCOPE_WORKSPACE_ID=xxx
#  5. fly deploy
#  6. 浏览器打开 https://disc-ai-leadership-lab.fly.dev/
#
# ── 本地构建测试 ──────────────────────────────────────────────
#  docker build -t disc-voice .
#  docker run --rm -p 4173:4173 --env-file .env disc-voice
#  浏览器 http://localhost:4173/
# ──────────────────────────────────────────────────────────────

# ===== Stage 1: deps + build =====
FROM node:20-alpine AS build

# corepack 自动按 packageManager 字段拉起 pnpm@12.5.1
RUN corepack enable
WORKDIR /app

# 先复制 manifest 利用 layer cache
COPY package.json pnpm-workspace.yaml ./
COPY packages/agent/package.json packages/agent/
COPY packages/voice/package.json packages/voice/

# 无 lock 文件时 pnpm 自动生成；--ignore-scripts 跳过可选 postinstall
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# 复制全部源代码（.dockerignore 已排除 node_modules/dist/.env）
COPY . .

# 构建所有 workspace 包（agent → voice）
RUN pnpm -r build

# 剪掉 devDeps，缩小运行镜像（monorepo 偶尔报错用 || true 兜底）
RUN pnpm prune --prod || true

# ===== Stage 2: runtime =====
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV VOICE_PORT=4173
# Fly 自带合法 HTTPS 证书，无需绕过自签
ENV NODE_TLS_REJECT_UNAUTHORIZED=

# 整体复制 build 阶段产物（含 dist + node_modules + public 静态资源）
COPY --from=build /app /app

EXPOSE 4173

# 启动编译后的 voice-server（ESM，dist/voice-server.js）
CMD ["node", "packages/voice/dist/voice-server.js"]
