-- TTPU Attendance Bot — v3 migratsiya: Starosta
-- Avval migration_v2.sql ishga tushirilgan bo'lishi kerak.
-- Supabase -> SQL Editor -> shu faylni to'liq joylab "Run" bosing. Qayta ishga tushirish xavfsiz.

-- 1) Starosta — oddiy o'quvchi + o'z guruhi davomatini ko'rish huquqi
alter table public.bot_users add column if not exists is_starosta boolean not null default false;

-- 2) Guruh davomati umumiy ko'rinishi (starosta sahifasi uchun).
--    Hisob-kitob bazada qilinadi: Supabase bitta so'rovda 1000 qatordan ko'p qaytarmaydi.
create or replace function public.group_overview(p_group text, p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.lesson_sessions s where s.group_code = p_group and s.started_at <= now()),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.telegram_id::text,
               'name', u.full_name,
               'starosta', u.is_starosta,
               'attended', (select count(*) from public.attendance_records r
                              join public.lesson_sessions s on s.id = r.session_id
                             where r.telegram_id = u.telegram_id and s.group_code = p_group)
             ) order by u.full_name)
        from public.bot_users u
       where u.role = 'student' and u.group_code = p_group and u.active
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(q.x order by q.started_at desc)
        from (
          select s.started_at,
                 jsonb_build_object(
                   'id', s.id,
                   'subject', s.subject,
                   'startedAt', s.started_at,
                   'mode', s.mode,
                   'teacher', t.full_name,
                   'present', (select count(*) from public.attendance_records r where r.session_id = s.id)
                 ) as x
            from public.lesson_sessions s
            left join public.bot_users t on t.telegram_id = s.teacher_id
           where s.group_code = p_group and s.started_at <= now()
           order by s.started_at desc
           limit p_limit
        ) q
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.group_overview(text, integer) from public, anon, authenticated;
grant execute on function public.group_overview(text, integer) to service_role;
