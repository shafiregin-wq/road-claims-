-- =====================================================================
-- MITAK — shared travel expense tracker for two colleagues
-- Supabase database schema.
--
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again after an update: it only adds what is missing
-- and replaces functions and policies with their latest versions.
--
-- Privacy model
--   • Exactly one MITAK workspace exists per Supabase project.
--   • The first person to sign up creates it and receives an invite code.
--   • The second person joins with that code. The code is then deleted
--     and the workspace is closed: it never has more than two members.
--   • Once both members have joined, new sign-ups are refused outright.
--   • Every table and every stored file is readable and writable only by
--     the members of the workspace (row level security).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'MITAK' check (char_length(name) between 1 and 60),
  invite_code text unique,              -- 12 hex characters; null once both members have joined
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role         text not null default 'member' check (role in ('owner', 'member')),
  -- Extra details printed on reimbursement files: employee_id, designation, department, vehicle …
  profile      jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category     text not null check (category in ('fuel', 'toll', 'food', 'parking')),
  amount       numeric(12, 2) not null check (amount > 0 and amount < 1000000),
  expense_date date not null,
  expense_time time,
  paid_by      uuid not null,           -- the member who paid (defaults to whoever adds it)
  created_by   uuid,                    -- set automatically from the signed-in user
  updated_by   uuid,                    -- set automatically from the signed-in user
  description  text not null default '' check (char_length(description) <= 500),
  location     text not null default '' check (char_length(location) <= 200),
  trip         text not null default '' check (char_length(trip) <= 120),
  -- Category-specific values, e.g. fuel: vehicle, odometer, litres, fuel_station, price_per_litre.
  details      jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  -- Receipt files in storage: [{ "path": "...", "name": "...", "type": "image/jpeg", "size": 12345 }]
  receipts     jsonb not null default '[]'::jsonb check (jsonb_typeof(receipts) = 'array'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists expenses_workspace_date on public.expenses (workspace_id, expense_date desc);

-- One reimbursement Excel template per category, with its field-to-cell mapping.
create table if not exists public.report_templates (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category     text not null check (category in ('fuel', 'toll', 'food', 'parking')),
  file_path    text,
  file_name    text,
  mapping      jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, category)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- The workspace the signed-in user belongs to (null if none).
-- security definer so policies on members can use it without recursion.
create or replace function public.my_workspace_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select workspace_id from public.members where user_id = auth.uid()
$$;

create or replace function public.mitak_new_invite_code()
returns text
language sql volatile
set search_path = public
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
$$;

create or replace function public.mitak_clean_name(p text)
returns text
language plpgsql immutable
as $$
declare n text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if n = '' then raise exception 'MITAK_NAME_REQUIRED'; end if;
  return left(n, 40);
end
$$;

-- ---------------------------------------------------------------------
-- Workspace set-up: create, join, new invite code
-- ---------------------------------------------------------------------

create or replace function public.create_workspace(p_display_name text, p_name text default 'MITAK')
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  ws   public.workspaces;
begin
  if uid is null then raise exception 'MITAK_NOT_SIGNED_IN'; end if;
  if exists (select 1 from public.members where user_id = uid) then raise exception 'MITAK_ALREADY_MEMBER'; end if;
  -- Only one MITAK workspace per project, even if two people try at the same moment.
  perform pg_advisory_xact_lock(hashtext('mitak.create_workspace'));
  if exists (select 1 from public.workspaces) then raise exception 'MITAK_WORKSPACE_EXISTS'; end if;

  insert into public.workspaces (name, invite_code, created_by)
  values (coalesce(nullif(btrim(p_name), ''), 'MITAK'), public.mitak_new_invite_code(), uid)
  returning * into ws;
  insert into public.members (workspace_id, user_id, display_name, role)
  values (ws.id, uid, public.mitak_clean_name(p_display_name), 'owner');

  return json_build_object('workspace_id', ws.id, 'invite_code', ws.invite_code);
end
$$;

create or replace function public.join_workspace(p_code text, p_display_name text)
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  code text := regexp_replace(regexp_replace(upper(coalesce(p_code, '')), '^\s*MITAK', ''), '[^0-9A-F]', '', 'g');
  ws   public.workspaces;
begin
  if uid is null then raise exception 'MITAK_NOT_SIGNED_IN'; end if;
  if exists (select 1 from public.members where user_id = uid) then raise exception 'MITAK_ALREADY_MEMBER'; end if;
  if length(code) <> 12 then raise exception 'MITAK_INVITE_INVALID'; end if;

  select * into ws from public.workspaces where invite_code = code for update;
  if not found then raise exception 'MITAK_INVITE_INVALID'; end if;
  if (select count(*) from public.members where workspace_id = ws.id) >= 2 then raise exception 'MITAK_WORKSPACE_FULL'; end if;

  insert into public.members (workspace_id, user_id, display_name, role)
  values (ws.id, uid, public.mitak_clean_name(p_display_name), 'member');
  -- Two members now: the invitation is used up and the workspace is closed.
  update public.workspaces set invite_code = null where id = ws.id;

  return json_build_object('workspace_id', ws.id);
end
$$;

-- The owner can make a fresh invite code while the second place is still free
-- (for example if the first code was shared with the wrong person).
create or replace function public.regenerate_invite()
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  wid  uuid;
  code text;
begin
  select workspace_id into wid from public.members where user_id = uid and role = 'owner';
  if wid is null then raise exception 'MITAK_OWNER_ONLY'; end if;
  if (select count(*) from public.members where workspace_id = wid) >= 2 then raise exception 'MITAK_WORKSPACE_FULL'; end if;
  code := public.mitak_new_invite_code();
  update public.workspaces set invite_code = code where id = wid;
  return code;
end
$$;

-- A workspace never has more than two members, whatever inserts the row.
create or replace function public.members_limit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform 1 from public.workspaces where id = new.workspace_id for update;
  if (select count(*) from public.members where workspace_id = new.workspace_id) >= 2 then
    raise exception 'MITAK_WORKSPACE_FULL';
  end if;
  return new;
end
$$;
drop trigger if exists members_limit on public.members;
create trigger members_limit before insert on public.members
  for each row execute function public.members_limit();

-- Once both members have joined, nobody else can create an account.
create or replace function public.mitak_signup_gate()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.workspaces w
    where (select count(*) from public.members m where m.workspace_id = w.id) >= 2
  ) then
    raise exception 'MITAK_SIGNUPS_CLOSED';
  end if;
  return new;
