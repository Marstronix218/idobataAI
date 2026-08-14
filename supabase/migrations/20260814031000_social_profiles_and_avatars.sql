alter table public.user_profiles
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists profile_visibility public.post_visibility not null default 'private';

alter table public.user_profiles
  drop constraint if exists user_profiles_display_name_length,
  add constraint user_profiles_display_name_length check (display_name is null or char_length(display_name) <= 50),
  drop constraint if exists user_profiles_bio_length,
  add constraint user_profiles_bio_length check (bio is null or char_length(bio) <= 160);

grant update(display_name, bio, profile_visibility) on public.user_profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatar_objects_insert_own on storage.objects;
create policy avatar_objects_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists avatar_objects_delete_own on storage.objects;
create policy avatar_objects_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
