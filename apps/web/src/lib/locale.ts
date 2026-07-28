/*
 * 언어 식별과 쿠키 이름.
 *
 * 사전(i18n.tsx)과 떼어 놓은 이유가 있다. 사전 쪽은 React 컨텍스트를 쓰므로
 * "use client"가 붙는데, 그러면 그 파일의 모든 내보내기가 클라이언트 전용이
 * 되어 서버 컴포넌트에서 부를 수 없다. layout.tsx는 서버에서 쿠키를 읽어
 * 언어를 정해야 하므로, 그때 필요한 것들만 여기 둔다.
 */

export type Locale = "ko" | "en";

export const LOCALES: readonly Locale[] = ["ko", "en"];

/**
 * 언어를 쿠키에 담는다.
 *
 * localStorage로는 서버가 읽을 수 없어서, 서버가 그린 한국어 화면이 잠깐
 * 보였다가 영어로 바뀐다. 쿠키는 요청에 실려 오므로 처음부터 맞는 언어로 그린다.
 */
export const LOCALE_COOKIE = "flare-alert.locale";

/** 모르는 값이면 한국어. 쿠키는 사용자가 임의로 고칠 수 있다. */
export function parseLocale(value: string | undefined): Locale {
  if (value === "en") {
    return "en";
  }
  return "ko";
}

/** 언어 전환 메뉴에 쓰는 이름. 언제나 그 언어로 쓴다 — 영어를 못 읽는
 *  사람에게 "Korean"이라고 써두면 찾을 수 없다. */
export const LOCALE_NAME: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
};

/** 사전에 없는 표기(날짜, 숫자)는 언어별 서식을 따른다. */
export const LOCALE_TAG: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
};
