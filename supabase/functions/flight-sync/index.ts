// Looks up a trip's flight on AeroDataBox (via RapidAPI) and stores the live
// arrival/departure time so matching uses the most accurate time available.
// Secret required: AERODATABOX_RAPIDAPI_KEY  (without it, the site falls back to the time users typed in)
import { cors, json, requireKellogg } from "../_shared/auth.ts";

const REFRESH_MINUTES = 10;

function parseUtc(t?: { utc?: string }) {
  if (!t?.utc) return null;
  const d = new Date(t.utc.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = await requireKellogg(req);
  if (auth instanceof Response) return auth;
  const { user, admin } = auth;

  const { trip_id } = await req.json().catch(() => ({}));
  const { data: trip } = await admin.from("trips").select("*").eq("id", trip_id).eq("user_id", user.id).maybeSingle();
  if (!trip) return json({ error: "Trip not found" }, 404);
  if (trip.location_type !== "airport") return json({ available: false, reason: "not_airport" });

  const key = Deno.env.get("AERODATABOX_RAPIDAPI_KEY");
  if (!key) return json({ available: false, reason: "no_api_key", trip });

  if (trip.flight_checked_at && Date.now() - new Date(trip.flight_checked_at).getTime() < REFRESH_MINUTES * 60_000) {
    return json({ available: true, cached: true, trip });
  }

  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(trip.flight_number)}/${trip.trip_date}` +
    `?withAircraftImage=false&withLocation=false&dateLocalRole=Both`;
  const res = await fetch(url, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
  });
  if (res.status === 204 || res.status === 404) {
    await admin.from("trips").update({ flight_status: "Not found", flight_checked_at: new Date().toISOString() }).eq("id", trip.id);
    return json({ available: true, found: false });
  }
  if (!res.ok) return json({ available: true, found: false, error: `Flight API error ${res.status}` });

  const flights = await res.json();
  const side = trip.direction === "arrival" ? "arrival" : "departure";
  // Pick the leg that touches the user's airport; if several, the one closest to what they typed.
  const legs = (Array.isArray(flights) ? flights : []).filter((f: any) => f?.[side]?.airport?.iata === trip.airport_code);
  const entered = new Date(trip.entered_at).getTime();
  let best: any = null, bestTime: Date | null = null;
  for (const f of legs) {
    const ep = f[side];
    const t = parseUtc(ep.runwayTime) ?? parseUtc(ep.revisedTime) ?? parseUtc(ep.predictedTime) ?? parseUtc(ep.scheduledTime);
    if (t && (!bestTime || Math.abs(t.getTime() - entered) < Math.abs(bestTime.getTime() - entered))) {
      best = f; bestTime = t;
    }
  }
  if (!best || !bestTime) {
    await admin.from("trips").update({ flight_status: "Not found at " + trip.airport_code, flight_checked_at: new Date().toISOString() }).eq("id", trip.id);
    return json({ available: true, found: false });
  }

  const update = {
    flight_time: bestTime.toISOString(),
    match_at: bestTime.toISOString(),
    flight_status: best.status ?? null,
    flight_checked_at: new Date().toISOString(),
  };
  const { data: updated } = await admin.from("trips").update(update).eq("id", trip.id).select().single();
  return json({ available: true, found: true, trip: updated });
});
