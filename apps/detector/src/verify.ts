// 실시간 파이프라인을 실제 바이낸스 데이터로 검증한다.
//
// 알림은 코인당 하루 2.2회쯤 나오게 맞춰 놨다. 그냥 띄워 놓고 기다리면
// 하나 보는 데 반나절이 걸려서, 알고리즘이 의도대로 도는지 확인할 수가 없다.
//
// 그래서 최근 며칠을 같은 파이프라인에 통과시킨다. 백테스트를 다시 하는 게
// 아니다 — 백테스트는 자기 코드(apps/backtest)로 자기 창을 만들지만, 여기서는
// detector가 실제로 쓰는 집계기·감지기·채널 판정을 그대로 쓴다. 확인하려는
// 것은 "그 파라미터로 이만큼 나온다"가 아니라 "detector가 그 파라미터를
// 제대로 구현했다"이다.
//
// 한계: 분 단위로 재생한다. 실시간은 초 단위라 판정 지점이 60배 많다.
// 60초 안에 시작해서 끝나는 사건은 여기서 통째로 빠질 수 있다.
// 그래서 여기서 센 알림 수는 하한으로 읽어야 한다.

import {
  SENSITIVITY_DEFAULT,
  TIMEFRAMES,
  createChannel,
  percentileToSlider,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import { BACKFILL_DAYS } from "./backfill.js";
import { ChannelRuntime } from "./channel-runtime.js";
import { Detector } from "./detect.js";
import { fetchMinuteKlines } from "./binance.js";

const EXCHANGE = "binance" as const;

/** 1분 프레임은 분 단위 재생에서 왜곡된다. 이유는 backfill.ts 머리말 참고. */
const SKIP: ReadonlySet<Timeframe> = new Set<Timeframe>(["1m"]);

interface SymbolReport {
  symbol: string;
  alerts: {
    atMs: number;
    percentile: number;
    score: number;
    scale: Timeframe;
    price: number;
    ratioToMedian: number;
    /** 알림 뒤 60분 안의 최대 가격 이동폭 (부호 없음) */
    moveAfter: number | null;
  }[];
  days: number;
  byScale: Record<Timeframe, number>;
}

/**
 * 알림 뒤 가격이 얼마나 움직였는지.
 *
 * 부호를 뺀 이동폭을 본다. 거래량 급등에는 방향이 없어서 — 폭락할 때도
 * 거래량은 터진다 — 부호 있는 수익률을 평균 내면 0 근처로 상쇄된다.
 * 자세한 근거는 apps/backtest/src/quality.ts 머리말 참고.
 */
function maxMoveAfter(
  closes: readonly number[],
  index: number,
  horizonMinutes: number,
): number | null {
  const base = closes[index];
  if (base === undefined || base <= 0) {
    return null;
  }
  const end = Math.min(closes.length - 1, index + horizonMinutes);
  if (end <= index) {
    return null;
  }

  let worst = 0;
  for (let i = index + 1; i <= end; i += 1) {
    const price = closes[i];
    if (price === undefined || price <= 0) {
      continue;
    }
    const move = Math.abs(price / base - 1);
    if (move > worst) {
      worst = move;
    }
  }
  return worst;
}

async function verifySymbol(
  symbol: string,
  sensitivity: number,
  verifyDays: number,
): Promise<SymbolReport> {
  const endMs = Math.floor(Date.now() / 60_000) * 60_000;
  const totalDays = BACKFILL_DAYS + verifyDays;
  const startMs = endMs - totalDays * 86_400_000;

  // 분포를 쌓는 구간과 알림을 세는 구간의 경계.
  const measureFromMs = endMs - verifyDays * 86_400_000;

  const klines = await fetchMinuteKlines(symbol, startMs, endMs);

  const detector = new Detector();
  const aggregator = detector.aggregator(symbol);

  const channel = {
    ...createChannel(),
    name: `${symbol} 검증`,
    symbol: { exchange: EXCHANGE, symbol },
    sensitivity,
  };
  const runtime = new ChannelRuntime(channel);
  const target = { exchange: EXCHANGE, symbol };

  const closes: number[] = [];
  const report: SymbolReport = {
    symbol,
    alerts: [],
    days: verifyDays,
    byScale: Object.fromEntries(TIMEFRAMES.map((tf) => [tf, 0])) as Record<
      Timeframe,
      number
    >,
  };

  // 알림 시각을 봉 인덱스로 되찾으려고 같이 들고 간다.
  const alertIndices: number[] = [];

  for (const kline of klines) {
    if (kline.openTimeMs >= endMs) {
      break;
    }

    const minuteSecond = Math.floor(kline.openTimeMs / 1000);
    aggregator.feedMinute(minuteSecond, kline.quoteVolume, kline.close);
    closes.push(kline.close);

    const atMs = kline.openTimeMs + 59_000;
    const measuring = kline.openTimeMs >= measureFromMs;

    if (!measuring) {
      detector.evaluate(symbol, atMs, { silent: true, skip: SKIP });
      continue;
    }

    const signals = detector.evaluate(symbol, atMs, { skip: SKIP });
    if (signals.length === 0) {
      continue;
    }

    const decision = runtime.decide(target, signals, atMs, kline.close);
    if (decision.alert === null) {
      continue;
    }

    const alert = decision.alert;
    report.byScale[alert.scale] += 1;
    alertIndices.push(closes.length - 1);
    report.alerts.push({
      atMs: alert.firedAtMs,
      percentile: alert.percentile,
      score: alert.score,
      scale: alert.scale,
      price: alert.price,
      ratioToMedian: alert.ratioToMedian,
      moveAfter: null,
    });
  }

  // 가격을 다 모은 뒤에 이동폭을 채운다.
  for (let i = 0; i < report.alerts.length; i += 1) {
    const entry = report.alerts[i];
    const index = alertIndices[i];
    if (entry === undefined || index === undefined) {
      continue;
    }
    entry.moveAfter = maxMoveAfter(closes, index, 60);
  }

  return report;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export async function runVerification(
  symbols: readonly string[],
  sensitivity: number,
  verifyDays: number,
): Promise<void> {
  const slider = percentileToSlider(sensitivity);

  console.log(
    `\n실시간 파이프라인 검증 — 민감도 ${sensitivity} (슬라이더 ${slider})`,
  );
  console.log(
    `분포 ${BACKFILL_DAYS}일 + 측정 ${verifyDays}일, 분 단위 재생\n` +
      `1분 프레임은 제외됩니다 (분 단위 재생에서 분포가 왜곡됨)\n`,
  );

  const reports: SymbolReport[] = [];

  for (const symbol of symbols) {
    const report = await verifySymbol(symbol, sensitivity, verifyDays);
    reports.push(report);

    const perDay = report.alerts.length / report.days;
    console.log(
      `── ${symbol}: ${report.alerts.length}건 (하루 ${perDay.toFixed(1)}회)`,
    );

    for (const alert of report.alerts) {
      const time = new Date(alert.atMs).toISOString().replace("T", " ").slice(5, 16);
      console.log(
        `   ${time}  ${alert.scale.padEnd(3)} ` +
          `백분위 ${alert.percentile.toFixed(4)}  ` +
          `S=${alert.score.toFixed(1).padStart(6)}  ` +
          `평소 ${alert.ratioToMedian.toFixed(1).padStart(5)}배  ` +
          `이후 60분 ${formatPercent(alert.moveAfter).padStart(7)}`,
      );
    }
    console.log("");
  }

  // ---- 요약 ----
  const totalAlerts = reports.reduce((sum, r) => sum + r.alerts.length, 0);
  const totalDays = reports.reduce((sum, r) => sum + r.days, 0);
  const perDay = totalDays > 0 ? totalAlerts / (totalDays / reports.length) : 0;

  console.log("─".repeat(64));
  console.log(
    `합계 ${totalAlerts}건 · 코인당 하루 ${(perDay / reports.length).toFixed(2)}회`,
  );

  const moves = reports
    .flatMap((r) => r.alerts.map((a) => a.moveAfter))
    .filter((move): move is number => move !== null)
    .sort((a, b) => a - b);

  if (moves.length > 0) {
    const median = moves[Math.floor(moves.length / 2)] ?? 0;
    console.log(`알림 뒤 60분 이동폭 중앙값 ${(median * 100).toFixed(2)}%`);
  }

  const byScale = {} as Record<Timeframe, number>;
  for (const timeframe of TIMEFRAMES) {
    byScale[timeframe] = reports.reduce(
      (sum, r) => sum + r.byScale[timeframe],
      0,
    );
  }
  const scaleLine = TIMEFRAMES.filter((tf) => byScale[tf] > 0)
    .map((tf) => `${tf} ${byScale[tf]}`)
    .join(" · ");
  console.log(`규모 분포: ${scaleLine || "없음"}`);
}

const symbols = (process.env["DETECTOR_SYMBOLS"] ?? "BTCUSDT,ETHUSDT,SOLUSDT")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter((symbol) => symbol !== "");

const sensitivity = Number(
  process.env["VERIFY_SENSITIVITY"] ?? SENSITIVITY_DEFAULT,
);
const days = Number(process.env["VERIFY_DAYS"] ?? 5);

runVerification(symbols, sensitivity, days).catch((error: unknown) => {
  console.error("검증 실패", error);
  process.exit(1);
});
