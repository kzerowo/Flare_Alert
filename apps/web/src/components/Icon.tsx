/*
 * 아이콘.
 *
 * 시안은 Google의 Material Symbols를 웹폰트로 받아 쓰지만, 아이콘 몇 개
 * 때문에 외부 폰트를 하나 더 물고 오는 건 과하다. 폰트가 로드되기 전에는
 * 아이콘 자리에 글자("more_vert")가 그대로 보이는 문제도 있다.
 *
 * 쓰는 아이콘이 열 개 남짓이라 인라인 SVG로 둔다. 즉시 그려지고 색과
 * 굵기를 currentColor로 따라간다.
 */

export type IconName =
  | "plus"
  | "edit"
  | "trash"
  | "close"
  | "search"
  | "info"
  | "activity"
  | "chart"
  | "globe"
  | "send"
  | "mail"
  | "lock"
  | "arrow-right"
  | "bell";

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18-2.5-3-2.5-15 0-18Z" />
    </>
  ),
  send: <path d="M21 3 3 10.5l7 3 3 7L21 3Z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </>
  ),
};

interface Props {
  name: IconName;
  /** 픽셀 단위. 글자 옆에 놓을 때는 16~18이 잘 맞는다. */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
