-- PostgREST resolves embedded resources from its schema cache. Refresh it after
-- introducing the named social_posts self-relationship used by feed queries.
notify pgrst, 'reload schema';
