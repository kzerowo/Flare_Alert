#!/usr/bin/env bash
#
# detector를 리눅스 서버에 올린다. Oracle Cloud 무료 티어(Ubuntu ARM)에서
# 검증한 순서지만 일반 우분투/데비안이면 어디서든 같다.
#
# 서버에서:
#   git clone https://github.com/kzerowo/Flare_Alert.git /opt/flare-alert
#   cd /opt/flare-alert
#   sudo bash apps/detector/deploy/setup.sh
#
# 이 스크립트는 .env를 만들지 않는다. 비밀 키가 들어가는 파일이라
# 사람이 직접 채워야 한다. 마지막에 무엇을 채워야 하는지 알려준다.

set -euo pipefail

APP_DIR=/opt/flare-alert
SERVICE_USER=flare
NODE_MAJOR=22

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "root로 실행해야 합니다: sudo bash $0" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Node
#
# 배포판이 주는 node는 대체로 너무 낡았다. detector는 전역 WebSocket과
# --env-file-if-exists를 쓴다. 후자가 22.9부터라 22를 기준으로 잡는다.
# ---------------------------------------------------------------------------
log "Node.js 확인"
if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; then
  echo "이미 설치됨: $(node --version)"
else
  echo "NodeSource에서 Node ${NODE_MAJOR} 설치"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

log "pnpm 확인"
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm
fi

# ---------------------------------------------------------------------------
# 스왑
#
# 무료 티어의 x86 마이크로(VM.Standard.E2.1.Micro)는 메모리가 1GB뿐이고
# 스왑이 없다. detector 실행은 종목당 0.5MB로 충분하지만 설치와 tsc 빌드가
# 그 한도를 넘겨 OOM으로 죽는다. 빌드 한 번을 위해 스왑을 깔아 둔다.
# ---------------------------------------------------------------------------
log "메모리와 스왑 확인"
MEM_MB=$(free -m | awk '/^Mem:/ {print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/ {print $2}')
echo "메모리 ${MEM_MB}MB, 스왑 ${SWAP_MB}MB"

if [[ "$MEM_MB" -lt 2048 && "$SWAP_MB" -lt 1024 ]]; then
  if [[ ! -f /swapfile ]]; then
    echo "메모리가 부족합니다. 2GB 스왑을 만듭니다"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    # 재부팅 후에도 남게 한다. 이미 있으면 중복으로 넣지 않는다.
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  else
    swapon /swapfile 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------------------
# 전용 계정
#
# root로 돌리지 않는다. detector는 인터넷에서 데이터를 받아 파싱하므로
# 만에 하나 문제가 생겨도 피해 범위를 좁혀 둔다.
# ---------------------------------------------------------------------------
log "서비스 계정 ${SERVICE_USER}"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "만들었습니다"
else
  echo "이미 있습니다"
fi

# ---------------------------------------------------------------------------
# 빌드
# ---------------------------------------------------------------------------
log "의존성 설치와 빌드"
cd "$APP_DIR"
# detector와 그 의존성(core)만 설치한다. 이 서버는 web도 backtest도 실행하지
# 않으므로 Next.js/React를 받을 이유가 없다 — 메모리가 1GB인 무료 티어에서는
# 그 차이가 빌드 성공과 OOM을 가른다.
pnpm install --frozen-lockfile --filter "@flare-alert/detector..."
pnpm --filter @flare-alert/core build
pnpm --filter @flare-alert/detector build

# ---------------------------------------------------------------------------
# 권한
# ---------------------------------------------------------------------------
log "권한 정리"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

if [[ -f "$APP_DIR/.env" ]]; then
  # service_role 키가 들어 있다. 다른 계정이 읽으면 전 사용자 데이터가 열린다.
  chmod 600 "$APP_DIR/.env"
  chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.env"
fi

# ---------------------------------------------------------------------------
# systemd
# ---------------------------------------------------------------------------
log "systemd 등록"
cp "$APP_DIR/apps/detector/deploy/flare-detector.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable flare-detector

# ---------------------------------------------------------------------------
# 마무리
# ---------------------------------------------------------------------------
if [[ ! -f "$APP_DIR/.env" ]]; then
  warn ".env가 없습니다. 아래를 채운 뒤 시작하세요."
  cat <<'EOF'

  sudo -u flare tee /opt/flare-alert/.env >/dev/null <<'ENV'
  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...
  VAPID_PUBLIC_KEY=...
  VAPID_PRIVATE_KEY=...
  VAPID_SUBJECT=mailto:you@example.com
  PORT=8080
  LOG_LEVEL=info
  ENV
  sudo chmod 600 /opt/flare-alert/.env
  sudo systemctl start flare-detector

EOF
else
  log "시작"
  systemctl restart flare-detector
  sleep 3
  systemctl --no-pager status flare-detector || true
fi

cat <<'EOF'

--- 확인 ---
  journalctl -u flare-detector -f      로그
  curl localhost:8080/health           상태

--- 갱신 ---
  cd /opt/flare-alert && sudo git pull
  sudo bash apps/detector/deploy/setup.sh

EOF
