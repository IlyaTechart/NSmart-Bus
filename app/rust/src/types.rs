use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Station {
    pub n: String,
    pub c: Option<String>,
    pub la: Option<f64>,
    pub lo: Option<f64>,
    #[serde(default)]
    pub l: Vec<String>,
    #[serde(default)]
    pub t: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stop {
    pub id: String,
    pub la: Option<f64>,
    pub lo: Option<f64>,
    pub tt: i64,
    pub slr: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub k: String,
    pub line: String,
    pub base: String,
    pub dir: String,
    pub actual: String,
    pub title: Option<String>,
    pub dest: Option<String>,
    pub s: Vec<Stop>,
    pub t: i64,
}

#[derive(Debug, Clone)]
pub struct Bus {
    pub line: String,
    pub actual: String,
    pub dir: String,
    pub dest: Option<String>,
    pub title: Option<String>,
    pub seconds: i64,
    pub between: Option<i64>,
    pub garage: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub cur: Option<String>,
    pub dep: Option<String>,
    pub next: Option<usize>,
    pub planned: bool,
    pub stops: Vec<Stop>,
}

#[derive(Debug, Clone)]
pub struct Vehicle {
    pub g: String,
    pub line: String,
    pub base: String,
    pub dir: String,
    pub dest: Option<String>,
    pub title: Option<String>,
    pub dep: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub next: Option<usize>,
    pub rk: Option<String>,
    pub slr: Vec<i64>,
    pub obs_at: i64,
    pub seen_at: i64,
    pub sig: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Position {
    pub la: f64,
    pub lo: f64,
    pub next_j: Option<usize>,
    pub done: bool,
    pub over: f64,
    pub left: f64,
    pub road_aligned: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BusItem {
    pub id: String,
    pub kind: String,
    pub base: String,
    pub line: String,
    pub dir: String,
    pub dest: Option<String>,
    pub title: Option<String>,
    pub la: f64,
    pub lo: f64,
    pub garage: Option<String>,
    pub road_aligned: bool,
    pub age: Option<i64>,
    pub next: Option<String>,
    pub dep: Option<String>,
    pub rk: Option<String>,
}

pub fn line_base(line: &str) -> String {
    let line = line.trim().trim_end_matches(|c| c == '.' || c == '*');
    const SPECIAL: &[&str] = &[
        "3A", "3B", "5N", "6A", "7A", "7B", "11A", "11B", "18A", "18B",
    ];
    for base in SPECIAL {
        if line.starts_with(base)
            && !line[base.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit())
        {
            return (*base).to_string();
        }
    }
    let digits: String = line.chars().take_while(char::is_ascii_digit).collect();
    if !digits.is_empty() {
        let n: u32 = digits.parse().unwrap_or(0);
        if !matches!(n, 7 | 11 | 18) {
            let after = &line[digits.len()..];
            if !after.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return digits;
            }
        }
    }
    if !digits.is_empty() {
        digits
    } else {
        line.to_string()
    }
}

pub fn distance(la1: f64, lo1: f64, la2: f64, lo2: f64) -> f64 {
    let k = std::f64::consts::PI / 180.0;
    let x = (lo2 - lo1) * k * ((la1 + la2) / 2.0 * k).cos();
    (x * x + ((la2 - la1) * k).powi(2)).sqrt() * 6_371_000.0
}
