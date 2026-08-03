// 1분봉급 민감도의 하루 알림 수를 실제로 센다.
//
// 라벨은 활발한 한 시간에서 받았다. 거기서 시간당 8~9개가 나왔다고 해서
// 하루 200개라고 할 수는 없다 — 유동성이 아예 안 터지는 구간이 하루의
// 대부분이기 때문이다. 사용자도 그 점을 먼저 짚었다.
//
// 그래서 며칠치를 통째로 훑어 실제 빈도를 센다. data/prepared는 월별
// 덤프라 이번 달치가 없으므로 REST로 받는다. 1분봉 판정에는 1분 해상도면
// 충분하다.
//
// 두 기준선을 나란히 낸다. 어느 쪽으로 갈지 아직 안 정했으므로 한쪽만
// 재면 다른 쪽과 비교할 수 없다.
//
//   중앙값60 — 직전 60분의 중앙값. 지금 알고리즘이 쓰는 방식.
//   이동평균20 — 직전 20분의 평균. 차트가 그려 주는 선이고, 사용자가
//                "주변보다 튀어나온 봉"이라고 말한 것에 가깝다.
//
// 사용법:
//   node scripts/minute-rate.mjs --days 7
//   node scripts/minute-rate.mjs --symbol ETHUSDT --days 14

// USD-M 선물. 현물이 아니다 — 사용자가 보는 차트가 선물이다.
const API = "https://fapi.binance.com/fapi/v1/klines";

const MEDIAN_LOOKBACK = 60;
const MA_LOOKBACK = 20;

/**
 * 사건이 끝났다고 보는 침묵 시간(분).
 *
 * 1분봉급에서는 짧게 잡아야 한다. 300초(5분)를 그대로 쓰면 연달아 터지는
 * 별개 급등이 한 덩어리로 묶여, 사용자가 따로 표시한 것들이 하나로 세어진다.
 * 라벨 구간의 13:38과 13:39처럼 붙어 있는 것은 한 사건이 맞지만, 13:29와
 * 13:38은 9분 떨어져 있고 사용자는 둘 다 표시했다.
 */
const EVENT_GAP_MINUTES = 3;

function parseArgs(argv) {
  const args = { symbol: "BTCUSDT", days: 7 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      continue;
    }
    if (flag === "--symbol") {
      args.symbol = value.toUpperCase();
      i += 1;
    } else if (flag === "--days") {
      args.days = Number(value);
      i += 1;
    }
  }
  return args;
}

async function fetchKlines(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${API}?symbol=${symbol}&interval=1m&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`바이낸스 응답 ${response.status}`);
    }
    const rows = await response.json();
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      out.push({ openMs: row[0], quoteVolume: Number(row[7]) });
    }
    cursor = rows[rows.length - 1][0] + 60_000;
  }
  return out;
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 임계를 넘은 분들을 사건으로 묶어 개수를 센다. 사건 하나에 알림 하나. */
function countEvents(ratios, threshold) {
  let events = 0;
  let lastAbove = -Infinity;
  for (let i = 0; i < ratios.length; i += 1) {
    if (ratios[i] < threshold) {
      continue;
    }
    if (i - lastAbove > EVENT_GAP_MINUTES) {
      events += 1;
    }
    lastAbove = i;
  }
  return events;
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padStart(text, width) {
  const s = String(text);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const endMs = Date.now();
  const startMs = endMs - args.days * 86_400_000;
  // 기준선용으로 앞을 더 받는다.
  const fetchFrom = startMs - (MEDIAN_LOOKBACK + 5) * 60_000;

  console.log(
    `${args.symbol} · 최근 ${args.days}일 (${new Date(startMs).toISOString().slice(0, 16)} ~ ${new Date(endMs).toISOString().slice(0, 16)} UTC)`,
  );

  const klines = await fetchKlines(args.symbol, fetchFrom, endMs);
  console.log(`봉 ${klines.length.toLocaleString()}개 수신`);

  const volumes = klines.map((k) => k.quoteVolume);
  const ratioMedian = [];
  const ratioMa = [];

  // 중앙값은 창을 옮길 때마다 다시 정렬하면 느리다. 60개뿐이라 그냥 정렬한다.
  for (let i = MEDIAN_LOOKBACK; i < volumes.length; i += 1) {
    const value = volumes[i];

    const window = volumes.slice(i - MEDIAN_LOOKBACK, i).sort((a, b) => a - b);
    const med = median(window);

    let sum = 0;
    for (let k = i - MA_LOOKBACK; k < i; k += 1) {
      sum += volumes[k];
    }
    const ma = sum / MA_LOOKBACK;

    ratioMedian.push(med > 0 ? value / med : 0);
    ratioMa.push(ma > 0 ? value / ma : 0);
  }

  const days = ratioMedian.length / 1440;
  console.log(`판정 가능한 분 ${ratioMedian.length.toLocaleString()}개 = ${days.toFixed(1)}일`);
  console.log(`사건 간격 ${EVENT_GAP_MINUTES}분 (이만큼 조용하면 다음은 새 사건)`);

  console.log("");
  console.log("═".repeat(64));
  console.log("임계별 하루 알림 수");
  console.log("");
  console.log(
    pad("배수", 8) + padStart("중앙값60 기준", 18) + padStart("이동평균20 기준", 20),
  );

  for (const threshold of [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 30]) {
    const a = countEvents(ratioMedian, threshold) / days;
    const b = countEvents(ratioMa, threshold) / days;
    console.log(
      pad(`${threshold}x`, 8) +
        padStart(a.toFixed(1), 18) +
        padStart(b.toFixed(1), 20),
    );
  }

  // 라벨 구간에서 사용자가 표시한 봉들은 이동평균 대비 2.6배 이상이었다.
  // 그 값이 하루 전체에서 몇 번인지가 이 측정의 핵심 질문이다.
  console.log("");
  console.log("─".repeat(64));
  console.log("라벨 구간(07-30 13:29~14:41 KST)에서 뚜렷했던 봉들의 값:");
  console.log("  이동평균20 대비 2.65x 이상이 8개 / 72분");
  console.log("  중앙값60 대비 8.3x 이상이 9개 / 72분");
  console.log("");
  console.log("그 임계를 하루 전체에 적용하면:");
  console.log(
    `  이동평균20 ≥ 2.65x → 하루 ${(countEvents(ratioMa, 2.65) / days).toFixed(1)}회`,
  );
  console.log(
    `  중앙값60  ≥ 8.3x  → 하루 ${(countEvents(ratioMedian, 8.3) / days).toFixed(1)}회`,
  );
  console.log("");
  console.log(
    "라벨 구간만 보면 시간당 8개(=하루 192회)지만, 활발한 시간대라 그렇다.",
  );
  console.log("위 숫자가 실제 하루 빈도다.");
}

main().catch((error) => {
  console.error("실패:", error.message);
  process.exit(1);
});
