-- Reduce original persona posts without changing replies, reactions, or reposts.
update public.social_companions
set posting_frequency = 4
where active;
