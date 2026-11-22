use crate::nsmart::buses_from_value;
use crate::roads::RoadNetwork;
use crate::timetable::{active_departures, departure_ts, hhmm, TimetableTable, Trip};
use crate::types::{distance, line_base, Bus, BusItem, Position, Route, Station, Stop, Vehicle};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const LIVE_MAX_AGE: i64 = 40_000;
const HOLD_MAX: i64 = 20 * 60_000;
const END_GRACE: i64 = 90_000;
const MATCH_EXACT: i64 = 60_000;
const MATCH_NEAR: i64 = 6 * 60;
const ROUTE_TTL: i64 = 90 * 86_400_000;

#[derive(Debug, Clone)]
struct TimePoint {
    t: f64,
    la: f64,
    lo: f64,
    j: f64,
}

pub struct Engine {
    pub stations: HashMap<String, Station>,
    pub routes: HashMap<String, Route>,
    pub vehicles: HashMap<String, Vehicle>,
    pub timetables: HashMap<String, TimetableTable>,
    pub roads: Option<RoadNetwork>,
    trips: Vec<Trip>,
    matched: HashMap<String, String>,
    trip_of: HashMap<String, Trip>,
    trips_at: i64,
}

impl Engine {
    pub fn new(
        stations: HashMap<String, Station>,
        routes: HashMap<String, Route>,
        roads: Option<RoadNetwork>,
    ) -> Self {
        Self {
            stations,
            routes,
            vehicles: HashMap::new(),
            timetables: HashMap::new(),
            roads,
            trips: Vec::new(),
            matched: HashMap::new(),
            trip_of: HashMap::new(),
            trips_at: 0,
        }
    }

    pub fn is_city(&self, base: &str) -> bool {
        self.stations.values().any(|s| {
            s.l.iter().any(|line| {
                line_base(line) == base && s.t.get(line).and_then(Value::as_str) == Some("1")
            })
        }) || base.parse::<u32>().is_ok_and(|n| n < 21)
    }

    fn learn_route(&mut self, bus: &Bus, now: i64) -> Option<String> {
        if bus.line.is_empty() || bus.stops.len() < 2 {
            return None;
        }
        let key = format!(
            "{}|{}|{}|{}",
            bus.line,
            bus.stops.first()?.id,
            bus.stops.last()?.id,
            bus.stops.len()
        );
        if let Some(old) = self.routes.get_mut(&key) {
            if now - old.t < 3_600_000 {
                old.t = old.t.max(now);
                return Some(key);
            }
        }
        let stops = bus
            .stops
            .iter()
            .map(|stop| {
                let station = self.stations.get(&stop.id);
                Stop {
                    id: stop.id.clone(),
                    la: stop.la.or_else(|| station.and_then(|s| s.la)),
                    lo: stop.lo.or_else(|| station.and_then(|s| s.lo)),
                    tt: stop.tt,
                    slr: stop.slr,
                }
            })
            .collect();
        self.routes.insert(
            key.clone(),
            Route {
                k: key.clone(),
                line: bus.line.clone(),
                base: line_base(&bus.line),
                dir: bus.dir.clone(),
                actual: bus.actual.clone(),
                title: bus.title.clone(),
                dest: bus.dest.clone(),
                s: stops,
                t: now,
            },
        );
        Some(key)
    }

    pub fn observe(&mut self, raw: &Value, now: i64) -> Result<usize, String> {
        let buses = buses_from_value(raw)?;
        let mut changed = 0;
        for bus in buses {
            if bus.planned || bus.line.is_empty() {
                continue;
            }
            if self
                .vehicles
                .get(&bus.garage)
                .is_some_and(|old| now < old.obs_at)
            {
                continue;
            }
            let rk = self.learn_route(&bus, now);
            let sig = format!(
                "{}|{:?}|{:?}|{:?}|{:?}",
                bus.line, bus.dep, bus.lat, bus.lng, bus.next
            );
            if let Some(old) = self.vehicles.get_mut(&bus.garage) {
                if old.sig == sig {
                    old.seen_at = old.seen_at.max(now);
                    continue;
                }
            }
            let vehicle = Vehicle {
                g: bus.garage.clone(),
                base: line_base(&bus.line),
                line: bus.line,
                dir: bus.dir,
                dest: bus.dest,
                title: bus.title,
                dep: bus.dep,
                lat: bus.lat,
                lng: bus.lng,
                next: bus.next,
                rk,
                slr: bus.stops.iter().map(|s| s.slr).collect(),
                obs_at: now,
                seen_at: now,
                sig,
            };
            self.vehicles.insert(bus.garage, vehicle);
            changed += 1;
        }
        self.trips_at = 0;
        Ok(changed)
    }

