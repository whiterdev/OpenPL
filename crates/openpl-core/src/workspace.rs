use crate::catalog::ObjectType;
use crate::{CoreError, ProfileStore};
use serde::{Deserialize, Serialize};
use std::io::{ErrorKind, Write};
use std::path::PathBuf;
use uuid::Uuid;

const MAX_TABS: usize = 50;
const MAX_TEXT: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workspace {
    pub version: u32,
    pub tabs: Vec<TabState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TabState {
    Object {
        object_type: ObjectType,
        owner: String,
        name: String,
    },
    Sql {
        title: String,
        text: String,
        kind: SqlKind,
    },
    File {
        name: String,
        text: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SqlKind {
    Sql,
    Test,
}

impl Workspace {
    fn validate(&self) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::Json(
                "Versión de espacio de trabajo no admitida.".into(),
            ));
        }
        if self.tabs.len() > MAX_TABS {
            return Err(CoreError::Json("El espacio supera 50 pestañas.".into()));
        }
        let bytes: usize = self
            .tabs
            .iter()
            .map(|tab| match tab {
                TabState::Object { .. } => 0,
                TabState::Sql { text, .. } | TabState::File { text, .. } => text.len(),
            })
            .sum();
        if bytes > MAX_TEXT {
            return Err(CoreError::Json("El texto del espacio supera 2 MiB.".into()));
        }
        Ok(())
    }
}

pub struct WorkspaceStore {
    dir: PathBuf,
}

impl WorkspaceStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn default_dir() -> PathBuf {
        ProfileStore::default_path().with_file_name("workspace")
    }

    fn path(&self, profile_id: Uuid) -> PathBuf {
        self.dir.join(format!("{profile_id}.json"))
    }

    pub fn load(&self, profile_id: Uuid) -> Result<Option<Workspace>, CoreError> {
        match std::fs::read(self.path(profile_id)) {
            Ok(json) => {
                let workspace: Workspace = serde_json::from_slice(&json)?;
                workspace.validate()?;
                Ok(Some(workspace))
            }
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn save(&self, profile_id: Uuid, workspace: &Workspace) -> Result<(), CoreError> {
        workspace.validate()?;
        let json = serde_json::to_vec(workspace)?;
        std::fs::create_dir_all(&self.dir)?;
        let path = self.path(profile_id);
        let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let mut file = std::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        let result = (|| {
            file.write_all(&json)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temp, &path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        Ok(result?)
    }

    pub fn clear(&self, profile_id: Uuid) -> Result<(), CoreError> {
        match std::fs::remove_file(self.path(profile_id)) {
            Err(error) if error.kind() != ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_reemplaza_y_borra_por_perfil() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().join("workspace"));
        let id = Uuid::new_v4();
        let mut workspace = Workspace {
            version: 1,
            tabs: vec![TabState::Sql {
                title: "SQL 1".into(),
                text: "select 1 from dual".into(),
                kind: SqlKind::Sql,
            }],
        };
        assert!(store.load(id).unwrap().is_none());
        store.save(id, &workspace).unwrap();
        assert_eq!(store.load(id).unwrap(), Some(workspace.clone()));
        workspace.tabs.push(TabState::File {
            name: "demo.pks".into(),
            text: "PACKAGE demo AS END;".into(),
        });
        store.save(id, &workspace).unwrap();
        assert_eq!(store.load(id).unwrap(), Some(workspace));
        assert!(store.load(Uuid::new_v4()).unwrap().is_none());
        store.clear(id).unwrap();
        store.clear(id).unwrap();
        assert!(store.load(id).unwrap().is_none());
    }

    #[test]
    fn rechaza_versiones_y_topes() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().to_path_buf());
        let id = Uuid::new_v4();
        let mut workspace = Workspace {
            version: 9,
            tabs: Vec::new(),
        };
        assert!(store.save(id, &workspace).is_err());
        std::fs::write(store.path(id), br#"{"version":9,"tabs":[]}"#).unwrap();
        assert!(store.load(id).is_err());
        workspace.version = 1;
        let tab = TabState::File {
            name: "demo.sql".into(),
            text: String::new(),
        };
        workspace.tabs = vec![tab; 51];
        assert!(store.save(id, &workspace).is_err());
        workspace.tabs = vec![TabState::File {
            name: "demo.sql".into(),
            text: "á".repeat(1024 * 1024 + 1),
        }];
        assert!(store.save(id, &workspace).is_err());
    }
}
