-- 회원제(docs/decisions/0029): 구글·카카오 로그인 계정 ↔ 학번 연결, 학번에 붙인 저장값.
-- sno_key는 HMAC(SMUL_KEY_SECRET, 'acct:'+학번)의 16진수. 학번 원문은 저장하지 않는다(0009).
-- 브라우저는 이 표를 직접 부르지 않는다. 서버 함수(api/account.ts)가 service role로 아래 함수만 부른다.
create table public.account_link (
  sno_key text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade, -- 계정 하나에 학번 하나. 탈퇴하면 같이 지운다
  linked_at timestamptz not null default now()
);
create table public.saved_state (
  sno_key text primary key references public.account_link (sno_key) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.account_link enable row level security; -- 정책 없음: anon·authenticated는 못 읽고 못 쓴다
alter table public.saved_state enable row level security;
revoke all on public.account_link, public.saved_state from anon, authenticated;

-- 샘물 로그인에 성공한 계정을 그 학번에 연결한다. 이 계정의 다른 학번 연결(과 그 저장값)은 지우고,
-- 같은 학번이 다른 계정에 있으면 이 계정으로 옮긴다(나중에 성공한 쪽 우선)
create function public.account_link(p_key text, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.account_link where user_id = p_user and sno_key <> p_key;
  insert into public.account_link (sno_key, user_id) values (p_key, p_user)
  on conflict (sno_key) do update set user_id = excluded.user_id, linked_at = now();
$$;

-- 연결 여부와 저장값
create function public.account_load(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('linked', l.sno_key is not null, 'data', s.data, 'at', s.updated_at)
  from (select 1) x
  left join public.account_link l on l.user_id = p_user
  left join public.saved_state s on s.sno_key = l.sno_key;
$$;

-- 저장. 연결이 없으면 false
create function public.account_save(p_user uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  select sno_key into k from public.account_link where user_id = p_user;
  if k is null then return false; end if;
  insert into public.saved_state (sno_key, data) values (k, p_data)
  on conflict (sno_key) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

revoke execute on function public.account_link(text, uuid), public.account_load(uuid), public.account_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.account_link(text, uuid), public.account_load(uuid), public.account_save(uuid, jsonb) to service_role;
