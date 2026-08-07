-- ---------------------------------------------------------------------------
-- 계정 삭제.
--
-- 웹은 anon 키로만 Supabase에 붙는다(서비스 계층이 없다 — README/CLAUDE.md
-- 참고). auth.users 삭제는 관리자 권한(service_role)이 필요한데, 그 키는
-- 브라우저에 절대 놓을 수 없다. 그래서 이 프로젝트가 이미 쓰는 방식을
-- 그대로 따른다 — API 라우트를 새로 두는 대신, "자기 자신만" 지울 수 있게
-- 좁힌 SECURITY DEFINER 함수를 하나 두고 RPC로 부른다.
--
-- profiles/channels/channel_symbols/push_subscriptions/alerts는 전부
-- auth.users를 on delete cascade로 참조하므로(0001, 0002), 이 함수 하나로
-- 사용자의 흔적이 깨끗이 지워진다.
-- ---------------------------------------------------------------------------

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid()는 호출자의 것이다. 인자로 id를 받으면 남의 계정을 지울 수
  -- 있는 함수가 되므로 받지 않는다.
  delete from auth.users where id = auth.uid();
end;
$$;

-- 로그인한 사용자만 부를 수 있다. anon(비로그인)은 auth.uid()가 null이라
-- 어차피 아무것도 지우지 못하지만, 권한 자체를 좁혀 둔다.
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  '호출한 본인의 계정을 삭제한다. auth.users 삭제가 관련 테이블 전부에 CASCADE된다.';
