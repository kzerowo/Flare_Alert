/*
 * Supabase 접속 정보.
 *
 * 없을 수도 있다고 보고 다룬다. 프로젝트를 아직 만들지 않았거나 남의
 * 체크아웃에서 .env.local이 비어 있을 수 있는데, 그때 앱이 죽으면
 * 게스트 기능까지 같이 막힌다. 게스트는 저장소가 필요 없으므로 그럴
 * 이유가 없다.
 *
 * anon 키는 브라우저에 노출되는 값이다. 비밀이 아니고, 실제 보호는
 * 행 수준 보안(RLS)이 한다. supabase/migrations/0001_init.sql 참고.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_URL = url ?? "";
export const SUPABASE_ANON_KEY = anonKey ?? "";

/** 회원 기능을 켤 수 있는지. false면 게스트 전용으로 동작한다. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/**
 * 웹 푸시 서명 공개 키(VAPID).
 *
 * 브라우저가 구독할 때 이 키로 서명을 검증한다. detector가 가진 비밀 키와
 * 쌍이어야 하고, 어긋나면 구독은 되는데 발송이 전부 거절된다.
 *
 * 공개 키라 노출되어도 문제없다. 이 키만으로는 알림을 보낼 수 없다.
 *
 * 없으면 null이다. Supabase와 마찬가지로 없는 것이 오류는 아니고,
 * 그 경우 알림 기능만 꺼진 채로 나머지가 동작한다.
 */
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
