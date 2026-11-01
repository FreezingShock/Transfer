//! The on-device learner: a multinomial naive Bayes over hashed tokens.
//!
//! * It only learns from what *you* do (corrections in the app, or dragging a
//!   file from one line folder into another).
//! * Tokens are hashed before they're counted, so the model file on disk holds
//!   numbers, not file names, hosts, or words from your documents.
//! * It never phones home. There is no network code in this crate.

use crate::lines::Line;
use std::collections::HashMap;
use std::path::Path;

const N: usize = 9; // Line variants incl. Holding

#[derive(Debug, Default)]
pub struct Model {
    docs: [u32; N],
    totals: [u64; N],
    /// hashed token -> per-line counts
    counts: HashMap<u64, [u32; N]>,
}

impl Model {
    /// File format (model.tsv), numbers only:
    ///   docs  <9 counts>
    ///   tot   <9 counts>
    ///   <token-hash-hex>  <9 counts>
    pub fn load(path: &Path) -> Model {
        let mut m = Model::default();
        let Ok(text) = std::fs::read_to_string(path) else { return m };
        for line in text.lines() {
            let mut it = line.split('\t');
            let key = it.next().unwrap_or("");
            let nums: Vec<u64> = it.filter_map(|x| x.parse().ok()).collect();
            if nums.len() != N {
                continue;
            }
            match key {
                "docs" => (0..N).for_each(|i| m.docs[i] = nums[i] as u32),
                "tot" => (0..N).for_each(|i| m.totals[i] = nums[i]),
                h => {
                    if let Ok(h) = u64::from_str_radix(h, 16) {
                        let mut c = [0u32; N];
                        (0..N).for_each(|i| c[i] = nums[i] as u32);
                        m.counts.insert(h, c);
                    }
                }
            }
        }
        m
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let row = |k: String, v: &[u64]| format!("{k}\t{}\n", v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join("\t"));
        let mut out = row("docs".into(), &self.docs.map(|x| x as u64));
        out += &row("tot".into(), &self.totals);
        for (h, c) in &self.counts {
            out += &row(format!("{h:016x}"), &c.map(|x| x as u64));
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(tmp, path)
    }

    pub fn examples(&self) -> u32 {
        self.docs.iter().sum()
    }

    pub fn learn(&mut self, tokens: &[String], line: Line) {
        let li = line.index();
        self.docs[li] += 1;
        for t in tokens {
            let c = self.counts.entry(fnv(t)).or_insert([0; N]);
            c[li] += 1;
            self.totals[li] += 1;
        }
    }

    /// Posterior over the 8 real lines (Holding excluded). None until the
    /// model has seen enough corrections to have an opinion.
    pub fn predict(&self, tokens: &[String]) -> Option<[f32; N]> {
        if self.examples() < 3 {
            return None;
        }
        let vocab = self.counts.len().max(1) as f64;
        let total_docs: f64 = self.docs.iter().map(|d| *d as f64).sum();
        let mut logp = [f64::NEG_INFINITY; N];
        for line in Line::ALL {
            let li = line.index();
            // smoothed prior so lines never corrected still get a chance
            let mut lp = ((self.docs[li] as f64 + 1.0) / (total_docs + 8.0)).ln();
            let denom = self.totals[li] as f64 + vocab;
            for t in tokens {
                let c = self.counts.get(&fnv(t)).map(|c| c[li]).unwrap_or(0) as f64;
                lp += ((c + 1.0) / denom).ln();
            }
            logp[li] = lp;
        }
        let max = logp.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let mut out = [0f32; N];
        let mut sum = 0.0;
        for i in 0..N {
            let e = if logp[i].is_finite() { (logp[i] - max).exp() } else { 0.0 };
            out[i] = e as f32;
            sum += e;
        }
        for v in &mut out {
            *v = (*v as f64 / sum) as f32;
        }
        Some(out)
    }

    /// How much the learned model should be trusted vs. the content rules.
    pub fn weight(&self) -> f32 {
        (self.examples() as f32 / 60.0).min(0.55)
    }
}

fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn learns_a_habit() {
        let mut m = Model::default();
        let school = |w: &str| vec!["kind:pdf".to_string(), format!("w:{w}"), "w:apbio".into()];
        for w in ["lab", "notes", "unit"] {
            m.learn(&school(w), Line::Docs);
        }
        for _ in 0..3 {
            m.learn(&["kind:pdf".into(), "w:ticket".into(), "host:ticketmaster.com".into()], Line::Archives);
        }
        let p = m.predict(&school("worksheet")).unwrap();
        assert!(p[Line::Docs.index()] > p[Line::Archives.index()]);
        let dir = std::env::temp_dir().join(format!("transfer-model-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("model.tsv");
        m.save(&f).unwrap();
        let disk = std::fs::read_to_string(&f).unwrap();
        assert!(!disk.contains("apbio"), "tokens must be hashed on disk");
        let back = Model::load(&f);
        assert_eq!(back.examples(), m.examples());
        assert_eq!(back.predict(&school("worksheet")), m.predict(&school("worksheet")));
    }
}
