-- 회원제 수정(docs/decisions/0029 "수정: 학번 연결 폐지"): 학번 연결 없이 로그인한 계정마다 저장한다.
-- 운영 v1.4.1이 옛 표(account_link·saved_state)를 쓰므로 여기서는 새 표·함수만 더하고 옛 것은 지우지 않는다.
-- 운영 배포 직전에 적용한다(그 사이 옛 표에 쌓인 저장값까지 옮긴다). 옛 표·함수는 배포 뒤 다음 이전 파일에서 지운다.
create table public.account_state (
  user_id uuid primary key references auth.users (id) on delete cascade, -- 탈퇴하면 같이 지운다
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.account_state enable row level security; -- 정책 없음: 서버 함수(service role)만 쓴다
revoke all on public.account_state from anon, authenticated;

-- 지금까지 학번에 연결해 둔 계정의 저장값을 그 계정으로 옮긴다
insert into public.account_state (user_id, data, updated_at)
select l.user_id, s.data, s.updated_at from public.account_link l join public.saved_state s using (sno_key)
on conflict (user_id) do nothing;

-- 저장값과 저장 시각(없으면 둘 다 null)
create function public.account_get(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('data', s.data, 'at', s.updated_at)
  from (select 1) x left join public.account_state s on s.user_id = p_user;
$$;

create function public.account_put(p_user uuid, p_data jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.account_state (user_id, data) values (p_user, p_data)
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
$$;

revoke execute on function public.account_get(uuid), public.account_put(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.account_get(uuid), public.account_put(uuid, jsonb) to service_role;
