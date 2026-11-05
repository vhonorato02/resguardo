
-- A narrow, secret-gated interface for the Vercel reminder cron.
-- No service_role key is needed, and subscriptions are never public.
CREATE SCHEMA IF NOT EXISTS resguardo_private;
REVOKE ALL ON SCHEMA resguardo_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS resguardo_private.cron_credentials (
  id integer PRIMARY KEY CHECK(id = 1),
  token_digest text NOT NULL CHECK(length(token_digest) = 64),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS resguardo_private.push_deliveries (
  subscription_id uuid NOT NULL REFERENCES public.resguardo_push_subscriptions(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subscription_id, local_day)
);
REVOKE ALL ON ALL TABLES IN SCHEMA resguardo_private FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.resguardo_cron_authorized(cron_token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
 SELECT COALESCE(length(cron_token) = 64
   AND EXISTS(SELECT 1 FROM resguardo_private.cron_credentials c
     WHERE c.id=1 AND c.token_digest = encode(extensions.digest(cron_token, 'sha256'), 'hex')),false);
$$;
REVOKE ALL ON FUNCTION public.resguardo_cron_authorized(text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.resguardo_push_due(cron_token text)
RETURNS TABLE(subscription_id uuid, subscription jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE local_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.resguardo_cron_authorized(cron_token) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='28000';
  END IF;
  IF EXTRACT(ISODOW FROM local_day) > 5 THEN RETURN; END IF;
  RETURN QUERY SELECT s.id, s.subscription
    FROM public.resguardo_push_subscriptions s
    WHERE s.enabled IS TRUE AND s.reminder_time='18:30'
      AND s.timezone='America/Sao_Paulo'
      AND NOT EXISTS (SELECT 1 FROM resguardo_private.push_deliveries d
        WHERE d.subscription_id=s.id AND d.local_day=local_day)
    ORDER BY s.updated_at DESC LIMIT 2000;
END;
$$;
REVOKE ALL ON FUNCTION public.resguardo_push_due(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.resguardo_push_due(text) TO anon;
CREATE OR REPLACE FUNCTION public.resguardo_push_mark_sent(cron_token text, target_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT public.resguardo_cron_authorized(cron_token) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='28000';
  END IF;
  INSERT INTO resguardo_private.push_deliveries(subscription_id,local_day)
    SELECT s.id, (now() AT TIME ZONE 'America/Sao_Paulo')::date
    FROM public.resguardo_push_subscriptions s WHERE s.id=target_id
    ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.resguardo_push_mark_sent(text,uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.resguardo_push_mark_sent(text,uuid) TO anon;
CREATE OR REPLACE FUNCTION public.resguardo_push_disable(cron_token text, target_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT public.resguardo_cron_authorized(cron_token) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='28000';
  END IF;
  UPDATE public.resguardo_push_subscriptions SET enabled=false, updated_at=now() WHERE id=target_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.resguardo_push_disable(text,uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.resguardo_push_disable(text,uuid) TO anon;
COMMENT ON FUNCTION public.resguardo_push_due(text) IS 'Private cron-only web push queue, gated by 256-bit token; not an administrative service-role key.';
