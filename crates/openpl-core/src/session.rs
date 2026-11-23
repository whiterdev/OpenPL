//! Sesiones: cada una es un hilo dueño de su conexión; la interfaz nunca se bloquea.

use crate::CoreError;
use openpl_oracle::{ConnectParams, DbConn, DbError, DbVersion, ErrorKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SessionState {
    Connected,
    Disconnected,
}

/// Abstrae cómo se abre una conexión (Oracle real o falsa en pruebas).
pub trait Connector: Send + Sync + 'static {
    type Conn: Send + 'static;
    fn connect(&self, p: &ConnectParams) -> Result<Self::Conn, DbError>;
    fn server_version(conn: &Self::Conn) -> DbVersion;
}

pub struct OracleConnector;

impl Connector for OracleConnector {
    type Conn = DbConn;
    fn connect(&self, p: &ConnectParams) -> Result<DbConn, DbError> {
        DbConn::connect(p)
    }
    fn server_version(conn: &DbConn) -> DbVersion {
        conn.server_version()
    }
}

type Job<T> = Box<dyn FnOnce(&mut Option<T>) + Send>;

const CONNECTED: u8 = 0;
const DISCONNECTED: u8 = 1;

/// Una conexión viva en su propio hilo. Al soltarla, el hilo termina y libera la conexión.
pub struct Session<C: Connector> {
    tx: Mutex<mpsc::Sender<Job<C::Conn>>>,
    state: Arc<AtomicU8>,
    connector: Arc<C>,
    params: ConnectParams,
}

impl<C: Connector> Session<C> {
    /// Abre la conexión en un hilo nuevo. Bloqueante: llamar desde `spawn_blocking`.
    pub fn open(connector: Arc<C>, params: ConnectParams) -> Result<Self, DbError> {
        let (tx, rx) = mpsc::channel::<Job<C::Conn>>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), DbError>>();
        let c = connector.clone();
        let p = params.clone();
        std::thread::Builder::new()
            .name("openpl-session".into())
            .spawn(move || {
                let mut conn = match c.connect(&p) {
                    Ok(conn) => {
                        let _ = ready_tx.send(Ok(()));
                        Some(conn)
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                while let Ok(job) = rx.recv() {
                    job(&mut conn);
                }
            })
            .map_err(|e| DbError::from_code(None, &e.to_string()))?;
        ready_rx.recv().map_err(|e| DbError::from_code(None, &e.to_string()))??;
        Ok(Self { tx: Mutex::new(tx), state: Arc::new(AtomicU8::new(CONNECTED)), connector, params })
    }

    pub fn state(&self) -> SessionState {
        if self.state.load(Ordering::SeqCst) == CONNECTED {
            SessionState::Connected
        } else {
            SessionState::Disconnected
        }
    }

    fn send(&self, job: Job<C::Conn>) -> Result<(), CoreError> {
        self.tx.lock().unwrap().send(job).map_err(|_| CoreError::Disconnected)
    }

    /// Ejecuta `f` en el hilo de la sesión. Si Oracle reporta conexión perdida, la sesión queda desconectada.
    pub async fn run<R: Send + 'static>(
        &self,
        f: impl FnOnce(&C::Conn) -> Result<R, DbError> + Send + 'static,
    ) -> Result<R, CoreError> {
        if self.state() == SessionState::Disconnected {
            return Err(CoreError::Disconnected);
        }
        let (otx, orx) = oneshot::channel();
        self.send(Box::new(move |conn: &mut Option<C::Conn>| {
            let r = match conn.as_ref() {
                Some(c) => f(c),
                None => Err(DbError::from_code(Some("DPI-1010".into()), "DPI-1010: not connected")),
            };
            let _ = otx.send(r);
        }))?;
        match orx.await.map_err(|_| CoreError::Disconnected)? {
            Ok(v) => Ok(v),
            Err(e) => {
                if e.kind == ErrorKind::ConnectionLost {
                    self.state.store(DISCONNECTED, Ordering::SeqCst);
                }
                Err(CoreError::Db(e))
            }
        }
    }

    /// Vuelve a conectar con los mismos parámetros, en el mismo hilo.
    pub async fn reconnect(&self) -> Result<(), CoreError> {
        let (otx, orx) = oneshot::channel();
        let connector = self.connector.clone();
        let params = self.params.clone();
        self.send(Box::new(move |slot: &mut Option<C::Conn>| {
            *slot = None;
            let r = connector.connect(&params).map(|c| {
                *slot = Some(c);
            });
            let _ = otx.send(r);
        }))?;
        orx.await.map_err(|_| CoreError::Disconnected)??;
        self.state.store(CONNECTED, Ordering::SeqCst);
        Ok(())
    }
}

