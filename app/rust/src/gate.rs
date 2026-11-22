use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MIN_MS: i64 = 3_000;
pub const MAX_REQUESTS: usize = 20;
pub const WINDOW_MS: i64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Gate {
    #[serde(default)]
    pub starts: Vec<i64>,
    #[serde(default)]
    pub blocked_until: i64,
    #[serde(default)]
    pub failures: u32,
    #[serde(default)]
    pub rate_failures: u32,
}

impl Gate {
    pub fn ready_at(&mut self, now: i64) -> i64 {
        self.starts.retain(|t| *t > now - WINDOW_MS);
        self.starts = self
            .starts
            .iter()
            .copied()
            .rev()
            .take(MAX_REQUESTS)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let spacing = self.starts.last().map_or(0, |last| last + MIN_MS);
        let window = if self.starts.len() >= MAX_REQUESTS {
            self.starts[0] + WINDOW_MS
        } else {
            0
        };
        self.blocked_until.max(spacing).max(window)
    }

    pub fn begin(&mut self, now: i64) -> Value {
        let ready = self.ready_at(now);
        if ready > now {
            return json!({"allowed": false, "waitMs": ready - now, "retryAt": self.blocked_until.max(ready)});
        }
        self.starts.push(now);
        json!({"allowed": true, "waitMs": 0, "retryAt": 0})
    }

    pub fn success(&mut self) {
        self.failures = 0;
        self.rate_failures = 0;
        self.blocked_until = 0;
    }

    pub fn failure(&mut self, now: i64, status: Option<i64>, retry_after_seconds: Option<i64>) {
        self.failures = self.failures.saturating_add(1);
        let restricted = matches!(status, Some(403 | 429));
        if restricted {
            self.rate_failures = self.rate_failures.saturating_add(1);
        }
        let mut delay = if restricted {
            (300_000_i64 * 2_i64.pow(self.rate_failures.saturating_sub(1).min(4))).min(1_800_000)
        } else {
            (15_000_i64 * 2_i64.pow(self.failures.saturating_sub(1).min(5))).min(300_000)
        };
        if let Some(server) = retry_after_seconds {
            delay = delay.max(server.max(0) * 1000);
        }
        self.blocked_until = self.blocked_until.max(now + delay);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_spacing_and_rolling_limit() {
        let mut gate = Gate::default();
        assert_eq!(gate.begin(0)["allowed"], true);
        assert_eq!(gate.begin(100)["waitMs"], 2900);
        for i in 1..20 {
            assert_eq!(gate.begin(i * 3000)["allowed"], true);
        }
        assert_eq!(gate.begin(57_001)["waitMs"], 2999);
        assert_eq!(gate.begin(60_000)["allowed"], true);
    }

    #[test]
    fn applies_backoff_and_retry_after() {
        let mut gate = Gate::default();
        gate.failure(1_000, Some(429), Some(700));
        assert_eq!(gate.blocked_until, 701_000);
        gate.success();
        gate.failure(1_000, Some(500), None);
        assert_eq!(gate.blocked_until, 16_000);
    }
}
