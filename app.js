import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOWED_DOMAIN, TIMEZONE } from "./config.js?v=8";
import { nextVehicle, SKYLINE } from "./vehicles.js?v=8";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $ = (id) => document.getElementById(id);
const views = ["view-email", "view-code", "view-app"];
let currentUser = null;
let pendingEmail = "";

// ---------- helpers ----------
const AIRLINES = {
  "United": "UA", "American": "AA", "Delta": "DL", "Southwest": "WN", "Alaska": "AS",
  "JetBlue": "B6", "Spirit": "NK", "Frontier": "F9", "Air Canada": "AC", "British Airways": "BA",
  "Lufthansa": "LH", "Air France": "AF", "KLM": "KL", "Aer Lingus": "EI", "Turkish Airlines": "TK",
  "Emirates": "EK", "Qatar Airways": "QR", "Aeromexico": "AM", "Copa": "CM", "Avianca": "AV",
  "Japan Airlines": "JL", "ANA": "NH", "Korean Air": "KE", "Cathay Pacific": "CX", "Air India": "AI",
  "Iberia": "IB", "Swiss": "LX", "Icelandair": "FI", "Porter": "PD", "Sun Country": "SY",
};
function bagText(checked, carry) {
  if (checked == null && carry == null) return "";
  const c = Number(checked || 0), k = Number(carry || 0);
  return `${c} checked bag${c === 1 ? "" : "s"} · ${k} carry-on${k === 1 ? "" : "s"}`;
}
function trunkSummary(people) {
  const withBags = people.filter((p) => p.checked_bags != null || p.carry_ons != null);
  if (!withBags.length) return "";
  const c = withBags.reduce((n, p) => n + Number(p.checked_bags || 0), 0);
  const k = withBags.reduce((n, p) => n + Number(p.carry_ons || 0), 0);
  const note = withBags.length < people.length ? ` (bags known for ${withBags.length} of ${people.length} people)` : "";
  return `<div class="trunk">🧳 <span><strong>Trunk space for this group:</strong> ${bagText(c, k)}${note}</span></div>`;
}
const dirLabel = (d) => (d === "arrival" ? "Group pick-up" : "Group drop-off");
function show(view) {
  views.forEach((v) => $(v).classList.toggle("hidden", v !== view));
  $("userbox").classList.toggle("hidden", view !== "view-app");
}
// Loading overlay: a 2-inch vehicle drives across the screen.
// It stays up for at least one full pass so the animation never flickers.
const MIN_SHOW_MS = 1500;
let shownAt = 0, hideTimer = null, busyCount = 0;
function busy(on, msg = "Loading…") {
  const el = $("loading");
  if (on) {
    busyCount++;
    clearTimeout(hideTimer);
    if (el.classList.contains("hidden")) {
      const v = nextVehicle();
      el.querySelector(".vehicle").innerHTML = v.svg;
      el.querySelector(".skyline").innerHTML ||= SKYLINE;
      const drive = el.querySelector(".drive");
      drive.style.animation = "none"; void drive.offsetWidth; drive.style.animation = "";
      shownAt = Date.now();
      el.classList.remove("hidden");
    }
    el.querySelector(".loading-text").textContent = msg;
    return Promise.resolve();
  }
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount > 0) return Promise.resolve();
  const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt));
  return new Promise((res) => {
    hideTimer = setTimeout(() => { if (busyCount === 0) el.classList.add("hidden"); res(); }, wait);
  });
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function isKellogg(email) { return String(email || "").trim().toLowerCase().endsWith(ALLOWED_DOMAIN); }
function fmtTime(iso) {
  return new Date(iso).toLocaleString("en-US", { timeZone: TIMEZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtPhone(digits) { return "+" + digits; }
function initials(name) { return (name.match(/\p{L}+/gu) || ["?"]).map((p) => p[0]).join("").slice(0, 2).toUpperCase(); }
function waLink(phone, text) { return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`; }
function isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
function openModal(html) { $("modal-body").innerHTML = html; $("modal").showModal(); }
function friendlyError(e) {
  const m = e?.message || String(e);
  if (/rate limit/i.test(m)) return "Too many codes requested. Please wait a minute and try again.";
  if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) return "That code is invalid or expired. Request a new one.";
  return m;
}
function tripSummary(t) {
  const place = t.location_type === "airport" ? `${t.airport_code}` : t.location_name;
  const verb = t.direction === "arrival" ? `on a group pick-up at ${place}` : `on a group drop-off at ${place}`;
  const flight = t.flight_number ? ` (${t.airline ? t.airline + " " : ""}${t.flight_number})` : "";
  return `${verb} ${fmtTime(t.match_at)}${flight}`;
}
function introMessage(me, others) {
  const names = others.map((o) => o.name.split(" ")[0]).join(", ");
  return `Hi ${names}! I'm ${me.name} from Kellogg — Kellogg Rideshare matched us. ` +
    `I'm ${tripSummary(me)}${me.checked_bags != null ? ` with ${bagText(me.checked_bags, me.carry_ons).replace(" · ", " and ")}` : ""}. Want to share a ride?`;
}

// ---------- auth ----------
$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim().toLowerCase();
  $("email-error").textContent = "";
  if (!isKellogg(email) || !/^[^@\s]+@kellogg\.northwestern\.edu$/.test(email)) {
    $("email-error").textContent = `Please use your ${ALLOWED_DOMAIN} email address.`;
    return;
  }
  busy(true, "Sending your code…");
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  busy(false);
  if (error) { $("email-error").textContent = friendlyError(error); return; }
  pendingEmail = email;
  $("code-email").textContent = email;
  $("code").value = "";
  show("view-code");
  $("code").focus();
});

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("code").value.replace(/\D/g, "");
  $("code-error").textContent = "";
  if (token.length < 6) { $("code-error").textContent = "Enter the code from your email."; return; }
  busy(true, "Checking your code…");
  const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
  busy(false);
  if (error) $("code-error").textContent = friendlyError(error);
});

