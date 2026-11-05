
create table if not exists public.resguardo_records (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entry_kind text not null check (entry_kind in ('shift','incident')),
  event_at timestamptz not null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  server_saved_at timestamptz not null default now(),
  constraint resguardo_payload_object check (jsonb_typeof(payload)='object'),
  constraint resguardo_payload_size check (pg_column_size(payload) < 300000)
);
create index if not exists resguardo_records_owner_event on public.resguardo_records (owner_id,event_at desc);
alter table public.resguardo_records enable row level security;
create policy "resguardo_select_own" on public.resguardo_records for select to authenticated using ((select auth.uid())=owner_id);
create policy "resguardo_insert_own" on public.resguardo_records for insert to authenticated with check ((select auth.uid())=owner_id);
create policy "resguardo_update_own" on public.resguardo_records for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

create table if not exists public.resguardo_audit (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.resguardo_records(id) on delete cascade,
  action text not null check (length(action) between 1 and 100),
  snapshot jsonb not null,
  client_at timestamptz not null,
  saved_at timestamptz not null default now(),
  constraint resguardo_snapshot_object check(jsonb_typeof(snapshot)='object')
);
create index if not exists resguardo_audit_owner_record on public.resguardo_audit(owner_id,record_id,saved_at);
alter table public.resguardo_audit enable row level security;
create policy "resguardo_audit_select_own" on public.resguardo_audit for select to authenticated using ((select auth.uid())=owner_id);
create policy "resguardo_audit_insert_own" on public.resguardo_audit for insert to authenticated with check ((select auth.uid())=owner_id and exists (select 1 from public.resguardo_records r where r.id=record_id and r.owner_id=(select auth.uid())));
create or replace function public.resguardo_validate_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.owner_id<>old.owner_id) then
     raise exception 'record identity cannot change';
  end if;
  new.server_saved_at=now();
  return new;
end;
$$;
create trigger resguardo_records_owner_guard before insert or update on public.resguardo_records for each row execute function public.resguardo_validate_owner();
revoke all on public.resguardo_records from anon;
revoke all on public.resguardo_audit from anon;
grant select,insert,update on public.resguardo_records to authenticated;
grant select,insert on public.resguardo_audit to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('resguardo-evidencias','resguardo-evidencias',false,31457280,array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','application/pdf','image/avif'])
on conflict (id) do nothing;
create policy "resguardo_files_read" on storage.objects for select to authenticated
using(bucket_id='resguardo-evidencias' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "resguardo_files_upload" on storage.objects for insert to authenticated
with check(bucket_id='resguardo-evidencias' and (storage.foldername(name))[1]=(select auth.uid())::text);
