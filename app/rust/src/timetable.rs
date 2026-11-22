use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone};
use chrono_tz::Europe::Belgrade;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineOption {
    pub value: String,
    pub label: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Departure {
    pub t: String,
    pub mark: Option<String>,
    pub low: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Direction {
    pub header: String,
    pub departures: Vec<Departure>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineTable {
    pub title: String,
    pub directions: Vec<Direction>,
    pub legend: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimetableTable {
    pub key: String,
    pub rv: String,
    pub dan: String,
    pub vaziod: String,
    pub fetched: i64,
    pub options: Vec<LineOption>,
    pub lines: HashMap<String, LineTable>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Trip {
    pub id: String,
    pub rv: String,
    pub base: String,
    pub dir: String,
    pub mark: Option<String>,
    pub dep_ts: i64,
    pub dest: Option<String>,
    pub header: String,
    pub rk: Option<String>,
    pub line: Option<String>,
}

fn re(pattern: &str) -> &'static Regex {
    static REGEXES: OnceLock<std::sync::Mutex<HashMap<String, &'static Regex>>> = OnceLock::new();
    let lock = REGEXES.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
    let mut map = lock.lock().unwrap();
    if let Some(found) = map.get(pattern) {
        return found;
    }
    let compiled: &'static Regex = Box::leak(Box::new(Regex::new(pattern).expect("valid regex")));
    map.insert(pattern.to_string(), compiled);
    compiled
}

fn text(html: &str) -> String {
    let stripped = re(r"(?s)<[^>]+>").replace_all(html, " ");
    html_escape::decode_html_entities(&stripped)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_index(html: &str) -> Value {
    let indicator =
        re(r"(?is)(?:danas voze po redu vo[žz]nje za|данас возе по реду вожње за)\s*(.*?)</p>")
            .captures(html)
            .map(|c| text(&c[1]).to_uppercase());
    let day_type = indicator.as_deref().and_then(|s| match s {
        "RADNI DAN" | "РАДНИ ДАН" => Some("R"),
        "SUBOTA" | "СУБОТА" => Some("S"),
        "NEDELJA" | "НЕДЕЉА" => Some("N"),
        "PRAZNIK" | "ПРАЗНИК" => Some("P"),
        _ => None,
    });
    let mut dates: Vec<String> = re(r#"<option value="(\d{4}-\d\d-\d\d)""#)
        .captures_iter(html)
        .map(|c| c[1].to_string())
        .collect();
    dates.sort();
    dates.dedup();
    json!({"dayType": day_type, "indicator": indicator, "vaziod": dates})
}

pub fn parse_options(html: &str) -> Vec<LineOption> {
    re(r#"(?s)<option value="([^"]*)">(.*?)</option>"#)
        .captures_iter(html)
        .map(|c| LineOption {
            value: html_escape::decode_html_entities(&c[1]).to_string(),
            label: text(&c[2]),
        })
        .collect()
}

pub fn parse_timetables(html: &str) -> HashMap<String, LineTable> {
    let mut out = HashMap::new();
    for chunk in html.split("table-title").skip(1) {
        let after_gt = chunk.split_once('>').map(|x| x.1).unwrap_or(chunk);
        let title_html = after_gt.split("</div>").next().unwrap_or("");
        let raw_title = text(title_html);
        let title = raw_title
            .split_once(':')
            .map(|x| x.1.trim().to_string())
            .unwrap_or(raw_title);
        let Some(base) = title.split_whitespace().next().map(str::to_string) else {
            continue;
        };
        let headers: Vec<String> = re(r"(?s)<th>(.*?)</th>")
            .captures_iter(chunk)
            .map(|c| text(&c[1]))
            .collect();
        let cells: Vec<String> = re(r"(?s)<td\s+valign='top'[^>]*>(.*?)</td>")
            .captures_iter(chunk)
            .map(|c| c[1].to_string())
            .collect();
        let mut directions = Vec::new();
        let departure_re =
            re(r#"<br/><b>(\d\d)</b>|<span class='([^']*)'>(\d\d)<b>([^<]*)</b></span>"#);
        for (header, cell) in headers.iter().zip(cells.iter()) {
            let mut departures = Vec::new();
            let mut hour: Option<i64> = None;
            for cap in departure_re.captures_iter(cell) {
                if let Some(value) = cap.get(1) {
                    hour = value.as_str().parse().ok();
                    continue;
                }
                let (Some(h), Some(minute)) = (hour, cap.get(3)) else {
                    continue;
                };
                let mark =
                    html_escape::decode_html_entities(&html_escape::decode_html_entities(&cap[4]))
                        .trim()
                        .to_string();
                departures.push(Departure {
                    t: format!("{h:02}:{}", minute.as_str()),
                    mark: if mark.is_empty() { None } else { Some(mark) },
                    low: cap
                        .get(2)
                        .is_some_and(|v| v.as_str().contains("niskopodni")),
                });
            }
            directions.push(Direction {
                header: header.clone(),
                departures,
            });
        }
        let legend = re(r"(?s)tabelapolascifooter[^>]*>(.*?)</td>")
            .captures(chunk)
            .map(|c| text(&c[1]));
        out.insert(
            base,
            LineTable {
                title,
                directions,
                legend,
            },
        );
    }
    out
}

pub fn header_letter(header: &str) -> Option<&'static str> {
    let trimmed = header.trim_start();
    for prefix in ["Smer", "Смер"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let letter = rest.trim_start().chars().next();
            match letter {
                Some('A') | Some('А') => return Some("A"),
                Some('B') | Some('Б') => return Some("B"),
                _ => {}
            }
        }
    }
    let lower = header.to_lowercase();
    if lower.contains("polasci za") || lower.contains("поласци за") {
        Some("A")
    } else if lower.contains("polasci iz") || lower.contains("поласци из") {
        Some("B")
    } else {
        None
    }
}

pub fn destination(header: &str) -> Option<String> {
    let after = header.split_once(':').map(|x| x.1).unwrap_or(header);
    let cleaned = re(r"(?i)^(polasci za|polasci iz)\s*").replace(after.trim(), "");
    cleaned
        .split(" - ")
        .last()
        .or_else(|| cleaned.split('–').last())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn expand_departures(departures: &[Departure]) -> Vec<(i64, i64, i64, Option<String>)> {
    let night = !departures.is_empty()
        && departures.iter().all(|d| {
            d.t.get(..2)
                .and_then(|h| h.parse::<i64>().ok())
                .unwrap_or(0)
                < 5
        });
    let mut previous = None;
    let mut offset = 0;
    let mut out = Vec::new();
    for departure in departures {
        let Some((hour, minute)) = departure
            .t
            .split_once(':')
            .and_then(|(h, m)| Some((h.parse::<i64>().ok()?, m.parse::<i64>().ok()?)))
        else {
            continue;
        };
        if previous.is_some_and(|p| hour < p) {
            offset = 1;
        }
        previous = Some(hour);
        out.push((
            if night { 1 } else { offset },
            hour,
            minute,
            departure.mark.clone(),
        ));
    }
    out
}

pub fn iso_day(now: i64) -> String {
    Belgrade
        .timestamp_millis_opt(now)
        .single()
        .unwrap()
        .format("%Y-%m-%d")
        .to_string()
}

fn date_with_overflow(
    year: i32,
    month: u32,
    day: i64,
    hour: i64,
    minute: i64,
) -> DateTime<chrono_tz::Tz> {
    let base = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let date = base + Duration::days(day - 1);
    let naive = date.and_hms_opt(0, 0, 0).unwrap() + Duration::minutes(hour * 60 + minute);
    Belgrade
        .from_local_datetime(&naive)
        .single()
        .unwrap_or_else(|| Belgrade.from_utc_datetime(&naive))
}

pub fn bg_ts(year: i32, month: u32, day: i64, hour: i64, minute: i64) -> i64 {
    date_with_overflow(year, month, day, hour, minute).timestamp_millis()
}

pub fn departure_ts(departure: Option<&str>, now: i64) -> Option<i64> {
    let dep = departure?;
    if dep == "00:00:00" {
        return None;
    }
    let mut parts = dep.split(':');
    let hour: i64 = parts.next()?.parse().ok()?;
    let minute: i64 = parts.next()?.parse().ok()?;
    let local = Belgrade.timestamp_millis_opt(now).single()?;
    let mut best = None;
    for offset in [-1, 0, 1] {
        let ts = bg_ts(
            local.year(),
            local.month(),
            local.day() as i64 + offset,
            hour,
            minute,
        );
        let delta = ts - now;
        if (-72_000_000..=14_400_000).contains(&delta)
            && best.is_none_or(|b: i64| delta.abs() < (b - now).abs())
        {
            best = Some(ts);
        }
    }
    best
}

pub fn hhmm(now: i64) -> String {
    Belgrade
        .timestamp_millis_opt(now)
        .single()
        .unwrap()
        .format("%H:%M")
        .to_string()
}

pub fn fallback_day_type(day: &str) -> &'static str {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap();
    let holidays = serbian_holidays(date.year());
    if holidays.contains(&date) {
        return "P";
    }
    match date.weekday().num_days_from_sunday() {
        6 => "S",
        0 => "N",
        _ => "R",
    }
}

fn orthodox_easter(year: i32) -> NaiveDate {
    let a = year % 4;
    let b = year % 7;
    let c = year % 19;
    let d = (19 * c + 15) % 30;
    let e = (2 * a + 4 * b - d + 34) % 7;
    let month = ((d + e + 114) / 31) as u32;
    let day = ((d + e + 114) % 31 + 1) as u32;
    NaiveDate::from_ymd_opt(year, month, day).unwrap() + Duration::days(13)
}

fn serbian_holidays(year: i32) -> Vec<NaiveDate> {
    let d = |m, d| NaiveDate::from_ymd_opt(year, m, d).unwrap();
    let easter = orthodox_easter(year);
    let state = [
        vec![d(1, 1), d(1, 2)],
        vec![d(2, 15), d(2, 16)],
        vec![d(5, 1), d(5, 2)],
        vec![d(11, 11)],
    ];
    let religious = [
        vec![d(1, 7)],
        vec![
            easter - Duration::days(2),
            easter - Duration::days(1),
            easter,
            easter + Duration::days(1),
        ],
    ];
    let mut out: Vec<NaiveDate> = state
        .iter()
        .chain(religious.iter())
        .flatten()
        .copied()
        .collect();
    for days in state {
        if days.iter().any(|d| d.weekday().num_days_from_sunday() == 0) {
            let mut next = *days.last().unwrap() + Duration::days(1);
            while next.weekday().num_days_from_sunday() >= 6 || out.contains(&next) {
                next += Duration::days(1);
            }
            out.push(next);
        }
    }
    out
}

pub fn active_departures(
    tables: &HashMap<String, TimetableTable>,
    now: i64,
    from: i64,
    to: i64,
    only_base: Option<&str>,
) -> Vec<Trip> {
    let current = Belgrade.timestamp_millis_opt(now).single().unwrap();
    let previous = current - Duration::days(1);
    let mut out = Vec::new();
    for day in [current, previous] {
        let iso = day.format("%Y-%m-%d").to_string();
        let dan = fallback_day_type(&iso);
        for rv in ["rvg", "rvp"] {
            let Some(table) = tables.get(&format!("{rv}|{dan}")) else {
                continue;
            };
            for (base, line) in &table.lines {
                if only_base.is_some_and(|b| b != base) {
                    continue;
                }
                for (index, direction) in line.directions.iter().enumerate() {
                    let letter = header_letter(&direction.header).unwrap_or(if index == 0 {
                        "A"
                    } else {
                        "B"
                    });
                    for (offset, hour, minute, mark) in expand_departures(&direction.departures) {
                        let ts = bg_ts(
                            day.year(),
                            day.month(),
                            day.day() as i64 + offset,
                            hour,
                            minute,
                        );
                        if ts < from || ts > to {
                            continue;
                        }
                        out.push(Trip {
                            id: format!("{rv}|{base}|{letter}|{ts}"),
                            rv: rv.into(),
                            base: base.clone(),
                            dir: letter.into(),
                            mark,
                            dep_ts: ts,
                            dest: destination(&direction.header),
                            header: direction.header.clone(),
                            rk: None,
                            line: None,
                        });
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_timetable() {
        let tables = parse_timetables(include_str!("../../tools/fixtures/ispis_rvg_R_14.html"));
        let line = &tables["14"];
        assert_eq!(line.directions.len(), 2);
        assert_eq!(line.directions[0].departures.len(), 55);
        assert_eq!(line.directions[1].departures.len(), 57);
        assert_eq!(header_letter("Polasci za VETERNIK"), Some("A"));
    }

    #[test]
    fn expands_night_and_serbian_holidays() {
        let deps = vec![
            Departure {
                t: "23:40".into(),
                mark: None,
                low: false,
            },
            Departure {
                t: "00:15".into(),
                mark: Some("X".into()),
                low: false,
            },
        ];
        let expanded = expand_departures(&deps);
        assert_eq!((expanded[0].0, expanded[0].1, expanded[0].2), (0, 23, 40));
        assert_eq!((expanded[1].0, expanded[1].1, expanded[1].2), (1, 0, 15));
        assert_eq!(fallback_day_type("2026-04-13"), "P");
        assert_eq!(fallback_day_type("2026-11-14"), "S");
    }

    #[test]
    fn belgrade_time_rolls_over_days() {
        assert_eq!(hhmm(bg_ts(2026, 7, 1, 12, 0)), "12:00");
        assert_eq!(iso_day(bg_ts(2026, 12, 31, 24, 30)), "2027-01-01");
    }
}
