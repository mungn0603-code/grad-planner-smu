-- 샘물 가져오기 시도 횟수(api/smul.ts, docs/ARCHITECTURE.md §6-5).
-- k는 HMAC(서버 비밀값, 'id:학번' 또는 'ip:IP')의 16진수. 학번·IP 원문은 저장하지 않는다. 행은 until이 지나면 다음 호출 때 지운다.
create table public.smul_try (
  k text primary key,
  n int not null,
  until timestamptz not null
);
alter table public.smul_try enable row level security; -- 정책 없음: anon·authenticated는 못 읽고 못 쓴다
revoke all on public.smul_try from anon, authenticated;

-- 시도 한 번: 만료된 행을 지우고 p_key의 횟수를 1 올려 돌려준다. 창은 첫 시도부터 p_sec초.
-- 샘물에 요청하기 전에 부르므로 동시 요청도 하나씩 센다(on conflict가 행을 잠근다)
create function public.smul_try(p_key text, p_sec int) returns int
language sql security definer set search_path = '' as $$
  delete from public.smul_try where until < now();
  insert into public.smul_try as t (k, n, until) values (p_key, 1, now() + make_interval(secs => p_sec))
  on conflict (k) do update set n = t.n + 1
  returning t.n;
$$;

-- 가져오기 성공: 학번 키를 지운다
create function public.smul_ok(p_key text) returns void
language sql security definer set search_path = '' as $$
  delete from public.smul_try where k = p_key;
$$;

revoke execute on function public.smul_try(text, int), public.smul_ok(text) from public, anon, authenticated;
grant execute on function public.smul_try(text, int), public.smul_ok(text) to service_role;
