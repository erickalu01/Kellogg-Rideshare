-- 1) Airline carrier for airport trips
alter table public.trips add column if not exists airline text check (airline is null or length(trim(airline)) between 1 and 60);

-- 2) submit_trip now takes p_airline (required for airport trips)
drop function if exists public.submit_trip(text, text, text, text, text, date, time, text, text, int);

create or replace function public.submit_trip(
  p_name text, p_phone text, p_direction text, p_location_type text, p_location_name text,
  p_date date, p_time time,
  p_airport_code text default null, p_airline text default null,
  p_flight_number text default null, p_luggage int default null)
returns public.trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_code text := upper(trim(coalesce(p_airport_code, '')));
  v_airline text := nullif(trim(coalesce(p_airline, '')), '');
  v_flight text := upper(regexp_replace(coalesce(p_flight_number, ''), '\s', '', 'g'));
  v_key text;
  v_at timestamptz;
begin
  if not public.is_kellogg() then
    raise exception 'Only @kellogg.northwestern.edu accounts can use this site' using errcode = '42501';
  end if;
  if length(v_phone) = 10 then v_phone := '1' || v_phone; end if;

  if p_location_type = 'airport' then
    if v_code !~ '^[A-Z]{3}$' then raise exception 'Enter a 3-letter airport code (e.g. ORD)'; end if;
    if v_airline is null then raise exception 'Enter the airline carrier'; end if;
    if v_flight !~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$' then raise exception 'Enter a flight number like UA1234'; end if;
    if p_luggage is null then raise exception 'Enter the number of bags'; end if;
    v_key := 'airport:' || v_code;
  else
    v_code := null; v_flight := null; p_luggage := null; v_airline := null;
    v_key := 'place:' || trim(regexp_replace(lower(trim(p_location_name)), '[^a-z0-9]+', ' ', 'g'));
  end if;

  v_at := (p_date + p_time) at time zone 'America/Chicago';

  insert into public.trips (user_id, email, name, phone, direction, location_type, location_name,
                            location_key, trip_date, trip_time, entered_at,
                            airport_code, airline, flight_number, luggage, match_at)
  values (auth.uid(), lower(auth.jwt() ->> 'email'), trim(p_name), v_phone, p_direction, p_location_type,
          case when p_location_type = 'airport' then v_code else trim(p_location_name) end,
          v_key, p_date, p_time, v_at, nullif(v_code, ''), v_airline, nullif(v_flight, ''), p_luggage, v_at)
  returning * into v_trip;
  return v_trip;
end;
$$;
revoke execute on function public.submit_trip(text, text, text, text, text, date, time, text, text, text, int) from public, anon;
grant execute on function public.submit_trip(text, text, text, text, text, date, time, text, text, text, int) to authenticated;

-- 3) Matching is based only on location + date/time (within 30 minutes),
--    regardless of whether the trip is a group pick-up or group drop-off.
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

  select coalesce(array_agg(t.id), '{}') into v_ids
  from public.trips t
  where t.location_key = v_me.location_key
    and t.user_id <> v_me.user_id
    and abs(extract(epoch from (t.match_at - v_me.match_at))) <= 30 * 60;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('mode', 'none', 'matches', '[]'::jsonb, 'trip', to_jsonb(v_me));
  end if;

  select gm.group_id into v_group
  from public.group_members gm
  join public.group_members gm2 on gm2.group_id = gm.group_id
  where gm.trip_id = v_me.id and gm2.trip_id = any (v_ids)
  limit 1;

  if v_group is not null then
    select case when g.created_by = auth.uid() then 'A' else 'B' end into v_mode
    from public.ride_groups g where g.id = v_group;
  else
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
        'direction', m.direction,
        'location_name', m.location_name, 'match_at', m.match_at,
        'airline', m.airline, 'flight_number', m.flight_number,
        'flight_status', m.flight_status, 'luggage', m.luggage,
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

create index if not exists trips_location_match_idx on public.trips (location_key, match_at);
