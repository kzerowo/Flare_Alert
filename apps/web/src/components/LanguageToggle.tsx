"use client";

import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_NAME } from "@/lib/locale";

/**
 * 언어 전환.
 *
 * 언어가 둘뿐이라 목록을 펼치지 않고 나란히 둔다. 지금 언어가 눌린 상태로
 * 보이므로 "이게 현재 언어인지 누르면 바뀔 언어인지" 헷갈리지 않는다.
 * 버튼 하나로 토글하면 그 구분이 사라진다.
 *
 * 각 언어 이름은 언제나 그 언어로 쓴다. 영어를 못 읽는 사람에게
 * "Korean"이라고 써두면 찾을 수 없다.
 */
export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className="flex items-center rounded-lg border border-white/10 p-[2px]"
      role="group"
      aria-label={t.nav.language}
    >
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLocale(option)}
            aria-pressed={active}
            className={`label rounded px-2 py-1 transition-colors ${
              active
                ? "bg-surface-highest text-on-surface"
                : "text-on-surface-variant hover:text-primary"
            }`}
          >
            {LOCALE_NAME[option]}
          </button>
        );
      })}
    </div>
  );
}
