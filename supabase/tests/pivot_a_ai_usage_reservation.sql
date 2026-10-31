begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Atomic AI cap reservation (reserve_ai_usage / release_ai_usage) and the
-- daily limit on coach time zone changes.

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e5e5e5e5-1111-4111-8111-e5e5e5e5e5e5','authenticated','authenticated','usage-u@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"usage_u"}',now(),now()),
  ('f6f6f6f6-1111-4111-8111-f6f6f6f6f6f6','authenticated','authenticated','usage-v@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"usage_v"}',now(),now());

-- ---------------------------------------------------------------------------
-- Structure: service role only.
-- ---------------------------------------------------------------------------

do $$
declare offenders text;
begin
  select string_agg(f, ', ') into offenders
  from unnest(array[
    'public.reserve_ai_usage(uuid,text,date,integer,integer,integer)',
    'public.release_ai_usage(uuid,text,date)'
  ]) f
  where has_function_privilege('anon', f, 'EXECUTE')
     or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE');
  if offenders is not null then raise exception 'usage reservation grants are not service-role only: %', offenders; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname in ('reserve_ai_usage','release_ai_usage')
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute a usage reservation function'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('reserve_ai_usage','release_ai_usage')
      and not (p.prosecdef and p.proconfig @> array['search_path=""'])
  ) then raise exception 'usage reservation functions must be security definer with an empty search_path'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5e5e5e5-1111-4111-8111-e5e5e5e5e5e5';
do $$
declare state text;
begin
  begin
    perform public.reserve_ai_usage('e5e5e5e5-1111-4111-8111-e5e5e5e5e5e5','reaction','2099-05-10',1,100,100);
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'authenticated could call reserve_ai_usage (got %)', state; end if;
  state := null;
  begin
    perform public.release_ai_usage('e5e5e5e5-1111-4111-8111-e5e5e5e5e5e5','reaction','2099-05-10');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'authenticated could call release_ai_usage (got %)', state; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Cap, no write when refused, kind isolation, release and the attempt ceiling.
-- ---------------------------------------------------------------------------

set local role service_role;

do $$
declare
  u constant uuid := 'e5e5e5e5-1111-4111-8111-e5e5e5e5e5e5';
  d constant date := '2099-05-10';
  usage public.ai_usage_daily;
  version_before text;
  state text;
begin
  if not public.reserve_ai_usage(u,'reaction',d,1,2,5) then raise exception 'the first reservation under the cap was refused'; end if;
  select * into usage from public.ai_usage_daily where user_id=u and date=d;
  if (usage.reactions, usage.reaction_attempts, usage.splits, usage.split_attempts) <> (1,1,0,0) then
    raise exception 'a reservation did not claim one reaction and one attempt: %', row_to_json(usage);
  end if;

  if not public.reserve_ai_usage(u,'reaction',d,1,2,5) then raise exception 'the second reservation under the cap was refused'; end if;
  select xmin::text into version_before from public.ai_usage_daily where user_id=u and date=d;
  if public.reserve_ai_usage(u,'reaction',d,1,2,5) then raise exception 'a reservation at the cap was granted'; end if;
  select * into usage from public.ai_usage_daily where user_id=u and date=d;
  if (usage.reactions, usage.reaction_attempts) <> (2,2)
    or (select xmin::text from public.ai_usage_daily where user_id=u and date=d) <> version_before
  then raise exception 'a refused reservation wrote to the usage row: %', row_to_json(usage); end if;

  -- Splits have their own cap and counters.
  if not public.reserve_ai_usage(u,'split',d,1,1,5) then raise exception 'a split was refused because of the reaction cap'; end if;
  if public.reserve_ai_usage(u,'split',d,1,1,5) then raise exception 'a split at its cap was granted'; end if;
  select * into usage from public.ai_usage_daily where user_id=u and date=d;
  if (usage.reactions, usage.reaction_attempts, usage.splits, usage.split_attempts) <> (2,2,1,1) then
    raise exception 'reaction and split counters are not isolated: %', row_to_json(usage);
  end if;
  perform public.release_ai_usage(u,'split',d);
  select * into usage from public.ai_usage_daily where user_id=u and date=d;
  if (usage.reactions, usage.reaction_attempts, usage.splits, usage.split_attempts) <> (2,2,0,1) then
    raise exception 'releasing a split touched more than the delivered split count: %', row_to_json(usage);
  end if;

  -- Release gives back delivered units only, never below zero.
  perform public.release_ai_usage(u,'reaction',d);
  perform public.release_ai_usage(u,'reaction',d);
  perform public.release_ai_usage(u,'reaction',d);
  select * into usage from public.ai_usage_daily where user_id=u and date=d;
  if (usage.reactions, usage.reaction_attempts) <> (0,2) then
    raise exception 'release did not decrement delivered only, floored at 0: %', row_to_json(usage);
  end if;

  -- Delivered is 0 after the releases, but two attempts reach a ceiling of 2.
  if public.reserve_ai_usage(u,'reaction',d,1,10,2) then raise exception 'the attempt ceiling did not block a reservation'; end if;
  if not public.reserve_ai_usage(u,'reaction',d,1,10,3) then raise exception 'a reservation under both limits was refused'; end if;

  -- Releasing a date with no row creates nothing.
  perform public.release_ai_usage(u,'reaction','2099-05-11');
  if exists(select 1 from public.ai_usage_daily where user_id=u and date='2099-05-11') then
    raise exception 'release created a usage row';
  end if;

  foreach state in array array['unknown kind','null cap','zero window'] loop
    declare got text;
    begin
      begin
        case state
          when 'unknown kind' then perform public.reserve_ai_usage(u,'chat',d,1,10,10);
          when 'null cap' then perform public.reserve_ai_usage(u,'reaction',d,1,null,10);
          else perform public.reserve_ai_usage(u,'reaction',d,0,10,10);
        end case;
      exception when others then get stacked diagnostics got = returned_sqlstate;
      end;
      if got is distinct from '22023' then raise exception 'reserve_ai_usage with % did not raise 22023 (got %)', state, got; end if;
    end;
  end loop;
  begin
    perform public.release_ai_usage(u,'chat',d);
    raise exception 'release_ai_usage accepted an unknown kind';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- The window is the p_window_days dates ending at p_date.
