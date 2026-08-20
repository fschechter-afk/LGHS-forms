-- Upgrade: photo, flyer and PDF attachments.
--
-- Files live in a PRIVATE storage bucket, one folder per channel, and are
-- only readable by members of that channel. Nothing is world-readable: the
-- app fetches short-lived signed URLs to open each file.
--
-- Run this once in the Supabase SQL editor.

-- 1. The bucket. Private, images + PDFs, 10 MB ceiling (the app compresses
--    phone photos to a few hundred KB before uploading; PDFs go as-is).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Access rules. Object paths are "<channel_id>/<file>", so the first
--    folder tells us which channel a file belongs to and we can reuse the
--    same membership checks the messages use.
drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_active(auth.uid())
    and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    -- can_post keeps students out of announcement channels here too.
    and public.can_post(((storage.foldername(name))[1])::uuid, auth.uid())
  );

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (owner = auth.uid() or public.my_role() in ('staff', 'admin'))
  );

-- 3. Messages can now be images or files. `data` carries the storage path
--    (plus dimensions for images, name/size for files); `body` is the
--    optional caption.
alter table public.messages drop constraint messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text', 'poll', 'checkin', 'image', 'file', 'deleted'));

-- 4. send_message accepts kinds 'image' and 'file' (caption optional).
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
  if v_kind not in ('text', 'poll', 'checkin', 'image', 'file') then
    raise exception 'Invalid message type.';
  end if;
  -- Attachments may stand on their own; everything else needs text.
  if v_kind not in ('image', 'file') and char_length(v_body) = 0 then
    raise exception 'Empty message.';
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
  elsif v_kind in ('image', 'file') then
    if coalesce(p_data ->> 'path', '') = '' then
      raise exception 'Missing attachment.';
    end if;
    -- Pin the file to this channel's folder so a caller cannot attach
    -- someone else's upload from another channel.
    if split_part(p_data ->> 'path', '/', 1) <> p_channel::text then
      raise exception 'Attachment does not belong to this channel.';
    end if;
    if v_kind = 'image' then
      v_data := jsonb_build_object(
        'path', p_data ->> 'path',
        'w', coalesce((p_data ->> 'w')::int, 0),
        'h', coalesce((p_data ->> 'h')::int, 0));
    else
      v_data := jsonb_build_object(
        'path', p_data ->> 'path',
        'name', left(coalesce(nullif(p_data ->> 'name', ''), 'Document'), 120),
        'size', coalesce((p_data ->> 'size')::bigint, 0));
    end if;
  end if;

  insert into messages (channel_id, user_id, kind, body, data)
  values (p_channel, v_uid, v_kind, v_body, v_data)
  returning * into v_msg;

  select name into v_name from profiles where id = v_uid;
  v_preview := case v_kind
    when 'poll' then '📊 ' || v_body
    when 'checkin' then '🙋 ' || v_body
    when 'image' then v_name || ': 📷 ' || coalesce(nullif(v_body, ''), 'Photo')
    when 'file' then v_name || ': 📄 ' || coalesce(v_data ->> 'name', 'Document')
    else v_name || ': ' || v_body end;

  update channels
     set last_msg_at = v_msg.created_at, last_msg_preview = left(v_preview, 80)
   where id = p_channel;

  return jsonb_build_object('messageId', v_msg.id, 'createdAt', v_msg.created_at);
end $$;

revoke execute on function public.send_message(uuid, text, text, jsonb) from public, anon;
