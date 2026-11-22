use crate::types::{Bus, Station, Stop};
use serde_json::{json, Value};
use std::collections::HashMap;

fn text(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(if *b { "1" } else { "0" }.to_string()),
        _ => None,
    }
}
fn number(v: Option<&Value>) -> Option<f64> {
    text(v)
        .and_then(|s| s.parse().ok())
        .or_else(|| v.and_then(Value::as_f64))
}
fn integer(v: Option<&Value>) -> Option<i64> {
    number(v).map(|n| n as i64)
}

pub fn parse_stations(raw: &Value) -> Result<HashMap<String, Station>, String> {
    let list = raw.as_array().ok_or("Station catalogue is not an array")?;
    let mut out = HashMap::new();
    for value in list {
        let Some(obj) = value.as_object() else {
            continue;
        };
        let Some(id) = text(obj.get("id")) else {
            continue;
        };
        let coords = obj.get("coordinates").cloned().unwrap_or(Value::Null);
        let lines = obj
            .get("lines_for_station")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| text(Some(v))).collect())
            .unwrap_or_default();
        let mut types = HashMap::new();
        if let Some(additional) = obj
            .get("lines_for_station_additional_data")
            .and_then(Value::as_array)
        {
            for entry in additional {
                if let (Some(line), Some(kind)) = (
                    entry.get("line_number_for_display").and_then(Value::as_str),
                    entry.get("line_type"),
                ) {
                    types.insert(line.to_string(), kind.clone());
                }
            }
        }
        out.insert(
            id,
            Station {
                n: text(obj.get("name")).unwrap_or_default(),
                c: text(obj.get("station_id")),
                la: number(coords.get("latitude")),
                lo: number(coords.get("longitude")),
                l: lines,
                t: types,
            },
        );
    }
    if out.len() < 100 {
        return Err("Incomplete station catalogue".into());
    }
    Ok(out)
}

pub fn parse_stop(raw: &Value) -> Result<Value, String> {
    let list = raw.as_array().ok_or("NSmart response is not an array")?;
    if list.is_empty() {
        return Err("Empty NSmart response".into());
    }
    if list[0] == Value::Bool(false) {
        return Ok(
            json!({"error": {"type": "api", "code": list.get(1).cloned().unwrap_or(Value::Null)}}),
        );
    }
    let first = list[0].as_object().ok_or("Invalid NSmart response")?;
    if first.get("station_name").is_none() && first.get("gpsx").is_none() {
        return Ok(json!({"error": {"type": "api", "code": 3, "missing": true}}));
    }
    let mut buses = Vec::new();
    if first.get("just_coordinates").and_then(Value::as_str) != Some("1") {
        for entry in list {
            if entry.get("seconds_left").is_none() {
                continue;
            }
            let garage = text(entry.get("garage_no")).unwrap_or_default();
            let actual = text(entry.get("actual_line_number")).unwrap_or_default();
            let vehicle = entry
                .get("vehicles")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .cloned()
                .unwrap_or(Value::Null);
            let mut stops = Vec::new();
            let mut previous_tt = 0;
            if let Some(raw_stops) = entry.get("all_stations").and_then(Value::as_array) {
                for stop in raw_stops {
                    if !stop.is_object() {
                        continue;
                    }
                    let coords = stop.get("coordinates").cloned().unwrap_or(Value::Null);
                    let tt = integer(stop.get("tt_time")).unwrap_or(previous_tt);
                    previous_tt = tt;
                    stops.push(Stop {
                        id: text(stop.get("id")).unwrap_or_default(),
                        la: number(coords.get("latitude")),
                        lo: number(coords.get("longitude")),
                        tt,
                        slr: integer(stop.get("second_left_by_route")).unwrap_or(0),
                    });
                }
            }
            buses.push(Bus {
                line: text(entry.get("line_number")).unwrap_or_default(),
                dir: if actual.to_uppercase().ends_with('B') {
                    "B".into()
                } else {
                    "A".into()
                },
                actual,
                dest: text(entry.get("to_price")),
                title: text(entry.get("line_title")),
                seconds: integer(entry.get("seconds_left")).unwrap_or(0),
                between: integer(entry.get("stations_between")),
                planned: !garage.chars().all(|c| c.is_ascii_digit()),
                garage,
                lat: number(vehicle.get("lat")),
                lng: number(vehicle.get("lng")),
                cur: text(vehicle.get("station_name")),
                dep: text(entry.get("entered_departure_time")),
                next: integer(entry.get("next_station")).map(|n| n.max(0) as usize),
                stops,
            });
        }
    }
    Ok(json!({
        "name": text(first.get("station_name")),
        "buses": buses.iter().map(bus_json).collect::<Vec<_>>()
    }))
}

pub fn bus_json(bus: &Bus) -> Value {
    json!({
        "line": bus.line, "actual": bus.actual, "dir": bus.dir, "dest": bus.dest,
        "title": bus.title, "seconds": bus.seconds, "between": bus.between,
        "garage": bus.garage, "lat": bus.lat, "lng": bus.lng, "cur": bus.cur,
        "dep": bus.dep, "next": bus.next, "planned": bus.planned, "stops": bus.stops
    })
}

pub fn buses_from_value(value: &Value) -> Result<Vec<Bus>, String> {
    let response = parse_stop(value)?;
    if response.get("error").is_some() {
        return Ok(Vec::new());
    }
    let list = response["buses"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    for item in list {
        out.push(Bus {
            line: text(item.get("line")).unwrap_or_default(),
            actual: text(item.get("actual")).unwrap_or_default(),
            dir: text(item.get("dir")).unwrap_or_else(|| "A".into()),
            dest: text(item.get("dest")),
            title: text(item.get("title")),
            seconds: integer(item.get("seconds")).unwrap_or(0),
            between: integer(item.get("between")),
            garage: text(item.get("garage")).unwrap_or_default(),
            lat: number(item.get("lat")),
            lng: number(item.get("lng")),
            cur: text(item.get("cur")),
            dep: text(item.get("dep")),
            next: integer(item.get("next")).map(|n| n as usize),
            planned: item
                .get("planned")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            stops: serde_json::from_value(item.get("stops").cloned().unwrap_or_else(|| json!([])))
                .map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_live_fixture() {
        let raw: Value =
            serde_json::from_str(include_str!("../../tools/fixtures/raw_6712_live_far.json"))
                .unwrap();
        let buses = buses_from_value(&raw).unwrap();
        let bus = buses.iter().find(|b| b.garage == "1015").unwrap();
        assert_eq!(bus.line, "14S");
        assert_eq!(bus.next, Some(3));
        assert!(bus.stops.len() > 10);
        assert_eq!(bus.stops.iter().find(|s| s.id == "6712").unwrap().slr, 1209);
    }

    #[test]
    fn accepts_empty_and_rejects_api_error() {
        let empty: Value =
            serde_json::from_str(include_str!("../../tools/fixtures/raw_6539_empty.json")).unwrap();
        assert!(buses_from_value(&empty).unwrap().is_empty());
        assert!(parse_stop(&serde_json::json!([false, 3]))
            .unwrap()
            .get("error")
            .is_some());
    }

    #[test]
    fn line_names_match_existing_model() {
        use crate::types::line_base;
        let input = [
            "14S", "3A", "54\"A\"", "9A", "1GL", "10APT", "35ČL", "7A", "18A", "24Š",
        ];
        let expected = ["14", "3A", "54", "9", "1", "10", "35", "7A", "18A", "24"];
        for (line, base) in input.into_iter().zip(expected) {
            assert_eq!(line_base(line), base);
        }
    }
}