    fn timeline(&self, vehicle: &Vehicle) -> Vec<TimePoint> {
        let Some(route) = vehicle.rk.as_ref().and_then(|key| self.routes.get(key)) else {
            return vehicle
                .lat
                .zip(vehicle.lng)
                .map(|(la, lo)| {
                    vec![TimePoint {
                        t: 0.0,
                        la,
                        lo,
                        j: -1.0,
                    }]
                })
                .unwrap_or_default();
        };
        let stops = &route.s;
        if stops.is_empty() {
            return Vec::new();
        }
        let k = vehicle
            .next
            .unwrap_or(1)
            .saturating_sub(1)
            .min(stops.len() - 1);
        let mut points = Vec::new();
        if let Some((la, lo)) = vehicle.lat.zip(vehicle.lng) {
            points.push(TimePoint {
                t: 0.0,
                la,
                lo,
                j: k as f64 - 0.5,
            });
        } else if let Some(previous) = k
            .checked_sub(1)
            .and_then(|i| stops.get(i))
            .or_else(|| stops.first())
        {
            if let Some((la, lo)) = previous.la.zip(previous.lo) {
                points.push(TimePoint {
                    t: 0.0,
                    la,
                    lo,
                    j: k.saturating_sub(1) as f64,
                });
            }
        }
        if points.is_empty() {
            return points;
        }
        let mut last_t = 0.0;
        let mut any = false;
        for (j, stop) in stops.iter().enumerate().skip(k) {
            let t = vehicle.slr.get(j).copied().unwrap_or(stop.slr);
            if t > 0 && t as f64 >= last_t && stop.la.is_some() && stop.lo.is_some() {
                points.push(TimePoint {
                    t: t as f64,
                    la: stop.la.unwrap(),
                    lo: stop.lo.unwrap(),
                    j: j as f64,
                });
                last_t = t as f64;
                any = true;
            }
        }
        if !any {
            points.truncate(1);
            let t0 = if stops[k].la.is_some() {
                distance(
                    points[0].la,
                    points[0].lo,
                    stops[k].la.unwrap(),
                    stops[k].lo.unwrap(),
                ) / 7.0
            } else {
                60.0
            };
            for (j, stop) in stops.iter().enumerate().skip(k) {
                if let (Some(la), Some(lo)) = (stop.la, stop.lo) {
                    points.push(TimePoint {
                        t: t0 + (stop.tt - stops[k].tt) as f64 * 60.0,
                        la,
                        lo,
                        j: j as f64,
                    });
                }
            }
        }
        points
    }