$("resend").addEventListener("click", async () => {
  if (!pendingEmail) return show("view-email");
  busy(true, "Sending a new code…");
  const { error } = await sb.auth.signInWithOtp({ email: pendingEmail });
  busy(false);
  $("code-error").textContent = error ? friendlyError(error) : "";
  if (!error) alertInline("code-error", "New code sent.");
});
function alertInline(id, msg) { const el = $(id); el.style.color = "var(--ok)"; el.textContent = msg; setTimeout(() => { el.textContent = ""; el.style.color = ""; }, 4000); }

$("change-email").addEventListener("click", () => show("view-email"));
$("signout").addEventListener("click", () => sb.auth.signOut());

sb.auth.onAuthStateChange((_event, session) => {
  // Defer so we don't call Supabase inside the auth callback.
  setTimeout(() => handleSession(session), 0);
});

async function handleSession(session) {
  const user = session?.user;
  if (!user) { currentUser = null; show(pendingEmail ? "view-code" : "view-email"); return; }
  if (!isKellogg(user.email)) {
    await sb.auth.signOut();
    pendingEmail = "";
    show("view-email");
    $("email-error").textContent = `Access is limited to ${ALLOWED_DOMAIN} accounts.`;
    return;
  }
  if (currentUser?.id === user.id) return;
  currentUser = user;
  $("useremail").textContent = user.email;
  show("view-app");
  initForm();
  await loadTrips();
}

// ---------- trip form ----------
function initForm() {
  $("kemail").value = currentUser?.email || "";
  const dl = $("airlines");
  if (!dl.children.length) dl.innerHTML = Object.keys(AIRLINES).map((a) => `<option value="${a}"></option>`).join("");
  $("name").value ||= load("kr_name");
  $("phone").value ||= load("kr_phone");
  if (!$("date").value) {
    $("date").value = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  }
  updateFormLabels();
}

function updateFormLabels() {
  const loc = $("location").value;
  const isAirport = loc === "airport";
  $("location-other").classList.toggle("hidden", loc !== "other");
  $("airport-fields").classList.toggle("hidden", !isAirport);
  ["airport", "airline", "flight", "checked", "carryon"].forEach((id) => ($(id).required = isAirport));
  $("location-other").required = loc === "other";
}
document.querySelectorAll('input[name="direction"]').forEach((r) => r.addEventListener("change", updateFormLabels));
$("location").addEventListener("change", updateFormLabels);

