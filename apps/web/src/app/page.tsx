// 랜딩. 서비스가 무엇을 하는지 모르는 사람이 처음 닿는 화면이다.
//
// 앱 본체는 /app 으로 내려갔다. 거래대금이니 민감도니 하는 말이 처음인
// 사람에게 빈 채널 목록부터 들이밀면 무엇을 하는 화면인지 알 수가 없다.
//
// 인증 제공자는 여전히 "/"로 돌려보낸다(auth.tsx의 redirectTo). 그 경우만
// AuthForward가 /app으로 넘긴다 — 자세한 이유는 그 파일에 적었다.

import { AuthForward } from "@/components/landing/AuthForward";
import { Landing } from "@/components/landing/Landing";

export default function HomePage() {
  return (
    <>
      <AuthForward />
      <Landing />
    </>
  );
}
