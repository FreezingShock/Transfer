//! transfer — command-line front end to the same engine the desktop app uses.
//!
//!   transfer plan [DIR...]        dry run: show where everything would go
//!   transfer apply [DIR...]       do it (every move is journaled)
//!   transfer watch [DIR...]       live mode, Ctrl-C to stop
//!   transfer history [N]          recent moves
//!   transfer undo ID              put a file back
//!   transfer correct ID LINE      re-route a move and teach the model
//!   transfer route PATH LINE      resolve a held file
//!   transfer explain FILE         show the signals for one file
//!   transfer state                full UI state as JSON

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use transfer_core::{engine::Engine, signals, Line, Plan};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let rest = &args[args.len().min(1)..];
    let mut eng = Engine::open(Engine::default_home()).expect("open data folder");
    let dirs_from = |r: &[String], eng: &mut Engine| -> Vec<PathBuf> {
        if r.is_empty() {
            eng.settings.sweep_sources().cloned().collect()
        } else {
            r.iter().map(PathBuf::from).collect()
        }
    };

    match cmd {
        "plan" | "apply" => {
            let dirs = dirs_from(rest, &mut eng);
            let plans: Vec<Plan> = dirs.iter().map(|d| eng.plan(d, 2)).collect();
            for p in &plans {
                print_plan(p);
            }
            if cmd == "apply" {
                let moves: Vec<_> = plans.iter().flat_map(|p| p.moves.clone()).collect();
                let res = eng.apply(&moves, "sweep");
                let ok = res.iter().filter(|r| r.is_ok()).count();
                for e in res.iter().filter_map(|r| r.as_ref().err()) {
                    eprintln!("  ! {e}");
                }
                println!("\nmoved {ok} file(s). `transfer history` to review, `transfer undo ID` to reverse.");
            } else {
                println!("\n(dry run, nothing moved; run `transfer apply` to do it)");
            }
        }
        "watch" => {
            let dirs = dirs_from(rest, &mut eng);
            if !rest.is_empty() {
                eng.settings.sources = dirs
                    .iter()
                    .map(|p| transfer_core::settings::Source::new(p.clone(), transfer_core::settings::Mode::Auto))
                    .collect();
            }
            println!("watching {} folder(s). Ctrl-C to stop.", dirs.len());
            let eng = Arc::new(Mutex::new(eng));
            let _h = transfer_core::watch::start(eng, |ev| match ev {
                transfer_core::watch::WatchEvent::Moved(e) => println!(
                    "  [{}] #{} {} → {}/  ({}%)",
                    e.line.letter(),
                    e.id,
                    name(&e.from),
                    e.line.folder(),
                    (e.confidence * 100.0) as u32
                ),
                transfer_core::watch::WatchEvent::Failed(m) => eprintln!("  ! {m}"),
            });
            loop {
                std::thread::park();
            }
        }
        "history" => {
            let n = rest.first().and_then(|s| s.parse().ok()).unwrap_or(20);
            for e in eng.journal.recent(n) {
                println!(
                    "#{:<4} [{}] {:<40} → {:<11} {:>3}% {}{}",
                    e.id,
                    e.line.letter(),
                    name(&e.from),
                    e.line.folder(),
                    (e.confidence * 100.0) as u32,
                    e.via,
                    if e.undone { "  (undone)" } else { "" }
                );
            }
        }
        "undo" => {
            let id = rest.first().and_then(|s| s.parse().ok()).expect("usage: transfer undo ID");
            match eng.undo(id) {
                Ok(e) => println!("restored {}", e.from.display()),
                Err(m) => eprintln!("{m}"),
            }
        }
        "correct" | "route" => {
            let (a, l) = (rest.first().expect("missing arg"), rest.get(1).expect("missing LINE"));
            let line = Line::parse(l).unwrap_or_else(|| panic!("unknown line {l}; try videos/docs/installers/..."));
            let r = if cmd == "correct" { eng.correct(a.parse().expect("ID"), line) } else { eng.route(&PathBuf::from(a), line) };
            match r {
                Ok(e) => println!("→ {}  (model now has {} examples)", e.to.display(), eng.model.examples()),
                Err(m) => eprintln!("{m}"),
            }
        }
        "state" => println!("{}", transfer_core::json::state(&eng)),
        "explain" => {
            for p in rest {
                let f = signals::extract(&PathBuf::from(p)).expect("read file");
                let (v, ..) = eng.verdict(&PathBuf::from(p)).unwrap();
                println!("{p}\n  kind={:?} origin={:?} size={} tokens={:?}", f.kind, f.origin_host, f.size, f.name_tokens);
                println!("  → {:?} ({}%) guess={:?}\n    {}", v.line, (v.confidence * 100.0) as u32, v.guess, v.reasons.join("\n    "));
            }
        }
        _ => println!("{}", include_str!("main.rs").lines().skip(2).take(10).map(|l| &l[4.min(l.len())..]).collect::<Vec<_>>().join("\n")),
    }
}

fn name(p: &std::path::Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn print_plan(p: &Plan) {
    println!("\n━━ {} ━━  {} to move · {} held · {} stale installers", p.source.display(), p.moves.len(), p.held.len(), p.stale.len());
    for m in &p.moves {
        println!(
            "  [{}] {:<42} → {:<11} {:>3}%  {}",
            m.line.letter(),
            name(&m.from),
            m.line.folder(),
            (m.confidence * 100.0) as u32,
            m.reasons.first().cloned().unwrap_or_default()
        );
    }
    for h in &p.held {
        println!("  [?] {:<42}   held ({}%, best guess {})", name(&h.path), (h.confidence * 100.0) as u32, if h.guess == Line::Holding { "none" } else { h.guess.folder() });
    }
    for s in &p.stale {
        println!("  [~] {:<42}   installer {} days old, safe to trash", name(&s.path), s.age_days);
    }
}
