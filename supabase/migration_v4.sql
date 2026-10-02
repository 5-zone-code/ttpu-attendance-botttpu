-- TTPU Attendance Bot — v4 migratsiya: o'quvchining o'zi ro'yxatdan o'tishi
-- Supabase -> SQL Editor -> shu faylni to'liq joylab "Run" bosing (bir marta).
-- Qayta ishga tushirish xavfsiz (idempotent). Oldin schema.sql, migration_v2.sql, migration_v3.sql bajarilgan bo'lishi kerak.

-- 1) Arizalar: ro'yxatda yo'q odam botni ochib ism-familiya va guruhini yuboradi.
--    status: pending (admin kutilmoqda) / approved (o'quvchi qo'shildi) / rejected (rad etildi)
create table if not exists public.registrations (
  telegram_id  bigint primary key,
  full_name    text not null,
  group_code   text not null references public.groups (code) on delete cascade,
  tg_username  text,
  tg_name      text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  decided_by   bigint,
  decided_at   timestamptz
);
create index if not exists registrations_status_idx on public.registrations (status, created_at desc);

-- Faqat server (service key) o'qiy/yoza oladi — boshqa jadvallar kabi
alter table public.registrations enable row level security;

-- 2) Ro'yxatdan o'tish rejimi:
--    "approve" — admin tasdiqlaydi (standart)
--    "auto"    — darhol qo'shiladi
--    "off"     — o'chirilgan, faqat admin qo'shadi (eski tartib)
insert into public.app_settings (key, value) values ('registration_mode', '"approve"'::jsonb)
on conflict (key) do nothing;
