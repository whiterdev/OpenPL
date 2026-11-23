//! Acceso a Oracle para OpenPL.

pub mod client;
pub mod connect;
pub mod error;
pub mod version;

pub use client::{client_help, client_version, init_client};
pub use connect::{ConnectParams, DbConn, Role};
pub use error::{classify, DbError, ErrorKind};
pub use version::{check_compat, Compat, DbVersion};
