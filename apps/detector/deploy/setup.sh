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
pnpm install --frozen-lockfile
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
