-- 알림 기록과 웹 푸시 구독
--
-- 적용: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행.
--       또는 supabase CLI를 쓴다면 `supabase db push`.
--
-- 두 가지를 한 번에 넣는다. 알림을 저장하는 것과 보내는 것은 같은 흐름의
-- 앞뒤라서, 테이블만 있고 구독이 없으면 아무 데도 못 가고 그 반대도 같다.

-- ---------------------------------------------------------------------------
-- 텔레그램 제거
--
-- 앱(App Store/Play Store)을 만들기로 하면서 텔레그램은 할 자리가 없어졌다
-- (2026-07-29). 원래 텔레그램이 맡던 자리는 "자리를 비웠을 때"였는데,
-- 웹은 Web Push가, 모바일은 앱 푸시가 그 자리를 대신한다.
--
-- 아직 발송기를 안 만든 게 다행이다. 지금은 컬럼과 선택지만 지우면 된다.
-- ---------------------------------------------------------------------------
alter table public.profiles drop column if exists telegram_chat_id;
alter table public.profiles drop column if exists telegram_verified_at;

-- 기존 행에 'telegram'이 남아 있으면 제약을 걸 때 걸린다. 먼저 걷어낸다.
update public.channels
  set delivery = array_remove(delivery, 'telegram')
  where 'telegram' = any (delivery);

-- 빈 배열이 되면 감지는 하되 알림이 안 나가는 채널이 된다. 기본값으로 되돌린다.
update public.channels
  set delivery = '{browser}'
  where cardinality(delivery) = 0;

alter table public.channels
  add constraint channels_delivery_known
  check (delivery <@ array['browser']::text[]);

-- ---------------------------------------------------------------------------
-- 웹 푸시 구독
--
-- 브라우저가 발급하는 구독 하나가 한 행이다. 같은 사용자가 여러 기기·
-- 브라우저를 쓰면 행이 여러 개 생긴다.
--
-- endpoint를 기본키로 삼는다. 브라우저가 주는 값이 이미 전역 고유하고,
-- 같은 브라우저가 재구독하면 같은 endpoint가 돌아오므로 upsert가 자연스럽다.
-- 별도 id를 두면 같은 기기가 중복 등록되어 알림이 두 번 간다.
--
-- p256dh와 auth는 페이로드를 암호화할 때 쓰는 공개 키 재료다(RFC 8291).
-- 비밀이 아니라 그 브라우저 전용 값이라, 유출되어도 남의 알림을 못 본다.
-- 다만 이 행을 읽으면 그 사용자에게 알림을 보낼 수는 있으므로 RLS는 건다.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,

  p256dh text not null,
  auth text not null,

  -- 어느 기기인지 사용자가 알아볼 수 있게. "Chrome / Windows" 정도.
  label text,

  created_at timestamptz not null default now(),
  -- 발송이 성공한 마지막 시각. 오래 실패하는 구독을 걷어낼 때 쓴다.
  last_success_at timestamptz
);

create index push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 알림 기록
--
-- detector가 넣고, 사용자는 자기 것만 읽는다. 웹은 이 테이블을 Realtime으로
-- 구독해서 탭이 열려 있을 때 즉시 반응하고, 닫혀 있으면 Web Push가 맡는다.
--
-- user_id를 채널에서 조인하지 않고 여기 복제해 둔다. Realtime 구독은
-- 단일 테이블의 컬럼으로만 필터할 수 있어서, 조인이 필요하면 남의 알림까지
-- 전부 받아 클라이언트에서 걸러야 한다. 그건 RLS로 막아도 트래픽이 낭비다.
--
-- 값들(percentile/score/...)도 마찬가지로 그 시점 그대로 박아 둔다.
-- 채널 민감도는 나중에 바뀔 수 있고, 그러면 "왜 이때 울렸는지"를
-- 되짚을 수 없게 된다.
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,

  exchange text not null check (exchange in ('binance', 'upbit')),
  symbol text not null,

  fired_at timestamptz not null,
  price double precision not null,

  -- 판정에 쓰인 값들. 표시와 사후 검증에 쓴다.
  percentile double precision not null,
  score double precision not null,
  quote_volume double precision not null,
  ratio_to_median double precision not null,

  -- 사건의 규모(이상치였던 가장 긴 프레임). 판정 기준이 아니라 라벨이다.
  scale text not null check (scale in ('1m', '5m', '15m', '1h', '4h', '1d')),

  created_at timestamptz not null default now()
);

-- 목록 화면은 "내 알림을 최근 순으로"만 묻는다.
create index alerts_user_recent_idx
  on public.alerts (user_id, fired_at desc);

create index alerts_channel_idx on public.alerts (channel_id, fired_at desc);

-- ---------------------------------------------------------------------------
-- Realtime
--
-- 이 발행 목록에 넣지 않으면 웹이 구독해도 아무것도 오지 않는다.
-- RLS는 그대로 적용되므로 남의 알림은 흘러가지 않는다.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.alerts;

-- ---------------------------------------------------------------------------
-- 행 수준 보안
--
-- detector는 service_role로 붙어 RLS를 우회하므로 insert 정책이 필요 없다.
-- 사용자에게는 읽기만 준다 — 알림 기록은 시스템이 남기는 것이라
-- 사용자가 고칠 수 있으면 기록으로서 의미가 없다. 다만 지우기는 허용한다.
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.alerts enable row level security;

create policy "본인 푸시 구독만 다룬다"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "본인 알림만 읽는다"
  on public.alerts for select
  using (auth.uid() = user_id);

create policy "본인 알림만 지운다"
  on public.alerts for delete
  using (auth.uid() = user_id);
