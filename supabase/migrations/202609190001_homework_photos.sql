begin;

-- Совместимое расширение: старые задания получают пустой список фотографий.
create function public.valid_homework_photos(paths text[])
returns boolean language sql immutable set search_path = '' as $$
  select paths is not null and cardinality(paths) <= 4
    and coalesce(array_ndims(paths), 1) = 1
    and not exists (
      select 1 from unnest(paths) p where p is null
        or p !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    )
    and cardinality(paths) = (select count(distinct p) from unnest(paths) p);
$$;
revoke all on function public.valid_homework_photos(text[]) from public;
grant execute on function public.valid_homework_photos(text[]) to anon, authenticated;

alter table public.assignments add column photo_paths text[] not null default '{}'
  check (public.valid_homework_photos(photo_paths));
grant insert(photo_paths), update(photo_paths) on public.assignments to authenticated;

-- Только изображения, не HTML/SVG; имена не содержат фамилий и исходных имён файлов.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('homework-photos', 'homework-photos', true, 5242880, array['image/jpeg']);

create policy homework_photo_upload on storage.objects for insert to authenticated
with check (bucket_id = 'homework-photos' and (select public.is_class_teacher())
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');
create policy homework_photo_manage_read on storage.objects for select to authenticated
using (bucket_id = 'homework-photos' and (select public.is_class_teacher()));
-- Нет UPDATE: опубликованную фотографию нельзя незаметно заменить по прежнему URL.
-- Нельзя удалить объект, пока на него ссылается хотя бы одно задание.
create policy homework_photo_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'homework-photos' and (select public.is_class_teacher())
  and not exists (select 1 from public.assignments a where objects.name = any(a.photo_paths)));

commit;
