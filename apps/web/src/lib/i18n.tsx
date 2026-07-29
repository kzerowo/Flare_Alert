"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { describeAlertRate } from "@flare-alert/core";
import type { ChannelProblem, Timeframe } from "@flare-alert/core";

import { LOCALE_COOKIE } from "./locale";
import type { Locale } from "./locale";

// ---------------------------------------------------------------------------
// 한국어 / 영어
//
// 사전을 객체로 두고 그대로 꺼내 쓴다. t("nav.login") 같은 문자열 키를 쓰면
// 오타가 런타임까지 살아남지만, 객체 접근은 컴파일 때 걸린다.
//
// ko를 원본으로 삼고 en에 그 타입을 씌운다. 새 문구를 ko에만 넣으면
// en에서 타입 오류가 나므로 번역 누락이 조용히 넘어가지 않는다.
//
// 값이 바뀌는 문구는 함수로 둔다. 영어는 단복수가 갈리고 한국어는 안 갈려서,
// 자리표시자만 끼워 넣는 방식으로는 한쪽이 어색해진다.
// ---------------------------------------------------------------------------

const ko = {
  brand: "Flare Alert",

  nav: {
    login: "로그인",
    signup: "회원가입",
    logout: "로그아웃",
    language: "언어",
  },

  store: {
    loadFailed: "저장된 채널을 불러오지 못했습니다. 새로고침해 주세요.",
    saveFailed: "저장하지 못했습니다. 방금 바꾼 내용은 되돌렸습니다.",
    dismiss: "닫기",
  },

  hero: {
    title: "크립토 유동성 알림",
    body: "감시할 크립토를 채널로 묶고 민감도만 정하면, 종목별 평소 거래량에 맞춰 자동으로 보정됩니다.",
    guestBadge: "게스트",
    guestBody: "채널은 이 탭이 열려 있는 동안 유지됩니다.",
  },

  notification: {
    unsupported: "이 브라우저는 알림을 지원하지 않습니다. 크롬이나 엣지를 써주세요.",
    denied:
      "알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 이 사이트의 알림을 허용해주세요.",
    unconfigured: "알림 서버가 아직 준비되지 않았습니다.",
    loginRequired: "알림을 받으려면 로그인이 필요합니다.",
    prompt: "알림을 켜면 탭을 닫아도 브라우저가 켜져 있는 동안 알림이 옵니다.",
    enable: "알림 켜기",
    enabling: "켜는 중...",
    subscribed: "이 브라우저로 알림을 받고 있습니다.",
  },

  alerts: {
    tab: "알림 기록",
    heading: "알림 기록",
    subtitle: "감지된 유동성 급증입니다",
    justNow: "방금",
    minutesAgo: (n: number) => `${n}분 전`,
    hoursAgo: (n: number) => `${n}시간 전`,
    daysAgo: (n: number) => `${n}일 전`,
    ratio: (times: string) => `평소의 ${times}배`,
    volume: (amount: string) => `거래대금 ${amount}`,
    remove: "이 기록 지우기",
    emptyTitle: "아직 알림이 없습니다",
    emptyBody: "감시 중인 채널에서 유동성이 크게 튀면 여기에 쌓입니다.",
    emptyChannelBody: "이 채널에서는 아직 알림이 없었습니다.",
    forChannel: (name: string) => `${name} 알림 기록`,
    backToAll: "전체 보기",
    guestTitle: "로그인이 필요합니다",
    guestBody: "알림 기록은 계정에 저장됩니다.",
    loadFailed: "알림 기록을 불러오지 못했습니다.",
  },

  list: {
    heading: (count: number) => (count > 0 ? `내 채널 (${count})` : "내 채널"),
    tab: "내 채널",
    subtitle: "감시 중인 목록입니다",
    create: "채널 만들기",
    emptyTitle: "아직 채널이 없습니다",
    emptyBody: "크립토 몇 개를 묶어 첫 채널을 만들어보세요.",
    emptyAction: "첫 채널 만들기",
  },

  card: {
    sensitivity: "민감도",
    perDay: "예상 알림/하루",
    catches: "잡는 규모",
    catchesLargest: "유동성이 가장 크게 튈 때만",
    catchesFrom: (frame: string) => `${frame} 이상`,
    delivery: "알림 방법",
    history: "알림 기록",
    edit: "편집",
    remove: "삭제",
    watching: "감시 중",
    off: "꺼짐",
    toggleLabel: (name: string) => `${name} 켜고 끄기`,
    removeConfirmTitle: (name: string) => `"${name}" 채널을 삭제할까요?`,
    removeConfirmBody: "삭제하면 되돌릴 수 없습니다.",
  },

  form: {
    createTitle: "채널 만들기",
    editTitle: "채널 편집",
    subtitle: "감시할 크립토를 묶고 민감도를 정하세요.",
    nameLabel: "채널 이름",
    namePlaceholder: "예: 메이저 단타",
    defaultName: "새 채널",
    symbolsLabel: "감시 크립토",
    symbolPickHint: "하나만 고를 수 있습니다",
    searchPlaceholder: "크립토 검색 (BTC, ETH, SOL...)",
    noMatches: "검색 결과가 없습니다.",
    deliveryLabel: "알림 방법",
    browser: "브라우저 알림",
    browserHint: "탭을 닫아도 브라우저가 켜져 있으면 옵니다",
    loginRequired: "로그인 필요",
    cancel: "취소",
    save: "저장",
  },

  problem: {
    empty_name: "채널 이름을 입력해주세요.",
    name_too_long: (max: number) => `채널 이름은 ${max}자까지입니다.`,
    no_symbol: "감시할 크립토를 골라주세요.",
    no_delivery: "알림 받을 방법을 하나 이상 골라주세요.",
  },

  slider: {
    label: "민감도",
    quiet: "조용히",
    frequent: "자주",
    summaryTitle: "이 설정이면",
    catchesLargest: "유동성이 가장 크게 튀는 순간에만 알림이 옵니다.",
    /** 앞뒤로 나눠 가운데 프레임 이름만 굵게 쓴다. */
    catchesFromBefore: "",
    catchesFromAfter: " 차트에서 눈에 띌 만큼 유동성이 몰릴 때부터 알림이 옵니다.",
    ratePerCoin: (rate: string) => `${rate} 정도 울립니다`,
    footnote:
      "알림은 유동성이 몰린 것을 알릴 뿐, 가격이 오를지 내릴지는 알려주지 않습니다. 눈금은 민감도의 세기를 가늠하기 위한 참고이고, 알림 기준은 민감도 하나뿐이라 봉마다 따로 울리지 않습니다.",
  },

  rate: {
    never: "거의 안 울림",
    everyNDays: (days: number) => `${days}일에 1회`,
    perDay: (value: string) => `하루 ${value}회`,
  },

  auth: {
    login: "로그인",
    signup: "회원가입",
    submitLogin: "로그인",
    submitSignup: "가입하기",
    subtitle: "채널을 계정에 저장하고 어디서든 이어서 씁니다.",
    close: "닫기",
    email: "이메일",
    password: "비밀번호",
    noticeTop:
      "아직 준비 중입니다. 계정이 생기면 채널이 저장되어 어느 기기에서든 이어서 쓸 수 있습니다.",
    noticeBottom:
      "지금은 로그인 없이 그대로 쓰셔도 됩니다. 만든 채널은 이 탭이 열려 있는 동안 유지됩니다.",
    toSignupPrefix: "계정이 없으신가요?",
    toSignupAction: "회원가입",
    toLoginPrefix: "이미 계정이 있으신가요?",
    toLoginAction: "로그인",
    working: "처리 중...",
    checkEmail:
      "확인 메일을 보냈습니다. 메일의 링크를 누르면 가입이 끝납니다.",
    /** 로그인 없이 써도 된다는 안내. 회원 기능이 준비된 뒤의 문구다. */
    guestHint:
      "로그인하지 않아도 그대로 쓸 수 있습니다. 다만 만든 채널은 이 탭이 열려 있는 동안만 유지됩니다.",
    problem: {
      unavailable:
        "회원 기능이 아직 연결되지 않았습니다. 로그인 없이 이용해 주세요.",
      invalid_credentials: "이메일 또는 비밀번호가 맞지 않습니다.",
      email_taken: "이미 가입된 이메일입니다.",
      weak_password: "비밀번호는 6자 이상이어야 합니다.",
      invalid_email: "이메일 형식이 올바르지 않습니다.",
      email_not_confirmed: "메일의 확인 링크를 먼저 눌러주세요.",
      rate_limited: "시도가 너무 잦습니다. 잠시 후 다시 해주세요.",
      unknown: "처리하지 못했습니다. 잠시 후 다시 해주세요.",
    },
  },

  footer: {
    note: "감지 엔진은 아직 연결되지 않았습니다. 지금은 채널을 만들고 설정을 확인하는 것까지 됩니다.",
  },

  /** 슬라이더 눈금과 카드에 쓰는 봉 이름. */
  frame: {
    "1m": "1분봉",
    "5m": "5분봉",
    "15m": "15분봉",
    "1h": "1시간봉",
    "4h": "4시간봉",
    "1d": "1일봉",
  } as Record<Timeframe, string>,

  /** "1분봉급" — 사건 규모를 가리킬 때. */
  frameScale: {
    "1m": "1분봉급",
    "5m": "5분봉급",
    "15m": "15분봉급",
    "1h": "1시간봉급",
    "4h": "4시간봉급",
    "1d": "1일봉급",
  } as Record<Timeframe, string>,
};

