-- Upgrade for existing installs (2026-08-19): roles become
-- student / parent / staff / admin, and admins can fully remove users.
-- (Shared invite codes — max_uses / use_count — were added in the previous
-- upgrade; fresh installs get everything from schema.sql alone.)

-- 1. Roles: rename faculty → staff, add parent.
alter table public.profiles drop constraint profiles_role_check;
alter table public.invite_codes drop constraint invite_codes_role_check;
update public.profiles set role = 'staff' where role = 'faculty';
update public.invite_codes set role = 'staff' where role = 'faculty';
alter table public.profiles
  add constraint profiles_role_check check (role in ('student', 'parent', 'staff', 'admin'));
alter table public.invite_codes
  add constraint invite_codes_role_check check (role in ('student', 'parent', 'staff', 'admin'));

-- 2. Foreign keys so deleting a profile is possible: the user's messages go
--    with them; code/channel bookkeeping just loses the reference.
alter table public.messages
  drop constraint messages_user_id_fkey,
  add constraint messages_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade;
alter table public.invite_codes
  drop constraint invite_codes_used_by_fkey,
  add constraint invite_codes_used_by_fkey
    foreign key (used_by) references public.profiles (id) on delete set null;
alter table public.invite_codes
  drop constraint invite_codes_created_by_fkey,
  add constraint invite_codes_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;
alter table public.channels
  drop constraint channels_created_by_fkey,
  add constraint channels_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

-- 3. Staff (not "faculty") holds the posting/check-in/moderation powers.
create or replace function public.can_post(ch uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_member(ch, uid) and is_active(uid) and exists (
    select 1 from channels c
    where c.id = ch
      and (c.type <> 'announcement'
           or exists (select 1 from profiles p where p.id = uid and p.role in ('staff', 'admin')))
  );
$$;

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

-- 4. Remove a user entirely (account + messages + reactions + votes).
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

revoke execute on function public.admin_remove_user(uuid) from public, anon;
