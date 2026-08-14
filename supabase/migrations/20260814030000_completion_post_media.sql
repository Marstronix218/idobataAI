alter table public.social_posts
  add column if not exists image_paths text[] not null default '{}'::text[];

alter table public.social_posts
  drop constraint if exists social_posts_image_paths_limit;

alter table public.social_posts
  add constraint social_posts_image_paths_limit
  check (
    cardinality(image_paths) <= 4
    and array_position(image_paths, null) is null
  );

comment on column public.social_posts.image_paths is
  'Opaque paths in the private completion-post-media bucket. Signed URLs are generated only after post visibility is authorized.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'completion-post-media',
  'completion-post-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload and signing stay behind authenticated application routes. No direct
-- storage.objects policies are created; the server-only key is the sole writer.
