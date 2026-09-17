begin;

-- Закрытая таблица допускает ровно одного назначенного учителя.
create schema if not exists school_private;
revoke all on schema school_private from public, anon, authenticated;
create table school_private.teacher (
  slot smallint primary key default 1 check (slot = 1),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table school_private.teacher enable row level security;
revoke all on school_private.teacher from public, anon, authenticated;

create function public.is_class_teacher()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from school_private.teacher where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_class_teacher() from public, anon;
grant execute on function public.is_class_teacher() to authenticated;

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (char_length(trim(subject)) between 1 and 100),
  body text not null check (char_length(trim(body)) between 1 and 6000),
  due_date date not null check (due_date between date '2020-01-01' and date '2100-12-31'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_due_date_idx on public.assignments(due_date desc, id desc);
alter table public.assignments enable row level security;
revoke all on public.assignments from public, anon, authenticated;
grant select on public.assignments to anon, authenticated;
grant insert(subject, body, due_date), update(subject, body, due_date) on public.assignments to authenticated;
grant delete on public.assignments to authenticated;

create policy assignments_read on public.assignments
  for select to anon, authenticated using (true);
create policy assignments_teacher_insert on public.assignments
  for insert to authenticated with check ((select public.is_class_teacher()));
create policy assignments_teacher_update on public.assignments
  for update to authenticated using ((select public.is_class_teacher()))
  with check ((select public.is_class_teacher()));
create policy assignments_teacher_delete on public.assignments
  for delete to authenticated using ((select public.is_class_teacher()));

-- Версию устанавливает сервер: новое содержание сбрасывает личную отметку «Сделано».
create function school_private.stamp_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function school_private.stamp_assignment() from public, anon, authenticated;
create trigger assignments_stamp before update on public.assignments
  for each row execute function school_private.stamp_assignment();

commit;