    fn along(&self, points: &[TimePoint], seconds: f64) -> Option<Position> {
        if points.is_empty() {
            return None;
        }
        if points.len() == 1 || seconds <= 0.0 {
            let first = &points[0];
            let (la, lo, aligned) = if let Some(next) = points.get(1) {
                if let Some(roads) = &self.roads {
                    if let Some(path) = roads.path(first.la, first.lo, next.la, next.lo) {
                        let p = roads.point(&path, 0.0);
                        (p.0, p.1, true)
                    } else {
                        (first.la, first.lo, false)
                    }
                } else {
                    (first.la, first.lo, false)
                }
            } else {
                (first.la, first.lo, false)
            };
            return Some(Position {
                la,
                lo,
                next_j: points
                    .get(1)
                    .and_then(|p| if p.j >= 0.0 { Some(p.j as usize) } else { None }),
                done: false,
                over: 0.0,
                left: 0.0,
                road_aligned: aligned,
            });
        }
        for pair in points.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            if seconds <= b.t {
                let fraction = if b.t > a.t {
                    ((seconds - a.t) / (b.t - a.t)).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let (la, lo, aligned) = if let Some(roads) = &self.roads {
                    if let Some(path) = roads.path(a.la, a.lo, b.la, b.lo) {
                        let p = roads.point(&path, fraction);
                        (p.0, p.1, true)
                    } else {
                        (
                            a.la + (b.la - a.la) * fraction,
                            a.lo + (b.lo - a.lo) * fraction,
                            false,
                        )
                    }
                } else {
                    (
                        a.la + (b.la - a.la) * fraction,
                        a.lo + (b.lo - a.lo) * fraction,
                        false,
                    )
                };
                return Some(Position {
                    la,
                    lo,
                    next_j: if b.j >= 0.0 { Some(b.j as usize) } else { None },
                    done: false,
                    over: 0.0,
                    left: b.t - seconds,
                    road_aligned: aligned,
                });
            }
        }
        let last = points.last().unwrap();
        Some(Position {
            la: last.la,
            lo: last.lo,
            next_j: None,
            done: true,
            over: seconds - last.t,
            left: 0.0,
            road_aligned: false,
        })
    }

    fn vehicle_position(&self, vehicle: &Vehicle, now: i64) -> Option<Position> {
        self.along(
            &self.timeline(vehicle),
            (now - vehicle.obs_at) as f64 / 1000.0,
        )
    }

    fn fresh(vehicle: &Vehicle, now: i64) -> bool {
        vehicle.lat.is_some() && vehicle.lng.is_some() && now - vehicle.obs_at <= LIVE_MAX_AGE
    }

    fn prune(&mut self, now: i64) {
        let remove: Vec<String> = self
            .vehicles
            .keys()
            .filter(|key| {
                let vehicle = &self.vehicles[*key];
                if now - vehicle.seen_at > HOLD_MAX {
                    return true;
                }
                self.vehicle_position(vehicle, now)
                    .is_none_or(|p| p.done && p.over * 1000.0 > END_GRACE as f64)
            })
            .cloned()
            .collect();
        for key in remove {
            self.vehicles.remove(&key);
        }
    }

    fn route_for(&self, base: &str, dir: &str, mark: Option<&str>) -> Option<&Route> {
        let candidates: Vec<&Route> = self
            .routes
            .values()
            .filter(|r| r.base == base && r.dir == dir)
            .collect();
        let normalize = |s: &str| {
            s.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .flat_map(char::to_uppercase)
                .collect::<String>()
        };
        let suffix =
            |route: &Route| normalize(route.line.strip_prefix(&route.base).unwrap_or(&route.line));
        let mut wanted = String::new();
        if let Some(mark) = mark {
            let m = normalize(mark);
            let mut tries = vec![m.clone()];
            if m.starts_with("NR") && m.len() > 2 {
                tries.push(m[2..].into());
            }
            if m.starts_with('N') && m.len() > 1 {
                tries.push(m[1..].into());
            }
            for attempt in tries {
                if candidates.iter().any(|r| suffix(r) == attempt) {
                    wanted = attempt;
                    break;
                }
                let hits: HashSet<String> = candidates
                    .iter()
                    .map(|r| suffix(r))
                    .filter(|s| {
                        !s.is_empty() && (s.starts_with(&attempt) || attempt.starts_with(s))
                    })
                    .collect();
                if hits.len() == 1 {
                    wanted = hits.into_iter().next().unwrap();
                    break;
                }
            }
        }
        let mut pool: Vec<&Route> = candidates
            .iter()
            .copied()
            .filter(|r| suffix(r) == wanted)
            .collect();
        if pool.is_empty() {
            pool = candidates;
        }
        pool.sort_by(|a, b| b.s.len().cmp(&a.s.len()).then(b.t.cmp(&a.t)));
        pool.first().copied()
    }

