import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";

import { LocaleProvider } from "@/lib/i18n";
import { LOCALE_COOKIE, parseLocale } from "@/lib/locale";

import "./globals.css";

/*
 * 시안은 Google Fonts를 <link>로 받아오지만, next/font는 빌드 시점에
 * 폰트를 내려받아 같이 배포한다. 외부 요청이 사라지고 렌더 중 글꼴이
 * 바뀌며 레이아웃이 튀는 것도 막는다.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/** 숫자 전용. 값이 바뀌어도 자리가 흔들리지 않게 고정폭을 쓴다. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-jetbrains",
  display: "swap",
});

/*
 * 언어는 쿠키에서 읽는다.
 *
 * 브라우저 설정(navigator.language)으로 정하면 마운트 후에야 알 수 있어서,
 * 서버가 그린 한국어 화면이 잠깐 보였다가 영어로 바뀐다. 쿠키는 서버에서도
 * 읽히므로 처음부터 맞는 언어로 그린다.
 *
 * 대신 이 레이아웃은 동적 렌더가 된다. 어차피 화면 전체가 클라이언트
 * 상호작용이라 정적으로 얻을 이득이 없다.
 */
async function currentLocale() {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();

  if (locale === "en") {
    return {
      title: "Flare Alert",
      description: "Volume spike alerts without per-coin tuning",
    };
  }

  return {
    title: "Flare Alert",
    description: "코인마다 임계치를 맞출 필요 없는 거래량 급등 알림",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await currentLocale();

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased">
        <LocaleProvider initial={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
