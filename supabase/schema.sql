-- TTPU Attendance Bot — Supabase schema
-- Supabase Dashboard -> SQL Editor -> shu faylni to'liq joylab "Run" bosing.

create extension if not exists pgcrypto;

-- 1) Ruxsat berilgan foydalanuvchilar (oq ro'yxat)
create table if not exists public.bot_users (
  telegram_id      bigint primary key,
  full_name        text not null,
  role             text not null check (role in ('student', 'teacher', 'admin')),
  group_code       text,
  face_descriptor  float8[],            -- 128 ta son (rasm EMAS), faqat server o'qiydi
  face_enrolled_at timestamptz,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- 2) Dars sessiyalari (o'qituvchi QR ko'rsatgan har bir dars)
create table if not exists public.lesson_sessions (
  id          uuid primary key default gen_random_uuid(),
  group_code  text not null,
  subject     text not null,
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists lesson_sessions_group_idx on public.lesson_sessions (group_code, started_at);

-- 3) Davomat yozuvlari
create table if not exists public.attendance_records (
  id           bigserial primary key,
  session_id   uuid not null references public.lesson_sessions(id) on delete cascade,
  telegram_id  bigint not null references public.bot_users(telegram_id) on delete cascade,
  marked_at    timestamptz not null default now(),
  lat          float8,
  lon          float8,
  accuracy     float8,
  distance_m   integer,
  unique (session_id, telegram_id)
);
create index if not exists attendance_records_user_idx on public.attendance_records (telegram_id, marked_at desc);

-- 4) Rad etilgan urinishlar (hududdan tashqarida, eski QR, va h.k.) — nazorat uchun
create table if not exists public.attendance_attempts (
  id          bigserial primary key,
  telegram_id bigint,
  session_id  uuid,
  reason      text not null,
  distance_m  integer,
  created_at  timestamptz not null default now()
);

-- 5) Face ID urinishlari jurnali
create table if not exists public.face_logs (
  id          bigserial primary key,
  telegram_id bigint,
  kind        text not null,
  ok          boolean not null,
  distance    float8,
  created_at  timestamptz not null default now()
);

-- XAVFSIZLIK: RLS yoqiladi va hech qanday policy berilmaydi.
-- Natijada anon (public) kalit bilan HECH NARSA o'qib/yozib bo'lmaydi.
-- Faqat Vercel serveridagi service_role kalit ishlaydi.
alter table public.bot_users           enable row level security;
alter table public.lesson_sessions     enable row level security;
alter table public.attendance_records  enable row level security;
alter table public.attendance_attempts enable row level security;
alter table public.face_logs           enable row level security;

-- Boshlang'ich talabalar
insert into public.bot_users (telegram_id, full_name, role, group_code) values
  (5491931116, 'Subxonov Maqsud',       'student', 'CYB3-26'),
  (8712189674, 'Ismonaliyev Behruzbek', 'student', 'CYB3-26'),
  (8057331173, 'Aliakbar Mominjonov',   'student', 'CYB3-26')
on conflict (telegram_id) do update
  set full_name = excluded.full_name, role = excluded.role, group_code = excluded.group_code;

-- ---------------------------------------------------------------
-- Foydali buyruqlar:
-- Yangi talaba qo'shish:
--   insert into bot_users (telegram_id, full_name, role, group_code)
--   values (123456789, 'Familiya Ism', 'student', 'CYB3-26');
-- Talabaning Face ID sini qayta o'rnatish (telefon/yuz o'zgarsa):
--   update bot_users set face_descriptor = null, face_enrolled_at = null where telegram_id = 5491931116;
-- Botni bloklash:
--   update bot_users set active = false where telegram_id = 123;
-- ---------------------------------------------------------------
