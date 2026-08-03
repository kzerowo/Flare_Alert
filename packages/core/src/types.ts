// 도메인 타입 정의.
// 이 파일은 "무엇을 계산하는가"만 선언한다. "어떻게 계산하는가"는 아직 없다.

// ---------------------------------------------------------------------------
// 거래소 / 심볼 / 타임프레임
// ---------------------------------------------------------------------------

/** 지원 거래소. 1차 목표는 binance, upbit는 로드맵. */
export type Exchange = "binance" | "upbit";

/**
 * 평가 대상 타임프레임.
 * 봉 마감을 기다리지 않고, 각 프레임의 롤링 창을 1초 해상도로 평가한다.
 */
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** 거래소 + 심볼 조합. detector 내부 맵의 키로 쓴다. */
export interface SymbolRef {
  exchange: Exchange;
  /** 거래소 원본 표기. 예: "BTCUSDT", "KRW-BTC" */
  symbol: string;
}

/** 심볼 + 프레임 조합. 기준선과 퍼센타일 분포는 이 단위로 따로 관리된다. */
export interface SeriesKey extends SymbolRef {
  timeframe: Timeframe;
}

// ---------------------------------------------------------------------------
// 원시 입력: 체결과 1초 버킷
// ---------------------------------------------------------------------------

/** 바이낸스 aggTrade 등에서 정규화한 체결 하나. */
export interface TradeTick {
  symbol: string;
  exchange: Exchange;
  /** 체결 시각 (epoch ms) */
  timestamp: number;
  price: number;
  /** 코인 수량 */
  quantity: number;
  /** 견적 통화 기준 거래대금 = price * quantity */
  quoteVolume: number;
}

/**
 * 1초 단위 집계 버킷.
 * 모든 타임프레임은 이 버킷들을 롤링 합산해서 만든다.
 */
export interface SecondBucket {
  /** 버킷 시작 시각 (epoch ms, 1000 단위로 내림) */
  startMs: number;
  /** 이 1초 동안의 총 거래대금 */
  quoteVolume: number;
  /** 이 1초 동안의 체결 건수 */
  tradeCount: number;
}

/**
 * 특정 시점에 잘라낸 롤링 창.
 * 봉 마감 여부와 무관하게, 창이 열린 뒤 경과한 만큼만 본다.
 */
export interface RollingWindow {
  key: SeriesKey;
  /** 창 시작 시각 (epoch ms) */
  openedAtMs: number;
  /** 평가 시각 (epoch ms) */
  evaluatedAtMs: number;
  /** 창이 열린 뒤 경과 시간(분). 4시간봉이라도 6분 지났으면 6이다. */
  elapsedMinutes: number;
  /** 창 누적 거래대금 */
  quoteVolume: number;
  /** 속도 v = quoteVolume / elapsedMinutes (분당 거래대금) */
  velocity: number;
}

// ---------------------------------------------------------------------------
// 점수 계산
// ---------------------------------------------------------------------------

/**
 * 중앙값/MAD 기준선.
 * 평균/표준편차를 쓰지 않는 이유는 docs/decisions.md 1번 참고.
 */
export interface VolatilityBaseline {
  /** M: 직전 N개 창 속도의 중앙값 */
  median: number;
  /** D: |속도 - M| 들의 중앙값 (MAD) */
  mad: number;
  /** 기준선 계산에 실제로 쓰인 표본 수 */
  sampleCount: number;
}

/** 한 심볼·프레임에 대한 한 시점의 이상치 평가 결과. */
export interface AnomalyScore {
  key: SeriesKey;
  evaluatedAtMs: number;
  window: RollingWindow;
  baseline: VolatilityBaseline;
  /** S = (v - M) / D */
  score: number;
  /** S를 해당 심볼·프레임의 과거 S 분포에서 환산한 백분위 (0~100) */
  percentile: number;
}

// ---------------------------------------------------------------------------
// 민감도와 사용자 설정
// ---------------------------------------------------------------------------