$("trip-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("trip-error");
  err.textContent = "";
  const form = $("trip-form");
  if (!form.checkValidity()) {
    const bad = form.querySelector("input:invalid, select:invalid");
    const label = bad ? (document.querySelector(`label[for="${bad.id}"]`)?.textContent || "This field") : "A field";
    err.textContent = `${label.replace(/\s*\(.*\)/, "")} is required.`;
    bad?.focus();
    return;
  }
  const phoneDigits = $("phone").value.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) { err.textContent = "Enter a valid phone number (with country code if outside the US)."; return; }
  const loc = $("location").value;
  const isAirport = loc === "airport";
  // Flight number: accept "1234" and add the carrier code if we know it.
  let flight = $("flight").value.replace(/\s/g, "").toUpperCase();
  const airline = $("airline").value.trim();
  const code = AIRLINES[Object.keys(AIRLINES).find((a) => a.toLowerCase() === airline.toLowerCase())];
  if (isAirport && /^\d{1,4}$/.test(flight)) {
    if (!code) { err.textContent = "Enter the full flight number including the airline code (e.g. UA1234)."; return; }
    flight = code + flight;
  }
  const params = {
    p_name: $("name").value.trim(),
    p_phone: $("phone").value,
    p_direction: document.querySelector('input[name="direction"]:checked').value,
    p_location_type: isAirport ? "airport" : "other",
    p_location_name: isAirport ? $("airport").value : loc === "other" ? $("location-other").value.trim() : loc,
    p_date: $("date").value,
    p_time: $("time").value,
    p_airport_code: isAirport ? $("airport").value.trim().toUpperCase() : null,
    p_airline: isAirport ? airline : null,
    p_flight_number: isAirport ? flight : null,
    p_checked_bags: isAirport ? Number($("checked").value) : null,
    p_carry_ons: isAirport ? Number($("carryon").value) : null,
  };
  store("kr_name", params.p_name);
  store("kr_phone", params.p_phone);

  $("trip-submit").disabled = true;
  busy(true, "Finding your matches…");
  const { data, error } = await sb.rpc("submit_trip", params);
  if (error) { busy(false); $("trip-submit").disabled = false; err.textContent = error.message; return; }
  $("time").value = ""; $("flight").value = ""; $("checked").value = ""; $("carryon").value = ""; $("airline").value = "";
  await showMatches(data.id);
  await loadTrips();
  busy(false);
  $("trip-submit").disabled = false;
});

// ---------- my trips ----------
async function loadTrips() {
  const { data, error } = await sb.from("trips").select("*").order("match_at", { ascending: true });
  const box = $("my-trips");
  if (error) { box.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  const upcoming = (data || []).filter((t) => new Date(t.match_at) > Date.now() - 6 * 3600e3);
  if (!upcoming.length) { box.innerHTML = `<p class="muted">No upcoming rides yet. Add one to see who you can share with.</p>`; return; }
  box.innerHTML = upcoming.map((t) => `
    <div class="trip">
      <div>
        <div class="title">${dirLabel(t.direction)} · ${esc(t.location_type === "airport" ? t.airport_code : t.location_name)}</div>
        <div class="sub">${esc(fmtTime(t.match_at))}${t.flight_number ? " · " + esc(t.flight_number) : ""}${t.flight_status ? " · " + esc(t.flight_status) : ""}</div>
      </div>
      <div class="btns">
        <button class="btn small" data-matches="${t.id}">Matches</button>
        <button class="btn small" data-delete="${t.id}" aria-label="Delete ride">✕</button>
      </div>
    </div>`).join("");
  box.querySelectorAll("[data-matches]").forEach((b) => b.addEventListener("click", async () => {
    busy(true, "Finding your matches…"); await showMatches(b.dataset.matches); busy(false);
  }));
  box.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this ride? Others will no longer be matched with you for it.")) return;
    await sb.from("trips").delete().eq("id", b.dataset.delete);
    $("results").classList.add("hidden");
    loadTrips();
  }));
}

