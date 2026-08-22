-- Quote reposts are authored posts, matching the social-post model used by X.
-- Keep this enum change in its own migration because PostgreSQL does not allow a
-- newly added enum value to be used safely until the transaction commits.
alter type public.post_kind add value if not exists 'human_quote';
