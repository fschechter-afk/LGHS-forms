// Sends a Web Push notification to every subscribed device when a new
// message lands in an announcement channel. Invoked by a Postgres trigger
// (public.notify_announcement_push, via pg_net) as a standard Database
// Webhook — never called directly by the app, so verify_jwt is off: the
// caller is the database itself, not an end-user request. The only "risk"
// of the URL being guessed is someone triggering a bogus push whose text is
// a name + message preview, i.e. nothing more sensitive than what
// Announcements already shows every member.
//
// The trigger already checks the message landed in an announcement channel
// before calling this function, but the check is repeated here too — cheap,
// and it means this function is safe even if something else ever calls it.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function restHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function deleteSubscription(endpoint: string) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
    { method: "DELETE", headers: restHeaders() },
  ).catch(() => {});
}

function previewFor(kind: string, body: string, data: Record<string, unknown> | null) {
  if (kind === "image") return "📷 " + (body || "Photo");
  if (kind === "file") return "📄 " + ((data?.name as string) || "Document");
  if (kind === "poll") return "📊 " + body;
  if (kind === "checkin") return "🙋 " + body;
  return body;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload?.record;
    if (!record || payload.type !== "INSERT" || record.kind === "deleted") {
      return new Response("skip", { status: 200 });
    }

    const [channelRes, authorRes, subsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/channels?id=eq.${record.channel_id}&select=type`, {
        headers: restHeaders(),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${record.user_id}&select=name`, {
        headers: restHeaders(),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=neq.${record.user_id}&select=*`, {
        headers: restHeaders(),
      }),
    ]);
    const channelRows = await channelRes.json();
    if (channelRows?.[0]?.type !== "announcement") {
      return new Response("skip: not an announcement channel", { status: 200 });
    }
    const authorRows = await authorRes.json();
    const subs = await subsRes.json();
    const authorName = authorRows?.[0]?.name || "Announcement";

    const notifPayload = JSON.stringify({
      title: "📣 LGHS Announcements",
      body: `${authorName}: ${previewFor(record.kind, record.body, record.data)}`.slice(0, 180),
      url: "./#chat/" + record.channel_id,
    });

    let sent = 0;
    await Promise.all(
      (Array.isArray(subs) ? subs : []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            notifPayload,
          );
          sent++;
        } catch (err) {
          // A device that's uninstalled the app or revoked permission
          // returns 404/410 forever; drop it instead of retrying it on
          // every future announcement.
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await deleteSubscription(s.endpoint);
          } else {
            console.error("push failed for", s.endpoint, err);
          }
        }
      }),
    );

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-announcement-push error", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
