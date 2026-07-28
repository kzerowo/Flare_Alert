import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import type { Database } from "./types";

/*
 * 서버 컴포넌트용 클라이언트.
 *
 * 세션은 쿠키에 있고, 서버 컴포넌트에서는 그 쿠키를 읽을 수만 있다.
 * setAll이 조용히 실패하도록 둔 것은 실수가 아니다 — 응답 헤더가 이미
 * 나간 뒤라 쓸 수 없고, 세션 갱신은 미들웨어가 맡는다.
 */
export async function getServerClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const store = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll() {
        // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 미들웨어가 대신 한다.
      },
    },
  });
}
