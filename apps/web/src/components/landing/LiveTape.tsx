"use client";

import { useEffect, useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { CoinIcon } from "../CoinIcon";
import { Icon } from "../Icon";

/*
 * 랜딩 히어로의 움직이는 예시.
 *
 * 실시간 시세가 아니다. 랜딩에 실제 바이낸스 스트림을 붙이면 조용한
 * 시간대에 들어온 사람은 아무 일도 일어나지 않는 화면을 보게 된다.
 * 소개 화면의 목적은 "이 서비스가 무엇을 하는가"를 몇 초 안에 보이는
 * 것이라, 급증이 반드시 일어나는 대본을 쓴다. 대신 화면 아래에 예시임을
 * 적어 둔다 — 실시간인 척하는 것은 다른 문제다.
 *
 * 규칙 자체는 진짜와 같다. 직전 봉들의 중앙값 대비 몇 배인지를 보고,
 * 기준을 넘은 봉에 알림 하나가 붙는다.
 */

/** 화면에 보이는 봉 개수. */
const VISIBLE = 44;

/** 실제 기본 설정과 같은 배수. */
const THRESHOLD = 3.5;

/** 한 칸 밀리는 간격(ms). */
const TICK_MS = 700;

/** 알림 카드가 떠 있는 시간(ms). */
const ALERT_MS = 4200;

/** 씨앗 고정 난수. 서버와 클라이언트가 같은 대본을 그려야 한다. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 대본. 평소 구간과 급증 구간이 섞여 있다.
 *
 * 값은 "그 종목의 평범한 1분"을 1로 둔 상대값이다. 모듈 수준에서 한 번만
 * 만들므로 서버 렌더와 클라이언트 렌더가 같은 배열을 본다.
 */
const SEQUENCE: readonly number[] = (() => {
  const rand = mulberry32(20260803);
  const out: number[] = [];
  for (let i = 0; i < 132; i += 1) {
    out.push(0.55 + rand() * 1.05);
  }

  // 급증은 한 봉으로 끝나지 않는다. 크게 터지고 몇 봉에 걸쳐 잦아든다.
  const bursts: ReadonlyArray<readonly [number, readonly number[]]> = [
    [38, [4.9, 2.6, 1.8]],
    [92, [6.3, 3.0, 2.1, 1.6]],
  ];
  for (const [at, shape] of bursts) {
    shape.forEach((value, offset) => {
      out[at + offset] = value;
    });
  }

  return out;
})();

/** 움직임을 줄여 달라고 한 사람에게 보여 줄 정지 화면의 위치. */
const FROZEN_HEAD = 52;

function medianOf(values: readonly number[]): number {
  if (values.length === 0) {
    return 1;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 1;
  }
  return ((sorted[mid - 1] ?? 1) + (sorted[mid] ?? 1)) / 2;
}

/** 대본에서 잘라 낸 한 화면치. */
function frameAt(head: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < VISIBLE; i += 1) {
    out.push(SEQUENCE[(head + i) % SEQUENCE.length] ?? 1);
  }
  return out;
}

interface Flash {
  /** 같은 알림인지 구분하는 값. 새 값이 들어올 때만 카드가 다시 뜬다. */
  id: number;
  ratio: number;
}

export function LiveTape() {
  const t = useT();
  // 첫 그림은 서버와 같아야 하므로 고정값에서 시작한다. 움직임은 마운트 뒤.
  const [head, setHead] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduced) {
      // 급증이 막 지나간 한 장면을 정지 화면으로 둔다. 빈 차트만 남으면
      // 설명이 되지 않는다.
      setFrozen(true);
      setHead(FROZEN_HEAD);
      setFlash({ id: -1, ratio: 6.3 });
      return;
    }

    const timer = window.setInterval(() => {
      setHead((previous) => (previous + 1) % SEQUENCE.length);
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, []);

  const bars = useMemo(() => frameAt(head), [head]);

  // 기준선은 직전 봉들에서 나온다. 방금 들어온 봉은 빼야 자기 자신 때문에
  // 기준이 올라가는 일이 없다.
  const median = useMemo(() => medianOf(bars.slice(0, -1)), [bars]);
  const newestRatio = (bars[bars.length - 1] ?? 1) / median;

  // 새 봉이 기준을 넘으면 알림을 세운다.
  useEffect(() => {
    if (newestRatio >= THRESHOLD) {
      setFlash({ id: head, ratio: newestRatio });
    }
  }, [head, newestRatio]);

  // 세워 둔 알림을 내린다. flash 객체가 바뀔 때만 다시 잰다 — 매 틱마다
  // 타이머를 다시 걸면 알림이 영영 내려가지 않는다.
  useEffect(() => {
    if (flash === null || frozen) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), ALERT_MS);
    return () => window.clearTimeout(timer);
  }, [flash, frozen]);

  // 눈금 최대치는 보이는 값에서 잡는다. 급증이 들어오면 나머지가 함께
  // 낮아지는데, 그 줄어드는 모습 자체가 얼마나 튀는 값인지를 말해 준다.
  const ceiling = Math.max(...bars) * 1.08;

  return (
    <div className="panel relative overflow-hidden rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CoinIcon symbol="BTCUSDT" size={20} />
          <span className="font-mono text-data">BTCUSDT</span>
          <span className="label rounded-full bg-white/5 px-2 py-[2px] text-on-surface-variant">
            1m
          </span>
        </div>
        <span className="label text-on-surface-variant">
          {t.landing.tape.barLabel}
        </span>
      </div>

      <div className="relative mt-7 h-40 sm:h-48">
        {/* 기준선. 이 위로 얼마나 솟았는지가 판정의 전부다. */}
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-primary/40 transition-[bottom] duration-500 ease-out"
          style={{ bottom: `${Math.min((median / ceiling) * 100, 100)}%` }}
        >
          <span className="label absolute -top-5 left-0 text-primary/70">
            {t.landing.tape.median}
          </span>
        </div>

        <div className="flex h-full items-end gap-[3px]">
          {bars.map((value, index) => {
            const hot = value / median >= THRESHOLD;
            return (
              <div
                key={(head + index) % SEQUENCE.length}
                className={`flex-1 rounded-t-[2px] transition-[height] duration-500 ease-out ${
                  hot
                    ? "bg-primary-container shadow-[0_0_18px_rgba(56,189,248,0.55)]"
                    : "bg-outline-variant/70"
                }`}
                style={{ height: `${Math.max((value / ceiling) * 100, 2)}%` }}
              />
            );
          })}
        </div>
      </div>

      {/*
        알림 카드. 자리를 늘 비워 두어 떴다 사라질 때 아래 문단이 밀리지
        않게 한다 — 랜딩에서 글이 위아래로 튀면 읽는 사람이 자리를 잃는다.
      */}
      <div className="mt-4 h-[68px]">
        {flash === null ? (
          <p className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/5 px-4 text-center text-body-sm text-on-surface-variant">
            {t.landing.tape.quiet}
          </p>
        ) : (
          <div
            key={flash.id}
            className="flex h-full animate-[flare-rise_320ms_ease-out] items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
              <Icon name="bell" size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-body-sm font-bold text-primary">
                {t.landing.tape.alertTitle}
              </p>
              <p className="truncate text-body-sm text-on-surface-variant">
                {t.landing.tape.alertBody("BTCUSDT", flash.ratio.toFixed(1))}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
