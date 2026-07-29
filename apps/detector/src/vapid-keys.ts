// VAPID 키 쌍을 만들어 출력한다.
//
//   pnpm --filter @flare-alert/detector keys
//
// 한 번 만들어 환경변수에 넣고 계속 쓴다. 키를 바꾸면 기존 구독이 전부
// 무효가 되어 모든 사용자가 알림을 다시 켜야 하므로, 유출된 게 아니라면
// 다시 만들지 않는다.

import { generateVapidKeys } from "./push.js";

const keys = generateVapidKeys();

console.log(`
VAPID 키 쌍을 만들었습니다. 아래를 각각 넣으세요.

--- 루트 .env (detector) ---
VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:your@email.com

--- apps/web/.env.local (웹) ---
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}

공개 키는 양쪽에 같은 값이 들어갑니다. 비밀 키는 detector에만 둡니다.
VAPID_SUBJECT은 mailto: 또는 https:// 로 시작해야 하고, 형식이 틀리면
푸시 서비스가 발송을 통째로 거절합니다.
`);
