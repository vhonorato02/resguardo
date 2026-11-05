ALTER TABLE public.resguardo_records ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.resguardo_records ADD CONSTRAINT resguardo_version_positive CHECK (version >= 1);
DROP POLICY IF EXISTS resguardo_audit_insert_own ON public.resguardo_audit;
REVOKE INSERT, UPDATE, DELETE ON public.resguardo_audit FROM authenticated;
GRANT SELECT ON public.resguardo_audit TO authenticated;
CREATE SCHEMA IF NOT EXISTS resguardo_private;
REVOKE ALL ON SCHEMA resguardo_private FROM public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.resguardo_validate_owner() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF new.id <> old.id OR new.owner_id <> old.owner_id THEN RAISE EXCEPTION 'Record identity is immutable'; END IF;
  new.version := old.version + 1;
 ELSE new.version := 1; END IF;
 new.server_saved_at := now();
 RETURN new;
END;
$$;
CREATE OR REPLACE FUNCTION resguardo_private.write_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.resguardo_audit (id,owner_id,record_id,action,snapshot,client_at,saved_at)
 VALUES (gen_random_uuid(),new.owner_id,new.id,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,
 jsonb_build_object('payload',new.payload,'event_at',new.event_at,'version',new.version),
 new.client_updated_at,now());
 RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS resguardo_audit_events ON public.resguardo_records;
CREATE TRIGGER resguardo_audit_events AFTER INSERT OR UPDATE ON public.resguardo_records FOR EACH ROW EXECUTE FUNCTION resguardo_private.write_audit();
CREATE TABLE IF NOT EXISTS public.resguardo_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE,
 subscription jsonb NOT NULL CHECK(jsonb_typeof(subscription)='object'),
 enabled boolean NOT NULL DEFAULT false,
 reminder_time text NOT NULL DEFAULT '18:30',
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resguardo_push_owner ON public.resguardo_push_subscriptions(owner_id);
ALTER TABLE public.resguardo_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY resguardo_push_select_own ON public.resguardo_push_subscriptions FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE POLICY resguardo_push_insert_own ON public.resguardo_push_subscriptions FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=owner_id);
CREATE POLICY resguardo_push_update_own ON public.resguardo_push_subscriptions FOR UPDATE TO authenticated USING ((SELECT auth.uid())=owner_id) WITH CHECK ((SELECT auth.uid())=owner_id);
CREATE POLICY resguardo_push_delete_own ON public.resguardo_push_subscriptions FOR DELETE TO authenticated USING ((SELECT auth.uid())=owner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resguardo_push_subscriptions TO authenticated;
REVOKE ALL ON public.resguardo_push_subscriptions FROM anon;