// ---------- matching ----------
async function showMatches(tripId) {
  let flightNote = "";
  // Refresh flight time from the live tracker (no-op for non-airport trips).
  const { data: fs } = await sb.functions.invoke("flight-sync", { body: { trip_id: tripId } }).catch(() => ({ data: null }));
  if (fs?.found && fs.trip?.flight_time) {
    flightNote = `Live flight time: <strong>${esc(fmtTime(fs.trip.flight_time))}</strong>${fs.trip.flight_status ? ` <span class="badge ok">${esc(fs.trip.flight_status)}</span>` : ""}`;
  } else if (fs?.available && fs.found === false) {
    flightNote = `We couldn't find this flight on the tracker, so we're matching on the time you entered.`;
  }

  const { data, error } = await sb.rpc("get_matches", { p_trip_id: tripId });
  const box = $("results");
  box.classList.remove("hidden");
  if (error) { box.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  const me = data.trip;
  const myBags = bagText(me.checked_bags, me.carry_ons);
  const head = `<h2>Your ride</h2><p class="muted">${esc(tripSummary(me))}${myBags ? `<br>🧳 ${esc(myBags)}` : ""}</p>${flightNote ? `<p class="fine">${flightNote}</p>` : ""}`;

  if (data.mode === "none") {
    box.innerHTML = head + `
      <div class="notice">No one else has a ride at this location within 30 minutes of you yet.
      Your ride is saved — anyone who matches later will see your contact info and reach out. You can also check back here.</div>
      <div class="actions"><button class="btn" id="recheck">Check again</button></div>`;
    $("recheck").onclick = async () => { busy(true, "Checking for new matches…"); await showMatches(tripId); busy(false); };
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (data.mode === "A") renderOptionA(box, head, data);
  else renderOptionB(box, head, data);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function personCard(m, selectable) {
  const gap = m.minutes_apart === 0 ? "same time" : `${Math.abs(m.minutes_apart)} min ${m.minutes_apart < 0 ? "earlier" : "later"}`;
  const flight = m.flight_number ? ` · ${m.airline ? esc(m.airline) + " " : ""}${esc(m.flight_number)}` : "";
  const bags = bagText(m.checked_bags, m.carry_ons);
  const inner = `
    <span class="avatar">${esc(initials(m.name))}</span>
    <div>
      <div class="who">${esc(m.name)} <span class="badge">${dirLabel(m.direction)}</span> ${m.in_group ? '<span class="badge">In proposed group</span>' : ""}</div>
      <div class="meta">${esc(fmtTime(m.match_at))} (${gap})${flight}</div>
      ${bags ? `<div class="meta">🧳 ${esc(bags)}</div>` : ""}
      <div class="meta"><a href="tel:+${esc(m.phone)}">${esc(fmtPhone(m.phone))}</a> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>
    </div>`;
  if (selectable) {
    return `<li><label class="person selectable"><input type="radio" name="pick" value="${esc(m.trip_id)}" />${inner}</label></li>`;
  }
  return `<li class="person">${inner}</li>`;
}

function renderOptionA(box, head, data) {
  const me = data.trip;
  const people = data.matches;
  const already = data.group_platform ? `<div class="notice">You already started this group on ${data.group_platform === "slack" ? "Slack" : "WhatsApp"}. You can open it again below.</div>` : "";
  box.innerHTML = head + `
    <h3>${people.length} Kellogg ${people.length === 1 ? "student matches" : "students match"} your ride</h3>
    <p class="muted">Nobody has grouped up for this time slot yet. Start a group chat to coordinate.</p>
    ${already}
    <ul class="people">${people.map((m) => personCard(m, false)).join("")}</ul>
    ${trunkSummary([me, ...people])}
    <div class="actions">
      <button class="btn wa" id="start-wa">Start WhatsApp group</button>
      <button class="btn slack" id="start-slack">Start Slack group</button>
    </div>`;
  $("start-wa").onclick = () => startWhatsAppGroup(data, me, people);
  $("start-slack").onclick = () => startSlack(data, me, people, true);
}

function renderOptionB(box, head, data) {
  const me = data.trip;
  const people = data.matches;
  box.innerHTML = head + `
    <h3>Others are already coordinating this time slot</h3>
    <div class="notice">A group chat may already have been created for these people. Reach out to one of them directly and ask to be added to the ride.</div>
    <ul class="people">${people.map((m, i) => personCard(m, true)).join("")}</ul>
    ${trunkSummary([me, ...people])}
    <p class="error" id="pick-error"></p>
    <div class="actions">
      <button class="btn wa" id="dm-wa">Message on WhatsApp</button>
      <button class="btn slack" id="dm-slack">Message on Slack</button>
    </div>`;
  const first = box.querySelector('input[name="pick"]');
  if (first) first.checked = true;
  const picked = () => people.find((p) => p.trip_id === box.querySelector('input[name="pick"]:checked')?.value);
  $("dm-wa").onclick = () => {
    const p = picked(); if (!p) return ($("pick-error").textContent = "Choose someone first.");
    const text = `Hi ${p.name.split(" ")[0]}! I'm ${me.name} from Kellogg — Kellogg Rideshare says we're both ${tripSummary(me)}. Is there a ride group I can join?`;
    window.open(waLink(p.phone, text), "_blank", "noopener");
  };
  $("dm-slack").onclick = () => {
    const p = picked(); if (!p) return ($("pick-error").textContent = "Choose someone first.");
    startSlack(data, me, [p], false);
  };
}

async function startWhatsAppGroup(data, me, people) {
  sb.rpc("set_group_platform", { p_group_id: data.group_id, p_platform: "whatsapp" });
  const groupName = `Kellogg ride ${me.location_type === "airport" ? me.airport_code : me.location_name} ${new Date(me.match_at).toLocaleDateString("en-US", { timeZone: TIMEZONE, month: "numeric", day: "numeric" })}`;
  const numbers = people.map((p) => `${p.name}: ${fmtPhone(p.phone)}`).join("\n");
  const msg = introMessage(me, people);
  const copied = await copy(numbers);
  const appLink = isMobile() ? "whatsapp://" : "https://web.whatsapp.com/";
  openModal(`
    <h2>Start your WhatsApp group</h2>
    <p class="muted">WhatsApp doesn't allow websites to create groups automatically, so everything is ready for you to paste.</p>
    <ol>
      <li>${copied ? "Everyone's numbers are <strong>copied</strong>." : "Copy everyone's numbers:"}
        <button class="btn small" id="copy-nums">Copy numbers</button></li>
      <li><a class="btn small wa" href="${appLink}" target="_blank" rel="noopener">Open WhatsApp</a> → <em>New group</em> → add the numbers. Suggested name: <strong>${esc(groupName)}</strong></li>
      <li>Paste this first message:
        <textarea id="intro" readonly>${esc(msg)}</textarea>
        <button class="btn small" id="copy-msg">Copy message</button></li>
    </ol>
    <p class="fine">Prefer one-on-one? Message each person directly:</p>
    <div class="actions">${people.map((p) => `<a class="btn small" target="_blank" rel="noopener" href="${esc(waLink(p.phone, msg))}">${esc(p.name)}</a>`).join("")}</div>`);
  $("copy-nums").onclick = async () => { await copy(numbers); $("copy-nums").textContent = "Copied ✓"; };
  $("copy-msg").onclick = async () => { await copy(msg); $("copy-msg").textContent = "Copied ✓"; };
}

async function startSlack(data, me, people, isGroup) {
  // Open the tab synchronously so pop-up blockers allow it, then point it at Slack.
  const win = window.open("about:blank", "_blank");
  busy(true, "Opening Slack…");
  const message = introMessage(me, people);
  const { data: res, error } = await sb.functions.invoke("slack-connect", {
    body: { my_trip_id: me.id, target_trip_ids: people.map((p) => p.trip_id), message },
  });
  busy(false);
  if (!error && res?.ok && res.url) {
    if (isGroup) sb.rpc("set_group_platform", { p_group_id: data.group_id, p_platform: "slack", p_slack_channel: res.channel });
    if (win) win.location.href = res.url; else window.location.href = res.url;
    if (res.missing?.length) openModal(`<h2>Slack group opened</h2><p>We couldn't find these people on Slack, so they weren't added: ${esc(res.missing.join(", "))}. Reach them on WhatsApp instead.</p>`);
    return;
  }
  // Fallback: no Slack bot configured (or lookup failed) — copy emails and open Slack.
  if (win) win.close();
  if (isGroup) sb.rpc("set_group_platform", { p_group_id: data.group_id, p_platform: "slack" });
  const emails = people.map((p) => p.email).join(", ");
  const copied = await copy(emails);
  openModal(`
    <h2>Message on Slack</h2>
    <ol>
      <li>${copied ? "Their Kellogg emails are <strong>copied</strong>" : "Copy their Kellogg emails"}: <code>${esc(emails)}</code>
        <button class="btn small" id="copy-emails">Copy</button></li>
      <li><a class="btn small slack" href="${isMobile() ? "slack://open" : "https://app.slack.com/client"}" target="_blank" rel="noopener">Open Slack</a> → <em>New message</em> (✎) → paste into the <em>To:</em> field.</li>
      <li>Send this message:
        <textarea readonly>${esc(message)}</textarea>
        <button class="btn small" id="copy-msg">Copy message</button></li>
    </ol>`);
  $("copy-emails").onclick = async () => { await copy(emails); $("copy-emails").textContent = "Copied ✓"; };
  $("copy-msg").onclick = async () => { await copy(message); $("copy-msg").textContent = "Copied ✓"; };
}

// ---------- boot ----------
(async () => {
  busy(true, "Loading…");
  const { data } = await sb.auth.getSession();
  await handleSession(data.session);
  busy(false);
})();
