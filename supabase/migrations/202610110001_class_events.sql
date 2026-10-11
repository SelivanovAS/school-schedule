begin;
create table public.events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('event', 'test', 'announcement')),
  title text not null check (char_length(trim(title)) between 1 and 150),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  event_date date check (event_date between date '2020-01-01' and date '2100-12-31'),
  time_text text not null default '' check (char_length(time_text) <= 300),
  location text not null default '' check (char_length(location) <= 500),
  cost text not null default '' check (char_length(cost) <= 200),
  payment text not null default '' check (char_length(payment) <= 3000),
  photo_paths text[] not null default '{}' check (public.valid_homework_photos(photo_paths)),
  cancelled boolean not null default false,
  archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'announcement' or event_date is not null)
);
create index events_active_date_idx on public.events(event_date, created_at desc, id desc) where not archived;
create index events_created_idx on public.events(created_at desc, id desc) where event_date is null;
create index events_archive_idx on public.events(archived, event_date desc, created_at desc, id desc);
alter table public.events enable row level security;
revoke all on public.events from public, anon, authenticated;
grant select on public.events to anon, authenticated;
grant insert(id, kind, title, body, event_date, time_text, location, cost, payment, photo_paths, cancelled, archived) on public.events to authenticated;
grant update(kind, title, body, event_date, time_text, location, cost, payment, photo_paths, cancelled, archived) on public.events to authenticated;
grant delete on public.events to authenticated;
create policy events_read on public.events for select to anon, authenticated using (true);
create policy events_insert on public.events for insert to authenticated with check ((select public.is_class_teacher()));
create policy events_update on public.events for update to authenticated using ((select public.is_class_teacher())) with check ((select public.is_class_teacher()));
create policy events_delete on public.events for delete to authenticated using ((select public.is_class_teacher()));
create function school_private.stamp_event() returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id; new.created_at := old.created_at;
  new.version := old.version + 1; new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function school_private.stamp_event() from public, anon, authenticated;
create trigger events_stamp before update on public.events for each row execute function school_private.stamp_event();
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', true, 5242880, array['image/jpeg']);
create policy event_photo_upload on storage.objects for insert to authenticated
with check (bucket_id = 'event-photos' and (select public.is_class_teacher())
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');
create policy event_photo_manage_read on storage.objects for select to authenticated
using (bucket_id = 'event-photos' and (select public.is_class_teacher()));
create policy event_photo_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'event-photos' and (select public.is_class_teacher())
  and not exists (select 1 from public.events e where objects.name = any(e.photo_paths)));
commit;