export type Dictionary = typeof ko;

const en: Dictionary = {
  brand: "Flare Alert",

  nav: {
    login: "Log in",
    signup: "Sign up",
    logout: "Log out",
    language: "Language",
  },

  store: {
    loadFailed: "Could not load your saved channels. Please refresh.",
    saveFailed: "Could not save. Your last change has been rolled back.",
    dismiss: "Dismiss",
  },

  hero: {
    title: "Crypto liquidity alerts",
    body: "Group the cryptos you want to watch into a channel and set one sensitivity. Thresholds calibrate to each asset's own normal volume.",
    guestBadge: "Guest",
    guestBody: "Channels last as long as this tab stays open.",
  },

  notification: {
    unsupported:
      "This browser does not support notifications. Try Chrome or Edge.",
    denied:
      "Notifications are blocked. Allow them for this site from the lock icon in the address bar.",
    unconfigured: "The alert server is not ready yet.",
    loginRequired: "Log in to receive alerts.",
    prompt:
      "Turn on alerts and they arrive even with this tab closed, as long as your browser is running.",
    enable: "Enable alerts",
    enabling: "Enabling...",
    subscribed: "This browser is receiving alerts.",
  },

  alerts: {
    tab: "History",
    heading: "Alert history",
    subtitle: "Liquidity surges we caught",
    justNow: "just now",
    minutesAgo: (n: number) => `${n} min ago`,
    hoursAgo: (n: number) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
    daysAgo: (n: number) => (n === 1 ? "1 day ago" : `${n} days ago`),
    ratio: (times: string) => `${times}x normal`,
    volume: (amount: string) => `Volume ${amount}`,
    remove: "Remove this record",
    emptyTitle: "No alerts yet",
    emptyBody:
      "When liquidity spikes on a channel you watch, it shows up here.",
    emptyChannelBody: "This channel has not fired yet.",
    forChannel: (name: string) => `${name} history`,
    backToAll: "Show all",
    guestTitle: "Log in required",
    guestBody: "Alert history is saved to your account.",
    loadFailed: "Could not load your alert history.",
  },

  list: {
    heading: (count: number) =>
      count > 0 ? `My channels (${count})` : "My channels",
    tab: "Channels",
    subtitle: "Everything you are watching",
    create: "New channel",
    emptyTitle: "No channels yet",
    emptyBody: "Group a few cryptos together to create your first channel.",
    emptyAction: "Create first channel",
  },

  card: {
    sensitivity: "Sensitivity",
    perDay: "Est. alerts/day",
    catches: "Catches",
    catchesLargest: "Only the biggest liquidity surges",
    catchesFrom: (frame: string) => `${frame} and larger`,
    delivery: "Delivery",
    history: "History",
    edit: "Edit",
    remove: "Delete",
    watching: "Watching",
    off: "Off",
    toggleLabel: (name: string) => `Turn ${name} on or off`,
    removeConfirmTitle: (name: string) => `Delete "${name}"?`,
    removeConfirmBody: "This can't be undone.",
  },

  form: {
    createTitle: "New channel",
    editTitle: "Edit channel",
    subtitle: "Pick a crypto to watch and set its sensitivity.",
    nameLabel: "Channel name",
    namePlaceholder: "e.g. BTC scalping",
    defaultName: "New channel",
    symbolsLabel: "Crypto",
    symbolPickHint: "one per channel",
    searchPlaceholder: "Search cryptos (BTC, ETH, SOL...)",
    noMatches: "No matches.",
    deliveryLabel: "Delivery",
    browser: "Browser notifications",
    browserHint: "Arrives even with this tab closed, as long as your browser is running",
    loginRequired: "Login required",
    cancel: "Cancel",
    save: "Save",
  },

  problem: {
    empty_name: "Please enter a channel name.",
    name_too_long: (max: number) =>
      `Channel names are limited to ${max} characters.`,
    no_symbol: "Pick a crypto to watch.",
    no_delivery: "Choose at least one delivery method.",
  },

  slider: {
    label: "Sensitivity",
    quiet: "Quiet",
    frequent: "Frequent",
    summaryTitle: "At this setting",
    catchesLargest: "Only the sharpest liquidity surges will alert.",
    catchesFromBefore: "Alerts start when liquidity gathers enough to stand out on a ",
    catchesFromAfter: " chart.",
    ratePerCoin: (rate: string) => `Alerts about ${rate}`,
    footnote:
      "An alert tells you liquidity gathered — not whether the price is about to rise or fall. The tick marks are a reference for gauging sensitivity; sensitivity is the only firing criterion, so alerts do not fire per timeframe.",
  },

  rate: {
    never: "almost never",
    everyNDays: (days: number) => `once every ${days} days`,
    perDay: (value: string) => `${value} a day`,
  },

  auth: {
    login: "Log in",
    signup: "Sign up",
    submitLogin: "Log in",
    submitSignup: "Create account",
    subtitle: "Save channels to your account and pick up anywhere.",
    close: "Close",
    email: "Email",
    password: "Password",
    noticeTop:
      "Not ready yet. Once accounts exist, your channels will be saved so you can pick up on any device.",
    noticeBottom:
      "You can keep using it without an account. Channels you create last as long as this tab stays open.",
    toSignupPrefix: "No account yet?",
    toSignupAction: "Sign up",
    toLoginPrefix: "Already have an account?",
    toLoginAction: "Log in",
    working: "Working...",
    checkEmail:
      "Check your inbox — follow the link in the email to finish signing up.",
    guestHint:
      "You can keep using it without an account. Channels you create will only last as long as this tab stays open.",
    problem: {
      unavailable:
        "Accounts are not connected yet. Please continue without logging in.",
      invalid_credentials: "That email and password do not match.",
      email_taken: "That email is already registered.",
      weak_password: "Passwords must be at least 6 characters.",
      invalid_email: "That email address is not valid.",
      email_not_confirmed: "Follow the confirmation link in your email first.",
      rate_limited: "Too many attempts. Please wait a moment and try again.",
      unknown: "Something went wrong. Please try again shortly.",
    },
  },

  footer: {
    note: "The detection engine is not connected yet. For now you can create channels and review their settings.",
  },

  frame: {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
  },

  frameScale: {
    "1m": "1m-scale",
    "5m": "5m-scale",
    "15m": "15m-scale",
    "1h": "1h-scale",
    "4h": "4h-scale",
    "1d": "1d-scale",
  },
};

