set local lock_timeout = '5s';

-- `npm run content:seed` links each launch character to its persona's art by
-- looking up social_companions.slug with the service role. A fresh project no
-- longer grants service_role anything on legacy tables by default, so grant
-- only the two columns that lookup reads. Granting a held privilege is a no-op.
grant select (id, slug) on public.social_companions to service_role;
