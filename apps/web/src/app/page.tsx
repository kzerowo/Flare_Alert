// 랜딩 페이지 자리표시자.
// 설정 UI와 알림 히스토리 대시보드는 감지 로직 확정 후에 붙인다.

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Flare Alert
      </h1>

      <p className="max-w-md text-flare-muted">
        감시할 코인을 채널로 묶고 민감도만 정하세요. 코인마다 임계치를 따로
        맞출 필요 없이, 종목별 평소 거래량에 맞춰 자동으로 보정됩니다.
      </p>

      <span className="rounded-full border border-flare-accent/40 px-4 py-1 text-sm text-flare-accent">
        준비 중
      </span>
    </main>
  );
}
