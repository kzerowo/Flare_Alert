import type { Exchange, Timeframe } from "./types.js";

// ---------------------------------------------------------------------------
// 확정 상수
// ---------------------------------------------------------------------------

/** 평가 대상 6개 프레임. 순서는 UI 표시 순서와 같다. */
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

/** 프레임 길이(분). 롤링 창 크기와 기준선 표본 간격의 기준. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/** 집계 버킷 해상도(ms). 봉 마감을 기다리지 않기 위한 최소 단위. */
export const BUCKET_RESOLUTION_MS = 1000;

/** 민감도 슬라이더 범위. */
export const SENSITIVITY_MIN = 1;
export const SENSITIVITY_MAX = 100;
export const SENSITIVITY_DEFAULT = 95;

/** 견적 통화. 거래대금 하한을 비교할 때 단위를 맞추는 데 쓴다. */
export const QUOTE_CURRENCY: Record<Exchange, string> = {
  binance: "USDT",
  upbit: "KRW",
};

// ---------------------------------------------------------------------------
// 미확정 파라미터
//
// 아래 값들은 전부 임시값이다. 백테스트로 확정하기 전까지 신뢰하지 말 것.
// 확정 절차는 docs/algorithm.md "미확정 파라미터" 절 참고.
// ---------------------------------------------------------------------------

/**
 * TODO(backtest): 룩백 창 개수 N.
 * 기준선(중앙값/MAD)을 계산할 때 몇 개의 직전 창을 볼 것인가.
 * 작으면 최근 추세를 잘 따라가지만 기준선이 흔들리고,
 * 크면 안정적이지만 장세 전환에 늦게 반응한다.
 */
export const LOOKBACK_WINDOW_COUNT: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 48,
  "15m": 32,
  "1h": 24,
  "4h": 18,
  "1d": 14,
};

/**
 * TODO(backtest): 창이 열린 뒤 판정을 시작하기까지의 최소 경과 시간(초).
 * 이 시간 전에는 표본이 적어 v = 거래대금 / 경과분 이 발산한다.
 * 프레임 길이에 비례시킬지 고정값으로 둘지도 아직 미정.
 */
export const MIN_ELAPSED_SECONDS: Record<Timeframe, number> = {
  "1m": 10,
  "5m": 30,
  "15m": 60,
  "1h": 180,
  "4h": 360,
  "1d": 900,
};

/**
 * TODO(backtest): 절대 거래대금 하한.
 * 창 누적 거래대금이 이 값 미만이면 점수가 아무리 높아도 버린다.
 * 잡코인이 1만원에서 20만원이 되면 S는 폭발하지만 실제로 진입할 수 없다.
 * 견적 통화 단위 기준 (binance=USDT, upbit=KRW).
 */
export const MIN_QUOTE_VOLUME: Record<Exchange, number> = {
  binance: 50_000,
  upbit: 50_000_000,
};

/**
 * TODO(backtest): 쿨다운 지속시간(초).
 * 알림 직후 임계를 올렸다가 이 시간에 걸쳐 원래 값으로 되돌린다.
 * "직전 알림보다 큰 거래량이어야 함" 방식은 쓰지 않는다 (docs/decisions.md 4번).
 */
export const COOLDOWN_DURATION_SECONDS: Record<Timeframe, number> = {
  "1m": 300,
  "5m": 900,
  "15m": 1800,
  "1h": 3600,
  "4h": 7200,
  "1d": 14400,
};

/**
 * TODO(backtest): 알림 직후 임계 상향분 (백분위 포인트).
 * 민감도 95에 상향분 4면 발사 직후에는 사실상 99가 되고,
 * 쿨다운 시간에 걸쳐 다시 95로 내려온다.
 */
export const COOLDOWN_INITIAL_BOOST = 4;

/**
 * TODO(backtest): 쿨다운 감쇠 곡선.
 * linear는 단순하지만 초반에 너무 빨리 풀리고,
 * exponential은 초반을 강하게 막지만 꼬리가 길게 남는다.
 */
export const COOLDOWN_DECAY_CURVE: "linear" | "exponential" = "exponential";

/**
 * TODO(backtest): 퍼센타일 환산에 쓸 과거 S 표본 보관 기간(일).
 * 짧으면 최근 장세에 맞지만 표본이 부족하고,
 * 길면 분포가 안정되지만 옛날 장세가 섞인다.
 */
export const PERCENTILE_HISTORY_DAYS = 14;

/**
 * TODO(backtest): 퍼센타일을 신뢰하기 위한 최소 표본 수.
 * 이보다 적으면 알림을 내지 않고 "insufficient_history"로 버린다.
 */
export const MIN_PERCENTILE_SAMPLES = 200;

/**
 * TODO(backtest): 프레임 병합 시간 창(초).
 * 이 시간 안에 여러 프레임이 임계를 넘으면 같은 사건으로 보고 하나로 묶는다.
 */
export const FRAME_MERGE_WINDOW_SECONDS = 60;

/**
 * TODO(backtest): MAD가 0에 가까울 때의 하한.
 * 완전히 잠든 종목은 MAD가 0이 되어 S가 무한대로 튄다.
 * 중앙값에 비례한 하한을 두는 방식이 유력하지만 계수는 미정.
 */
export const MAD_FLOOR_RATIO = 0.05;
