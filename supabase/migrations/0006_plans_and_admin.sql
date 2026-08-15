-- 요금제(free/pro)와 관리자
--
-- 적용: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행.
--       또는 supabase CLI를 쓴다면 `supabase db push`.
--
-- 이 마이그레이션의 핵심은 "화면에서 버튼을 감추는 것은 방어가 아니다"다.
-- 웹은 anon 키로 브라우저에서 직접 insert한다(0001 주석 참고). 무료 사용자가
-- 개발자 도구를 열고 channels에 100행을 넣는 데 아무 장벽이 없으므로,
-- 채널 수 상한은 DB가 판정해야 한다. 트리거로 막는다.

-- ---------------------------------------------------------------------------
-- 요금제와 권한
--
-- plan과 role을 한 컬럼에 합치지 않는다. 관리자는 "돈을 낸 사람"이 아니라
-- "운영하는 사람"이라, 요금제 축에 얹으면 나중에 결제를 붙일 때 관리자가
-- 유료 사용자로 집계되고 매출이 부풀려진다.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'pro'));

alter table public.profiles
  add column if not exists role text not null default 'user'
    check (role in ('user', 'admin'));

-- 결제 연동 전이라 지금은 전부 null(만료 없음)이다. 미리 만들어 둔 것은,
-- 나중에 컬럼을 추가하면 아래의 판정 함수·트리거·RPC와 웹의 읽기 경로까지
-- 전부 다시 손봐야 하기 때문이다. 지금 넣어 두면 결제 연동은
-- admin_set_plan()을 부르는 웹훅 하나로 끝난다.
alter table public.profiles
  add column if not exists plan_expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- 판정 함수
--
-- 셋 다 SECURITY DEFINER다. 남의 요금제를 읽어야 하는 자리(트리거는 채널을
-- 만든 사람의 한도를, 관리자 조회는 전 회원의 상태를)에서 불리는데,
-- 호출자 권한으로 읽으면 0001의 "본인 프로필만 다룬다" 정책에 걸려 빈
-- 결과가 돌아온다. 그러면 한도가 없는 것처럼 보인다 — 조용히 틀린다.
--
-- 나중에 profiles에 is_admin()을 쓰는 RLS 정책을 붙일 여지도 남는다.
-- 그 경우 호출자 권한으로 읽으면 정책이 자기 자신을 다시 불러 무한 재귀가 된다.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.id = uid),
    false
  );
$$;

/*
 * 실제로 적용되는 요금제.
 *
 * 저장된 plan을 그대로 믿지 않는다. 관리자는 항상 pro고, 만료 시각이 지난
 * pro는 free다. 이 판정이 한 군데 모여 있지 않으면 트리거와 RPC와 화면이
 * 서로 다른 답을 낸다.
 *
 * packages/core/src/plan.ts 의 effectivePlan()과 같은 규칙이다.
 */
