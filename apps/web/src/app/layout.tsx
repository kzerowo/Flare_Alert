import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flare Alert",
  description: "코인마다 임계치를 맞출 필요 없는 거래량 급등 알림",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
