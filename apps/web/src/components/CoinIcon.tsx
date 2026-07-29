"use client";

import { useState } from "react";

import { displaySymbol } from "@flare-alert/core";

/*
 * 코인 심볼 아이콘.
 *
 * SVG를 public/coins/ 에 두고 <img>로 부른다. JSX에 인라인하지 않은 이유가
 * 있다 — 일부 아이콘(ADA)이 내부에 id를 가진 필터를 쓰는데, 같은 문서 안에
 * 같은 코인이 두 번 그려지면(목록과 카드에 동시에) id가 충돌한다.
 * <img>는 각 SVG가 독립 문서라 이 문제가 생기지 않는다.
 *
 * 외부 CDN이 아니라 우리가 배포하는 파일이라, 예전에 CDN을 뺐던 이유
 * (외부 의존과 로드 실패)는 해당되지 않는다.
 *
 * 아이콘이 없는 종목은 색 점으로 물러난다. 목록에 종목을 추가할 때
 * 아이콘을 깜빡해도 화면이 깨지지 않아야 한다.
 */

/**
 * 아이콘이 없을 때 쓰는 상징색.
 *
 * 지금 목록의 12종목은 모두 아이콘이 있어서 쓰이지 않는다. 나중에 종목을
 * 늘리면서 아이콘을 빠뜨렸을 때를 위한 것이다.
 */
const FALLBACK_COLOR: Record<string, string> = {
  DOT: "#e6007a",
  AVAX: "#e84142",
  LTC: "#bfbbbb",
  XMR: "#ff6600",
  HYPE: "#97fce4",
};

const DEFAULT_COLOR = "#4b5563";

interface Props {
  /** 거래소 원본 표기. 예: "BTCUSDT" */
  symbol: string;
  size?: number;
}

export function CoinIcon({ symbol, size = 16 }: Props) {
  const [failed, setFailed] = useState(false);
  const name = displaySymbol(symbol);

  if (failed) {
    return (
      <span
        className="shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: FALLBACK_COLOR[name] ?? DEFAULT_COLOR,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    // next/image를 쓰지 않는다. 크기가 고정된 수백 바이트짜리 SVG라
    // 최적화할 것이 없고, 최적화 경로를 태우면 오히려 요청만 늘어난다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/coins/${name.toLowerCase()}.svg`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full"
      aria-hidden="true"
    />
  );
}