create or replace function public.effective_plan(uid uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.role = 'admin' then 'pro'
    when p.plan = 'pro'
      and (p.plan_expires_at is null or p.plan_expires_at > now()) then 'pro'
    else 'free'
  end
  from public.profiles p
  where p.id = uid;
$$;

/*
 * 만들 수 있는 채널 수. null이면 무제한.
 *
 * 3은 packages/core/src/plan.ts 의 FREE_CHANNEL_LIMIT와 같은 값이어야 한다.
 * 한쪽만 바꾸면 화면은 네 번째 채널을 허용하는데 DB가 거절해서, 사용자는
 * 저장을 눌렀다가 되돌아가는 화면만 본다.
 */
create or replace function public.channel_limit_for(uid uuid default auth.uid())
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(public.effective_plan(uid), 'free') = 'pro' then null::int
    else 3
  end;
$$;

-- ---------------------------------------------------------------------------
-- 채널 수 상한
-- ---------------------------------------------------------------------------
create or replace function public.enforce_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed int;
  used int;
begin
  allowed := public.channel_limit_for(new.user_id);

  if allowed is null then
    return new;
  end if;

  -- 두 요청이 동시에 들어오면 둘 다 통과할 수 있다. 그걸 막으려면 프로필
  -- 행을 잠가야 하는데, 채널 하나 만드는 데 계정 전체를 직렬화하는 대가가
  -- 더 크다. 새는 창은 밀리초 단위고 넘어가는 개수는 많아야 하나다.
  select count(*) into used
    from public.channels c
    where c.user_id = new.user_id;

  if used >= allowed then
    -- 웹은 이 문자열을 보고 "한도 초과"를 구분한다.
    -- apps/web/src/lib/channel-store.tsx
    raise exception 'channel_limit_reached'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists channels_enforce_limit on public.channels;
create trigger channels_enforce_limit
  before insert on public.channels
  for each row execute function public.enforce_channel_limit();

-- ---------------------------------------------------------------------------
-- 스스로 pro가 되는 것을 막는다
--
-- 0001의 "본인 프로필만 다룬다" 정책은 for all이라 사용자가 자기 profiles
-- 행을 update할 수 있다. 요금제 컬럼을 그냥 얹으면 누구나
-- `update profiles set plan='pro', role='admin' where id=auth.uid()` 한 줄로
-- 관리자가 된다. anon 키는 공개되는 값이라 이건 가정이 아니라 한 줄짜리
-- 권한 상승이다. 정책을 좁히는 대신 트리거로 이 세 컬럼만 잠근다 —
-- locale 같은 나머지 설정은 사용자가 계속 바꿀 수 있어야 하기 때문이다.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan is not distinct from old.plan
     and new.role is not distinct from old.role
     and new.plan_expires_at is not distinct from old.plan_expires_at
  then
    return new;
  end if;

  -- 판정 기준은 current_user가 아니라 auth.uid()다. current_user는 이 함수가
  -- SECURITY DEFINER라 항상 소유자(postgres)로 보여서, 그걸로 검사하면
  -- 조건이 영영 참이 되지 않고 가드가 통째로 죽는다.
  --
  -- auth.uid()는 요청의 JWT에서 읽으므로 SECURITY DEFINER에 영향받지 않는다.
  --   브라우저의 일반 사용자 → uid 있음, is_admin 거짓  → 막는다
  --   브라우저의 관리자       → uid 있음, is_admin 참    → 통과
  --   admin_set_plan() 경유   → 부른 관리자의 uid가 그대로 → 통과
  --   SQL Editor / service_role(결제 웹훅) → uid 없음     → 통과
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'plan_change_forbidden'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- 관리자 조회/변경
--
-- 전부 RPC로 둔다. 관리자에게 profiles·channels·alerts를 통째로 읽는 RLS
-- 정책을 열어 주는 방법도 있지만, 그러면 "관리자면 무엇이든"이 되어
-- 되돌리기 어렵다. 필요한 질문 세 개만 함수로 뚫는 편이 좁다.
--
-- 이메일은 auth.users에만 있고 거기엔 정책을 걸 수 없다. 그래서 조회는
-- 어차피 SECURITY DEFINER 함수여야 한다.
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_users(
  search text default null,
  max_rows int default 100
)
returns table (
  id uuid,
  email text,
  plan text,
  role text,
  plan_expires_at timestamptz,
  created_at timestamptz,
  channel_count bigint,
  alert_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      p.id,
      u.email::text,
      p.plan,
      p.role,
      p.plan_expires_at,
      p.created_at,
      (select count(*) from public.channels c where c.user_id = p.id),
      (select count(*) from public.alerts a where a.user_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    where search is null
       or search = ''
       or u.email ilike '%' || search || '%'
    order by p.created_at desc
    limit least(greatest(max_rows, 1), 500);
end;
$$;

/*
 * 요금제를 바꾼다.
 *
 * role은 여기서 못 바꾼다. 관리자를 늘리는 일은 화면에 버튼으로 두기에는
 * 되돌리기 어려운 변경이고(자기 자신을 강등시켜 아무도 관리자가 아닌 상태를
 * 만들 수 있다), 실제로 필요한 빈도는 몇 달에 한 번이다. SQL Editor에서
 * profiles.role을 직접 고친다 — 이 파일 맨 아래의 부트스트랩 구문과 같은
 * 방식이다.
 */
create or replace function public.admin_set_plan(
  target_id uuid,
  next_plan text,
  expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if next_plan not in ('free', 'pro') then
    raise exception 'unknown_plan' using errcode = 'check_violation';
  end if;

  update public.profiles
    set plan = next_plan,
        -- free로 내리면서 만료 시각을 남겨 두면, 나중에 그 값을 읽는 쪽이
        -- "만료된 pro"와 "원래 free"를 구분하지 못한다.
        plan_expires_at = case when next_plan = 'pro' then expires_at else null end
    where id = target_id;

  -- 내릴 때는 이미 만들어 둔 채널이 한도를 넘은 채로 남는다. 트리거는
  -- insert만 막으므로 그대로 두면 detector가 계속 전부 감시한다.
  --
  -- 지우지는 않는다 — 다시 결제하면 그대로 살아나야 한다. 오래된 것부터
  -- 한도만큼 남기고 나머지를 끈다. detector는 enabled=true만 읽는다.
  -- (다시 pro가 되어도 자동으로 켜 주지는 않는다. 사용자가 스스로 끈
  --  채널과 구분할 방법이 없어서, 잘못 켜는 쪽이 더 나쁘다.)
  allowed := public.channel_limit_for(target_id);
  if allowed is not null then
    update public.channels
      set enabled = false
      where id in (
        select c.id
        from public.channels c
        where c.user_id = target_id
        order by c.created_at asc
        offset allowed
      );
  end if;
end;
$$;

create or replace function public.admin_stats()
returns table (
  total_users bigint,
  pro_users bigint,
  total_channels bigint,
  enabled_channels bigint,
  push_subscriptions bigint,
  alerts_24h bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      (select count(*) from public.profiles),
      -- effective_plan()을 행마다 부르지 않고 같은 조건을 편다. 사용자가
      -- 수천이 되어도 한 번의 스캔으로 끝나야 하는 화면이다.
      (select count(*) from public.profiles p
        where p.role = 'admin'
           or (p.plan = 'pro'
               and (p.plan_expires_at is null or p.plan_expires_at > now()))),
      (select count(*) from public.channels),
      (select count(*) from public.channels c where c.enabled),
      (select count(*) from public.push_subscriptions),
      (select count(*) from public.alerts a
        where a.fired_at > now() - interval '24 hours');
end;
$$;

-- ---------------------------------------------------------------------------
-- 실행 권한
--
-- 관리자 함수도 authenticated에게 연다. 안을 is_admin()으로 막아 두었으므로
-- 일반 사용자가 불러도 예외만 돌아온다. anon(비로그인)에게는 주지 않는다.
-- ---------------------------------------------------------------------------
revoke all on function public.is_admin(uuid) from public;
revoke all on function public.effective_plan(uuid) from public;
revoke all on function public.channel_limit_for(uuid) from public;
revoke all on function public.admin_list_users(text, int) from public;
revoke all on function public.admin_set_plan(uuid, text, timestamptz) from public;
revoke all on function public.admin_stats() from public;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.effective_plan(uuid) to authenticated;
grant execute on function public.channel_limit_for(uuid) to authenticated;
grant execute on function public.admin_list_users(text, int) to authenticated;
grant execute on function public.admin_set_plan(uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 첫 관리자
--
-- 닭과 달걀이다. admin_set_plan()은 관리자만 부를 수 있고, 관리자를 만드는
-- 함수는 없다. 최초 한 명은 여기서 직접 지정한다. 위의 guard 트리거는
-- SQL Editor(current_user = postgres)에서 오는 변경을 막지 않는다.
--
-- 관리자를 추가하려면 이메일만 바꿔 같은 구문을 다시 실행하면 된다.
-- ---------------------------------------------------------------------------
update public.profiles p
  set role = 'admin'
  from auth.users u
  where u.id = p.id
    and lower(u.email) = lower('kyj02420440@gmail.com');

comment on column public.profiles.plan is
  '결제 요금제. free는 채널 3개, pro는 무제한. 실제 판정은 effective_plan()을 쓴다.';
comment on column public.profiles.role is
  '운영 권한. admin은 요금제와 무관하게 pro로 취급한다. 화면에서는 바꿀 수 없다.';
