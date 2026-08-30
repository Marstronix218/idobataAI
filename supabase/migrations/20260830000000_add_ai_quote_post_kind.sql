-- A persona quote repost is an authored post in the persona's own feed, the
-- same shape `human_quote` already uses. This stays in its own migration
-- because PostgreSQL refuses to use a newly added enum value until the adding
-- transaction has committed.
alter type public.post_kind add value if not exists 'ai_quote';
