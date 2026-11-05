REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.resguardo_records,public.resguardo_audit,public.resguardo_push_subscriptions FROM anon,authenticated;
REVOKE DELETE ON TABLE public.resguardo_records FROM anon,authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.resguardo_audit FROM anon,authenticated;
GRANT SELECT ON TABLE public.resguardo_audit TO authenticated;
