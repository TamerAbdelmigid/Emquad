//! App-wide settings, kept in the per-user config directory.

use crate::error::Result;
use crate::history::Author;
use crate::project::{Project, atomic_write};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub author_id: String,
    /// Empty until the user has been asked for it.
    pub display_name: String,
    pub recent: Vec<Recent>,
    pub compile_on_save: bool,
    pub editor_font_size: u32,
    /// "fieldwork", "glass" or "onyx".
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub id: String,
    pub name: String,
    pub path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            author_id: uuid::Uuid::new_v4().to_string(),
            display_name: String::new(),
            recent: Vec::new(),
            compile_on_save: true,
            editor_font_size: 13,
            theme: "fieldwork".into(),
        }
    }
}

/// Settings are read, changed and written back as one step; this keeps two commands from
/// interleaving and one of them writing stale or default values over the other's.
static LOCK: Mutex<()> = Mutex::new(());

pub const THEMES: [&str; 3] = ["fieldwork", "glass", "onyx"];

impl Settings {
    fn read(dir: &Path) -> Result<Settings> {
        let path = dir.join("settings.json");
        if !path.exists() {
            let fresh = Settings::default();
            fresh.write(dir)?;
            return Ok(fresh);
        }
        match serde_json::from_slice(&fs::read(&path)?) {
            Ok(settings) => Ok(settings),
            Err(_) => {
                // Unreadable settings must not be silently replaced: keep the file for recovery.
                let _ = fs::rename(&path, dir.join("settings.damaged.json"));
                let fresh = Settings::default();
                fresh.write(dir)?;
                Ok(fresh)
            }
        }
    }

    fn write(&self, dir: &Path) -> Result<()> {
        atomic_write(
            &dir.join("settings.json"),
            &serde_json::to_vec_pretty(self)?,
        )
    }

    pub fn load(dir: &Path) -> Result<Settings> {
        let _guard = LOCK.lock().unwrap();
        Self::read(dir)
    }

    /// Change the stored settings and return the result.
    pub fn update(dir: &Path, change: impl FnOnce(&mut Settings)) -> Result<Settings> {
        let _guard = LOCK.lock().unwrap();
        let mut settings = Self::read(dir)?;
        change(&mut settings);
        settings.write(dir)?;
        Ok(settings)
    }

    pub fn author(&self) -> Author {
        Author {
            id: self.author_id.clone(),
            name: if self.display_name.trim().is_empty() {
                "You".into()
            } else {
                self.display_name.trim().into()
            },
        }
    }

    /// Put a project at the top of the recent list.
    pub fn remember(&mut self, project: &Project) {
        let path = project.root.to_string_lossy().into_owned();
        self.recent.retain(|r| r.path != path);
        self.recent.insert(
            0,
            Recent {
                id: project.info.project_id.clone(),
                name: project.info.name.clone(),
                path,
            },
        );
        self.recent.truncate(12);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_survive_a_restart_and_keep_one_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let first = Settings::load(tmp.path()).unwrap();
        assert!(first.display_name.is_empty() && !first.author_id.is_empty());
        Settings::update(tmp.path(), |s| s.display_name = "Tamer".into()).unwrap();
        let again = Settings::load(tmp.path()).unwrap();
        assert_eq!(again.author_id, first.author_id);
        assert_eq!(again.author().name, "Tamer");
    }

    #[test]
    fn concurrent_readers_and_writers_never_lose_the_name_or_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let id = Settings::update(tmp.path(), |s| s.display_name = "Tamer".into())
            .unwrap()
            .author_id;
        let dir = tmp.path().to_path_buf();
        let threads: Vec<_> = (0..8)
            .map(|n| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        if n % 2 == 0 {
                            Settings::load(&dir).unwrap();
                        } else {
                            Settings::update(&dir, |s| s.editor_font_size = 12 + n).unwrap();
                        }
                    }
                })
            })
            .collect();
        threads.into_iter().for_each(|t| t.join().unwrap());
        let end = Settings::load(&dir).unwrap();
        assert_eq!((end.author_id, end.display_name.as_str()), (id, "Tamer"));
    }

    #[test]
    fn damaged_settings_are_set_aside_rather_than_overwritten() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("settings.json"), "{ not json").unwrap();
        assert!(Settings::load(tmp.path()).unwrap().display_name.is_empty());
        assert_eq!(
            fs::read_to_string(tmp.path().join("settings.damaged.json")).unwrap(),
            "{ not json"
        );
    }
}
