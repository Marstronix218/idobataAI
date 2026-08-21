begin;

revoke execute on function public.check_rate_limit(text, integer, integer, text)
from public, anon, authenticated;

grant execute on function public.check_rate_limit(text, integer, integer, text)
to service_role;

commit;
