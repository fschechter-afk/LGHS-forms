-- LGHS Dorm Messenger — Supabase backend.
--
-- Setup (once, ~5 minutes, free tier):
--  1. Create a free project at https://supabase.com (no credit card needed).
--  2. In the dashboard: Authentication → Sign In / Up → enable "Anonymous
--     sign-ins" (the app signs devices in anonymously; identity comes from
--     invite codes, not passwords).
--  3. SQL Editor → New query → paste this whole file → Run.
--     The result of the last statement is your one-time ADMIN invite code.
--  4. Project Settings → API: copy the Project URL and the "anon public" key
--     into the app's join screen, together with the admin code.
--
-- Everything is enforced here, server-side: invite codes are single-use,
-- students can't post in announcement channels or start check-ins, and
-- disabled accounts lose access instantly. The app itself only holds the
-- anon key, which grants nothing without a signed-in user + these policies.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  role       text not null default 'student' check (role in ('student', 'parent', 'staff', 'admin')),
  status     text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table public.invite_codes (
  code       text primary key,
  role       text not null default 'student' check (role in ('student', 'parent', 'staff', 'admin')),
  note       text not null default '',
  max_uses   int not null default 1,   -- 0 = shared code, unlimited uses
  use_count  int not null default 0,
  used_by    uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.channels (
  id               uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('dm', 'group', 'announcement')),
  name             text not null default '',
  dm_key           text unique,  -- "uuid|uuid" (sorted) so a DM pair exists once
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_msg_at      timestamptz not null default now(),
  last_msg_preview text not null default ''
);

create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (channel_id, user_id)
);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text', 'poll', 'checkin', 'deleted')),
  body       text not null default '',
  data       jsonb,
  created_at timestamptz not null default now()
);
create index messages_channel_created on public.messages (channel_id, created_at);