/// Sesiones abiertas por id.
pub struct SessionManager<C: Connector> {
    connector: Arc<C>,
    sessions: RwLock<HashMap<SessionId, Arc<Session<C>>>>,
}

impl<C: Connector> SessionManager<C> {
    pub fn new(connector: Arc<C>) -> Self {
        Self { connector, sessions: RwLock::new(HashMap::new()) }
    }

    pub async fn open(&self, p: ConnectParams) -> Result<SessionId, CoreError> {
        let connector = self.connector.clone();
        let session = tokio::task::spawn_blocking(move || Session::open(connector, p))
            .await
            .map_err(|e| CoreError::Io(e.to_string()))??;
        let id = SessionId(Uuid::new_v4());
        self.sessions.write().unwrap().insert(id, Arc::new(session));
        Ok(id)
    }

    pub fn get(&self, id: SessionId) -> Result<Arc<Session<C>>, CoreError> {
        self.sessions.read().unwrap().get(&id).cloned().ok_or(CoreError::SessionNotFound)
    }

    pub fn close(&self, id: SessionId) {
        self.sessions.write().unwrap().remove(&id);
    }
}

/// Conector falso para pruebas de este crate y de la app.
#[cfg(any(test, feature = "testing"))]
pub mod fake {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub struct FakeConn {
        pub server: DbVersion,
    }

    pub struct FakeConnector {
        pub server: DbVersion,
        pub connects: AtomicUsize,
    }

    impl FakeConnector {
        pub fn new(server: DbVersion) -> Self {
            Self { server, connects: AtomicUsize::new(0) }
        }
    }

    impl Connector for FakeConnector {
        type Conn = FakeConn;
        fn connect(&self, _p: &ConnectParams) -> Result<FakeConn, DbError> {
            self.connects.fetch_add(1, Ordering::SeqCst);
            Ok(FakeConn { server: self.server })
        }
        fn server_version(conn: &FakeConn) -> DbVersion {
            conn.server
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;
    use openpl_oracle::Role;
    use std::sync::Arc;

    fn params() -> ConnectParams {
        ConnectParams { user: "u".into(), password: "p".into(), db: "d".into(), role: Role::Normal }
    }

    fn lost() -> DbError {
        DbError::from_code(Some("ORA-03113".into()), "ORA-03113: end-of-file on communication channel")
    }

    fn open() -> Session<FakeConnector> {
        Session::open(Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0))), params()).unwrap()
    }

    #[tokio::test]
    async fn run_ejecuta_en_el_hilo_de_la_sesion() {
        let s = open();
        let id_hilo = s.run(|_| Ok(std::thread::current().id())).await.unwrap();
        assert_ne!(id_hilo, std::thread::current().id());
    }

    #[tokio::test]
    async fn conexion_perdida_marca_desconectada() {
        let s = open();
        let r: Result<(), CoreError> = s.run(|_| Err(lost())).await;
        assert!(matches!(r, Err(CoreError::Db(_))));
        assert_eq!(s.state(), SessionState::Disconnected);
        assert!(matches!(s.run(|_| Ok(1)).await, Err(CoreError::Disconnected)));
    }

    #[tokio::test]
    async fn reconnect_vuelve_a_connected() {
        let s = open();
        let _ = s.run(|_| -> Result<(), DbError> { Err(lost()) }).await;
        s.reconnect().await.unwrap();
        assert_eq!(s.state(), SessionState::Connected);
        assert_eq!(s.run(|_| Ok(1)).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn error_normal_no_desconecta() {
        let s = open();
        let r: Result<(), CoreError> =
            s.run(|_| Err(DbError::from_code(Some("ORA-00942".into()), "ORA-00942"))).await;
        assert!(r.is_err());
        assert_eq!(s.state(), SessionState::Connected);
    }

    #[tokio::test]
    async fn manager_get_inexistente() {
        let mgr = SessionManager::new(Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0))));
        assert!(matches!(mgr.get(SessionId(Uuid::new_v4())), Err(CoreError::SessionNotFound)));
    }

    #[tokio::test]
    async fn close_elimina_sesion() {
        let mgr = SessionManager::new(Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0))));
        let id = mgr.open(params()).await.unwrap();
        assert!(mgr.get(id).is_ok());
        mgr.close(id);
        assert!(matches!(mgr.get(id), Err(CoreError::SessionNotFound)));
    }

    #[tokio::test]
    async fn sesion_conoce_version_del_servidor() {
        let s = open();
        assert_eq!(s.run(|c| Ok(FakeConnector::server_version(c))).await.unwrap(), DbVersion::new(19, 0, 0));
    }
}