do $$
declare v constant uuid := 'f6f6f6f6-1111-4111-8111-f6f6f6f6f6f6';
begin
  if not public.reserve_ai_usage(v,'reaction','2099-06-01',1,10,10) then raise exception 'window setup failed (06-01)'; end if;
  if not public.reserve_ai_usage(v,'reaction','2099-06-03',1,10,10) then raise exception 'window setup failed (06-03)'; end if;
  if public.reserve_ai_usage(v,'reaction','2099-06-03',3,2,10) then
    raise exception 'a 3-day window ending 06-03 did not count 06-01';
  end if;
  if not public.reserve_ai_usage(v,'reaction','2099-06-03',2,2,10) then
    raise exception 'a 2-day window ending 06-03 counted 06-01';
  end if;
  if public.reserve_ai_usage(v,'reaction','2099-06-04',2,2,10) then
    raise exception 'a 2-day window ending 06-04 did not count 06-03';
  end if;
  if not public.reserve_ai_usage(v,'reaction','2099-06-05',2,2,10) then
    raise exception 'a 2-day window ending 06-05 counted 06-03';
  end if;
  if (select sum(reactions) from public.ai_usage_daily where user_id=v) <> 4 then
    raise exception 'the window test claimed the wrong number of reactions';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- set_coach_profile: at most three time zone changes a day; saving the stored
-- zone again does not count.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5e5e5e5-1111-4111-8111-e5e5e5e5e5e5';

do $$
declare i integer; state text; msg text;
begin
  perform public.set_coach_profile(null, 'America/Los_Angeles');
  perform public.set_coach_profile(null, 'America/New_York');
  perform public.set_coach_profile(null, 'Asia/Tokyo');
  for i in 1..5 loop
    perform public.set_coach_profile(null, 'Asia/Tokyo');
  end loop;

  begin
    perform public.set_coach_profile(null, 'Europe/London');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'rate limit exceeded' then
    raise exception 'a fourth time zone change in a day was not rate limited (got % %)', state, msg;
  end if;
  if (select timezone from public.user_coach_profiles) <> 'Asia/Tokyo' then
    raise exception 'a rate-limited time zone change was saved';
  end if;
  if (public.set_coach_profile(null, 'Asia/Tokyo')).timezone <> 'Asia/Tokyo' then
    raise exception 'saving the stored time zone after the limit was refused';
  end if;
end $$;

reset role;

select extensions.pass('AI usage reservation and time zone change limits hold');
select * from extensions.finish();

rollback;
