//! Perfiles de conexión guardados en un archivo JSON del usuario (sin contraseñas).

use crate::CoreError;
use openpl_oracle::Role;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Dev,
    Qa,
    Prod,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConnectionProfile {
    pub id: Uuid,
    pub name: String,
    pub user: String,
    pub db: String,
    pub role: Role,
    pub environment: Option<Environment>,
    pub save_password: bool,
}

pub struct ProfileStore {
    path: PathBuf,
}

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// `<config del usuario>/openpl/connections.json`
    pub fn default_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("openpl")
            .join("connections.json")
    }

    pub fn load(&self) -> Result<Vec<ConnectionProfile>, CoreError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(serde_json::from_str(&text)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(e.into()),
        }
    }

    pub fn upsert(&self, p: ConnectionProfile) -> Result<(), CoreError> {
        let mut all = self.load()?;
        match all.iter_mut().find(|x| x.id == p.id) {
            Some(slot) => *slot = p,
            None => all.push(p),
        }
        self.save(&all)
    }

    pub fn delete(&self, id: Uuid) -> Result<(), CoreError> {
        let mut all = self.load()?;
        all.retain(|x| x.id != id);
        self.save(&all)
    }

    /// Escritura atómica: archivo temporal y renombrado.
    fn save(&self, all: &[ConnectionProfile]) -> Result<(), CoreError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(all)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perfil(id: Uuid, name: &str) -> ConnectionProfile {
        ConnectionProfile {
            id,
            name: name.into(),
            user: "HR".into(),
            db: "db.example.com:1521/DEVPDB".into(),
            role: Role::Normal,
            environment: Some(Environment::Dev),
            save_password: true,
        }
    }

    fn store() -> (tempfile::TempDir, ProfileStore) {
        let dir = tempfile::tempdir().unwrap();
        let s = ProfileStore::new(dir.path().join("sub").join("c.json"));
        (dir, s)
    }

    #[test]
    fn load_sin_archivo_devuelve_vacio() {
        let (_d, s) = store();
        assert_eq!(s.load().unwrap(), vec![]);
    }

    #[test]
    fn upsert_y_load_ida_y_vuelta() {
        let (_d, s) = store();
        let p = perfil(Uuid::new_v4(), "HR en DEV");
        s.upsert(p.clone()).unwrap();
        assert_eq!(s.load().unwrap(), vec![p]);
    }

    #[test]
    fn upsert_reemplaza_mismo_id() {
        let (_d, s) = store();
        let id = Uuid::new_v4();
        s.upsert(perfil(id, "uno")).unwrap();
        s.upsert(perfil(id, "dos")).unwrap();
        let v = s.load().unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "dos");
    }

    #[test]
    fn delete_quita_perfil() {
        let (_d, s) = store();
        let id = Uuid::new_v4();
        s.upsert(perfil(id, "uno")).unwrap();
        s.upsert(perfil(Uuid::new_v4(), "otro")).unwrap();
        s.delete(id).unwrap();
        let v = s.load().unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "otro");
    }

    #[test]
    fn json_no_contiene_password() {
        let (_d, s) = store();
        s.upsert(perfil(Uuid::new_v4(), "uno")).unwrap();
        let raw = std::fs::read_to_string(&s.path).unwrap();
        assert!(!raw.contains("\"password\""));
        assert!(raw.contains("\"environment\": \"dev\""));
    }

    #[test]
    fn json_corrupto_da_error_json() {
        let (_d, s) = store();
        std::fs::create_dir_all(s.path.parent().unwrap()).unwrap();
        std::fs::write(&s.path, "{").unwrap();
        assert!(matches!(s.load(), Err(CoreError::Json(_))));
    }
}
