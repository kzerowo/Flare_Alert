import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

/*
 * 세션 갱신.
 *
 * Supabase 액세스 토큰은 한 시간이면 만료된다. 서버 컴포넌트는 쿠키를
 * 쓸 수 없으므로 갱신된 토큰을 저장할 자리가 없다. 미들웨어는 응답을
 * 만들기 전이라 쓸 수 있어서, 갱신은 여기서만 한다.
 *
 * 이 파일이 없으면 한 시간 뒤부터 서버가 로그인 상태를 잃어버린다.
 * 브라우저 쪽은 멀쩡해 보여서 원인을 찾기 어렵다.
 *
 * 접근 제어는 하지 않는다. 이 앱은 로그인 없이도 전부 쓸 수 있고,
 * 남의 데이터를 막는 것은 RLS의 몫이다.
 */
export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser를 부르는 것 자체가 목적이다. 토큰이 만료됐으면 이 호출이
  // 갱신을 일으키고, 위 setAll이 새 쿠키를 응답에 싣는다.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * 정적 자산은 건너뛴다. 이미지 한 장마다 세션을 갱신할 이유가 없고,
     * 그만큼 응답이 느려진다.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
