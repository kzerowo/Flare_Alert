// 메인 페이지. 본 기능이 여기 다 있다.
//
// 별도 설정 페이지로 나누지 않았다. 채널을 만들고 목록을 보는 것이
// 이 서비스가 하는 일의 전부라, 페이지를 나누면 왕복만 늘어난다.

import { MainApp } from "@/components/MainApp";
import { AlertStoreProvider } from "@/lib/alerts";
import { AuthProvider } from "@/lib/auth";
import { ChannelStoreProvider } from "@/lib/channel-store";

export default function HomePage() {
  // 저장소가 인증 상태를 보고 게스트/계정을 고르므로 인증이 바깥에 온다.
  // 알림 기록도 사용자에 매달리므로 마찬가지로 안쪽에 둔다.
  return (
    <AuthProvider>
      <ChannelStoreProvider>
        <AlertStoreProvider>
          <MainApp />
        </AlertStoreProvider>
      </ChannelStoreProvider>
    </AuthProvider>
  );
}