/**
 * 사용자 민감도.
 * 값의 의미: "상위 (100 - sensitivity)%에 드는 사건만 알린다".
 * 즉 99.9면 상위 0.1%. 슬라이더 하나로 전 종목에 동일하게 적용된다.
 *
 * 정수가 아니다. 매 초 평가하는 구조라 유효 구간이 99~100에 몰려 있어서
 * 소수점이 필요하다. 근거는 docs/algorithm.md "백테스트 결과" 참고.
 */
export type Sensitivity = number;

/** 프레임별 개별 조정. 기본은 비어 있고, 고급 설정에서만 건드린다. */
export type TimeframeOverrides = Partial<Record<Timeframe, Sensitivity>>;

/**
 * 알림 전달 수단.
 *
 * 한때 "telegram"이 있었다. 자리를 비웠을 때를 메우려던 것이었는데,
 * 앱을 만들기로 하면서(2026-07-29) 그 자리를 앱 푸시가 맡게 되어 지웠다.
 * 발송기를 만들기 전이라 타입과 컬럼만 걷어내면 됐다.
 *
 * 지금은 하나뿐이지만 유니온으로 남겨 둔다. 앱이 나오면 "app"이 붙는다.
 */
export type DeliveryMethod = "browser";

/**
 * 채널. 사용자가 만드는 감시 단위다.
 *
 * 종목 하나에 민감도 하나가 붙는다. 한 채널이 여러 종목을 담았을 때
 * "지금 울린 게 어느 코인인지"가 화면에서 흐려지는 문제가 있어
 * 1채널 1종목으로 정리했다 (2026-07-29).
 *
 * 민감도가 백분위 기반이라는 점은 그대로 의미가 있다. 종목마다 자기
 * 분포를 기준으로 해석되므로, 유동성이 전혀 다른 코인들에 같은 숫자를
 * 써도 각자 알맞은 임계로 번역된다. 사용자는 절대 거래대금을 몰라도 된다.
 *
 * 사용자는 채널을 여러 개 만든다. 같은 코인을 다른 민감도로 두 번
 * 감시할 수도 있고, 그때는 채널마다 임계·쿨다운이 독립적으로 적용된다.
 */
export interface Channel {
  id: string;
  /** 사용자가 붙이는 이름. 예: "비트 단타", "이더 큰 파동만" */
  name: string;
  enabled: boolean;
  /** 이 채널이 감시하는 종목. 아직 고르지 않았으면 null. */
  symbol: SymbolRef | null;
  /**
   * 민감도. 판정에 쓰는 창 길이다.
   *
   * 슬라이더가 정하는 유일한 값이고, 배수는 여기서 따라 나온다
   * (SENSITIVITY_SCALES). 짧은 봉일수록 잦고 긴 봉일수록 드물다.
   *
   * 1d는 들어올 수 없다 — 하루치 거래대금은 평소의 3배가 되는 일이 없다.
   */
  scale: Timeframe;
  /**
   * @deprecated 옛 백분위 설정. 스케일 축으로 옮기기 전에 저장된 값이다.
   * 읽기만 하고 판정에는 쓰지 않는다.
   */
  sensitivity?: Sensitivity;
  /** 감시할 프레임 목록. 비어 있으면 전체 프레임. */
  timeframes: Timeframe[];
  /** 전달 수단. 비어 있으면 감지는 하되 알림이 나가지 않는다. */
  delivery: DeliveryMethod[];
  /** 고급 설정에서만 노출되는 프레임별 예외값. */
  overrides?: TimeframeOverrides;
}

/** 사용자 단위 설정. */
export interface UserSettings {
  userId: string;
  channels: Channel[];
  /** 알림을 받지 않을 시간대 (KST 기준 "HH:mm"). 미설정이면 24시간 수신. */
  quietHours?: { from: string; to: string };
}

