-- Upgrade: manage who is in a group after it has been created.
--
-- Until now membership was fixed at creation time, so a student who joined
-- later could never be added to an existing group.
--
-- Who may change membership: the group's creator, plus any staff or admin.
-- Deliberately not "any member" — in a school group a student should not be
-- able to pull an outsider into a conversation. Anyone can leave on their own.

create or replace function public.can_manage_members(ch uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_active(uid)
     and exists (
       select 1 from channels c
       where c.id = ch
         and c.type = 'group'
         and (c.created_by = uid
              or exists (select 1 from profiles p
                          where p.id = uid and p.role in ('staff', 'admin')))
     );
$$;

revoke execute on function public.can_manage_members(uuid, uuid) from public, anon;

-- Adds people to a group. Returns how many were newly added.
create or replace function public.add_channel_members(p_channel uuid, p_members uuid[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_added int;
begin
  if not can_manage_members(p_channel, auth.uid()) then
    raise exception 'Only the group creator or staff can add people.';
  end if;

  with inserted as (
    insert into channel_members (channel_id, user_id)
    select p_channel, m from unnest(p_members) as m
    where is_active(m)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from inserted;

  return v_added;
end $$;

revoke execute on function public.add_channel_members(uuid, uuid[]) from public, anon;

create or replace function public.remove_channel_member(p_channel uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not can_manage_members(p_channel, auth.uid()) then
    raise exception 'Only the group creator or staff can remove people.';
  end if;
  delete from channel_members where channel_id = p_channel and user_id = p_user;
end $$;

revoke execute on function public.remove_channel_member(uuid, uuid) from public, anon;

-- Anyone may take themselves out of a group.
create or replace function public.leave_channel(p_channel uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from channels where id = p_channel and type = 'group') then
    raise exception 'You can only leave a group.';
  end if;
  delete from channel_members where channel_id = p_channel and user_id = auth.uid();
end $$;

revoke execute on function public.leave_channel(uuid) from public, anon;
