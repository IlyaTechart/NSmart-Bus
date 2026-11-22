use serde_json::Value;
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

const X: f64 = 78_380.0;
const Y: f64 = 111_320.0;
const CELL: f64 = 180.0;

#[derive(Debug, Clone)]
struct Edge {
    a: usize,
    b: usize,
    flags: i64,
    weight: f64,
    len: f64,
}
#[derive(Debug, Clone)]
struct Projection {
    t: f64,
    p: [f64; 2],
    d: f64,
    edge: usize,
}
#[derive(Debug, Clone)]
pub struct Path {
    points: Vec<[f64; 2]>,
    cumulative: Vec<f64>,
    length: f64,
}

#[derive(Debug, Clone, Copy)]
struct HeapItem {
    estimate: f64,
    node: usize,
    cost: f64,
}
impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.estimate == other.estimate && self.node == other.node
    }
}
impl Eq for HeapItem {}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .estimate
            .partial_cmp(&self.estimate)
            .unwrap_or(Ordering::Equal)
            .then(self.node.cmp(&other.node))
    }
}

pub struct RoadNetwork {
    xy: Vec<[f64; 2]>,
    edges: Vec<Edge>,
    adj: Vec<Vec<(usize, f64)>>,
    grid: HashMap<(i32, i32), Vec<usize>>,
    cache: RefCell<HashMap<String, Option<Path>>>,
}

impl RoadNetwork {
    pub fn from_json(value: &Value) -> Result<Self, String> {
        let raw_nodes = value["nodes"].as_array().ok_or("Road nodes missing")?;
        let xy: Vec<[f64; 2]> = raw_nodes
            .iter()
            .map(|p| {
                [
                    p[1].as_f64().unwrap_or(0.0) * X,
                    p[0].as_f64().unwrap_or(0.0) * Y,
                ]
            })
            .collect();
        let mut edges = Vec::new();
        let mut adj = vec![Vec::new(); xy.len()];
        let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (index, raw) in value["edges"]
            .as_array()
            .ok_or("Road edges missing")?
            .iter()
            .enumerate()
        {
            let a = raw[0].as_u64().unwrap_or(0) as usize;
            let b = raw[1].as_u64().unwrap_or(0) as usize;
            if a >= xy.len() || b >= xy.len() {
                continue;
            }
            let flags = raw[2].as_i64().unwrap_or(0);
            let weight = raw[3].as_f64().unwrap_or(1.0);
            let len = ((xy[b][0] - xy[a][0]).powi(2) + (xy[b][1] - xy[a][1]).powi(2)).sqrt();
            if flags & 1 != 0 {
                adj[a].push((b, len * weight));
            }
            if flags & 2 != 0 {
                adj[b].push((a, len * weight));
            }
            for x in ((xy[a][0].min(xy[b][0]) / CELL).floor() as i32)
                ..=((xy[a][0].max(xy[b][0]) / CELL).floor() as i32)
            {
                for y in ((xy[a][1].min(xy[b][1]) / CELL).floor() as i32)
                    ..=((xy[a][1].max(xy[b][1]) / CELL).floor() as i32)
                {
                    grid.entry((x, y)).or_default().push(index);
                }
            }
            edges.push(Edge {
                a,
                b,
                flags,
                weight,
                len,
            });
        }
        Ok(Self {
            xy,
            edges,
            adj,
            grid,
            cache: RefCell::new(HashMap::new()),
        })
    }

