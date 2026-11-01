//! Minimal JSON output for the UI bridge and `transfer --json`.
//! (Output only. The core never needs to parse JSON.)

use crate::engine::{Held, Plan, Planned, Stale, Stats};
use crate::journal::Entry;
use crate::lines::Line;
use crate::settings::Settings;
use std::path::Path;

pub fn s(v: &str) -> String {
    let mut o = String::with_capacity(v.len() + 2);
    o.push('"');
    for c in v.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}
fn p(v: &Path) -> String {
    s(&v.to_string_lossy())
}
fn name(v: &Path) -> String {
    s(&v.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
}
pub fn arr<T>(items: &[T], f: impl Fn(&T) -> String) -> String {
    format!("[{}]", items.iter().map(f).collect::<Vec<_>>().join(","))
}
fn strs(v: &[String]) -> String {
    arr(v, |x| s(x))
}

pub fn line(l: Line) -> String {
    format!(
        r#"{{"id":{},"folder":{},"letter":"{}","color":"{}"}}"#,
        s(l.id()),
        s(l.folder()),
        l.letter(),
        l.color()
    )
}

pub fn lines() -> String {
    arr(&Line::ALL, |l| line(*l))
}

pub fn entry(e: &Entry) -> String {
    format!(
        r#"{{"id":{},"ts":{},"name":{},"from":{},"to":{},"line":{},"confidence":{:.3},"reasons":{},"undone":{},"via":{}}}"#,
        e.id,
        e.ts,
        name(&e.from),
        p(&e.from),
        p(&e.to),
        s(e.line.id()),
        e.confidence,
        strs(&e.reasons),
        e.undone,
        s(&e.via)
    )
}

pub fn entries(v: &[Entry]) -> String {
    arr(v, entry)
}

fn planned(m: &Planned) -> String {
    format!(
        r#"{{"name":{},"from":{},"to":{},"line":{},"confidence":{:.3},"reasons":{},"size":{}}}"#,
        name(&m.from),
        p(&m.from),
        p(&m.to),
        s(m.line.id()),
        m.confidence,
        strs(&m.reasons),
        m.size
    )
}
pub fn held(h: &Held) -> String {
    format!(
        r#"{{"name":{},"path":{},"guess":{},"confidence":{:.3},"reasons":{},"size":{}}}"#,
        name(&h.path),
        p(&h.path),
        s(h.guess.id()),
        h.confidence,
        strs(&h.reasons),
        h.size
    )
}
pub fn stale(x: &Stale) -> String {
    format!(r#"{{"name":{},"path":{},"age_days":{},"size":{}}}"#, name(&x.path), p(&x.path), x.age_days, x.size)
}

pub fn plan(pl: &Plan) -> String {
    format!(
        r#"{{"source":{},"moves":{},"held":{},"stale":{},"skipped":{}}}"#,
        p(&pl.source),
        arr(&pl.moves, planned),
        arr(&pl.held, held),
        arr(&pl.stale, stale),
        pl.skipped
    )
}

pub fn plans(v: &[Plan]) -> String {
    arr(v, plan)
}

pub fn stats(st: &Stats) -> String {
    format!(
        r#"{{"per_line":{{{}}},"today":{},"total":{},"learned_examples":{}}}"#,
        st.per_line.iter().map(|(l, n)| format!("{}:{}", s(l.id()), n)).collect::<Vec<_>>().join(","),
        st.today,
        st.total,
        st.learned_examples
    )
}

pub fn settings(st: &Settings) -> String {
    format!(
        r#"{{"sources":{},"confidence":{},"stale_installer_days":{},"settle_secs":{},"paused":{},"launch_at_login":{}}}"#,
        arr(&st.sources, |x| format!(r#"{{"path":{},"enabled":{}}}"#, p(&x.path), x.enabled)),
        st.confidence,
        st.stale_installer_days,
        st.settle_secs,
        st.paused,
        st.launch_at_login
    )
}

/// Everything the UI needs for a full refresh, in one payload.
pub fn state(e: &crate::engine::Engine) -> String {
    let plans = e.plan_all(e.settings.settle_secs);
    let held: Vec<Held> = plans.iter().flat_map(|p| p.held.clone()).collect();
    let stale_v: Vec<Stale> = plans.iter().flat_map(|p| p.stale.clone()).collect();
    format!(
        r#"{{"stats":{},"history":{},"settings":{},"held":{},"stale":{},"lines":{}}}"#,
        stats(&e.stats()),
        entries(&e.journal.recent(500)),
        settings(&e.settings),
        arr(&held, held_one),
        arr(&stale_v, stale),
        lines()
    )
}
fn held_one(h: &Held) -> String {
    held(h)
}
