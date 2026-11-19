-- Kellogg Rideshare schema
-- Everything is gated to verified @kellogg.northwestern.edu accounts.

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
create or replace function public.is_kellogg()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@kellogg.northwestern.edu', false)
$$;

-- Auth hook: reject sign-ups from any other email domain.
-- Enable in Dashboard > Authentication > Hooks > "Before User Created" (Postgres function).
create or replace function public.hook_kellogg_only_signup(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if v_email like '%@kellogg.northwestern.edu' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Only @kellogg.northwestern.edu email addresses can access Kellogg Rideshare.'));
end;
$$;
grant execute on function public.hook_kellogg_only_signup to supabase_auth_admin;
revoke execute on function public.hook_kellogg_only_signup from authenticated, anon, public;

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email           text not null,
  name            text not null check (length(trim(name)) between 1 and 100),
  phone           text not null check (phone ~ '^[0-9]{8,15}$'),           -- E.164 digits, no "+"
  direction       text not null check (direction in ('arrival', 'departure')),
  location_type   text not null check (location_type in ('airport', 'other')),
  location_name   text not null check (length(trim(location_name)) between 1 and 120),
  location_key    text not null,                                              -- normalized match key
  trip_date       date not null,
  trip_time       time not null,
  entered_at      timestamptz not null,                                       -- date+time in Chicago
  airport_code    text check (airport_code ~ '^[A-Z]{3}$'),
  flight_number   text check (flight_number ~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$'),
  luggage         int check (luggage between 0 and 20),
  flight_time     timestamptz,                                                -- live time from flight tracker
  flight_status   text,
  flight_checked_at timestamptz,
  match_at        timestamptz not null,                                       -- flight_time if known, else entered_at
  created_at      timestamptz not null default now(),
  constraint airport_fields_required check (
    location_type <> 'airport'
    or (airport_code is not null and flight_number is not null and luggage is not null))
);
create index trips_match_idx on public.trips (direction, location_key, match_at);
create index trips_user_idx on public.trips (user_id);

-- A proposed ride group: created the first time a set of matching people is shown to each other.
create table public.ride_groups (
  id            uuid primary key default gen_random_uuid(),
  direction     text not null,
  location_key  text not null,
  anchor_at     timestamptz not null,
  created_by    uuid not null references auth.users (id) on delete cascade,
  platform      text check (platform in ('whatsapp', 'slack')),
  slack_channel text,
  created_at    timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.ride_groups (id) on delete cascade,
  trip_id   uuid not null references public.trips (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (group_id, trip_id)
);
create index group_members_trip_idx on public.group_members (trip_id);
create index ride_groups_created_by_idx on public.ride_groups (created_by);

-- Audit log of whose contact info was shown to whom.
create table public.contact_shares (
  viewer_trip_id uuid not null references public.trips (id) on delete cascade,
  shared_trip_id uuid not null references public.trips (id) on delete cascade,
  mode           text not null check (mode in ('A', 'B')),
  shared_at      timestamptz not null default now(),
  primary key (viewer_trip_id, shared_trip_id)
);
create index contact_shares_shared_idx on public.contact_shares (shared_trip_id);

-- ---------------------------------------------------------------
-- Row level security: users see only their own rows directly.
-- Other people's contact info is only reachable through get_matches().
-- ---------------------------------------------------------------
alter table public.trips          enable row level security;
alter table public.ride_groups    enable row level security;
alter table public.group_members  enable row level security;
alter table public.contact_shares enable row level security;

create policy "own trips: select" on public.trips
  for select to authenticated using (public.is_kellogg() and user_id = (select auth.uid()));
create policy "own trips: delete" on public.trips
  for delete to authenticated using (public.is_kellogg() and user_id = (select auth.uid()));
-- inserts/updates go through submit_trip() so fields are normalized server-side

revoke all on public.ride_groups, public.group_members, public.contact_shares from anon, authenticated;
revoke insert, update on public.trips from anon, authenticated;
revoke all on public.trips from anon;
grant select, delete on public.trips to authenticated;

-- ---------------------------------------------------------------
-- RPC: submit a trip
-- ---------------------------------------------------------------
create or replace function public.submit_trip(
  p_name text, p_phone text, p_direction text, p_location_type text, p_location_name text,
  p_date date, p_time time,
  p_airport_code text default null, p_flight_number text default null, p_luggage int default null)
returns public.trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_code text := upper(trim(coalesce(p_airport_code, '')));
  v_flight text := upper(regexp_replace(coalesce(p_flight_number, ''), '\s', '', 'g'));
  v_key text;
  v_at timestamptz;
begin
  if not public.is_kellogg() then
    raise exception 'Only @kellogg.northwestern.edu accounts can use this site' using errcode = '42501';
  end if;
  if length(v_phone) = 10 then v_phone := '1' || v_phone; end if;   -- assume US if no country code

  if p_location_type = 'airport' then
    if v_code !~ '^[A-Z]{3}$' then raise exception 'Enter a 3-letter airport code (e.g. ORD)'; end if;
    if v_flight !~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$' then raise exception 'Enter a flight number like UA1234'; end if;
    if p_luggage is null then raise exception 'Enter the number of bags'; end if;
    v_key := 'airport:' || v_code;
  else
    v_code := null; v_flight := null; p_luggage := null;
    v_key := 'place:' || trim(regexp_replace(lower(trim(p_location_name)), '[^a-z0-9]+', ' ', 'g'));
  end if;

  v_at := (p_date + p_time) at time zone 'America/Chicago';

  insert into public.trips (user_id, email, name, phone, direction, location_type, location_name,
                            location_key, trip_date, trip_time, entered_at,
                            airport_code, flight_number, luggage, match_at)
  values (auth.uid(), lower(auth.jwt() ->> 'email'), trim(p_name), v_phone, p_direction, p_location_type,
          case when p_location_type = 'airport' then v_code else trim(p_location_name) end,
          v_key, p_date, p_time, v_at, nullif(v_code, ''), nullif(v_flight, ''), p_luggage, v_at)
  returning * into v_trip;
  return v_trip;
end;
$$;

-- ---------------------------------------------------------------
-- RPC: find matches for one of my trips (within 30 minutes).
-- Mode B if any match already belongs to a proposed group; else Mode A,
-- in which case a new group is proposed and recorded.
-- ---------------------------------------------------------------
create or replace function public.get_matches(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.trips;
  v_group uuid;
  v_mode text;
  v_matches jsonb;
  v_ids uuid[];
begin
  if not public.is_kellogg() then
    raise exception 'Only @kellogg.northwestern.edu accounts can use this site' using errcode = '42501';
  end if;
  select * into v_me from public.trips where id = p_trip_id and user_id = auth.uid();
  if not found then raise exception 'Trip not found'; end if;

  -- Same direction + same place + within 30 minutes, excluding my own trips.
  select coalesce(array_agg(t.id), '{}') into v_ids
  from public.trips t
  where t.direction = v_me.direction
    and t.location_key = v_me.location_key
    and t.user_id <> v_me.user_id
    and abs(extract(epoch from (t.match_at - v_me.match_at))) <= 30 * 60;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('mode', 'none', 'matches', '[]'::jsonb, 'trip', to_jsonb(v_me));
  end if;

  -- Already in a group with any of these people? Keep the mode I was originally given.
  select gm.group_id into v_group
  from public.group_members gm
  join public.group_members gm2 on gm2.group_id = gm.group_id
  where gm.trip_id = v_me.id and gm2.trip_id = any (v_ids)
  limit 1;

  if v_group is not null then
    select case when g.created_by = auth.uid() then 'A' else 'B' end into v_mode
    from public.ride_groups g where g.id = v_group;
  else
    -- Has a group already been proposed among these people? -> Option B
    select gm.group_id into v_group
    from public.group_members gm
    join public.ride_groups g on g.id = gm.group_id
    where gm.trip_id = any (v_ids)
    group by gm.group_id, g.created_at
    order by count(*) desc, g.created_at
    limit 1;

    if v_group is not null then
      v_mode := 'B';
    else
      -- Nobody connected yet -> Option A: propose a new group
      v_mode := 'A';
      insert into public.ride_groups (direction, location_key, anchor_at, created_by)
      values (v_me.direction, v_me.location_key, v_me.match_at, auth.uid())
      returning id into v_group;
      insert into public.group_members (group_id, trip_id)
      select v_group, unnest(v_ids) on conflict do nothing;
    end if;
    insert into public.group_members (group_id, trip_id) values (v_group, v_me.id) on conflict do nothing;
  end if;

  insert into public.contact_shares (viewer_trip_id, shared_trip_id, mode)
  select v_me.id, unnest(v_ids), v_mode on conflict do nothing;

  select coalesce(jsonb_agg(x.obj order by x.in_group desc, x.gap), '[]'::jsonb) into v_matches
  from (
    select jsonb_build_object(
        'trip_id', m.id, 'name', m.name, 'phone', m.phone, 'email', m.email,
        'location_name', m.location_name, 'match_at', m.match_at,
        'flight_number', m.flight_number, 'flight_status', m.flight_status, 'luggage', m.luggage,
        'in_group', ig.in_group,
        'minutes_apart', round(extract(epoch from (m.match_at - v_me.match_at)) / 60)) as obj,
      ig.in_group,
      abs(extract(epoch from (m.match_at - v_me.match_at))) as gap
    from public.trips m
    cross join lateral (select exists (select 1 from public.group_members gm
                                       where gm.group_id = v_group and gm.trip_id = m.id) as in_group) ig
    where m.id = any (v_ids)
  ) x;

  return jsonb_build_object(
    'mode', v_mode,
    'group_id', v_group,
    'group_platform', (select platform from public.ride_groups where id = v_group),
    'slack_channel', (select slack_channel from public.ride_groups where id = v_group),
    'trip', to_jsonb(v_me),
    'matches', v_matches);
end;
$$;

-- Record which platform the group creator chose (Option A).
create or replace function public.set_group_platform(p_group_id uuid, p_platform text, p_slack_channel text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_kellogg() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_platform not in ('whatsapp', 'slack') then raise exception 'Bad platform'; end if;
  update public.ride_groups
     set platform = coalesce(platform, p_platform), slack_channel = coalesce(p_slack_channel, slack_channel)
   where id = p_group_id
     and exists (select 1 from public.group_members gm join public.trips t on t.id = gm.trip_id
                 where gm.group_id = p_group_id and t.user_id = auth.uid());
end;
$$;

-- Lock down function execution to signed-in users only.
revoke execute on function public.submit_trip(text, text, text, text, text, date, time, text, text, int) from public, anon;
revoke execute on function public.get_matches(uuid) from public, anon;
revoke execute on function public.set_group_platform(uuid, text, text) from public, anon;
grant execute on function public.submit_trip(text, text, text, text, text, date, time, text, text, int) to authenticated;
grant execute on function public.get_matches(uuid) to authenticated;
grant execute on function public.set_group_platform(uuid, text, text) to authenticated;