create table public.reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table public.votes (
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  choice     int not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.settings (
  key   text primary key,
  value text not null default ''
);

-- ---------------------------------------------------------------- helpers

create or replace function public.is_active(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = uid and status = 'active');
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.is_member(ch uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    where c.id = ch
      and (c.type = 'announcement'
           or exists (select 1 from channel_members m where m.channel_id = ch and m.user_id = uid))
  );
$$;

create or replace function public.can_post(ch uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_member(ch, uid) and is_active(uid) and exists (
    select 1 from channels c
    where c.id = ch
      and (c.type <> 'announcement'
           or exists (select 1 from profiles p where p.id = uid and p.role in ('staff', 'admin')))
  );
$$;

create or replace function public.random_code(prefix text)
returns text language sql volatile set search_path = public as $$
  select prefix || '-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

-- ---------------------------------------------------------------- row-level security
-- Reads go through these policies; ALL writes go through the RPC functions
-- below (security definer), so there are deliberately no insert/update/delete
-- policies — direct writes with the anon key are rejected.

alter table public.profiles        enable row level security;
alter table public.invite_codes    enable row level security;
alter table public.channels        enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages        enable row level security;
alter table public.reactions       enable row level security;
alter table public.votes           enable row level security;
alter table public.settings        enable row level security;

create policy profiles_read on public.profiles
  for select to authenticated using (is_active(auth.uid()));

create policy invite_codes_admin_read on public.invite_codes
  for select to authenticated using (my_role() = 'admin');

create policy channels_member_read on public.channels
  for select to authenticated using (is_active(auth.uid()) and is_member(id, auth.uid()));

create policy channel_members_read on public.channel_members
  for select to authenticated using (is_active(auth.uid()) and is_member(channel_id, auth.uid()));

create policy messages_member_read on public.messages
  for select to authenticated using (is_active(auth.uid()) and is_member(channel_id, auth.uid()));

create policy reactions_member_read on public.reactions
  for select to authenticated using (is_active(auth.uid()) and is_member(channel_id, auth.uid()));

create policy votes_member_read on public.votes
  for select to authenticated using (is_active(auth.uid()) and is_member(channel_id, auth.uid()));

create policy settings_read on public.settings
  for select to authenticated using (is_active(auth.uid()));

-- ---------------------------------------------------------------- rpc: joining

-- Redeems a single-use invite code for the signed-in (anonymous) auth user.
-- If this device already has a profile, it is returned as-is so reopening
-- the app never burns a second code.
create or replace function public.redeem_invite(p_code text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_code invite_codes%rowtype;
  v_prof profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_prof from profiles where id = v_uid;
  if found then
    return jsonb_build_object(
      'user', jsonb_build_object('id', v_prof.id, 'name', v_prof.name, 'role', v_prof.role),
      'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from settings));
  end if;

  select * into v_code from invite_codes
   where upper(code) = upper(trim(p_code)) for update;
  if not found then
    raise exception 'That invite code is not valid.';
  end if;
  if v_code.max_uses > 0 and v_code.use_count >= v_code.max_uses then
    raise exception 'That invite code was already used.';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'A name is required.';
  end if;

  insert into profiles (id, name, role)
  values (v_uid, left(trim(p_name), 40), v_code.role)
  returning * into v_prof;

  update invite_codes
     set use_count = use_count + 1, used_by = coalesce(used_by, v_uid)
   where code = v_code.code;

  -- Make sure the school-wide announcements channel exists.
  if not exists (select 1 from channels where type = 'announcement') then
    insert into channels (type, name, created_by) values ('announcement', '📣 Announcements', v_uid);
  end if;

  return jsonb_build_object(
    'user', jsonb_build_object('id', v_prof.id, 'name', v_prof.name, 'role', v_prof.role),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from settings));
end $$;

-- ---------------------------------------------------------------- rpc: channels

create or replace function public.create_dm(p_other uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if not is_active(v_uid) or not is_active(p_other) or p_other = v_uid then
    raise exception 'Cannot start that conversation.';
  end if;
  v_key := least(v_uid::text, p_other::text) || '|' || greatest(v_uid::text, p_other::text);

  select id into v_id from channels where dm_key = v_key;
  if found then
    return v_id;
  end if;

  insert into channels (type, dm_key, created_by) values ('dm', v_key, v_uid) returning id into v_id;
  insert into channel_members (channel_id, user_id) values (v_id, v_uid), (v_id, p_other);
  return v_id;
end $$;

create or replace function public.create_group(p_name text, p_members uuid[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not is_active(v_uid) then
    raise exception 'Account is not active.';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'A group name is required.';
  end if;

  insert into channels (type, name, created_by)
  values ('group', left(trim(p_name), 60), v_uid) returning id into v_id;

  insert into channel_members (channel_id, user_id)
  select v_id, m from unnest(p_members || v_uid) as m
  where is_active(m)
  on conflict do nothing;
  return v_id;
end $$;

create or replace function public.create_announcement(p_name text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if my_role() <> 'admin' then
    raise exception 'Only admins can create announcement channels.';
  end if;
  insert into channels (type, name, created_by)
  values ('announcement', left(trim(coalesce(p_name, 'Announcements')), 60), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- rpc: messages

create or replace function public.send_message(p_channel uuid, p_kind text, p_body text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_kind    text := coalesce(p_kind, 'text');
  v_body    text := left(trim(coalesce(p_body, '')), 2000);
  v_data    jsonb := null;
  v_msg     messages%rowtype;
  v_name    text;
  v_preview text;
  v_options jsonb;
begin
  if not can_post(p_channel, v_uid) then
    raise exception 'You cannot post in this channel.';
  end if;
  if v_kind not in ('text', 'poll', 'checkin') or char_length(v_body) = 0 then
    raise exception 'Empty or invalid message.';
  end if;

  if v_kind = 'checkin' then
    if my_role() not in ('staff', 'admin') then
      raise exception 'Only staff can start a check-in.';
    end if;
    v_data := jsonb_build_object('options', jsonb_build_array('I''m here ✔'));
  elsif v_kind = 'poll' then
    v_options := coalesce(p_data -> 'options', '[]'::jsonb);
    if jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 8 then
      raise exception 'A poll needs 2–8 options.';
    end if;
    v_data := jsonb_build_object('options',
      (select jsonb_agg(left(trim(o.value), 80)) from jsonb_array_elements_text(v_options) o));
  end if;

  insert into messages (channel_id, user_id, kind, body, data)
  values (p_channel, v_uid, v_kind, v_body, v_data)
  returning * into v_msg;

  select name into v_name from profiles where id = v_uid;
  v_preview := case v_kind
    when 'poll' then '📊 ' || v_body
    when 'checkin' then '🙋 ' || v_body
    else v_name || ': ' || v_body end;

  update channels
     set last_msg_at = v_msg.created_at, last_msg_preview = left(v_preview, 80)
   where id = p_channel;

  return jsonb_build_object('messageId', v_msg.id, 'createdAt', v_msg.created_at);
end $$;

create or replace function public.toggle_reaction(p_message uuid, p_emoji text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg messages%rowtype;
begin
  select * into v_msg from messages where id = p_message;
  if not found or not is_member(v_msg.channel_id, v_uid) or not is_active(v_uid) then
    raise exception 'Cannot react to that message.';
  end if;

  delete from reactions where message_id = p_message and user_id = v_uid and emoji = p_emoji;
  if found then
    return jsonb_build_object('removed', true);
  end if;
  insert into reactions (message_id, channel_id, user_id, emoji)
  values (p_message, v_msg.channel_id, v_uid, left(p_emoji, 8));
  return jsonb_build_object('removed', false);
end $$;

create or replace function public.set_vote(p_message uuid, p_choice int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg messages%rowtype;
begin
  select * into v_msg from messages where id = p_message;
  if not found or v_msg.kind not in ('poll', 'checkin')
     or not is_member(v_msg.channel_id, v_uid) or not is_active(v_uid) then
    raise exception 'Cannot vote on that message.';
  end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(v_msg.data -> 'options') then
    raise exception 'Invalid choice.';
  end if;

  insert into votes (message_id, channel_id, user_id, choice)
  values (p_message, v_msg.channel_id, v_uid, p_choice)
  on conflict (message_id, user_id) do update set choice = excluded.choice, created_at = now();
end $$;

create or replace function public.delete_message(p_message uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg messages%rowtype;
begin
  select * into v_msg from messages where id = p_message;
  if not found then
    raise exception 'Message not found.';
  end if;
  if v_msg.user_id <> v_uid and coalesce(my_role(), 'student') not in ('staff', 'admin') then
    raise exception 'You can only delete your own messages.';
  end if;
  update messages set kind = 'deleted', body = '', data = null where id = p_message;
end $$;

-- ---------------------------------------------------------------- rpc: admin

-- p_shared = true creates one code with unlimited uses (a whole role can
-- share it); admin codes must stay single-use so admin access is deliberate.
create or replace function public.admin_create_codes(p_role text, p_count int, p_note text default '', p_shared boolean default false)
returns setof text language plpgsql volatile security definer set search_path = public as $$
declare
  v_code text;
  v_n int := case when p_shared then 1 else least(greatest(p_count, 1), 50) end;
begin
  if my_role() <> 'admin' then
    raise exception 'Admins only.';
  end if;
  if p_role not in ('student', 'parent', 'staff', 'admin') then
    raise exception 'Invalid role.';
  end if;
  if p_shared and p_role = 'admin' then
    raise exception 'Admin codes must stay single-use.';
  end if;
  for i in 1 .. v_n loop
    v_code := random_code(upper(left(p_role, 3)));
    insert into invite_codes (code, role, note, created_by, max_uses)
    values (v_code, p_role, coalesce(p_note, ''), auth.uid(), case when p_shared then 0 else 1 end);
    return next v_code;
  end loop;
end $$;

-- Revoke a code: stops all future joins with it; existing members keep access.
create or replace function public.admin_delete_code(p_code text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'Admins only.';
  end if;
  delete from invite_codes where code = p_code;
  if not found then
    raise exception 'Code not found.';
  end if;
end $$;

-- Remove a user entirely: their account, memberships, messages, reactions
-- and votes are deleted. Use "disable" instead to block someone but keep
-- their messages.
create or replace function public.admin_remove_user(p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'Admins only.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove yourself.';
  end if;
  delete from profiles where id = p_user;
  if not found then
    raise exception 'User not found.';
  end if;
end $$;

create or replace function public.admin_set_status(p_user uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'Admins only.';
  end if;
  if p_status not in ('active', 'disabled') then
    raise exception 'Invalid status.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot disable yourself.';
  end if;
  update profiles set status = p_status where id = p_user;
end $$;

create or replace function public.admin_set_setting(p_key text, p_value text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then
    raise exception 'Admins only.';
  end if;
  insert into settings (key, value) values (left(p_key, 40), coalesce(p_value, ''))
  on conflict (key) do update set value = excluded.value;
  return (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from settings);
end $$;

-- ---------------------------------------------------------------- grants
-- Only signed-in users may call the API functions; anonymous visitors and
-- the internal-only helpers are locked out at the grant level.

revoke execute on function public.redeem_invite(text, text) from public, anon;
revoke execute on function public.create_dm(uuid) from public, anon;
revoke execute on function public.create_group(text, uuid[]) from public, anon;
revoke execute on function public.create_announcement(text) from public, anon;
revoke execute on function public.send_message(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.toggle_reaction(uuid, text) from public, anon;
revoke execute on function public.set_vote(uuid, int) from public, anon;
revoke execute on function public.delete_message(uuid) from public, anon;
revoke execute on function public.admin_create_codes(text, int, text, boolean) from public, anon;
revoke execute on function public.admin_delete_code(text) from public, anon;
revoke execute on function public.admin_remove_user(uuid) from public, anon;
revoke execute on function public.admin_set_status(uuid, text) from public, anon;
revoke execute on function public.admin_set_setting(text, text) from public, anon;

-- Helpers used by RLS policies: authenticated keeps execute; anon loses it.
revoke execute on function public.is_active(uuid) from public, anon;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.is_member(uuid, uuid) from public, anon;
revoke execute on function public.can_post(uuid, uuid) from public, anon;

-- Only used inside security-definer functions; no client role needs it.
revoke execute on function public.random_code(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.channels;

-- ---------------------------------------------------------------- first admin code

insert into public.invite_codes (code, role, note)
values (public.random_code('ADMIN'), 'admin', 'First admin — join with this code');

select code as "Your one-time admin invite code"
from public.invite_codes where role = 'admin' and used_by is null;
