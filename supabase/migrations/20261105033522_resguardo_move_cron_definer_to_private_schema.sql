
ALTER FUNCTION public.resguardo_push_due(text) SET SCHEMA resguardo_private;
ALTER FUNCTION public.resguardo_push_mark_sent(text,uuid) SET SCHEMA resguardo_private;
ALTER FUNCTION public.resguardo_push_disable(text,uuid) SET SCHEMA resguardo_private;
GRANT USAGE ON SCHEMA resguardo_private TO anon;
REVOKE ALL ON FUNCTION resguardo_private.resguardo_push_due(text) FROM PUBLIC,authenticated;
REVOKE ALL ON FUNCTION resguardo_private.resguardo_push_mark_sent(text,uuid) FROM PUBLIC,authenticated;
REVOKE ALL ON FUNCTION resguardo_private.resguardo_push_disable(text,uuid) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION resguardo_private.resguardo_push_due(text) TO anon;
GRANT EXECUTE ON FUNCTION resguardo_private.resguardo_push_mark_sent(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION resguardo_private.resguardo_push_disable(text,uuid) TO anon;
CREATE FUNCTION public.resguardo_push_due(cron_token text)
 RETURNS TABLE(subscription_id uuid,subscription jsonb)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
 AS $$ SELECT * FROM resguardo_private.resguardo_push_due(cron_token) $$;
CREATE FUNCTION public.resguardo_push_mark_sent(cron_token text,target_id uuid)
 RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
 AS $$ SELECT resguardo_private.resguardo_push_mark_sent(cron_token,target_id) $$;
CREATE FUNCTION public.resguardo_push_disable(cron_token text,target_id uuid)
 RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
 AS $$ SELECT resguardo_private.resguardo_push_disable(cron_token,target_id) $$;
REVOKE EXECUTE ON FUNCTION public.resguardo_push_due(text) FROM PUBLIC,authenticated;
REVOKE EXECUTE ON FUNCTION public.resguardo_push_mark_sent(text,uuid) FROM PUBLIC,authenticated;
REVOKE EXECUTE ON FUNCTION public.resguardo_push_disable(text,uuid) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.resguardo_push_due(text) TO anon;
GRANT EXECUTE ON FUNCTION public.resguardo_push_mark_sent(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.resguardo_push_disable(text,uuid) TO anon;
NOTIFY pgrst,'reload schema';