    fn progress(&self, vehicle: &Vehicle, now: i64) -> Option<f64> {
        let route = self.routes.get(vehicle.rk.as_ref()?)?;
        let position = self.vehicle_position(vehicle, now)?;
        if let Some(next) = position.next_j {
            Some(route.s.get(next)?.tt as f64 * 60.0 - position.left)
        } else {
            Some(route.s.last()?.tt as f64 * 60.0)
        }
    }

    fn refresh_trips(&mut self, now: i64) {
        let mut trips = Vec::new();
        for mut trip in active_departures(&self.timetables, now, now - 3 * 3_600_000, now, None) {
            let Some(route) = self.route_for(&trip.base, &trip.dir, trip.mark.as_deref()) else {
                continue;
            };
            if now > trip.dep_ts + route.s.last().map_or(0, |s| s.tt) * 60_000 + 60_000 {
                continue;
            }
            trip.rk = Some(route.k.clone());
            trip.line = Some(route.line.clone());
            trips.push(trip);
        }
        let mut matched = HashMap::new();
        let mut trip_of: HashMap<String, Trip> = HashMap::new();
        for vehicle in self.vehicles.values() {
            let Some(dep) = departure_ts(vehicle.dep.as_deref(), now) else {
                continue;
            };
            let candidate = trips
                .iter()
                .filter(|t| {
                    !matched.contains_key(&t.id)
                        && t.base == vehicle.base
                        && t.dir == vehicle.dir
                        && (t.dep_ts - dep).abs() <= MATCH_EXACT
                })
                .min_by_key(|t| (t.dep_ts - dep).abs());
            if let Some(trip) = candidate {
                matched.insert(trip.id.clone(), vehicle.g.clone());
                trip_of.insert(vehicle.g.clone(), trip.clone());
            }
        }
        for vehicle in self.vehicles.values() {
            if trip_of.contains_key(&vehicle.g) {
                continue;
            }
            let Some(progress) = self.progress(vehicle, now) else {
                continue;
            };
            let candidate = trips
                .iter()
                .filter(|t| {
                    !matched.contains_key(&t.id) && t.base == vehicle.base && t.dir == vehicle.dir
                })
                .map(|t| (t, (((now - t.dep_ts) as f64 / 1000.0) - progress).abs()))
                .filter(|(_, d)| *d <= MATCH_NEAR as f64)
                .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            if let Some((trip, _)) = candidate {
                matched.insert(trip.id.clone(), vehicle.g.clone());
                trip_of.insert(vehicle.g.clone(), trip.clone());
            }
        }
        self.trips = trips;
        self.matched = matched;
        self.trip_of = trip_of;
        self.trips_at = now;
    }

    fn trip_position(&self, trip: &Trip, now: i64) -> Option<Position> {
        let route = self.routes.get(trip.rk.as_ref()?)?;
        let points: Vec<TimePoint> = route
            .s
            .iter()
            .enumerate()
            .filter_map(|(j, s)| {
                Some(TimePoint {
                    t: s.tt as f64 * 60.0,
                    la: s.la?,
                    lo: s.lo?,
                    j: j as f64,
                })
            })
            .collect();
        self.along(&points, (now - trip.dep_ts) as f64 / 1000.0)
    }

