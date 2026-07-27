import {
  COOLDOWN_DECAY_CURVE,
  COOLDOWN_DURATION_SECONDS,
  COOLDOWN_TAIL_TIGHTENING,
} from "./constants.js";
import type { SeriesKey, Sensitivity, Timeframe } from "./types.js";

/**
 * 시간 감쇠 쿨다운.
 *
 * 알림 직후 임계를 올렸다가 시간에 걸쳐 원래대로 되돌린다.
 * "직전 알림보다 커야 함" 방식을 쓰지 않는 이유는 docs/decisions.md 4번 참고.
 *
 * 임계를 백분위에 더하지 않고 "허용 꼬리 비율"에 곱한다는 점이 중요하다.
 * 민감도 95는 상위 5%, 99는 상위 1%를 뜻하는데 여기에 +4를 하면
 * 99는 103이 되어 상한(100)을 넘고 쿨다운 동안 완전 묵음이 된다.
 * 그건 우리가 기각한 고정 시간 묵음과 같아진다.
 *
 * 꼬리 비율을 1/K로 조였다가 K를 1로 되돌리면
 *   - 절대 100을 넘지 않고
 *   - 민감도가 몇이든 "평소보다 K배 드문 사건만"이라는 같은 의미가 되고
 *   - 충분히 큰 사건은 쿨다운 중에도 여전히 통과한다
 */
export class TimeDecayCooldown {
  readonly #lastFiredAtMs = new Map<string, number>();
  readonly #tightening: number;
  readonly #durations: Record<Timeframe, number>;
  readonly #curve: "linear" | "exponential";

  constructor(
    options: {
      tightening?: number;
      durations?: Record<Timeframe, number>;
      curve?: "linear" | "exponential";
    } = {},
  ) {
    this.#tightening = options.tightening ?? COOLDOWN_TAIL_TIGHTENING;
    this.#durations = options.durations ?? COOLDOWN_DURATION_SECONDS;
    this.#curve = options.curve ?? COOLDOWN_DECAY_CURVE;
  }

  /** 알림이 나갔음을 기록한다. */
  record(key: SeriesKey, firedAtMs: number): void {
    this.#lastFiredAtMs.set(serializeKey(key), firedAtMs);
  }

  /**
   * 지금 적용해야 할 실효 임계 백분위.
   * 쿨다운 중이 아니면 민감도 값 그대로다.
   */
  effectiveThreshold(
    key: SeriesKey,
    sensitivity: Sensitivity,
    atMs: number,
  ): number {
    const lastFired = this.#lastFiredAtMs.get(serializeKey(key));
    if (lastFired === undefined) {
      return sensitivity;
    }

    const duration = this.#durations[key.timeframe];
    const elapsedSeconds = (atMs - lastFired) / 1000;

    if (elapsedSeconds < 0 || elapsedSeconds >= duration) {
      return sensitivity;
    }

    const progress = elapsedSeconds / duration;
    const strength = this.#decay(progress);

    // K는 발사 직후 tightening, 쿨다운이 끝나면 1로 돌아온다.
    const k = 1 + (this.#tightening - 1) * strength;

    const tail = 100 - sensitivity;
    return 100 - tail / k;
  }

  /** 진단용. 쿨다운이 걸려 있으면 마지막 발사 시각. */
  lastFired(key: SeriesKey): number | null {
    return this.#lastFiredAtMs.get(serializeKey(key)) ?? null;
  }

  clear(): void {
    this.#lastFiredAtMs.clear();
  }

  /** progress 0에서 1(가장 강함), 1에서 0(원복)으로 떨어지는 곡선. */
  #decay(progress: number): number {
    if (this.#curve === "linear") {
      return 1 - progress;
    }

    // exp(-3)≈0.05 이므로 쿨다운이 끝나는 지점에서 거의 0이 된다.
    // 남은 5%는 아래에서 빼서 정확히 0에 닿게 맞춘다.
    const raw = Math.exp(-3 * progress);
    const atEnd = Math.exp(-3);
    return (raw - atEnd) / (1 - atEnd);
  }
}

function serializeKey(key: SeriesKey): string {
  return `${key.exchange}:${key.symbol}:${key.timeframe}`;
}
