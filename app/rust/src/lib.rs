mod gate;
mod model;
mod nsmart;
mod roads;
mod timetable;
mod types;

use gate::Gate;
use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jlong, jstring};
use jni::JNIEnv;
use model::Engine;
use roads::RoadNetwork;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock};
use timetable::TimetableTable;
use types::{Route, Station};

fn engines() -> &'static Mutex<HashMap<i64, Engine>> {
    static ENGINES: OnceLock<Mutex<HashMap<i64, Engine>>> = OnceLock::new();
    ENGINES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn gates() -> &'static Mutex<HashMap<i64, Gate>> {
    static GATES: OnceLock<Mutex<HashMap<i64, Gate>>> = OnceLock::new();
    GATES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn next_handle() -> i64 {
    static NEXT: AtomicI64 = AtomicI64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn json_arg(env: &mut JNIEnv, value: &JString) -> Result<Value, String> {
    let text: String = env.get_string(value).map_err(|e| e.to_string())?.into();
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
fn string_arg(env: &mut JNIEnv, value: &JString) -> Result<String, String> {
    Ok(env.get_string(value).map_err(|e| e.to_string())?.into())
}
fn json_return(env: &mut JNIEnv, value: Value) -> jstring {
    match serde_json::to_string(&value) {
        Ok(text) => env.new_string(text).expect("JSON string").into_raw(),
        Err(error) => {
            let _ = env.throw_new("java/lang/RuntimeException", error.to_string());
            std::ptr::null_mut()
        }
    }
}
fn fail(env: &mut JNIEnv, error: String) -> jstring {
    let _ = env.throw_new("java/lang/RuntimeException", error);
    std::ptr::null_mut()
}
fn engine_json(
    env: &mut JNIEnv,
    handle: jlong,
    action: impl FnOnce(&mut Engine) -> Result<Value, String>,
) -> jstring {
    let result = engines()
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|mut engines| {
            let engine = engines
                .get_mut(&handle)
                .ok_or_else(|| "Rust engine is closed".to_string())?;
            action(engine)
        });
    match result {
        Ok(value) => json_return(env, value),
        Err(error) => fail(env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeDayType(
    env: JNIEnv,
    _class: JClass,
    timestamp: jlong,
) -> jstring {
    env.new_string(timetable::fallback_day_type(&timetable::iso_day(timestamp)))
        .expect("day type")
        .into_raw()
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeVersion(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    env.new_string("Trecker Rust Core 2.0")
        .expect("UTF-8")
        .into_raw()
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeParseStations(
    mut env: JNIEnv,
    _class: JClass,
    raw: JString,
) -> jstring {
    match json_arg(&mut env, &raw).and_then(|v| nsmart::parse_stations(&v)) {
        Ok(stations) => json_return(&mut env, json!(stations)),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeSetStations(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    raw: JString,
) -> jstring {
    match json_arg(&mut env, &raw) {
        Ok(raw) => engine_json(&mut env, handle, |engine| {
            engine.stations = if raw.as_array().is_some() {
                nsmart::parse_stations(&raw)?
            } else {
                serde_json::from_value(raw).map_err(|e| e.to_string())?
            };
            Ok(json!(true))
        }),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    stations: JString,
    routes: JString,
    roads: JString,
) -> jlong {
    let result = (|| -> Result<i64, String> {
        let stations_value = json_arg(&mut env, &stations)?;
        let stations: HashMap<String, Station> = if stations_value.as_array().is_some() {
            nsmart::parse_stations(&stations_value)?
        } else {
            serde_json::from_value(stations_value).map_err(|e| e.to_string())?
        };
        let routes: HashMap<String, Route> =
            serde_json::from_value(json_arg(&mut env, &routes)?).map_err(|e| e.to_string())?;
        let roads_value = json_arg(&mut env, &roads)?;
        let roads = if roads_value.is_null() {
            None
        } else {
            Some(RoadNetwork::from_json(&roads_value)?)
        };
        let handle = next_handle();
        engines()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(handle, Engine::new(stations, routes, roads));
        Ok(handle)
    })();
    match result {
        Ok(handle) => handle,
        Err(error) => {
            fail(&mut env, error);
            0
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if let Ok(mut engines) = engines().lock() {
        engines.remove(&handle);
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeObserve(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    raw: JString,
    now: jlong,
) -> jstring {
    match json_arg(&mut env, &raw) {
        Ok(raw) => engine_json(&mut env, handle, |engine| {
            let changed = engine.observe(&raw, now)?;
            Ok(json!({"changed": changed}))
        }),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeSnapshot(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    now: jlong,
    focus: JString,
    city: jboolean,
    suburban: jboolean,
) -> jstring {
    let focus = string_arg(&mut env, &focus).unwrap_or_default();
    engine_json(&mut env, handle, |engine| {
        Ok(json!(engine.snapshot(
            now,
            if focus.is_empty() {
                None
            } else {
                Some(focus.as_str())
            },
            city != 0,
            suburban != 0
        )))
    })
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeRoutes(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    base: JString,
    now: jlong,
) -> jstring {
    let base = string_arg(&mut env, &base).unwrap_or_default();
    engine_json(&mut env, handle, |engine| {
        Ok(json!(engine.routes_of(&base, now)))
    })
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeRoute(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    key: JString,
) -> jstring {
    let key = string_arg(&mut env, &key).unwrap_or_default();
    engine_json(&mut env, handle, |engine| {
        Ok(engine.route_json(&key).unwrap_or(Value::Null))
    })
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeLines(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    engine_json(&mut env, handle, |engine| Ok(engine.lines_json()))
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeArrivals(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    raw: JString,
    uid: JString,
    now: jlong,
    received_at: jlong,
) -> jstring {
    let uid = string_arg(&mut env, &uid).unwrap_or_default();
    match json_arg(&mut env, &raw) {
        Ok(raw) => engine_json(&mut env, handle, |engine| {
            engine.arrivals(&raw, &uid, now, received_at)
        }),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativePollPlan(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    focus: JString,
    city: jboolean,
    suburban: jboolean,
    viewport: JString,
    polled: JString,
    now: jlong,
) -> jstring {
    let focus = string_arg(&mut env, &focus).unwrap_or_default();
    let viewport_value = json_arg(&mut env, &viewport).unwrap_or(Value::Null);
    let area = viewport_value.as_array().and_then(|a| {
        if a.len() == 4 {
            Some([
                a[0].as_f64()?,
                a[1].as_f64()?,
                a[2].as_f64()?,
                a[3].as_f64()?,
            ])
        } else {
            None
        }
    });
    let polled: HashMap<String, i64> =
        serde_json::from_value(json_arg(&mut env, &polled).unwrap_or_else(|_| json!({})))
            .unwrap_or_default();
    engine_json(&mut env, handle, |engine| {
        Ok(json!(engine.poll_plan(
            if focus.is_empty() {
                None
            } else {
                Some(focus.as_str())
            },
            city != 0,
            suburban != 0,
            area,
            &polled,
            now
        )))
    })
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeExportRoutes(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    engine_json(&mut env, handle, |engine| Ok(json!(engine.routes)))
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeSetTimetable(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    table: JString,
) -> jstring {
    match json_arg(&mut env, &table) {
        Ok(value) => engine_json(&mut env, handle, |engine| {
            let table: TimetableTable = serde_json::from_value(value).map_err(|e| e.to_string())?;
            engine
                .timetables
                .insert(format!("{}|{}", table.rv, table.dan), table);
            Ok(json!(true))
        }),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeParseIndex(
    mut env: JNIEnv,
    _class: JClass,
    html: JString,
) -> jstring {
    match string_arg(&mut env, &html) {
        Ok(html) => json_return(&mut env, timetable::parse_index(&html)),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeParseOptions(
    mut env: JNIEnv,
    _class: JClass,
    html: JString,
) -> jstring {
    match string_arg(&mut env, &html) {
        Ok(html) => json_return(&mut env, json!(timetable::parse_options(&html))),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeParseTimetables(
    mut env: JNIEnv,
    _class: JClass,
    html: JString,
) -> jstring {
    match string_arg(&mut env, &html) {
        Ok(html) => json_return(&mut env, json!(timetable::parse_timetables(&html))),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateCreate(
    _env: JNIEnv,
    _class: JClass,
) -> jlong {
    let handle = next_handle();
    if let Ok(mut gates) = gates().lock() {
        gates.insert(handle, Gate::default());
    }
    handle
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if let Ok(mut gates) = gates().lock() {
        gates.remove(&handle);
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateBegin(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
    now: jlong,
) -> jstring {
    let mut env = env;
    let result = gates()
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|mut gates| {
            let gate = gates
                .get_mut(&handle)
                .ok_or_else(|| "Rust gate is closed".to_string())?;
            Ok(gate.begin(now))
        });
    match result {
        Ok(value) => json_return(&mut env, value),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateSuccess(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if let Ok(mut gates) = gates().lock() {
        if let Some(gate) = gates.get_mut(&handle) {
            gate.success();
        }
    }
    let _ = env;
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateFailure(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    now: jlong,
    status: jlong,
    retry_after: jlong,
) {
    if let Ok(mut gates) = gates().lock() {
        if let Some(gate) = gates.get_mut(&handle) {
            gate.failure(
                now,
                if status > 0 { Some(status) } else { None },
                if retry_after >= 0 {
                    Some(retry_after)
                } else {
                    None
                },
            );
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateState(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    let mut env = env;
    let result = gates().lock().map_err(|e| e.to_string()).and_then(|gates| {
        let gate = gates
            .get(&handle)
            .ok_or_else(|| "Rust gate is closed".to_string())?;
        serde_json::to_value(gate).map_err(|e| e.to_string())
    });
    match result {
        Ok(value) => json_return(&mut env, value),
        Err(error) => fail(&mut env, error),
    }
}

#[no_mangle]
pub extern "system" fn Java_rs_trecker_RustCore_nativeGateRestore(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    state: JString,
) {
    if let Ok(state) = json_arg(&mut env, &state) {
        if let Ok(saved) = serde_json::from_value::<Gate>(state) {
            if let Ok(mut gates) = gates().lock() {
                if let Some(gate) = gates.get_mut(&handle) {
                    *gate = saved;
                }
            }
        }
    }
}

#[cfg(test)]
mod native_seed_tests {
    use super::*;

    #[test]
    fn loads_bundled_stations_routes_and_roads() {
        let stations: HashMap<String, Station> = serde_json::from_str(include_str!(
            "../../native/app/src/main/assets/stations.json"
        ))
        .unwrap();
        let routes: HashMap<String, Route> =
            serde_json::from_str(include_str!("../../native/app/src/main/assets/routes.json"))
                .unwrap();
        let roads: Value =
            serde_json::from_str(include_str!("../../native/app/src/main/assets/roads.json"))
                .unwrap();
        let network = RoadNetwork::from_json(&roads).unwrap();
        assert!(stations.len() > 100);
        assert!(!routes.is_empty());
        let route = routes.values().find(|route| route.base == "14").unwrap();
        let a = &route.s[4];
        let b = &route.s[5];
        let path = network.path(a.la.unwrap(), a.lo.unwrap(), b.la.unwrap(), b.lo.unwrap());
        assert!(path.is_some());
    }
}