/**
 * 브라우저 수신 대상 = 웹 푸시 구독 하나.
 *
 * 탭이 열려 있어야만 받던 구조를 버렸다(2026-07-29). 그때는 페이지의
 * JavaScript가 직접 Notification을 띄웠기 때문에 탭을 닫으면 경로가 끊겼는데,
 * 트레이더가 하루 종일 이 사이트 탭을 열어둘 거라는 가정이 비현실적이었다.
 *
 * 이제 서비스 워커가 받는다. 브라우저만 떠 있으면 탭과 무관하게 도착한다.
 * (브라우저를 완전히 종료하면 그때는 못 받는다. 그 자리는 앱이 메운다.)
 *
 * p256dh와 auth는 페이로드 암호화용 공개 키 재료다(RFC 8291). 비밀이
 * 아니라 그 브라우저 전용 값이다.
 */
export interface BrowserTarget {
  /** 푸시 서비스가 준 고유 주소. 그대로 기본키로 쓴다. */
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 발송 시점에 실제로 쓰이는 수신 대상. */
export type DeliveryTarget = { method: "browser"; target: BrowserTarget };

// ---------------------------------------------------------------------------
// 알림 파이프라인
// ---------------------------------------------------------------------------

/**
 * 채널 단위 상태의 키.
 *
 * 쿨다운과 병합은 채널마다 독립이다. 같은 코인을 두 채널이 감시하면
 * 한쪽에서 알림이 나갔다고 다른 쪽이 조용해지면 안 된다.
 *
 * 반면 점수 S와 퍼센타일은 채널과 무관하다. 종목·프레임의 성질이지
 * 사용자 설정의 함수가 아니다. 그래서 detector는 무거운 계산을 종목당
 * 한 번만 하고, 그 결과에 채널별 임계만 각각 적용한다.
 */
export interface ChannelSeriesKey extends SeriesKey {
  channelId: string;
}

/** 임계 판정을 통과했지만 아직 필터를 거치지 않은 후보. */
export interface AlertCandidate {
  key: ChannelSeriesKey;
  score: AnomalyScore;
  /** 판정에 실제로 적용된 민감도 (쿨다운 조임 반영 전 원본값) */
  sensitivity: Sensitivity;
  /** 쿨다운 감쇠까지 반영한 실효 임계 백분위 */
  effectiveThreshold: number;
}

/** 후보가 필터에서 걸렸을 때의 사유. */
export type RejectionReason =
  | "below_threshold"
  /** 절대 거래대금 하한 미달 (잡코인 컷) */
  | "min_turnover"
  /** 창이 열린 지 얼마 안 돼 표본이 부족 */
  | "warmup"
  /** 쿨다운 상향 임계에 걸림 */
  | "cooldown"
  /** 과거 S 분포 표본이 부족해 퍼센타일을 신뢰할 수 없음 */
  | "insufficient_history"
  /** 직전 알림과 같은 사건으로 판단됨 */
  | "same_event";

/**
 * 최종 알림. 채널당 하나씩 나간다.
 *
 * 프레임별로 알림을 만들어 합치는 구조가 아니다. 판정 기준은 민감도
 * 하나뿐이고, 프레임은 그 민감도가 어느 정도인지 알려주는 참고 라벨이다.
 */
export interface Alert {
  id: string;
  /** 이 알림을 발생시킨 채널. 사용자에게 어느 채널인지 보여줘야 한다. */
  channelId: string;
  target: SymbolRef;
  firedAtMs: number;
  /** 알림 시점 가격 */
  price: number;

  /** 판정에 쓰인 채널 신호 (백분위) */
  percentile: number;
  /** 그 신호를 만든 점수 S */
  score: number;
  /** 판정 시점의 창 누적 거래대금 */
  quoteVolume: number;
  /** 참고용 배수 (v / M). 판정에는 쓰지 않고 표시용으로만 쓴다. */
  ratioToMedian: number;

