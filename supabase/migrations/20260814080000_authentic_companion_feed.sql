-- A new community should begin empty rather than simulating human activity with
-- an all-AI starter feed. Companions remain available in their directory, and a
-- small rotating cast may contribute clearly labeled completions each day.
delete from public.social_posts
where companion_id is not null
  and source_key like 'starter-completion:%';

create or replace function public.schedule_companion_posts(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c record;
  inserted integer := 0;
  template text;
  scheduled_at timestamptz;
  minute_offset integer;
  primary_interest text;
begin
  for c in
    select *
    from public.social_companions
    where active and posting_frequency > 0
    order by hashtextextended(id::text || ':cast:' || p_date::text, 0)
    limit 4
  loop
    template := coalesce(
      c.daily_templates[1 + ((hashtextextended(c.id::text || ':template:' || p_date::text, 0) & 9223372036854775807) % cardinality(c.daily_templates))::integer],
      c.name || ' completed one focused task today.'
    );
    minute_offset := ((hashtextextended(c.id::text || ':time:' || p_date::text, 0) & 9223372036854775807) % 1020)::integer;
    scheduled_at := p_date::timestamptz + interval '6 hours' + make_interval(mins => minute_offset);
    primary_interest := coalesce(nullif(c.interests[1], ''), 'daily');

    insert into public.social_posts(
      companion_id, kind, visibility, content, task_title, category,
      xp_earned, completed_at, source_key, is_ai_generated, created_at
    ) values (
      c.id, 'ai_completion', 'public', template,
      'Complete today''s ' || primary_interest || ' task', initcap(primary_interest),
      10 + (minute_offset % 4) * 5, scheduled_at,
      'daily-completion:' || c.id::text || ':' || p_date::text,
      true, scheduled_at
    )
    on conflict(companion_id, source_key)
      where companion_id is not null and source_key is not null do nothing;
    if found then inserted := inserted + 1; end if;
  end loop;
  return inserted;
end $$;