    fn project(&self, p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> (f64, [f64; 2], f64) {
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = dx * dx + dy * dy;
        let t = if d == 0.0 {
            0.0
        } else {
            (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d).clamp(0.0, 1.0)
        };
        let q = [a[0] + dx * t, a[1] + dy * t];
        (t, q, ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt())
    }

    fn candidates(&self, p: [f64; 2]) -> Vec<Projection> {
        let x = (p[0] / CELL).floor() as i32;
        let y = (p[1] / CELL).floor() as i32;
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(indices) = self.grid.get(&(x + dx, y + dy)) {
                    for index in indices {
                        if !seen.insert(*index) {
                            continue;
                        }
                        let edge = &self.edges[*index];
                        let (t, q, d) = self.project(p, self.xy[edge.a], self.xy[edge.b]);
                        if d <= 70.0 {
                            out.push(Projection {
                                t,
                                p: q,
                                d,
                                edge: *index,
                            });
                        }
                    }
                }
            }
        }
        out.sort_by(|a, b| a.d.partial_cmp(&b.d).unwrap_or(Ordering::Equal));
        out.truncate(5);
        out
    }

    pub fn path(&self, a: f64, a_lo: f64, b: f64, b_lo: f64) -> Option<Path> {
        let key = format!("{a:.6},{a_lo:.6},{b:.6},{b_lo:.6}");
        if let Some(cached) = self.cache.borrow().get(&key) {
            return cached.clone();
        }
        let result = self.route([a_lo * X, a * Y], [b_lo * X, b * Y]);
        let mut cache = self.cache.borrow_mut();
        if cache.len() > 768 {
            if let Some(first) = cache.keys().next().cloned() {
                cache.remove(&first);
            }
        }
        cache.insert(key, result.clone());
        result
    }

    fn route(&self, start: [f64; 2], end: [f64; 2]) -> Option<Path> {
        let starts = self.candidates(start);
        let ends = self.candidates(end);
        if starts.is_empty() || ends.is_empty() {
            return None;
        }
        let mut goals: HashMap<usize, (f64, Projection)> = HashMap::new();
        let mut costs = HashMap::new();
        let mut previous: HashMap<usize, Option<usize>> = HashMap::new();
        let mut roots: HashMap<usize, Projection> = HashMap::new();
        let mut heap = BinaryHeap::new();
        let mut best = f64::INFINITY;
        let mut result = None;
        for q in &ends {
            let edge = &self.edges[q.edge];
            if edge.flags & 1 != 0 {
                goals.insert(
                    edge.a,
                    (q.t * edge.len * edge.weight + q.d * 4.0, q.clone()),
                );
            }
            if edge.flags & 2 != 0 {
                goals.insert(
                    edge.b,
                    ((1.0 - q.t) * edge.len * edge.weight + q.d * 4.0, q.clone()),
                );
            }
        }
        for q in &starts {
            let edge = &self.edges[q.edge];
            for r in &ends {
                if q.edge != r.edge {
                    continue;
                }
                let delta = r.t - q.t;
                if (delta >= 0.0 && edge.flags & 1 != 0) || (delta <= 0.0 && edge.flags & 2 != 0) {
                    let cost = delta.abs() * edge.len * edge.weight + (q.d + r.d) * 4.0;
                    if cost < best {
                        best = cost;
                        result = Some(make_path(vec![q.p, r.p]));
                    }
                }
            }
            for (node, cost) in [
                (edge.b, (1.0 - q.t) * edge.len * edge.weight + q.d * 4.0),
                (edge.a, q.t * edge.len * edge.weight + q.d * 4.0),
            ] {
                if (node == edge.b && edge.flags & 1 == 0)
                    || (node == edge.a && edge.flags & 2 == 0)
                {
                    continue;
                }
                if cost < *costs.get(&node).unwrap_or(&f64::INFINITY) {
                    costs.insert(node, cost);
                    previous.insert(node, None);
                    roots.insert(node, q.clone());
                    heap.push(HeapItem {
                        estimate: cost
                            + ((self.xy[node][0] - end[0]).powi(2)
                                + (self.xy[node][1] - end[1]).powi(2))
                            .sqrt(),
                        node,
                        cost,
                    });
                }
            }
        }
        let mut visits = 0;
        while let Some(item) = heap.pop() {
            visits += 1;
            if visits > 18_000 || item.estimate >= best {
                break;
            }
            if Some(item.cost) != costs.get(&item.node).copied() {
                continue;
            }
            if let Some((goal_cost, projection)) = goals.get(&item.node) {
                if item.cost + goal_cost < best {
                    best = item.cost + goal_cost;
                    let mut points = vec![projection.p];
                    let mut node = Some(item.node);
                    while let Some(current) = node {
                        points.push(self.xy[current]);
                        node = previous.get(&current).copied().flatten();
                    }
                    points.push(roots[&item.node].p);
                    points.reverse();
                    result = Some(make_path(points));
                }
            }
            for (next, edge_cost) in &self.adj[item.node] {
                let cost = item.cost + edge_cost;
                if cost >= *costs.get(next).unwrap_or(&f64::INFINITY) {
                    continue;
                }
                costs.insert(*next, cost);
                previous.insert(*next, Some(item.node));
                roots.insert(*next, roots[&item.node].clone());
                heap.push(HeapItem {
                    estimate: cost
                        + ((self.xy[*next][0] - end[0]).powi(2)
                            + (self.xy[*next][1] - end[1]).powi(2))
                        .sqrt(),
                    node: *next,
                    cost,
                });
            }
        }
        result.filter(|path| {
            path.length
                <= 800.0_f64
                    .max(((end[0] - start[0]).powi(2) + (end[1] - start[1]).powi(2)).sqrt() * 5.0)
        })
    }

    pub fn point(&self, path: &Path, fraction: f64) -> (f64, f64) {
        let distance = fraction.clamp(0.0, 1.0) * path.length;
        for i in 1..path.points.len() {
            if distance <= path.cumulative[i] {
                let a = path.points[i - 1];
                let b = path.points[i];
                let len = path.cumulative[i] - path.cumulative[i - 1];
                let t = if len > 0.0 {
                    (distance - path.cumulative[i - 1]) / len
                } else {
                    0.0
                };
                return (
                    (a[1] + (b[1] - a[1]) * t) / Y,
                    (a[0] + (b[0] - a[0]) * t) / X,
                );
            }
        }
        let last = path.points[path.points.len() - 1];
        (last[1] / Y, last[0] / X)
    }

    pub fn coordinates(&self, path: &Path) -> Vec<[f64; 2]> {
        path.points.iter().map(|p| [p[1] / Y, p[0] / X]).collect()
    }
}

fn make_path(points: Vec<[f64; 2]>) -> Path {
    let mut cumulative = vec![0.0];
    for pair in points.windows(2) {
        cumulative.push(
            cumulative.last().unwrap()
                + ((pair[1][0] - pair[0][0]).powi(2) + (pair[1][1] - pair[0][1]).powi(2)).sqrt(),
        );
    }
    let length = *cumulative.last().unwrap();
    Path {
        points,
        cumulative,
        length,
    }
}
