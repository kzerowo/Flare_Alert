// 채널 만들기 화면.
// 지금은 민감도 슬라이더만 동작한다. 코인 선택과 저장은 아직 없다.

import Link from "next/link";

import { SensitivitySlider } from "@/components/SensitivitySlider";

export default function NewChannelPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-flare-muted hover:text-flare-accent">
        ← Flare Alert
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        채널 만들기
      </h1>
      <p className="mt-2 text-sm text-flare-muted">
        감시할 코인을 묶고 민감도를 정합니다. 채널 안의 코인들은 각자의 평소
        거래량 분포를 기준으로 판정되므로, 규모가 달라도 민감도 하나면 됩니다.
      </p>

      <section className="mt-10">
        <SensitivitySlider />
      </section>

      <section className="mt-12 rounded-lg border border-flare-muted/20 p-4">
        <h2 className="text-sm font-medium">아직 없는 것</h2>
        <ul className="mt-2 space-y-1 text-sm text-flare-muted">
          <li>· 코인 선택</li>
          <li>· 감시 프레임 선택</li>
          <li>· 전달 수단 (브라우저 / 텔레그램)</li>
          <li>· 저장</li>
        </ul>
      </section>
    </main>
  );
}
