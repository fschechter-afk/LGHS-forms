-- Upgrade: push notifications for new Announcements posts.
--
-- Scope, deliberately: only messages in announcement-type channels trigger a
-- phone notification. DMs and groups stay in-app only — a busy group thread
-- should never buzz someone's lock screen.
--
-- iOS note: this only works for the app installed to the home screen, on
-- iOS 16.4+. A plain Safari tab cannot receive push notifications at all —
-- that's an Apple platform limit, not something this code can work around.
--
-- Run this once in the Supabase SQL editor, THEN deploy the Edge Function
-- (see messenger/supabase/functions/send-announcement-push/) and set its
-- three secrets in the dashboard (Project Settings → Edge Functions →
-- Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

-- 1. One row per device (a browser's push subscription). A device that
--    reinstalls or re-subscribes reuses the same endpoint, so it's the
--    natural unique key.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
-- No select/insert/delete grants: writes go through the RPCs below, and
-- nobody but the Edge Function (via the service role key, which bypasses
-- RLS entirely) ever needs to read this table.

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_active(auth.uid()) then
    raise exception 'Not signed in.';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Invalid subscription.';
  end if;
  -- A device that switches accounts (sign out, restore a different account)
  -- reuses the same browser subscription; re-point it to whoever owns the
  -- device now rather than erroring on the unique endpoint.
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke execute on function public.remove_push_subscription(text) from public, anon;

-- 2. The trigger: fires for every non-deleted new message, checks whether
--    it landed in an announcement channel, and if so hands it to the Edge
--    Function as a standard Supabase Database Webhook payload
--    ({ type, table, schema, record }). This project doesn't have the
--    `supabase_functions` helper schema (the usual Database Webhooks path),
--    so this calls pg_net directly instead — same result, no dependency on
--    that schema existing. Postgres trigger WHEN clauses can't contain a
--    subquery, so the announcement-channel check lives inside the function
--    body rather than the WHEN clause.
create extension if not exists pg_net;

create or replace function public.notify_announcement_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_announcement boolean;
begin
  select (c.type = 'announcement') into is_announcement
  from public.channels c where c.id = new.channel_id;

  if coalesce(is_announcement, false) then
    perform net.http_post(
      url := 'https://aheiyytqvzxkoowykkgt.supabase.co/functions/v1/send-announcement-push',
      body := jsonb_build_object('type', 'INSERT', 'table', 'messages', 'schema', 'public', 'record', to_jsonb(new)),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  end if;
  return new;
end $$;

revoke execute on function public.notify_announcement_push() from public, anon, authenticated;

create trigger send_announcement_push
  after insert on public.messages
  for each row
  when (new.kind <> 'deleted')
  execute function public.notify_announcement_push();
