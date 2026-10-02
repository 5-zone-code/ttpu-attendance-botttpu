-- TTPU Attendance Bot — v2 migratsiya
-- Supabase -> SQL Editor -> shu faylni to'liq joylab "Run" bosing (bir marta).
-- Qayta ishga tushirish xavfsiz (idempotent).

-- 1) Rollar: student / teacher / admin / owner
alter table public.bot_users drop constraint if exists bot_users_role_check;
alter table public.bot_users add constraint bot_users_role_check
  check (role in ('student', 'teacher', 'admin', 'owner'));

-- Ustoz uchun: EduPage dagi o'qituvchi ID si va dars beradigan fanlari
alter table public.bot_users add column if not exists edupage_teacher_id text;
alter table public.bot_users add column if not exists subjects text[] not null default '{}';
alter table public.bot_users add column if not exists added_by bigint;

-- 2) Guruhlar (sinflar) — nomi EduPage dagi bilan bir xil
create table if not exists public.groups (
  code             text primary key,
  edupage_class_id text,
  created_by       bigint,
  created_at       timestamptz not null default now()
);
insert into public.groups (code) values ('CYB3-26') on conflict (code) do nothing;
-- mavjud talabalarning guruhlari ham ro'yxatga tushsin
insert into public.groups (code)
  select distinct group_code from public.bot_users where group_code is not null
on conflict (code) do nothing;

-- 3) Dars sessiyalari: ustoz, rejim, o'quvchilar soni chegarasi
alter table public.lesson_sessions add column if not exists teacher_id bigint;
alter table public.lesson_sessions add column if not exists mode text not null default 'qr';
alter table public.lesson_sessions add column if not exists max_students integer;
alter table public.lesson_sessions add column if not exists closed_at timestamptz;
create index if not exists lesson_sessions_teacher_idx on public.lesson_sessions (teacher_id, started_at desc);

-- 4) Davomat: qanday belgilangani (qr / manual) va kim belgilagani
alter table public.attendance_records add column if not exists method text not null default 'qr';
alter table public.attendance_records add column if not exists marked_by bigint;

-- 5) Vazifalar
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  group_code   text not null,
  teacher_id   bigint not null,
  teacher_name text,
  subject      text not null,
  description  text not null,
  file_path    text,
  file_name    text,
  file_size    bigint,
  file_mime    text,
  status       text not null default 'active' check (status in ('active', 'done')),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_group_idx on public.tasks (group_code, created_at desc);
create index if not exists tasks_teacher_idx on public.tasks (teacher_id, created_at desc);

-- 6) Umumiy sozlamalar (masalan joylashuv tekshiruvi)
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by bigint,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('geofence_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- 7) Ega (owner)
insert into public.bot_users (telegram_id, full_name, role)
values (7317966615, 'Ega', 'owner')
on conflict (telegram_id) do update set role = 'owner';

-- 8) Davomatni atomik belgilash: sessiya ochiq, joy bor, takror emas.
--    Oxirgi o'quvchi belgilanganda sessiya avtomatik yopiladi.
create or replace function public.mark_attendance(
  p_session uuid, p_user bigint,
  p_lat float8, p_lon float8, p_acc float8, p_dist integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.lesson_sessions%rowtype;
  n integer;
begin
  select * into s from public.lesson_sessions where id = p_session for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if exists (select 1 from public.attendance_records where session_id = p_session and telegram_id = p_user) then
    return jsonb_build_object('ok', true, 'already', true, 'subject', s.subject);
  end if;
  select count(*) into n from public.attendance_records where session_id = p_session;
  if s.max_students is not null and n >= s.max_students then
    update public.lesson_sessions set closed_at = now() where id = p_session and closed_at is null;
    return jsonb_build_object('ok', false, 'error', 'session_full');
  end if;
  if s.closed_at is not null or now() > s.ends_at then
    return jsonb_build_object('ok', false, 'error', 'session_closed');
  end if;
  insert into public.attendance_records (session_id, telegram_id, lat, lon, accuracy, distance_m, method)
  values (p_session, p_user, p_lat, p_lon, p_acc, p_dist, 'qr');
  n := n + 1;
  if s.max_students is not null and n >= s.max_students then
    update public.lesson_sessions set closed_at = now() where id = p_session;
  end if;
  return jsonb_build_object('ok', true, 'subject', s.subject, 'count', n, 'max', s.max_students);
end;
$$;
revoke all on function public.mark_attendance(uuid, bigint, float8, float8, float8, integer) from public, anon, authenticated;
grant execute on function public.mark_attendance(uuid, bigint, float8, float8, float8, integer) to service_role;

-- 9) RLS: yangi jadvallar ham faqat server (service key) orqali
alter table public.groups       enable row level security;
alter table public.tasks        enable row level security;
alter table public.app_settings enable row level security;

-- 10) Vazifa fayllari uchun yopiq (private) storage bucket, 25 MB gacha
insert into storage.buckets (id, name, public, file_size_limit)
values ('tasks', 'tasks', false, 26214400)
on conflict (id) do nothing;
