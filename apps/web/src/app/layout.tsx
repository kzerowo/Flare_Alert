import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

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

export const metadata: Metadata = {
  title: "Flare Alert",
  description: "코인마다 임계치를 맞출 필요 없는 거래량 급등 알림",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
