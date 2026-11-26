//! Sesiones: cada una es un hilo dueño de su conexión; la interfaz nunca se bloquea.

use crate::CoreError;
use openpl_oracle::{ConnectParams, DbConn, DbError, DbVersion, ErrorKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
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

/// Interrumpe la llamada en curso de una conexión; se invoca desde otro hilo.
pub type Interrupter = Arc<dyn Fn() + Send + Sync>;

/// Abstrae cómo se abre una conexión (Oracle real o falsa en pruebas).
pub trait Connector: Send + Sync + 'static {
    type Conn: Send + 'static;
    fn connect(&self, p: &ConnectParams) -> Result<Self::Conn, DbError>;
    fn server_version(conn: &Self::Conn) -> DbVersion;
    fn interrupter(_conn: &Self::Conn) -> Option<Interrupter> {
        None
    }
    fn ping(_conn: &Self::Conn) -> Result<(), DbError> {
        Ok(())
    }
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
    fn interrupter(conn: &DbConn) -> Option<Interrupter> {
        let raw = conn.shared();
        Some(Arc::new(move || {
            let _ = raw.break_execution();
        }))
    }
    fn ping(conn: &DbConn) -> Result<(), DbError> {
        conn.ping()
    }
}

type Job<T> = Box<dyn FnOnce(&mut Option<T>) + Send>;

const CONNECTED: u8 = 0;
const DISCONNECTED: u8 = 1;

/// Marca un trabajo activo en el hilo de la sesión para que `ping` no se encole detrás.
struct BusyGuard(Arc<AtomicUsize>);

