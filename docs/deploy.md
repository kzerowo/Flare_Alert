# 배포와 저장소 설정

이 문서는 웹(Vercel)과 데이터베이스(Supabase)를 실제로 연결하는 절차다.
코드는 이미 다 들어가 있고, 여기 적힌 것은 계정에서 해야 하는 일들이다.

**지금 상태**: 두 값(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)이
비어 있으면 회원 기능이 꺼지고 게스트 전용으로 동작한다. 오류는 나지 않는다.
그러니 아래 순서를 급하게 다 밟지 않아도 개발은 계속할 수 있다.

---

## 1. Supabase 프로젝트

### 1.1 프로젝트 만들기

1. <https://supabase.com/dashboard> 에서 **New project**
2. région은 **Northeast Asia (Seoul)** — detector를 도쿄에 둘 예정이라 가깝다
3. 데이터베이스 비밀번호는 따로 보관한다. 지금은 쓰지 않지만 나중에 CLI에 필요하다

### 1.2 스키마 적용

대시보드의 **SQL Editor**에 `supabase/migrations/0001_init.sql` 내용을 붙여넣고 실행한다.

만드는 것:

| 테이블 | 용도 |
|---|---|
| `profiles` | 계정에 딸린 설정 (텔레그램 연결, 언어) |
| `channels` | 채널 본체 (이름, 민감도, 전달 수단) |
| `channel_symbols` | 채널이 감시하는 종목 |

행 수준 보안(RLS)이 세 테이블 모두에 켜진다. 이게 유일한 방어선이다 —
anon 키는 브라우저로 나가는 공개 값이라, 정책이 없으면 누구나 남의 채널을 읽는다.

> **`channel_symbols`를 왜 따로 뒀나**
> detector가 매초 던지는 질문은 "BTCUSDT를 보는 채널이 누구인가"다.
> 종목을 `channels` 행 안에 배열로 넣으면 이 역방향 조회에 인덱스를 걸 수 없어,
> 채널이 늘어날수록 매번 전체를 훑게 된다.

### 1.3 키 가져오기

**Project Settings > API** 에서:

- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY` (**detector 전용**)

`service_role` 키는 RLS를 통째로 우회한다. `NEXT_PUBLIC_` 접두사를 절대 붙이지
않는다. 붙는 순간 브라우저 번들에 들어가고, 그러면 아무나 모든 사용자의 데이터를
읽고 쓸 수 있다.

### 1.4 인증 설정

**Authentication > Providers > Email** 에서 이메일 로그인을 켠다.

개발 중에는 **Confirm email**을 꺼 두는 편이 편하다. 켜져 있으면 가입 후
메일의 링크를 눌러야 로그인이 되는데, 화면은 그 경우를 이미 처리한다
(확인 메일을 보냈다는 안내가 뜨고 로그인된 척하지 않는다).

**Authentication > URL Configuration**:

- Site URL: 배포 후의 Vercel 주소
- Redirect URLs: `http://localhost:3000/**` 도 넣어 둔다

### 1.5 로컬에서 켜기

Next.js는 루트의 `.env`가 아니라 `apps/web/.env.local`을 읽는다.

