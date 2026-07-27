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

apps/backtest   파라미터 확정용 오프라인 도구. 배포되지 않는다.
                바이낸스 공개 덤프를 리플레이해서 알림 빈도를 측정한다.

packages/core   두 앱이 공유하는 타입 정의, 상수, 감지 알고리즘.

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
| `pnpm test` | 전체 테스트 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm clean` | 빌드 산출물 삭제 |

## 백테스트

```bash
# 바이낸스 공개 덤프 내려받기 (6종목 × 3개월, 약 670MB)
pnpm --filter @flare-alert/backtest fetch

# 리플레이용 이진 형식으로 변환
pnpm --filter @flare-alert/backtest prepare:data

# 교차 추출 + 파라미터 스윕
pnpm --filter @flare-alert/backtest build
pnpm --filter @flare-alert/backtest start
```

받은 데이터와 중간 결과는 `data/`에 쌓이고 커밋되지 않는다.
교차 추출 결과는 캐시되므로 두 번째 실행부터는 스윕만 몇 초 만에 돈다.

## 현재 상태

### 되어 있는 것

- 모노레포 골격, 타입 정의, 기획 문서
- 감지 알고리즘의 통계 부분: 중앙값/MAD 기준선, 점수 S, 퍼센타일 추정기,
  시간 감쇠 쿨다운 (`packages/core`, 테스트 43개)
- 백테스트 하니스와 1차 결과

### 안 되어 있는 것

- 바이낸스 WebSocket 연결과 1초 버킷 집계 (`apps/detector`는 골격만)
- 텔레그램 발송
- 설정 UI와 알림 히스토리 (`apps/web`은 랜딩 페이지만)
- 상태 저장소

### 파라미터

1차 백테스트로 병합창, 쿨다운 지속시간, 기본 민감도를 정했다.
나머지 7개는 아직 임시값이며 `packages/core/src/constants.ts`에
`TODO(backtest)` 주석이 달려 있다. 현황은
[docs/algorithm.md](docs/algorithm.md#파라미터-현황) 참고.

가장 시급한 것은 최소 거래대금 하한이다. 소형 종목의 결과를 사실상
혼자 결정하고 있는데 아직 근거 없이 잡은 값이다.