    pub fn snapshot(
        &mut self,
        now: i64,
        focus: Option<&str>,
        city: bool,
        suburban: bool,
    ) -> Vec<BusItem> {
        if now - self.trips_at > 15_000 {
            self.prune(now);
            self.refresh_trips(now);
        }
        let want = |base: &str| {
            focus.is_some_and(|f| f == base)
                || (focus.is_none() && if self.is_city(base) { city } else { suburban })
        };
        let mut out = Vec::new();
        for vehicle in self.vehicles.values() {
            if !want(&vehicle.base) {
                continue;
            }
            let Some(position) = self.vehicle_position(vehicle, now) else {
                continue;
            };
            if position.done && position.over * 1000.0 > END_GRACE as f64 {
                continue;
            }
            let route = vehicle.rk.as_ref().and_then(|key| self.routes.get(key));
            let trip = self.trip_of.get(&vehicle.g);
            out.push(BusItem {
                id: format!("v{}", vehicle.g),
                kind: if Self::fresh(vehicle, now) {
                    "gps".into()
                } else {
                    "est".into()
                },
                base: vehicle.base.clone(),
                line: vehicle.line.clone(),
                dir: vehicle.dir.clone(),
                dest: vehicle
                    .dest
                    .clone()
                    .or_else(|| route.and_then(|r| r.dest.clone())),
                title: vehicle.title.clone(),
                la: position.la,
                lo: position.lo,
                garage: Some(vehicle.g.clone()),
                road_aligned: position.road_aligned,
                age: Some(((now - vehicle.obs_at) / 1000).max(0)),
                next: position
                    .next_j
                    .and_then(|j| route.and_then(|r| r.s.get(j)))
                    .and_then(|s| self.station_name(&s.id)),
                dep: vehicle
                    .dep
                    .as_deref()
                    .filter(|d| *d != "00:00:00")
                    .map(|d| d[..5.min(d.len())].to_string())
                    .or_else(|| trip.map(|t| hhmm(t.dep_ts))),
                rk: vehicle.rk.clone(),
            });
        }
        for trip in &self.trips {
            if self.matched.contains_key(&trip.id) || !want(&trip.base) {
                continue;
            }
            let Some(position) = self.trip_position(trip, now) else {
                continue;
            };
            if position.done || now < trip.dep_ts {
                continue;
            }
            let route = trip.rk.as_ref().and_then(|key| self.routes.get(key));
            out.push(BusItem {
                id: format!("t{}", trip.id),
                kind: "sched".into(),
                base: trip.base.clone(),
                line: trip.line.clone().unwrap_or_else(|| trip.base.clone()),
                dir: trip.dir.clone(),
                dest: trip
                    .dest
                    .clone()
                    .or_else(|| route.and_then(|r| r.dest.clone())),
                title: route.and_then(|r| r.title.clone()),
                la: position.la,
                lo: position.lo,
                garage: None,
                road_aligned: position.road_aligned,
                age: None,
                next: position
                    .next_j
                    .and_then(|j| route.and_then(|r| r.s.get(j)))
                    .and_then(|s| self.station_name(&s.id)),
                dep: Some(hhmm(trip.dep_ts)),
                rk: trip.rk.clone(),
            });
        }
        out
    }

    fn station_name(&self, uid: &str) -> Option<String> {
        self.stations
            .get(uid)
            .map(|s| s.n.clone())
            .filter(|s| !s.is_empty())
    }

