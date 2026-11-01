//! transfer-core: the sorting brain behind Transfer.
//!
//! Privacy contract (enforced by construction, not policy):
//! * zero dependencies: std only, so no third-party code ever reads your files
//! * no networking code anywhere in the crate
//! * file contents are read into memory to classify, never written anywhere
//! * the only files written are settings.txt, model.tsv (hashed counts) and
//!   journal.tsv (the move log that powers undo), all in the local app data folder

pub mod classify;
pub mod engine;
pub mod journal;
pub mod json;
pub mod lines;
pub mod model;
pub mod settings;
pub mod signals;
pub mod watch;

pub use engine::{Engine, Plan, Planned};
pub use lines::Line;
