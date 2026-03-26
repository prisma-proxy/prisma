//! WebSocket endpoint for config reload events.
//!
//! Subscribers receive a JSON `ReloadEvent` each time a config reload
//! occurs (whether triggered via the API, SIGHUP, or file watcher).

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;

use crate::MgmtState;

pub async fn ws_reload(ws: WebSocketUpgrade, State(state): State<MgmtState>) -> Response {
    ws.on_upgrade(move |socket| handle_reload_ws(socket, state))
}

async fn handle_reload_ws(mut socket: WebSocket, state: MgmtState) {
    let mut rx = state.state.reload_tx.subscribe();

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        if let Ok(json) = serde_json::to_string(&event) {
                            if socket.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
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
