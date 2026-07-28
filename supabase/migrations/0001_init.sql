-- Flare Alert 초기 스키마
--
-- 적용: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행.
--       또는 supabase CLI를 쓴다면 `supabase db push`.
--
-- 인증은 Supabase Auth(auth.users)를 그대로 쓴다. 사용자 테이블을 따로
-- 만들지 않는다. 비밀번호 해시와 세션 관리를 직접 하면 얻는 것 없이
-- 사고 날 지점만 늘어난다.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 프로필
--
-- auth.users에는 우리 도메인 정보를 넣을 수 없다. 계정에 딸린 설정은
-- 여기에 둔다. 텔레그램 연결이 계정 단위인 이유는 types.ts UserSettings
-- 주석 참고 — 채널마다 연결하게 하면 봇을 여러 번 붙여야 한다.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  telegram_chat_id text,
  -- 사용자가 실제로 봇을 연결했는지 확인된 시각. null이면 미확인이라
  -- 채널이 telegram을 켜 두었어도 발송하지 않는다.
  telegram_verified_at timestamptz,

  locale text not null default 'ko' check (locale in ('ko', 'en')),

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 채널
--
-- 감시 단위. 코인 묶음 하나에 민감도 하나가 붙는다.
--
-- sensitivity는 슬라이더 위치(1~100)가 아니라 백분위 임계 그대로 저장한다.
-- 슬라이더는 화면 표현일 뿐이고 로그 축 변환이 걸려 있어서, 위치를
-- 저장하면 나중에 축을 조정할 때 모든 사용자의 설정이 조용히 바뀐다.
-- ---------------------------------------------------------------------------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null check (char_length(name) between 1 and 24),
  enabled boolean not null default true,

  -- SENSITIVITY_MIN(90) ~ SENSITIVITY_MAX(99.995).
  -- 상한을 100으로 둔 건 상수를 조정할 여지를 남기기 위해서다.
  sensitivity double precision not null check (sensitivity >= 90 and sensitivity < 100),

  timeframes text[] not null default '{1m,5m,15m,1h,4h,1d}',
  delivery text[] not null default '{browser}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index channels_user_id_idx on public.channels (user_id);

-- ---------------------------------------------------------------------------
-- 채널이 감시하는 종목
--
-- channels 안에 배열이나 jsonb로 넣지 않고 따로 뺐다.
--
-- detector가 매초 던지는 질문은 "이 종목을 보는 채널이 누구인가"이고,
-- 그건 종목에서 채널로 가는 역방향 조회다. 배열 안에 넣으면 여기에
-- 제대로 된 인덱스를 걸 수 없어서 매번 전체 채널을 훑게 된다.
-- 채널 수가 늘어날수록 이 비용이 선형으로 커진다.
-- ---------------------------------------------------------------------------
create table public.channel_symbols (
  channel_id uuid not null references public.channels (id) on delete cascade,
  exchange text not null default 'binance' check (exchange in ('binance', 'upbit')),
  symbol text not null,

  primary key (channel_id, exchange, symbol)
);

-- detector의 핵심 조회 경로.
create index channel_symbols_lookup_idx on public.channel_symbols (exchange, symbol);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger channels_touch_updated_at
  before update on public.channels
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 가입하면 프로필을 만든다
--
-- 클라이언트가 가입 직후 따로 insert하게 하면, 그 요청이 실패했을 때
-- 프로필 없는 계정이 남는다. 트리거로 묶어 그 틈을 없앤다.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 행 수준 보안
--
-- 웹은 anon 키로 브라우저에서 직접 질의한다. 그 키는 공개되는 값이라
-- RLS가 유일한 방어선이다. 정책 없이 테이블을 열면 누구나 남의 채널을
-- 읽을 수 있다.
--
-- detector는 service_role 키를 쓰고 RLS를 우회한다. 그 키는 서버
-- 환경변수에만 두고 브라우저로 절대 내보내지 않는다.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.channel_symbols enable row level security;

create policy "본인 프로필만 다룬다"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "본인 채널만 다룬다"
  on public.channels for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 종목 행에는 소유자가 직접 없다. 부모 채널을 거쳐 확인한다.
create policy "본인 채널의 종목만 다룬다"
  on public.channel_symbols for all
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_symbols.channel_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_symbols.channel_id and c.user_id = auth.uid()
    )
  );
