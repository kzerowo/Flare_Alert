-- ---------------------------------------------------------------------------
-- 민감도를 다섯 칸에서 1~100 연속 축으로 옮긴다.
--
-- 0003이 슬라이더를 봉 길이로 만들면서 선택지가 다섯 개로 줄었다. 그 다섯
-- 개가 너무 성겼다 — 15분봉(하루 4.2회)에서 5분봉(하루 10회)으로 한 칸에
-- 2.4배가 뛰는데, 그 사이를 원하는 사용자가 갈 자리가 없었다.
--
-- 이제 슬라이더는 1~100이다. 봉 길이는 여전히 다섯 개 중 하나로 붙지만
-- (집계기가 종목당 여섯 프레임만 계산하므로 임의 길이 창은 쓸 수 없다),
-- 구간 안에서 배수가 연속으로 움직인다. 알림 빈도를 실제로 정하는 것은
-- 배수라서, 사용자가 보는 값은 전 구간에서 연속이다.
--
-- 구간은 20칸씩 다섯 개이고, 각 구간의 오른쪽 끝이 실측 앵커다:
--   1~20 4h(20=3.0배)   21~40 1h(40=3.4배)   41~60 15m(60=3.6배)
--   61~80 5m(80=4.5배)  81~100 1m(100=8.4배)
--
-- packages/core의 levelForScale()이 같은 앵커를 쓴다. 한쪽만 고치면
-- 저장된 설정의 뜻이 조용히 바뀐다.
-- ---------------------------------------------------------------------------

alter table public.channels
  add column if not exists sensitivity_level integer;

-- ---------------------------------------------------------------------------
-- 기존 행 옮기기
--
-- 봉 길이를 그 봉의 앵커 위치로 옮긴다. 앵커는 구간의 오른쪽 끝이므로
-- 옮긴 뒤에도 배수와 실측 빈도가 그대로다 — 사용자가 맞춰 둔 설정이
-- 이사 때문에 달라지지 않는다.
-- ---------------------------------------------------------------------------
update public.channels
set sensitivity_level = case scale
  when '4h' then 20
  when '1h' then 40
  when '15m' then 60
  when '5m' then 80
  when '1m' then 100
  else 60
end
where sensitivity_level is null;

alter table public.channels
  alter column sensitivity_level set default 60;

update public.channels
set sensitivity_level = 60
where sensitivity_level is null;

alter table public.channels
  alter column sensitivity_level set not null;

alter table public.channels
  add constraint channels_sensitivity_level_check
  check (sensitivity_level between 1 and 100);

-- ---------------------------------------------------------------------------
-- 옛 컬럼
--
-- 0003과 같은 이유로 지우지 않는다. 배포 중에는 옛 코드와 새 코드가 잠깐
-- 같이 도는데, scale이 not null인 채로 남아 있어야 옛 코드의 insert가
-- 살아남는다. 읽는 곳이 없어진 뒤 다음 마이그레이션에서 지운다.
--
-- 그래서 not null만 푼다. 새 코드는 scale을 쓰지 않으므로 채워 넣지 않고,
-- 옛 코드는 계속 채워 넣는다.
-- ---------------------------------------------------------------------------
alter table public.channels
  alter column scale drop not null;

comment on column public.channels.scale is
  '폐기 예정. 민감도 위치(sensitivity_level)로 대체됨. 0004 이전 행 보존용.';

comment on column public.channels.sensitivity_level is
  '민감도 슬라이더 위치 1~100. 창 길이와 배수가 core의 sensitivityAt()에서 함께 나온다.';