    pub fn route_json(&self, key: &str) -> Option<Value> {
        let route = self.routes.get(key)?;
        let mut shape = Vec::new();
        for pair in route.s.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            let (Some(a_la), Some(a_lo), Some(b_la), Some(b_lo)) = (a.la, a.lo, b.la, b.lo) else {
                continue;
            };
            if let Some(roads) = &self.roads {
                if let Some(path) = roads.path(a_la, a_lo, b_la, b_lo) {
                    shape.extend(roads.coordinates(&path));
                    continue;
                }
            }
            shape.push([a_la, a_lo]);
            shape.push([b_la, b_lo]);
        }
        Some(
            json!({"route": route, "shape": shape, "stops": route.s.iter().map(|s| json!({"id": s.id, "la": s.la, "lo": s.lo, "name": self.station_name(&s.id)})).collect::<Vec<_>>()}),
        )
    }

    pub fn routes_of(&self, base: &str, now: i64) -> Vec<Value> {
        self.routes
            .values()
            .filter(|r| r.base == base && now - r.t < ROUTE_TTL)
            .filter_map(|r| self.route_json(&r.k))
            .collect()
    }

    pub fn lines_json(&self) -> Value {
        let mut lines: HashMap<String, (bool, HashSet<String>, HashSet<String>)> = HashMap::new();
        for (uid, station) in &self.stations {
            for line in &station.l {
                let base = line_base(line);
                let entry = lines
                    .entry(base)
                    .or_insert_with(|| (false, HashSet::new(), HashSet::new()));
                entry.0 |= station.t.get(line).and_then(Value::as_str) == Some("1");
                entry.1.insert(line.clone());
                entry.2.insert(uid.clone());
            }
        }
        let mut list: Vec<Value> = lines
            .into_iter()
            .map(|(base, (city, variants, stops))| {
                let mut variants: Vec<_> = variants.into_iter().collect();
                variants.sort();
                json!({"base": base, "city": city, "variants": variants, "stops": stops.len()})
            })
            .collect();
        list.sort_by(|a, b| {
            let a = a["base"].as_str().unwrap_or("");
            let b = b["base"].as_str().unwrap_or("");
            match (a.parse::<u32>(), b.parse::<u32>()) {
                (Ok(x), Ok(y)) => x.cmp(&y).then(a.cmp(b)),
                (Ok(_), Err(_)) => std::cmp::Ordering::Less,
                (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
                _ => a.cmp(b),
            }
        });
        Value::Array(list)
    }

    pub fn arrivals(
        &mut self,
        raw: &Value,
        uid: &str,
        now: i64,
        received_at: i64,
    ) -> Result<Value, String> {
        let buses = buses_from_value(raw)?;
        self.observe(raw, received_at)?;
        self.prune(now);
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for bus in buses {
            if bus.planned {
                continue;
            }
            let known = self.vehicles.get(&bus.garage);
            if known.is_some_and(|v| v.obs_at > received_at) {
                continue;
            }
            seen.insert(bus.garage.clone());
            out.push(json!({"kind": if known.is_some_and(|v| Self::fresh(v, now)) { "gps" } else { "est" }, "base": line_base(&bus.line),
                "line": bus.line, "dest": bus.dest, "eta": (bus.seconds - (now - received_at) / 1000).max(0), "between": bus.between,
                "garage": bus.garage, "dep": bus.dep.as_deref().filter(|d| *d != "00:00:00").map(|d| d[..5.min(d.len())].to_string())}));
        }
        for vehicle in self.vehicles.values() {
            if seen.contains(&vehicle.g) || now - vehicle.seen_at > HOLD_MAX {
                continue;
            }
            let Some(route) = vehicle.rk.as_ref().and_then(|key| self.routes.get(key)) else {
                continue;
            };
            let seconds = (now - vehicle.obs_at) as f64 / 1000.0;
            let timeline = self.timeline(vehicle);
            if let Some(point) = timeline
                .iter()
                .find(|p| p.j >= 0.0 && route.s.get(p.j as usize).is_some_and(|s| s.id == uid))
            {
                let eta = point.t - seconds;
                if (-30.0..=3600.0).contains(&eta) {
                    seen.insert(vehicle.g.clone());
                    out.push(
                        json!({"kind": "est", "base": vehicle.base, "line": vehicle.line,
                    "dest": vehicle.dest, "eta": eta.round().max(0.0), "garage": vehicle.g}),
                    );
                }
            }
        }
        if now - self.trips_at > 15_000 {
            self.refresh_trips(now);
        }
        for trip in active_departures(
            &self.timetables,
            now,
            now - 3 * 3_600_000,
            now + 3_600_000,
            None,
        ) {
            if self.matched.contains_key(&trip.id) {
                continue;
            }
            let Some(route) = self.route_for(&trip.base, &trip.dir, trip.mark.as_deref()) else {
                continue;
            };
            let Some(stop) = route.s.iter().find(|s| s.id == uid) else {
                continue;
            };
            let eta = (trip.dep_ts + stop.tt * 60_000 - now) / 1000;
            if !(-60..=3600).contains(&eta) {
                continue;
            }
            if out.iter().any(|o| {
                o["base"].as_str() == Some(&trip.base)
                    && o["kind"].as_str() != Some("sched")
                    && (o["eta"].as_i64().unwrap_or(0) - eta).abs() < MATCH_NEAR
            }) {
                continue;
            }
            out.push(json!({"kind": "sched", "base": trip.base, "line": route.line, "dest": trip.dest.or_else(|| route.dest.clone()), "eta": eta.max(0), "dep": hhmm(trip.dep_ts)}));
        }
        out.sort_by_key(|v| v["eta"].as_i64().unwrap_or(0));
        Ok(json!({"name": self.station_name(uid), "list": out, "at": now, "dataAt": received_at}))
    }

    pub fn poll_plan(
        &self,
        focus: Option<&str>,
        city: bool,
        suburban: bool,
        viewport: Option<[f64; 4]>,
        polled_at: &HashMap<String, i64>,
        now: i64,
    ) -> Vec<String> {
        let want = |base: &str| {
            focus.is_some_and(|f| f == base)
                || (focus.is_none() && if self.is_city(base) { city } else { suburban })
        };
        let mut chosen = HashSet::new();
        let mut order = Vec::new();
        let mut routes: Vec<&Route> = self
            .routes
            .values()
            .filter(|r| want(&r.base) && now - r.t < ROUTE_TTL)
            .collect();
        routes.sort_by_key(|r| std::cmp::Reverse(r.s.len()));
        for route in routes {
            if route.s.len() < 3 {
                if let Some(s) = route.s.last() {
                    if chosen.insert(s.id.clone()) {
                        order.push(s.id.clone());
                    }
                }
                continue;
            }
            let mut i = route.s.len() - 2;
            loop {
                let id = &route.s[i].id;
                if chosen.insert(id.clone()) {
                    order.push(id.clone());
                }
                if i <= 1 {
                    break;
                }
                let mut j = i - 1;
                while j > 1 && route.s[i].tt - route.s[j - 1].tt <= 10 {
                    j -= 1;
                }
                i = j;
            }
        }
        let local = |uid: &String| {
            let Some(area) = viewport else { return false };
            self.stations.get(uid).is_some_and(|s| {
                s.la.is_some_and(|la| la >= area[0] && la <= area[1])
                    && s.lo.is_some_and(|lo| lo >= area[2] && lo <= area[3])
            })
        };
        let age = |a: &String, b: &String| {
            polled_at
                .get(a)
                .copied()
                .unwrap_or(0)
                .cmp(&polled_at.get(b).copied().unwrap_or(0))
        };
        let mut visible: Vec<String> = order.iter().filter(|u| local(u)).cloned().collect();
        visible.sort_by(age);
        visible.truncate(24);
        let selected: HashSet<String> = visible.iter().cloned().collect();
        let mut rest: Vec<String> = order
            .into_iter()
            .filter(|u| !selected.contains(u))
            .collect();
        rest.sort_by(age);
        visible.extend(rest.into_iter().take(32usize.saturating_sub(visible.len())));
        visible
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::new(HashMap::new(), HashMap::new(), None)
    }

    #[test]
    fn projects_real_vehicle_to_observed_stop() {
        let raw: Value =
            serde_json::from_str(include_str!("../../tools/fixtures/raw_6712_live_far.json"))
                .unwrap();
        let mut engine = engine();
        let now = 1_800_000_000_000;
        engine.observe(&raw, now).unwrap();
        let vehicle = &engine.vehicles["1015"];
        let at_stop = engine.vehicle_position(vehicle, now + 1_209_000).unwrap();
        let route = &engine.routes[vehicle.rk.as_ref().unwrap()];
        let stop = route.s.iter().find(|s| s.id == "6712").unwrap();
        assert!(distance(at_stop.la, at_stop.lo, stop.la.unwrap(), stop.lo.unwrap()) < 1.0);
        assert!(
            engine
                .vehicle_position(vehicle, now + 3_000_000)
                .unwrap()
                .done
        );
    }

    #[test]
    fn cached_gps_does_not_reset_observation_time() {
        let raw: Value =
            serde_json::from_str(include_str!("../../tools/fixtures/raw_6712_live_far.json"))
                .unwrap();
        let mut engine = engine();
        let now = 1_800_000_000_000;
        engine.observe(&raw, now).unwrap();
        engine.observe(&raw, now + 60_000).unwrap();
        let vehicle = &engine.vehicles["1015"];
        assert_eq!(vehicle.obs_at, now);
        assert!(!Engine::fresh(vehicle, now + 60_000));
    }
}
