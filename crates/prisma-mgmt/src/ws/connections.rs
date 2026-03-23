//! WebSocket endpoint for real-time connection updates.
//!
//! Streams a JSON snapshot of all active connections every second, including
//! destination, matched rule, bytes transferred, and duration.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use serde::Serialize;
use uuid::Uuid;

use prisma_core::state::{SessionMode, Transport};

use crate::MgmtState;

#[derive(Serialize)]
struct WsConnectionEntry {
    session_id: Uuid,
    client_id: Option<Uuid>,
    client_name: Option<String>,
    peer_addr: String,
    transport: Transport,
    mode: SessionMode,
    connected_at: String,
    bytes_up: u64,
    bytes_down: u64,
    destination: Option<String>,
    matched_rule: Option<String>,
    duration_secs: u64,
}

#[derive(Serialize)]
struct WsConnectionsMessage {
    r#type: &'static str,
    connections: Vec<WsConnectionEntry>,
    total: usize,
}

pub async fn ws_connections(ws: WebSocketUpgrade, State(state): State<MgmtState>) -> Response {
    ws.on_upgrade(move |socket| handle_connections_ws(socket, state))
}

async fn handle_connections_ws(mut socket: WebSocket, state: MgmtState) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let conns = state.connections.read().await;
                let now = chrono::Utc::now();
                let entries: Vec<WsConnectionEntry> = conns
                    .values()
                    .map(|c| {
                        let duration = now
                            .signed_duration_since(c.connected_at)
                            .num_seconds()
                            .max(0) as u64;
                        WsConnectionEntry {
                            session_id: c.session_id,
                            client_id: c.client_id,
                            client_name: c.client_name.clone(),
                            peer_addr: c.peer_addr.clone(),
                            transport: c.transport,
                            mode: c.mode,
                            connected_at: c.connected_at.to_rfc3339(),
                            bytes_up: c.bytes_up_val(),
                            bytes_down: c.bytes_down_val(),
                            destination: c.destination.clone(),
                            matched_rule: c.matched_rule.clone(),
                            duration_secs: duration,
                        }
                    })
                    .collect();
                let total = entries.len();
                let msg = WsConnectionsMessage {
                    r#type: "connections",
                    connections: entries,
                    total,
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}
