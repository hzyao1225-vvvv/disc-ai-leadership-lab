#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  DISC × AI 镜像实验室 - 阿里云 ECS 一键部署脚本
# ═══════════════════════════════════════════════════════════
#
#  用法（三步）：
#    1. 本机上传项目到 ECS（PowerShell）：
#         tar -czf - --exclude=node_modules --exclude=dist -C "c:\Users\vivian.hu\Documents\trae_projects\DISC Role Play" disc-ai-leadership-lab | ssh root@<ECS_IP> "mkdir -p /opt && tar -xzf - -C /opt"
#    2. SSH 进 ECS：
#         ssh root@<ECS_IP>
#    3. 执行本脚本：
#         bash /opt/disc-ai-leadership-lab/deploy/deploy.sh
#
#  前置条件：
#    - 阿里云 ECS Ubuntu 22.04，安全组已开放 TCP 80/443 入方向
#    - 拥有 DashScope API Key (sk-xxx) 和 Workspace ID
#
#  执行后访问：https://<ECS公网IP>.nip.io/
#  首次访问需等 30-60 秒 Let's Encrypt 自动签发 HTTPS 证书
#
#  常用运维命令：
#    pm2 status                          # 查看服务状态
#    pm2 logs disc-voice                 # 查看 voice-server 日志
#    pm2 restart disc-voice              # 重启 voice-server
#    journalctl -u caddy -f              # 查看 Caddy 日志
#    vi /opt/disc-ai-leadership-lab/.env # 改配置后 pm2 restart disc-voice
#
#  qwen-plus 额度耗尽时：
#    把 .env 的 LLM_MODEL=qwen-plus 改成 qwen-turbo，再 pm2 restart disc-voice
#
#  安全组规则：
#    TCP 22  限你本机 IP（SSH）
#    TCP 80  0.0.0.0/0（Caddy HTTP 跳 HTTPS）
#    TCP 443 0.0.0.0/0（老板访问）
#    4173 不要开放（voice-server 只监听 localhost）
# ═══════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_DIR="/opt/disc-ai-leadership-lab"
DEPLOY_DIR="$PROJECT_DIR/deploy"
ENV_FILE="$PROJECT_DIR/.env"
CADDYFILE="/etc/caddy/Caddyfile"
PM2_APP_NAME="disc-voice"

# === 颜色输出 ===
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
err()  { echo -e "${RED}[err]${NC} $1"; exit 1; }

# === 0. 前置检查 ===
[[ ! -d "$PROJECT_DIR" ]] && err "项目目录不存在: $PROJECT_DIR"
[[ "$(id -u)" -ne 0 ]] && err "请用 root 执行（或加 sudo）"

ECS_PUBLIC_IP=$(curl -s --max-time 5 http://100.100.100.200/latest/meta-data/public-ipv4 || true)
if [[ -z "$ECS_PUBLIC_IP" ]]; then
  read -p "无法自动获取公网 IP，请手动输入 ECS 公网 IP: " ECS_PUBLIC_IP
fi
DOMAIN="${ECS_PUBLIC_IP}.nip.io"
log "检测到 ECS 公网 IP: $ECS_PUBLIC_IP"
log "本服务将使用域名: $DOMAIN"

# === 1. 安装系统依赖 ===
log "安装系统依赖..."
apt-get update -y
apt-get install -y curl git build-essential

# Node 20 (NodeSource)
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  log "安装 Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
log "Node 版本: $(node -v)"

# pnpm
if ! command -v pnpm &>/dev/null; then
  log "安装 pnpm..."
  npm install -g pnpm@9
fi
log "pnpm 版本: $(pnpm -v)"

# pm2
if ! command -v pm2 &>/dev/null; then
  log "安装 pm2..."
  npm install -g pm2
fi

# Caddy（自动 HTTPS）
if ! command -v caddy &>/dev/null; then
  log "安装 Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
log "Caddy 版本: $(caddy version)"

# === 2. 配置 .env ===
if [[ ! -f "$ENV_FILE" ]]; then
  log "生成 .env（请填入真实值）..."
  read -p "DashScope API Key (sk-xxx): " DASHSCOPE_KEY
  read -p "DashScope Workspace ID: " WORKSPACE_ID
  cat > "$ENV_FILE" <<EOF
LLM_API_KEY=$DASHSCOPE_KEY
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=800
EVAL_MAX_TOKENS=4096

DASHSCOPE_API_KEY=$DASHSCOPE_KEY
DASHSCOPE_WORKSPACE_ID=$WORKSPACE_ID

VOICE_PORT=4173
COSYVOICE_MODEL=cosyvoice-v3-flash
PARAFORMER_MODEL=paraformer-realtime-v2

DEBUG_PROMPT=false
DEBUG_RESPONSE=false
EOF
  chmod 600 "$ENV_FILE"
  log ".env 已写入（权限 600）"
else
  warn ".env 已存在，跳过生成（如需修改请手动编辑 $ENV_FILE）"
fi

# === 3. 安装依赖 + 构建 ===
log "pnpm install..."
cd "$PROJECT_DIR"
pnpm install --frozen-lockfile=false

log "pnpm -r build..."
pnpm -r build

# === 4. 配置 Caddy ===
# 只配置 $DOMAIN 一个块，Caddy 会自动：
#   - 在 80 端口监听并 301 跳转到 HTTPS
#   - 在 443 端口提供 HTTPS 服务（Let's Encrypt 自动签证书）
# nip.io 是公网 DNS 服务，<IP>.nip.io 会解析回该 IP，Let's Encrypt 可正常签发
log "写入 Caddyfile..."
mkdir -p /etc/caddy
cat > "$CADDYFILE" <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy localhost:4173 {
    # WebSocket 升级（voice-server /voice 路径用 ws）
    flush_interval -1
  }
}
EOF

log "重启 Caddy..."
systemctl enable caddy
systemctl restart caddy
sleep 3

# === 5. 启动 pm2 ===
log "pm2 启动 voice-server..."
cd "$PROJECT_DIR/packages/voice"
pm2 delete $PM2_APP_NAME 2>/dev/null || true
pm2 start "npx tsx --env-file=../../.env src/voice-server.ts" --name $PM2_APP_NAME
pm2 save
pm2 startup systemd -u root --hp /root | tail -5

# === 6. 完成 ===
echo ""
echo "═════════════════════════════════════════════════"
echo "  ✅ 部署完成"
echo "═════════════════════════════════════════════════"
echo "  老板访问地址: https://$DOMAIN/"
echo "  健康检查:     https://$DOMAIN/healthz"
echo "  pm2 状态:    pm2 status"
echo "  pm2 日志:    pm2 logs $PM2_APP_NAME"
echo "  Caddy 日志:  journalctl -u caddy -f"
echo ""
echo "  ⚠️ 首次访问 HTTPS 证书需 30-60 秒签发（Let's Encrypt）"
echo "  ⚠️ 安全组必须开放 80/443 入方向"
echo "═════════════════════════════════════════════════"