impl BusyGuard {
    fn enter(counter: &Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self(counter.clone())
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Una conexión viva en su propio hilo. Al soltarla, el hilo termina y libera la conexión.
pub struct Session<C: Connector> {
    tx: Mutex<mpsc::Sender<Job<C::Conn>>>,
    state: Arc<AtomicU8>,
    connector: Arc<C>,
    params: ConnectParams,
    interrupter: Arc<Mutex<Option<Interrupter>>>,
    active_jobs: Arc<AtomicUsize>,
}

impl<C: Connector> Session<C> {
    /// Abre la conexión en un hilo nuevo. Bloqueante: llamar desde `spawn_blocking`.
    pub fn open(connector: Arc<C>, params: ConnectParams) -> Result<Self, DbError> {
        let (tx, rx) = mpsc::channel::<Job<C::Conn>>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), DbError>>();
        let c = connector.clone();
        let p = params.clone();
        let interrupter: Arc<Mutex<Option<Interrupter>>> = Arc::default();
        let slot = interrupter.clone();
        std::thread::Builder::new()
            .name("openpl-session".into())
            .spawn(move || {
                let mut conn = match c.connect(&p) {
                    Ok(conn) => {
                        *slot.lock().unwrap() = C::interrupter(&conn);
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
        ready_rx
            .recv()
            .map_err(|e| DbError::from_code(None, &e.to_string()))??;
        Ok(Self {
            tx: Mutex::new(tx),
            state: Arc::new(AtomicU8::new(CONNECTED)),
            connector,
            params,
            interrupter,
            active_jobs: Arc::default(),
        })
    }

    pub fn params(&self) -> &ConnectParams {
        &self.params
    }

    /// Interrumpe la sentencia en curso sin esperar al hilo de la sesión. `false` si no se puede.
    pub fn interrupt(&self) -> bool {
        let handle = self.interrupter.lock().unwrap().clone();
        match handle {
            Some(interrupt) => {
                interrupt();
                true
            }
            None => false,
        }
    }

    pub fn state(&self) -> SessionState {
        if self.state.load(Ordering::SeqCst) == CONNECTED {
            SessionState::Connected
        } else {
            SessionState::Disconnected
        }
    }

    fn send(&self, job: Job<C::Conn>) -> Result<(), CoreError> {
        self.tx
            .lock()
            .unwrap()
            .send(job)
            .map_err(|_| CoreError::Disconnected)
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
        let guard = BusyGuard::enter(&self.active_jobs);
        self.send(Box::new(move |conn: &mut Option<C::Conn>| {
            let _busy = guard;
            let r = match conn.as_ref() {
                Some(c) => f(c),
                None => Err(DbError::from_code(
                    Some("DPI-1010".into()),
                    "DPI-1010: not connected",
                )),
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

    /// Comprueba la conexión en el hilo de la sesión; si está ocupada devuelve `true` sin encolar.
    pub async fn ping(&self) -> Result<bool, CoreError> {
        if self.state() == SessionState::Disconnected {
            return Ok(false);
        }
        if self.active_jobs.load(Ordering::SeqCst) > 0 {
            return Ok(true);
        }
        match self.run(|c| C::ping(c)).await {
            Ok(()) => Ok(true),
            Err(_) => {
                self.state.store(DISCONNECTED, Ordering::SeqCst);
                Ok(false)
            }
        }
    }

    /// Vuelve a conectar con los mismos parámetros, en el mismo hilo.
    pub async fn reconnect(&self) -> Result<(), CoreError> {
        let (otx, orx) = oneshot::channel();
        let connector = self.connector.clone();
        let params = self.params.clone();
        let interrupter = self.interrupter.clone();
        let guard = BusyGuard::enter(&self.active_jobs);
        self.send(Box::new(move |slot: &mut Option<C::Conn>| {
            let _busy = guard;
            *slot = None;
            let r = connector.connect(&params).map(|c| {
                *interrupter.lock().unwrap() = C::interrupter(&c);
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
    children: RwLock<HashMap<SessionId, Vec<SessionId>>>,
    parents: RwLock<HashMap<SessionId, SessionId>>,
}

impl<C: Connector> SessionManager<C> {
    pub fn new(connector: Arc<C>) -> Self {
        Self {
            connector,
            sessions: RwLock::new(HashMap::new()),
            children: RwLock::new(HashMap::new()),
            parents: RwLock::new(HashMap::new()),
        }
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

    /// Abre otra sesión con los parámetros de `id` (ventanas con transacción propia).
    pub async fn open_sibling(&self, id: SessionId) -> Result<SessionId, CoreError> {
        let params = self.get(id)?.params().clone();
        let child = self.open(params).await?;
        let sessions = self.sessions.read().unwrap();
        if !sessions.contains_key(&id) {
            drop(sessions);
            self.close(child);
            return Err(CoreError::SessionNotFound);
        }
        self.children
            .write()
            .unwrap()
            .entry(id)
            .or_default()
            .push(child);
        self.parents.write().unwrap().insert(child, id);
        Ok(child)
    }

    pub fn siblings(&self, parent: SessionId) -> Vec<SessionId> {
        self.children
            .read()
            .unwrap()
            .get(&parent)
            .cloned()
            .unwrap_or_default()
    }

    pub fn get(&self, id: SessionId) -> Result<Arc<Session<C>>, CoreError> {
        self.sessions
            .read()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or(CoreError::SessionNotFound)
    }

    pub fn close(&self, id: SessionId) {
        let mut to_close = vec![id];
        let mut sessions = self.sessions.write().unwrap();
        let mut children = self.children.write().unwrap();
        let mut parents = self.parents.write().unwrap();

        if let Some(parent) = parents.remove(&id) {
            if let Some(list) = children.get_mut(&parent) {
                list.retain(|&c| c != id);
            }
        }

        while let Some(cur) = to_close.pop() {
            sessions.remove(&cur);
            parents.remove(&cur);
            if let Some(kids) = children.remove(&cur) {
                to_close.extend(kids);
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.sessions.read().unwrap().is_empty()
    }
}

/// Conector falso para pruebas de este crate y de la app.
#[cfg(any(test, feature = "testing"))]
pub mod fake {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub struct FakeConn {
        pub server: DbVersion,
        interrupts: Arc<AtomicUsize>,
        pings: Arc<AtomicUsize>,
        fail_ping: Arc<AtomicBool>,
    }

    pub struct FakeConnector {
        pub server: DbVersion,
        pub connects: AtomicUsize,
        pub interrupts: Arc<AtomicUsize>,
        pub pings: Arc<AtomicUsize>,
        fail_ping: Arc<AtomicBool>,
    }

    impl FakeConnector {
        pub fn new(server: DbVersion) -> Self {
            Self {
                server,
                connects: AtomicUsize::new(0),
                interrupts: Arc::default(),
                pings: Arc::default(),
                fail_ping: Arc::default(),
            }
        }

        pub fn set_fail_ping(&self, fail: bool) {
            self.fail_ping.store(fail, Ordering::SeqCst);
        }
    }

    impl Connector for FakeConnector {
        type Conn = FakeConn;
        fn connect(&self, _p: &ConnectParams) -> Result<FakeConn, DbError> {
            self.connects.fetch_add(1, Ordering::SeqCst);
            Ok(FakeConn {
                server: self.server,
                interrupts: self.interrupts.clone(),
                pings: self.pings.clone(),
                fail_ping: self.fail_ping.clone(),
            })
        }
        fn server_version(conn: &FakeConn) -> DbVersion {
            conn.server
        }
        fn interrupter(conn: &FakeConn) -> Option<Interrupter> {
            let count = conn.interrupts.clone();
            Some(Arc::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
            }))
        }
        fn ping(conn: &FakeConn) -> Result<(), DbError> {
            conn.pings.fetch_add(1, Ordering::SeqCst);
            if conn.fail_ping.load(Ordering::SeqCst) {
                return Err(DbError::from_code(
                    Some("ORA-03113".into()),
                    "ORA-03113: end-of-file on communication channel",
                ));
            }
            Ok(())
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
        ConnectParams {
            user: "u".into(),
            password: "p".into(),
            db: "d".into(),
            role: Role::Normal,
        }
    }

    fn lost() -> DbError {
        DbError::from_code(
            Some("ORA-03113".into()),
            "ORA-03113: end-of-file on communication channel",
        )
    }

    fn open() -> Session<FakeConnector> {
        Session::open(
            Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0))),
            params(),
        )
        .unwrap()
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
        assert!(matches!(
            s.run(|_| Ok(1)).await,
            Err(CoreError::Disconnected)
        ));
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
        let r: Result<(), CoreError> = s
            .run(|_| Err(DbError::from_code(Some("ORA-00942".into()), "ORA-00942")))
            .await;
        assert!(r.is_err());
        assert_eq!(s.state(), SessionState::Connected);
    }

    #[tokio::test]
    async fn manager_get_inexistente() {
        let mgr = SessionManager::new(Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0))));
        assert!(matches!(
            mgr.get(SessionId(Uuid::new_v4())),
            Err(CoreError::SessionNotFound)
        ));
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
    async fn sesion_hermana_usa_los_mismos_datos_y_es_otra() {
        let connector = Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0)));
        let mgr = SessionManager::new(connector.clone());
        let id = mgr.open(params()).await.unwrap();
        let sibling = mgr.open_sibling(id).await.unwrap();
        assert_ne!(id, sibling);
        assert_eq!(
            connector.connects.load(std::sync::atomic::Ordering::SeqCst),
            2
        );
        assert_eq!(mgr.get(sibling).unwrap().params().user, "u");
        assert_eq!(mgr.siblings(id), vec![sibling]);
        mgr.close(id);
        assert!(matches!(mgr.get(sibling), Err(CoreError::SessionNotFound)));
        assert!(mgr.siblings(id).is_empty());
        assert!(mgr.is_empty());
    }

    #[tokio::test]
    async fn cerrar_una_hermana_solo_saca_esa_de_siblings() {
        let mgr = SessionManager::new(Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0))));
        let parent = mgr.open(params()).await.unwrap();
        let s1 = mgr.open_sibling(parent).await.unwrap();
        let s2 = mgr.open_sibling(parent).await.unwrap();
        assert_eq!(mgr.siblings(parent), vec![s1, s2]);
        mgr.close(s1);
        assert_eq!(mgr.siblings(parent), vec![s2]);
        assert!(mgr.get(parent).is_ok());
        mgr.close(parent);
        assert!(mgr.is_empty());
    }

    #[tokio::test]
    async fn ping_marca_desconectada_si_falla_y_no_encola_si_esta_ocupada() {
        let connector = Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0)));
        let mgr = SessionManager::new(connector.clone());
        let id = mgr.open(params()).await.unwrap();
        let session = mgr.get(id).unwrap();

        assert!(session.ping().await.unwrap());
        assert_eq!(connector.pings.load(Ordering::SeqCst), 1);

        // Sesión ocupada: ping devuelve true sin encolar ni ejecutar ping.
        let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let gate_job = gate.clone();
        let busy_session = session.clone();
        let job = tokio::spawn(async move {
            busy_session
                .run(move |_| {
                    entered_tx.send(()).unwrap();
                    let (l, cv) = &*gate_job;
                    let mut done = l.lock().unwrap();
                    while !*done {
                        done = cv.wait(done).unwrap();
                    }
                    Ok(())
                })
                .await
        });
        entered_rx.await.unwrap();
        assert!(session.ping().await.unwrap());
        assert_eq!(connector.pings.load(Ordering::SeqCst), 1);
        {
            let (l, cv) = &*gate;
            *l.lock().unwrap() = true;
            cv.notify_all();
        }
        job.await.unwrap().unwrap();

        // Ping que falla marca la sesión como desconectada y devuelve false.
        connector.set_fail_ping(true);
        assert!(!session.ping().await.unwrap());
        assert_eq!(session.state(), SessionState::Disconnected);
        assert!(!session.ping().await.unwrap());
    }

    #[tokio::test]
    async fn interrumpir_llama_al_manejador_desde_otro_hilo() {
        let connector = Arc::new(FakeConnector::new(DbVersion::new(19, 0, 0)));
        let s = Session::open(connector.clone(), params()).unwrap();
        assert!(s.interrupt());
        assert_eq!(
            connector
                .interrupts
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[tokio::test]
    async fn sesion_conoce_version_del_servidor() {
        let s = open();
        assert_eq!(
            s.run(|c| Ok(FakeConnector::server_version(c)))
                .await
                .unwrap(),
            DbVersion::new(19, 0, 0)
        );
    }
}