```
apps/web/.env.local
---
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

`pnpm dev:web`을 다시 띄우면 로그인 버튼이 실제로 동작한다.

---

## 2. Vercel

### 2.1 연결

1. <https://vercel.com/new> 에서 `kzerowo/Flare_Alert` 가져오기
2. **Root Directory를 `apps/web`으로 설정한다.** Next.js 프레임워크 자동 감지가
   `package.json`의 `next` 의존성을 Root Directory 안에서 찾기 때문에, 루트로
   두면 "No Next.js version detected" 오류가 난다.
3. Root Directory를 바꾸면 **"Include files outside of the Root Directory in
   the Build Step"** 옵션이 나온다. 반드시 켠다 — 안 켜면 `apps/web`이
   `packages/core`를 볼 수 없다.
4. 나머지 빌드 설정은 건드리지 않는다 — `apps/web/vercel.json`이 이미 정하고 있다

```json
{
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "buildCommand": "cd ../.. && pnpm --filter @flare-alert/core build && pnpm --filter @flare-alert/web build",
  "outputDirectory": ".next"
}
```

`vercel.json`은 `apps/web/` 안에 있어야 한다. Root Directory가 그쪽으로
잡혀 있으면 Vercel은 루트의 `vercel.json`을 아예 읽지 않는다.

`cd ../..`로 저장소 루트까지 올라가는 이유는 pnpm 워크스페이스 설치와
`packages/core` 빌드가 루트에서 이뤄져야 하기 때문이다. `outputDirectory`는
`.next`(상대 경로)다 — Root Directory가 이미 `apps/web`이므로 여기서 다시
`apps/web/.next`라고 쓰면 `apps/web/apps/web/.next`를 찾게 되어 실패한다.

### 2.2 환경변수

**Settings > Environment Variables** 에 넣는다. Production/Preview/Development 전부 체크.

| 이름 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 1.3에서 가져온 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 1.3에서 가져온 anon 키 |
| `NEXT_PUBLIC_APP_URL` | 배포된 주소 |

`SUPABASE_SERVICE_ROLE_KEY`는 **넣지 않는다.** 웹은 쓰지 않고, 없는 편이 안전하다.

### 2.3 배포 후

Supabase의 **Site URL**을 실제 Vercel 주소로 바꾼다 (1.4 참고).
안 바꾸면 메일 확인 링크가 localhost로 돌아온다.

---

## 3. detector

`apps/detector`는 바이낸스 WebSocket을 24시간 붙들고 있는 상시 프로세스라
Vercel에 올라가지 않는다. 요청이 올 때만 깨는 서버리스로는 감지가 끊긴다.

같은 이유로 **유휴 시 잠드는 무료 플랜은 쓸 수 없다** (Render 무료 등).
잠든 사이 체결이 통째로 빠지고, 그 구간은 거래대금 0으로 남아 기준선까지
망가뜨린다.

### 3.1 어디에 올릴까

| | 비용 | 상시 가동 | 비고 |
|---|---|---|---|
| **Oracle Cloud 무료 티어** | $0 (영구) | O | ARM 4코어/24GB. 서버 설정을 직접 한다 |
| Railway | ~$5/월 | O | 배포는 가장 쉽다. 무료 크레딧은 30일이면 끝난다 |
| Fly.io | ~$5/월 | O | 무료 티어 폐지됨 (2026) |
| Render 무료 | $0 | X | 유휴 시 잠들어서 부적합 |

detector는 가볍다 — 종목당 메모리 약 0.5MB(13종목이면 6MB 남짓), CPU도
초당 수십 번의 계산이 전부다. 어느 쪽을 골라도 최저 사양으로 충분하고,
사양 때문에 비용이 오를 일은 없다.

### 3.2 Oracle Cloud 무료 티어에 올리기

**VM 만들기** — 콘솔에서 Compute > Instances > Create instance.

- Image: Ubuntu 22.04 이상
- Shape: **Ampere A1 (ARM)**, 1 OCPU / 6GB 정도면 넉넉하다
  (무료 한도는 4 OCPU / 24GB이고 인스턴스를 나눠 쓸 수 있다)
- SSH 키를 등록하고 공인 IP를 받는다

Ampere A1은 지역에 따라 재고가 없어 생성이 실패할 때가 있다. "Out of
capacity"가 나오면 다른 가용 도메인을 고르거나 시간을 두고 다시 시도한다.

**방화벽** — detector는 바깥에서 들어오는 연결이 필요 없다. 바이낸스와
Supabase로 나가는 연결만 쓴다. 헬스체크 포트(8080)를 인터넷에 열지 않는다.
상태는 SSH로 들어가 `curl localhost:8080/health`로 본다.

**설치**

```bash
ssh ubuntu@<공인IP>

sudo git clone https://github.com/kzerowo/Flare_Alert.git /opt/flare-alert
cd /opt/flare-alert
sudo bash apps/detector/deploy/setup.sh
```

스크립트가 Node/pnpm 설치, 빌드, 전용 계정(`flare`) 생성, systemd 등록까지
한다. `.env`는 만들지 않는다 — 비밀 키가 들어가는 파일이라 사람이 채운다.

**환경변수**

```bash
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
```

`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 통째로 우회한다. 이 파일이 600이 아니면
서버의 다른 계정이 전 사용자 데이터를 읽을 수 있다.

VAPID 키는 웹과 **같은 쌍**이어야 한다. 공개 키가 Vercel의
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`와 다르면 구독은 되는데 발송이 전부 거절된다.

**확인**

```bash
journalctl -u flare-detector -f    # 로그
curl localhost:8080/health         # 상태
```

`/health`는 백필이 끝나기 전까지 503, 끝나면 200을 준다. 종목별 예열 상태와
백분위 표본 수가 들어 있어서 "시세가 잠잠한 것"과 "아직 못 깨어난 것"을
구분할 수 있다.

**갱신**

```bash
cd /opt/flare-alert && sudo git pull
sudo bash apps/detector/deploy/setup.sh
```

재시작하면 과거 20일치를 다시 받는다(종목당 3초쯤). 그동안은 감지가 멈추므로
장이 조용한 시간에 하는 편이 낫다.

### 3.3 Railway에 올린다면

저장소를 연결하고 Root Directory를 비운 채 아래를 설정한다.

- Build: `pnpm install --frozen-lockfile && pnpm --filter @flare-alert/core build && pnpm --filter @flare-alert/detector build`
- Start: `node apps/detector/dist/index.js`
- 환경변수는 3.2와 같다

---

## 아직 안 한 것

- **비밀번호 재설정** — Supabase가 제공하는 기능이라 화면만 붙이면 된다.
- **알림 보관 기간** — `alerts`는 계속 쌓이기만 한다. 오래된 행을 지우는
  정책이 없다.
