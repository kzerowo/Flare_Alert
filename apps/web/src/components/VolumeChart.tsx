"use client";

import { useState } from "react";

import type { TestBar } from "@/lib/test-charts";

/**
 * 거래량 막대 차트. 봉을 눌러 "여기서 울렸으면" 하고 표시한다.
 *
 * 거래량만 그린다. 가격 캔들을 같이 보여 주면 사용자가 "많이 오른 봉"을
 * 고르게 되는데, 그건 우리가 감지하는 것이 아니다. 알림은 유동성이 몰린
 * 것만 알리므로, 라벨도 유동성만 보고 붙어야 임계가 의도와 맞는다.
 *
 * 기준선(중앙값이든 이동평균이든)도 긋지 않는다. 선을 그으면 사용자가
 * 자기 눈이 아니라 그 선을 기준으로 누르게 되어, 우리가 답을 먼저 알려
 * 주고 그 답을 되돌려 받는 꼴이 된다. 어느 기준선이 맞는지는 아직
 * 정해지지 않은 문제이기도 하다.
 *
 * 축은 선형이다. 로그로 누르면 급등이 평범해 보여서 실제 차트에서 눈에
 * 띄는 것과 달라진다. 3.5배라는 상수가 나온 라벨도 선형 차트에서 찍혔다.
 */

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 260;
const GAP = 2;

interface Props {
  bars: readonly TestBar[];
  /** 사용자가 고른 봉의 인덱스. */
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
  label: string;
}

export function VolumeChart({ bars, selected, onToggle, label }: Props) {
  // 키보드로 훑을 때 탭 정지가 100개 생기지 않도록 하나만 초점을 받는다.
  // 화살표로 옮기고 스페이스로 고르는, 목록에서 쓰는 방식 그대로다.
  const [cursor, setCursor] = useState(0);

  const peak = Math.max(...bars.map((bar) => bar.quoteVolume), 1);
  const column = VIEW_WIDTH / Math.max(bars.length, 1);
  const width = Math.max(column - GAP, 1);

  function move(delta: number): void {
    setCursor((previous) =>
      Math.min(Math.max(previous + delta, 0), bars.length - 1),
    );
  }

  function onKeyDown(event: React.KeyboardEvent, index: number): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle(index);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="group"
      aria-label={label}
      className="w-full touch-manipulation select-none"
    >
      {bars.map((bar, index) => {
        const on = selected.has(index);
        // 아주 작은 봉도 1px는 남긴다. 사라지면 누를 수가 없다.
        const height = Math.max((bar.quoteVolume / peak) * VIEW_HEIGHT, 1);
        const x = index * column;

        return (
          <g
            key={bar.openTime}
            role="checkbox"
            aria-checked={on}
            aria-label={`${index + 1}`}
            tabIndex={index === cursor ? 0 : -1}
            onClick={() => {
              setCursor(index);
              onToggle(index);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:fill-white/10"
          >
            {/*
              누르는 자리는 막대가 아니라 세로 칸 전체다. 막대만 대상이면
              작은 봉은 높이가 몇 px이라 사실상 누를 수 없다.
            */}
            <rect
              x={x}
              y={0}
              width={column}
              height={VIEW_HEIGHT}
              fill="transparent"
              className="hover:fill-white/5"
            />
            <rect
              x={x + GAP / 2}
              y={VIEW_HEIGHT - height}
              width={width}
              height={height}
              rx={1}
              fill={
                on
                  ? "var(--color-primary-container)"
                  : "var(--color-outline-variant)"
              }
              className="pointer-events-none transition-colors"
            />
            {/* 고른 봉은 위에 점을 찍는다. 색만으로 구분하지 않게. */}
            {on ? (
              <circle
                cx={x + column / 2}
                cy={6}
                r={3}
                fill="var(--color-primary)"
                className="pointer-events-none"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