end
$$;
drop trigger if exists mitak_signup_gate on auth.users;
create trigger mitak_signup_gate before insert on auth.users
  for each row execute function public.mitak_signup_gate();

-- ---------------------------------------------------------------------
-- Expense bookkeeping: owner checks and timestamps
-- ---------------------------------------------------------------------

create or replace function public.expenses_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.paid_by is distinct from old.paid_by then
    if not exists (select 1 from public.members where workspace_id = new.workspace_id and user_id = new.paid_by) then
      raise exception 'MITAK_PAID_BY_NOT_MEMBER';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.workspace_id := old.workspace_id;
    new.created_by   := old.created_by;
    new.created_at   := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard before insert or update on public.expenses
  for each row execute function public.expenses_guard();

create or replace function public.templates_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists templates_touch on public.report_templates;
create trigger templates_touch before insert or update on public.report_templates
  for each row execute function public.templates_touch();

-- ---------------------------------------------------------------------
-- Row level security: members only
-- ---------------------------------------------------------------------

alter table public.workspaces       enable row level security;
alter table public.members          enable row level security;
alter table public.expenses         enable row level security;
alter table public.report_templates enable row level security;

revoke all on public.workspaces, public.members, public.expenses, public.report_templates from anon;
revoke all on public.workspaces, public.members from authenticated;
grant select on public.workspaces, public.members to authenticated;
grant update (name) on public.workspaces to authenticated;
grant update (display_name, profile) on public.members to authenticated;
grant select, insert, update, delete on public.expenses, public.report_templates to authenticated;

