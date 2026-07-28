"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import type { Database } from "./types";

export type Client = SupabaseClient<Database>;

/*
 * 브라우저용 클라이언트.
 *
 * 한 번 만들어 재사용한다. 매번 새로 만들면 인증 상태 구독이 여러 벌
 * 생기고, 로그아웃 같은 이벤트가 중복으로 흘러다닌다.
 */
let cached: Client | null = null;

/** 설정이 없으면 null. 호출부는 게스트 모드로 넘어가야 한다. */
export function getBrowserClient(): Client | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (cached === null) {
    cached = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  return cached;
}
