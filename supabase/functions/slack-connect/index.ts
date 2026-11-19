// Opens a Slack group DM (or a DM-with-bot for one person) between the caller and
// people whose contact info the site has already shared with them.
// Secret required: SLACK_BOT_TOKEN (bot scopes: users:read, users:read.email, mpim:write, im:write, chat:write)
// Without it, the site falls back to copying Kellogg emails and opening Slack.
import { cors, json, requireKellogg } from "../_shared/auth.ts";

async function slack(method: string, token: string, params: Record<string, string>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = await requireKellogg(req);
  if (auth instanceof Response) return auth;
  const { user, admin } = auth;

  const { my_trip_id, target_trip_ids, message } = await req.json().catch(() => ({}));
  if (!Array.isArray(target_trip_ids) || target_trip_ids.length === 0 || target_trip_ids.length > 7) {
    return json({ error: "Pick between 1 and 7 people" }, 400);
  }
  const { data: mine } = await admin.from("trips").select("id").eq("id", my_trip_id).eq("user_id", user.id).maybeSingle();
  if (!mine) return json({ error: "Trip not found" }, 404);

  // Only people whose contact info was already shared with this trip.
  const { data: shares } = await admin.from("contact_shares")
    .select("shared_trip_id, trips:shared_trip_id(email)")
    .eq("viewer_trip_id", my_trip_id).in("shared_trip_id", target_trip_ids);
  const emails = (shares ?? []).map((s: any) => s.trips?.email).filter(Boolean);
  if (emails.length !== target_trip_ids.length) return json({ error: "Not allowed" }, 403);

  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) return json({ available: false, emails });

  const ids: string[] = [];
  const missing: string[] = [];
  for (const e of [user.email, ...emails]) {
    const r = await slack("users.lookupByEmail", token, { email: e });
    if (r.ok) ids.push(r.user.id); else missing.push(e);
  }
  if (ids.length < 2) return json({ available: true, ok: false, missing, emails });

  const open = await slack("conversations.open", token, { users: ids.join(",") });
  if (!open.ok) return json({ available: true, ok: false, error: open.error, emails });
  if (message) await slack("chat.postMessage", token, { channel: open.channel.id, text: String(message).slice(0, 2000) });
  const team = (await slack("auth.test", token, {})).team_id;
  return json({
    available: true, ok: true, channel: open.channel.id, team, missing,
    url: `https://slack.com/app_redirect?channel=${open.channel.id}&team=${team}`,
  });
});
