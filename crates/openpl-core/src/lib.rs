//! Lógica de OpenPL independiente de la interfaz.

pub mod error;
pub mod profiles;
pub mod secrets;

pub use error::CoreError;
pub use profiles::{ConnectionProfile, Environment, ProfileStore};
pub use secrets::{KeyringStore, MemoryStore, SecretStore};
