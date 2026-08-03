-- ---------------------------------------------------------------------------
-- 민감도를 백분위에서 봉 길이로 옮긴다.
--
-- 사용자 요구가 명확했다 — 유동성 판별 기준이 특정 봉(15분)에 고정되면 안
-- 되고, 시간봉은 판정 축이 아니라 "이 위치면 이 봉급"이라는 참고 라벨이다.
-- 그래서 슬라이더가 봉 길이를 정하고 배수는 거기서 따라 나온다.
--
-- 그동안 sensitivity에는 백분위가 들어 있었고, 런타임이 백분위 → 슬라이더
-- → 배수로 두 번 변환했다. 축을 손볼 때마다 저장된 설정의 뜻이 조용히
-- 바뀌는 구조였다. 이제 판정에 쓰는 값을 그대로 저장한다.
-- ---------------------------------------------------------------------------

alter table public.channels
  add column if not exists scale text;

-- ---------------------------------------------------------------------------
-- 기존 행 옮기기
--
-- 옛 슬라이더는 1~100이었고 로그 축이었다 (꼬리 비율 0.005% ~ 10%).
-- 그 위치를 20씩 다섯 구간으로 잘라 봉에 대응시킨다. 사용자가 맞춰 둔
-- 상대적 위치(조용한 쪽인지 잦은 쪽인지)는 그대로 유지된다.
--
-- 경계가 되는 백분위는 슬라이더 20/40/60/80 지점이다:
--   tail = 0.005 * 2000 ^ ((s - 1) / 99),  percentile = 100 - tail
--
-- packages/core의 percentileToScale()이 같은 경계를 쓴다.
-- 한쪽만 고치면 화면과 저장이 어긋난다.
-- ---------------------------------------------------------------------------
update public.channels
set scale = case
  when sensitivity >= 99.9785 then '4h'
  when sensitivity >= 99.9002 then '1h'
  when sensitivity >= 99.5360 then '15m'
  when sensitivity >= 97.8454 then '5m'
  else '1m'
end
where scale is null;

alter table public.channels
  alter column scale set default '15m';

update public.channels set scale = '15m' where scale is null;

alter table public.channels
  alter column scale set not null;

-- 1일봉은 없다. 하루치 거래대금은 어떤 사건이 와도 평소의 3배가 되지
-- 않는다 — 61일 동안 대형주 3종목에서 한 번도 없었고, 배수를 1.1배까지
-- 내려도 하루 0.12회다. 하루를 통째로 합치면 급등이 평균에 묻힌다.
alter table public.channels
  add constraint channels_scale_check
  check (scale in ('1m', '5m', '15m', '1h', '4h'));

-- ---------------------------------------------------------------------------
-- 옛 컬럼
--
-- 지우지 않고 null 허용으로만 바꾼다. 배포 중에는 옛 코드와 새 코드가
-- 잠깐 같이 도는데, 컬럼이 사라지면 옛 코드의 insert가 통째로 실패한다.
-- 읽는 곳이 없어진 뒤 다음 마이그레이션에서 지운다.
-- ---------------------------------------------------------------------------
alter table public.channels
  alter column sensitivity drop not null;

alter table public.channels
  alter column sensitivity drop default;

comment on column public.channels.sensitivity is
  '폐기 예정. 봉 길이(scale)로 대체됨. 0003 이전 행의 원본값 보존용.';

comment on column public.channels.scale is
  '판정에 쓰는 창 길이. 배수는 core의 SENSITIVITY_SCALES에서 따라 나온다.';
