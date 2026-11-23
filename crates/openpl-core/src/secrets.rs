//! Contraseñas en el almacén seguro del sistema (nunca en archivos).

use crate::CoreError;
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

pub trait SecretStore: Send + Sync {
    fn set(&self, id: Uuid, pw: &str) -> Result<(), CoreError>;
    fn get(&self, id: Uuid) -> Result<Option<String>, CoreError>;
    fn delete(&self, id: Uuid) -> Result<(), CoreError>;
}

/// Windows Credential Manager / Secret Service (Linux), vía `keyring`.
pub struct KeyringStore;

const SERVICE: &str = "openpl";

impl KeyringStore {
    fn entry(id: Uuid) -> Result<keyring::Entry, CoreError> {
        keyring::Entry::new(SERVICE, &id.to_string()).map_err(|e| CoreError::Secret(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, id: Uuid, pw: &str) -> Result<(), CoreError> {
        Self::entry(id)?.set_password(pw).map_err(|e| CoreError::Secret(e.to_string()))
    }

    fn get(&self, id: Uuid) -> Result<Option<String>, CoreError> {
        match Self::entry(id)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(CoreError::Secret(e.to_string())),
        }
    }

    fn delete(&self, id: Uuid) -> Result<(), CoreError> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(CoreError::Secret(e.to_string())),
        }
    }
}

/// Almacén en memoria para pruebas.
#[derive(Default)]
pub struct MemoryStore {
    map: Mutex<HashMap<Uuid, String>>,
}

impl SecretStore for MemoryStore {
    fn set(&self, id: Uuid, pw: &str) -> Result<(), CoreError> {
        self.map.lock().unwrap().insert(id, pw.to_string());
        Ok(())
    }

    fn get(&self, id: Uuid) -> Result<Option<String>, CoreError> {
        Ok(self.map.lock().unwrap().get(&id).cloned())
    }

    fn delete(&self, id: Uuid) -> Result<(), CoreError> {
        self.map.lock().unwrap().remove(&id);
        Ok(())
    }
}
