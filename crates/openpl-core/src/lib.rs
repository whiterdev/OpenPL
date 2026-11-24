//! Lógica de OpenPL independiente de la interfaz.

pub mod actions;
pub mod catalog;
pub mod error;
pub mod profiles;
pub mod program;
pub mod secrets;
pub mod session;
pub mod sql;

pub use error::CoreError;
pub use profiles::{ConnectionProfile, Environment, ProfileStore};
pub use secrets::{KeyringStore, MemoryStore, SecretStore};