drop policy if exists "workspace: members read" on public.workspaces;
create policy "workspace: members read" on public.workspaces
  for select to authenticated using (id = public.my_workspace_id());
drop policy if exists "workspace: members rename" on public.workspaces;
create policy "workspace: members rename" on public.workspaces
  for update to authenticated using (id = public.my_workspace_id()) with check (id = public.my_workspace_id());

drop policy if exists "members: read own workspace" on public.members;
create policy "members: read own workspace" on public.members
  for select to authenticated using (workspace_id = public.my_workspace_id());
drop policy if exists "members: edit own profile" on public.members;
create policy "members: edit own profile" on public.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "expenses: members only" on public.expenses;
create policy "expenses: members only" on public.expenses
  for all to authenticated
  using (workspace_id = public.my_workspace_id())
  with check (workspace_id = public.my_workspace_id());

drop policy if exists "templates: members only" on public.report_templates;
create policy "templates: members only" on public.report_templates
  for all to authenticated
  using (workspace_id = public.my_workspace_id())
  with check (workspace_id = public.my_workspace_id());

revoke execute on function public.my_workspace_id(), public.create_workspace(text, text), public.join_workspace(text, text),
  public.regenerate_invite(), public.mitak_new_invite_code(), public.mitak_clean_name(text) from public, anon;
grant execute on function public.my_workspace_id(), public.create_workspace(text, text), public.join_workspace(text, text),
  public.regenerate_invite() to authenticated;

-- ---------------------------------------------------------------------
-- File storage: receipts and Excel templates, in a private bucket.
-- Paths start with the workspace id: <workspace_id>/receipts/... and <workspace_id>/templates/...
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mitak', 'mitak', false, 15728640, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/octet-stream'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mitak files: members read" on storage.objects;
create policy "mitak files: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'mitak' and (storage.foldername(name))[1] = public.my_workspace_id()::text);
drop policy if exists "mitak files: members add" on storage.objects;
create policy "mitak files: members add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mitak' and (storage.foldername(name))[1] = public.my_workspace_id()::text);
drop policy if exists "mitak files: members replace" on storage.objects;
create policy "mitak files: members replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'mitak' and (storage.foldername(name))[1] = public.my_workspace_id()::text)
  with check (bucket_id = 'mitak' and (storage.foldername(name))[1] = public.my_workspace_id()::text);
drop policy if exists "mitak files: members delete" on storage.objects;
create policy "mitak files: members delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mitak' and (storage.foldername(name))[1] = public.my_workspace_id()::text);

-- ---------------------------------------------------------------------
-- Push notifications: each phone that turned notifications on, and the
-- notification keys. The Edge Function "notify" (supabase/functions/notify)
-- reads these with the service key; members only see their own phones.
-- ---------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  endpoint     text primary key check (char_length(endpoint) <= 1000),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  p256dh       text not null check (char_length(p256dh) <= 200),
  auth         text not null check (char_length(auth) <= 100),
  user_agent   text not null default '' check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now()
);

-- Created by the Edge Function on first use. Nobody but the function can read it.
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_jwk jsonb not null,
  subject     text not null,
  created_at  timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_config        enable row level security;
revoke all on public.push_subscriptions, public.push_config from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

drop policy if exists "push: own phones" on public.push_subscriptions;
create policy "push: own phones" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- Saves this phone for the signed-in member (taking it over if someone else used it before).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  wid uuid := public.my_workspace_id();
begin
  if uid is null or wid is null then raise exception 'MITAK_NOT_MEMBER'; end if;
  if coalesce(p_endpoint, '') !~ '^https?://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'MITAK_PUSH_INVALID';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, workspace_id, p256dh, auth, user_agent)
  values (p_endpoint, uid, wid, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, workspace_id = excluded.workspace_id, p256dh = excluded.p256dh,
        auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql volatile security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------
-- Live updates: when one colleague saves, the other's screen refreshes.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['expenses', 'members', 'report_templates', 'workspaces'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
