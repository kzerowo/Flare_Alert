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
2. **Root Directory는 바꾸지 않는다** (저장소 루트 그대로)
3. 나머지 빌드 설정도 건드리지 않는다 — 루트의 `vercel.json`이 이미 정하고 있다

```json
{
  "buildCommand": "pnpm --filter @flare-alert/core build && pnpm --filter @flare-alert/web build",
  "outputDirectory": "apps/web/.next"
}
```

`packages/core`를 먼저 빌드해야 하는 이유는, `apps/web`이 core의 소스가 아니라
빌드 결과(`dist/`)를 가져다 쓰기 때문이다. 기본 설정으로는 이 단계가 없어서
빌드가 깨진다.

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

## 3. detector는 여기 없다

`apps/detector`는 항상 떠 있는 프로세스라 Vercel에 올라가지 않는다.
Railway나 Fly.io(도쿄)로 따로 배포한다. 아직 파이프라인이 구현되지 않아
배포할 것이 없다.

---

## 아직 안 한 것

- **알림 히스토리 테이블** — 알림을 만들어 내는 detector가 없어서 채울 것이 없다.
  스키마는 `packages/core/src/types.ts`의 `Alert`에 이미 잡혀 있다.
- **텔레그램 연결 화면** — `profiles.telegram_chat_id` 자리는 만들어 뒀지만
  봇을 연결하는 흐름은 없다.
- **비밀번호 재설정** — Supabase가 제공하는 기능이라 화면만 붙이면 된다.
