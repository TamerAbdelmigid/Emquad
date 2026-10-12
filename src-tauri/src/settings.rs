//! App-wide settings, kept in the per-user config directory.

use crate::error::Result;
use crate::history::Author;
use crate::project::{Project, atomic_write};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
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
        }
    }
}

impl Settings {
    pub fn load(dir: &Path) -> Settings {
        fs::read(dir.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> Result<()> {
        atomic_write(&dir.join("settings.json"), &serde_json::to_vec_pretty(self)?)
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
        let mut s = Settings::load(tmp.path());
        assert!(s.display_name.is_empty() && !s.author_id.is_empty());
        s.display_name = "Tamer".into();
        s.save(tmp.path()).unwrap();
        let again = Settings::load(tmp.path());
        assert_eq!(again.author_id, s.author_id);
        assert_eq!(again.author().name, "Tamer");
    }
}
