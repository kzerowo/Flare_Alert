"use client";

import { useEffect } from "react";

/*
 * 인증 콜백을 앱으로 넘긴다.
 *
 * Supabase에 돌려보낼 주소로 window.location.origin을 준다. 즉 메일 확인,
 * 비밀번호 재설정, 구글 로그인이 모두 "/"로 돌아온다. 이제 "/"는 소개
 * 페이지라 그 자리에 인증을 처리할 코드가 없다 — 비밀번호 재설정 창은
 * MainApp 안에 있다.
 *
 * 돌려보낼 주소를 "/app"으로 바꾸는 방법도 있지만, 그러려면 Supabase
 * 대시보드의 허용 주소 목록도 같이 고쳐야 한다. 코드만으로 닫히지 않는
 * 문제를 만들지 않으려고 여기서 넘긴다.
 *
 * 조각(#) 뒤는 서버로 가지 않으므로 이 일은 브라우저에서만 할 수 있다.
 * 이 페이지가 Supabase 클라이언트를 만들지 않는 것도 중요하다 — 만들면
 * detectSessionInUrl이 여기서 코드를 먼저 써 버려서 앱 쪽에 남는 것이 없다.
 */

/** 이 중 하나라도 있으면 인증에서 돌아온 것으로 본다. */
const QUERY_MARKERS = [
  "code",
  "token_hash",
  "error",
  "error_code",
  "error_description",
];

export function AuthForward() {
  useEffect(() => {
    const { search, hash } = window.location;

    const query = new URLSearchParams(search);
    const fragment = new URLSearchParams(
      hash.startsWith("#") ? hash.slice(1) : hash,
    );

    const fromAuth =
      QUERY_MARKERS.some((key) => query.has(key)) ||
      fragment.has("access_token") ||
      fragment.has("error") ||
      fragment.get("type") === "recovery";

    if (!fromAuth) {
      return;
    }

    // 붙어 온 것을 그대로 들고 간다. 앱 쪽 클라이언트가 이어서 처리한다.
    window.location.replace(`/app${search}${hash}`);
  }, []);

  return null;
}
