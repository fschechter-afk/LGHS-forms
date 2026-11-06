-- LGHS Notes — database setup.
--
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste →
-- Run. It is safe to run again. It only ADDS a notes table and its rules; it
-- does not touch any of the Messenger's tables.
--
-- !!! Before running, change 'YOUR-SCHOOL-DOMAIN.org' near the bottom to the
-- part after the @ in student email addresses.

-- ---------------------------------------------------------------- tables

create table if not exists public.notes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Text only, by construction: a note is a title plus a body string (the
  -- note's lines and checklist items, encoded as JSON text). There is no
  -- column that could hold a file, and the size caps stop anyone from using
  -- notes as file storage. 400,000 characters is roughly 150 printed pages.
  title       text    not null default '' check (char_length(title) <= 300),
  body        text    not null default '[]' check (char_length(body) <= 400000 and left(body, 1) = '['),
  created_at  bigint  not null,          -- milliseconds, from the phone
  updated_at  bigint  not null,          -- milliseconds, from the phone (last edit wins)
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()  -- set by the server
);

create index if not exists notes_user_synced on public.notes (user_id, synced_at);

-- Email domains allowed to use Notes. Not readable by any app user.
create table if not exists public.notes_allowed_domains (
  domain text primary key
);
alter table public.notes_allowed_domains enable row level security;

-- ---------------------------------------------------------------- who may use it

-- True only for a real school account: signed in through Google/Microsoft
-- (not the Messenger's anonymous logins, not email+password), with an email
-- address in an allowed domain.
create or replace function public.notes_account_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and (auth.jwt() -> 'app_metadata' ->> 'provider') in ('google', 'azure')
    and exists (
      select 1 from public.notes_allowed_domains d
      where split_part(lower(auth.jwt() ->> 'email'), '@', 2) = lower(d.domain)
    )
$$;

-- ---------------------------------------------------------------- privacy

-- Row-level security: every query is filtered to the signed-in student's own
-- rows. Another student's notes cannot be read or changed, whatever the app
-- (or anyone with the public key) sends.
alter table public.notes enable row level security;

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select
  using (user_id = auth.uid() and public.notes_account_ok());

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert
  with check (user_id = auth.uid() and public.notes_account_ok());

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update
  using (user_id = auth.uid() and public.notes_account_ok())
  with check (user_id = auth.uid() and public.notes_account_ok());
-- No delete policy: the app "deletes" by marking a note deleted, so the
-- deletion reaches her other devices and staff can restore an accident.

-- Server-side timestamp for sync, and owner can never change.
create or replace function public.notes_touch()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.notes_touch();

-- ---------------------------------------------------------------- saving

-- Save a batch of notes from a phone. An older copy never overwrites a newer
-- one (e.g. an old phone coming back online after a new one was used).
-- Runs with the caller's permissions, so the policies above still apply.
create or replace function public.save_notes(items jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if not public.notes_account_ok() then
    raise exception 'Please sign in with your school account';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 100 then
    raise exception 'Bad request';
  end if;

  insert into public.notes as t (id, user_id, title, body, created_at, updated_at, deleted)
  select (i ->> 'id')::uuid,
         auth.uid(),
         coalesce(i ->> 'title', ''),
         coalesce(i ->> 'body', '[]'),
         (i ->> 'created_at')::bigint,
         (i ->> 'updated_at')::bigint,
         coalesce((i ->> 'deleted')::boolean, false)
  from jsonb_array_elements(items) as i
  on conflict (id) do update
    set title = excluded.title,
        body = excluded.body,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted
    where t.updated_at <= excluded.updated_at;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.save_notes(jsonb) from public, anon;
grant execute on function public.save_notes(jsonb) to authenticated;
revoke all on public.notes from anon;

-- ---------------------------------------------------------------- your school

-- !!! Change this to your students' email domain (add more rows for staff
-- domains if they differ).
insert into public.notes_allowed_domains (domain)
values ('YOUR-SCHOOL-DOMAIN.org')
on conflict do nothing;