const DICTIONARIES: Record<Locale, Dictionary> = { ko, en };

interface I18n {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
}

const Context = createContext<I18n | null>(null);

export function LocaleProvider({
  initial,
  children,
}: {
  initial: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);

    // 서버 렌더가 같은 언어로 나오도록 쿠키에 남긴다. 이게 없으면
    // 새로고침할 때마다 기본 언어로 되돌아간다.
    // 개인정보가 아니라 표시 설정이라 1년이면 충분하다.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  const value = useMemo(
    () => ({ locale, t: DICTIONARIES[locale], setLocale }),
    [locale, setLocale],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const found = useContext(Context);
  if (found === null) {
    throw new Error("LocaleProvider 안에서만 쓸 수 있습니다");
  }
  return found;
}

/** 문구만 필요할 때. 대부분의 컴포넌트가 이것만 쓴다. */
export function useT(): Dictionary {
  return useI18n().t;
}

// ---------------------------------------------------------------------------
// 언어가 필요한 서식
//
// core는 언어를 모른다. 숫자만 내주고 문장은 여기서 만든다.
// ---------------------------------------------------------------------------

/**
 * 하루 알림 수를 사람이 읽을 문구로.
 * 어떤 표현을 쓸지는 core가 정한다. 여기서는 말만 붙인다.
 */
export function formatAlertsPerDay(t: Dictionary, perDay: number): string {
  const described = describeAlertRate(perDay);

  if (described.kind === "never") {
    return t.rate.never;
  }
  if (described.kind === "everyNDays") {
    return t.rate.everyNDays(described.days);
  }
  return t.rate.perDay(described.value);
}

/** 저장 전 검사에서 나온 문제를 문장으로. */
export function formatProblem(
  t: Dictionary,
  problem: ChannelProblem,
  limits: { maxNameLength: number },
): string {
  if (problem === "empty_name") {
    return t.problem.empty_name;
  }
  if (problem === "name_too_long") {
    return t.problem.name_too_long(limits.maxNameLength);
  }
  if (problem === "no_symbol") {
    return t.problem.no_symbol;
  }
  return t.problem.no_delivery;
}