  /**
   * 사건의 규모. 이상치였던 가장 긴 프레임이다.
   *
   * "1시간봉급 급등"처럼 사용자에게 크기를 알려주는 용도다.
   * 알림을 만드는 기준이 아니라 만들어진 알림을 설명하는 라벨이다.
   */
  scale: Timeframe;
}

/** 쿨다운 상태. 알림 직후 임계를 올리고 시간에 따라 원복시킨다. */
export interface CooldownState {
  key: ChannelSeriesKey;
  lastFiredAtMs: number;
  /** 발사 직후 꼬리 비율을 조인 배수 */
  tightening: number;
}

// ---------------------------------------------------------------------------
// 알고리즘 인터페이스 (구현은 다음 세션)
// ---------------------------------------------------------------------------

/** 체결 스트림을 1초 버킷에 누적하고, 프레임별 롤링 창을 잘라낸다. */
export interface VolumeAggregator {
  /** 체결 하나를 반영한다. */
  ingest(tick: TradeTick): void;
  /** 지정 시점 기준의 롤링 창. 표본이 없으면 null. */
  sliceWindow(key: SeriesKey, atMs: number): RollingWindow | null;
  /** 기준선 계산용으로 보관 중인 직전 창들의 속도 배열. */
  recentVelocities(key: SeriesKey, count: number): number[];
}

/** 속도 배열에서 중앙값/MAD 기준선을 만든다. */
export interface BaselineCalculator {
  compute(velocities: readonly number[]): VolatilityBaseline;
}

/**
 * 창 + 기준선에서 S를 계산한다.
 * MAD가 0이라 점수를 정의할 수 없으면 null.
 */
export interface ScoreCalculator {
  compute(window: RollingWindow, baseline: VolatilityBaseline): number | null;
}

/** S를 해당 시리즈의 과거 분포에서 백분위로 환산한다. */
export interface PercentileEstimator {
  /**
   * 새 관측치를 분포에 반영한다.
   * atMs는 오래된 표본을 버리는 기준이다. 백테스트에서도 실시간과 같은
   * 동작을 얻으려면 시스템 시각이 아니라 데이터의 시각이어야 한다.
   */
  observe(key: SeriesKey, score: number, atMs: number): void;
  /** 백분위(0~100). 표본이 부족하면 null. */
  toPercentile(key: SeriesKey, score: number): number | null;
}

/** 후보를 걸러내는 단계 하나. 통과하면 null, 걸리면 사유를 반환한다. */
export interface AlertFilter {
  readonly name: string;
  evaluate(candidate: AlertCandidate, atMs: number): RejectionReason | null;
}

/**
 * 후보들을 채널당 알림 하나로 만든다.
 *
 * 여러 프레임이 동시에 임계를 넘어도 알림은 하나다. 프레임을 세어 강도로
 * 쓰지 않는다. 대신 가장 긴 이상치 프레임을 사건의 규모(scale)로 붙인다.
 */
export interface AlertBuilder {
  build(candidates: readonly AlertCandidate[], atMs: number): Alert[];
}

/**
 * 최종 알림 발송 수단 하나.
 *
 * 브라우저와 텔레그램은 성질이 다르다. 브라우저는 탭이 닫히면 대상이
 * 사라지고, 텔레그램은 사용자가 없어도 전송된다. 그래서 실패를 같은
 * 방식으로 다룰 수 없다 — 브라우저 실패는 정상이고, 텔레그램 실패는 사고다.
 */
export interface Notifier {
  readonly method: DeliveryMethod;
  /** 대상이 유효하지 않으면(예: 세션 종료) false. 예외를 던지지 않는다. */
  send(alert: Alert, target: DeliveryTarget): Promise<boolean>;
}

/** 채널 설정에 따라 여러 수단으로 동시에 내보낸다. */
export interface AlertDispatcher {
  dispatch(
    alert: Alert,
    channel: Channel,
    settings: UserSettings,
  ): Promise<DeliveryResult[]>;
}

export interface DeliveryResult {
  method: DeliveryMethod;
  delivered: boolean;
  error?: string;
}
