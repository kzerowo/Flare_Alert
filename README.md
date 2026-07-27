# Flare Alert

암호화폐 거래량 급등 알림 서비스.

트레이더가 슬라이더 하나로 민감도(1~100)를 정하면, 감시 중인 모든 코인에
자동 보정된 임계치가 적용된다. 코인마다 "평균 대비 몇 배"를 손으로 맞출
필요가 없다.

## 왜 만드는가

기존 알림 서비스는 대부분 고정 배수를 쓴다. "평균 대비 3배"는

- 평소 조용한 코인에서는 거의 안 울리고
- 원래 변동이 큰 코인에서는 하루 종일 울린다

결국 종목마다 사람이 값을 다시 맞춰야 한다. Flare Alert는 배수 대신
**퍼센타일**을 쓴다. "상위 5%"는 종목이 달라져도 울리는 빈도가 예측 가능하다.

## 구조

```
apps/web        Next.js 15 (App Router) + TypeScript + Tailwind v4
                설정 UI와 알림 히스토리 대시보드. Vercel 배포.

apps/detector   Node.js + TypeScript
                바이낸스 WebSocket 상시 연결, 급등 감지, 텔레그램 발송.
                상시 프로세스라 서버리스 불가. Railway / Fly.io 도쿄 리전.

packages/core   두 앱이 공유하는 타입 정의, 상수, 알고리즘 인터페이스.

docs            기획 문서.
```

## 문서

| 문서 | 내용 |
|---|---|
| [docs/algorithm.md](docs/algorithm.md) | 감지 알고리즘 설계와 미확정 파라미터 |
| [docs/architecture.md](docs/architecture.md) | 데이터 흐름과 배포 구성 |
| [docs/research.md](docs/research.md) | 경쟁 서비스 조사와 남은 빈틈 |
| [docs/decisions.md](docs/decisions.md) | 주요 의사결정과 기각된 대안 |

## 시작하기

필요한 것: Node.js 20 이상, pnpm.

```bash
pnpm install

# 환경변수 준비
cp .env.example .env

# 공유 패키지 빌드 후 web 개발 서버
pnpm dev:web

# 공유 패키지 빌드 후 detector 실행
pnpm dev:detector
```

`packages/core`는 dist를 통해 소비되므로, 두 앱을 직접 실행하기 전에
`pnpm --filter @flare-alert/core build`가 한 번은 돌아야 한다.
위 `dev:*` 스크립트는 이 과정을 포함한다.

## 스크립트

| 명령 | 설명 |
|---|---|
| `pnpm build` | 전체 워크스페이스 빌드 (의존 순서대로) |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm clean` | 빌드 산출물 삭제 |

## 현재 상태

초기 셋업 단계다. 저장소 골격, 타입 정의, 기획 문서까지 끝났다.
**감지 로직은 아직 구현되어 있지 않다.**

`packages/core/src/constants.ts`의 `TODO(backtest)` 주석이 달린 값들은
전부 임시값이다. 다음 작업은 백테스트로 이 값들을 확정하는 것이다.
