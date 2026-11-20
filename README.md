# Kellogg Rideshare

A GitHub Pages site where Kellogg students find classmates arriving or leaving at the same time (same place, within 30 minutes) and start a WhatsApp or Slack chat to share a ride.

- **Front end:** static HTML/CSS/JS (`index.html`, `styles.css`, `app.js`, `config.js`), served by GitHub Pages.
- **Back end:** Supabase project `gahmqofseimuuaelmakj` (Postgres + Auth + Edge Functions).

## How it works

1. A visitor enters their `@kellogg.northwestern.edu` email and Supabase emails them a one-time code.
2. After verifying, they add a ride: name, phone, Kellogg email (pre-filled, verified), group pick-up or group drop-off, location, date and time. If the location is an airport, they also enter the airport code, airline carrier, flight number, and number of checked bags and carry-ons (shown to matches, with a group total, to estimate trunk space).
3. For airport rides, the `flight-sync` edge function looks up the flight on AeroDataBox. The live arrival or departure time replaces the typed time for matching.
4. `get_matches()` finds other rides at the same location within 30 minutes (date + time), whether they're a group pick-up or drop-off:
   - **Option A**: none of these people has been grouped yet. The site records a proposed group and offers **Start WhatsApp group** / **Start Slack group**.
   - **Option B**: some of them are already in a proposed group. The site says a group may already exist and lets the user pick one person to message directly.
   - Every time contact info is shown, it is logged in `contact_shares`.

## Security

- Users can only sign up with a Kellogg email: the site checks the address, the `hook_kellogg_only_signup` auth hook rejects other domains, and every database function and policy checks the email again (`is_kellogg()`).
- Users can only read their own rides. Other people's contact info is returned only by `get_matches()`, and only to people with a matching ride.
- The publishable key in `config.js` is meant to be public.

## One-time Supabase setup (dashboard) — all done ✅

| Setting | Where | Value |
|---|---|---|
| **Send a code, not a link** | Authentication → Emails → *Confirm sign up* **and** *Magic link or OTP* templates | Both bodies must include `{{ .Token }}` and no link (sample below). First-time users get *Confirm sign up*; returning users get *Magic link or OTP*. |
| **Kellogg-only sign-ups** | Authentication → Hooks → *Before User Created* | Postgres function `public.hook_kellogg_only_signup` |
| **Custom SMTP (required for real users)** | Authentication → Emails → SMTP Settings | Currently Gmail: `kelloggridecoordination@gmail.com` via `smtp.gmail.com:465` with a Google app password (about 500 emails/day). Supabase's built-in mailer only sends to project team members. |
| Site URL | Authentication → URL Configuration | `https://erickalu01.github.io/Kellogg-Rideshare/` |

Sample Magic Link email template:

```html
<h2>Your Kellogg Rideshare code</h2>
<p>Enter this code to sign in:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>It expires in 1 hour. If you didn't request it, ignore this email.</p>
```

Keep the template code-only (no `{{ .ConfirmationURL }}` link): Northwestern's email security scanner opens links in incoming mail, which uses up the one-time code before the student can enter it.

## Optional integrations (Edge Function secrets)

Set these under **Edge Functions → Secrets**:

| Secret | What it enables | Without it |
|---|---|---|
| `AERODATABOX_RAPIDAPI_KEY` | Live flight times from [AeroDataBox on RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) (it has a free tier) | Matches use the time the student typed in |
| `SLACK_BOT_TOKEN` | **Start Slack group** creates a real Slack group DM with everyone (plus the bot) and posts an intro message. Install a Slack app in the Kellogg workspace with bot scopes `users:read`, `users:read.email`, `mpim:write`, `im:write`, `chat:write`. | The site copies everyone's Kellogg emails and opens Slack so the user can start the DM themselves |

**About WhatsApp:** WhatsApp has no public way for a website to create a group from a list of personal numbers. **Start WhatsApp group** copies everyone's numbers, suggests a group name, writes an intro message, and adds one-tap `wa.me` links to message each person. Option B opens a WhatsApp chat with the chosen person, with the message already typed.

## Deploying

1. Push these files to the `main` branch.
2. In the repo, go to **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. The site will be live at `https://erickalu01.github.io/Kellogg-Rideshare/`.

The database schema is in `supabase/migrations/` and the edge functions are in `supabase/functions/`. Both are already deployed to the Supabase project.
