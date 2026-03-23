//! XMUX stream multiplexing: multiplex multiple proxy requests over a single
//! transport connection using a simple frame-based protocol.
//!
//! Frame format:
//! ```text
//! [stream_id: 4 bytes][frame_type: 1 byte][length: 2 bytes][payload: variable]
//! ```
//!
//! Frame types:
//! - `0x01` SYN: open a new stream (payload: destination address)
//! - `0x02` DATA: stream data
//! - `0x03` FIN: close a stream gracefully
//! - `0x04` RST: reset a stream (error)

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::Result;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex, Notify};
use tracing::{debug, warn};

/// Mux frame header size: stream_id(4) + type(1) + length(2) = 7
pub const MUX_HEADER_SIZE: usize = 7;

/// Maximum mux payload per frame.
pub const MUX_MAX_PAYLOAD: usize = 32768;

/// Frame type constants.
pub const MUX_SYN: u8 = 0x01;
pub const MUX_DATA: u8 = 0x02;
pub const MUX_FIN: u8 = 0x03;
pub const MUX_RST: u8 = 0x04;

/// A single mux frame on the wire.
#[derive(Debug, Clone)]
pub struct MuxFrame {
    pub stream_id: u32,
    pub frame_type: u8,
    pub payload: Vec<u8>,
}

impl MuxFrame {
    /// Encode frame to bytes: [stream_id:4][type:1][length:2][payload]
    pub fn encode(&self) -> Vec<u8> {
        let len = self.payload.len() as u16;
        let mut buf = Vec::with_capacity(MUX_HEADER_SIZE + self.payload.len());
        buf.extend_from_slice(&self.stream_id.to_be_bytes());
        buf.push(self.frame_type);
        buf.extend_from_slice(&len.to_be_bytes());
        buf.extend_from_slice(&self.payload);
        buf
    }

    /// Decode frame from a reader.
    pub async fn decode<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Self> {
        let mut header = [0u8; MUX_HEADER_SIZE];
        reader.read_exact(&mut header).await?;
        let stream_id = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let frame_type = header[4];
        let length = u16::from_be_bytes([header[5], header[6]]) as usize;
        if length > MUX_MAX_PAYLOAD {
            return Err(anyhow::anyhow!(
                "Mux frame payload too large: {} > {}",
                length,
                MUX_MAX_PAYLOAD
            ));
        }
        let mut payload = vec![0u8; length];
        if length > 0 {
            reader.read_exact(&mut payload).await?;
        }
        Ok(MuxFrame {
            stream_id,
            frame_type,
            payload,
        })
    }
}

/// State of a single multiplexed stream.
#[derive(Debug)]
pub struct MuxStream {
    /// Receives data from the remote peer for this stream.
    pub rx: mpsc::Receiver<Vec<u8>>,
    /// The stream ID on the wire.
    pub stream_id: u32,
    /// Shared writer handle for sending frames back.
    pub writer: Arc<MuxWriter>,
    /// True when FIN has been received.
    closed: bool,
}

impl MuxStream {
    /// Read data from this mux stream. Returns `None` on stream close.
    pub async fn read(&mut self) -> Option<Vec<u8>> {
        if self.closed {
            return None;
        }
        match self.rx.recv().await {
            Some(data) if data.is_empty() => {
                self.closed = true;
                None
            }
            Some(data) => Some(data),
            None => {
                self.closed = true;
                None
            }
        }
    }

    /// Write data to this mux stream.
    pub async fn write(&self, data: &[u8]) -> Result<()> {
        let frame = MuxFrame {
            stream_id: self.stream_id,
            frame_type: MUX_DATA,
            payload: data.to_vec(),
        };
        self.writer.send_frame(frame).await
    }

    /// Close this stream gracefully.
    pub async fn close(&self) -> Result<()> {
        let frame = MuxFrame {
            stream_id: self.stream_id,
            frame_type: MUX_FIN,
            payload: Vec::new(),
        };
        self.writer.send_frame(frame).await
    }

    /// Reset this stream (error).
    pub async fn reset(&self) -> Result<()> {
        let frame = MuxFrame {
            stream_id: self.stream_id,
            frame_type: MUX_RST,
            payload: Vec::new(),
        };
        self.writer.send_frame(frame).await
    }
}

/// Serialized access to the transport write half.
#[derive(Debug)]
pub struct MuxWriter {
    tx: mpsc::Sender<Vec<u8>>,
}

impl MuxWriter {
    /// Send a framed mux message to the transport.
    pub async fn send_frame(&self, frame: MuxFrame) -> Result<()> {
        let encoded = frame.encode();
        self.tx
            .send(encoded)
            .await
            .map_err(|_| anyhow::anyhow!("Mux writer channel closed"))
    }
}

/// Client-side mux session: manages multiple streams over one transport connection.
pub struct MuxSession {
    next_stream_id: AtomicU32,
    max_streams: u32,
    streams: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>>,
    writer: Arc<MuxWriter>,
    /// Notification when a stream is removed (for concurrency limit).
    stream_removed: Arc<Notify>,
}

impl MuxSession {
    /// Create a new mux session over a transport.
    ///
    /// Spawns a background writer task that serializes frame writes and a
    /// background reader task that demultiplexes incoming frames.
    pub fn new<R, W>(reader: R, writer: W, max_streams: u32) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let streams: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Writer task: serializes frame writes
        let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(256);
        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(data) = write_rx.recv().await {
                if writer.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        let mux_writer = Arc::new(MuxWriter { tx: write_tx });

        // Reader task: demultiplexes incoming frames to per-stream channels
        let streams_clone = streams.clone();
        let stream_removed = Arc::new(Notify::new());
        let stream_removed_clone = stream_removed.clone();
        tokio::spawn(async move {
            let mut reader = reader;
            while let Ok(frame) = MuxFrame::decode(&mut reader).await {
                match frame.frame_type {
                    MUX_DATA => {
                        let tx = {
                            let map = streams_clone.lock().await;
                            map.get(&frame.stream_id).cloned()
                        };
                        if let Some(tx) = tx {
                            let _ = tx.send(frame.payload).await;
                        } else {
                            debug!(stream_id = frame.stream_id, "Mux frame for unknown stream");
                        }
                    }
                    MUX_FIN | MUX_RST => {
                        let tx = {
                            let mut map = streams_clone.lock().await;
                            map.remove(&frame.stream_id)
                        };
                        if let Some(tx) = tx {
                            let _ = tx.send(Vec::new()).await;
                        }
                        stream_removed_clone.notify_waiters();
                    }
                    _ => {
                        warn!(
                            stream_id = frame.stream_id,
                            frame_type = frame.frame_type,
                            "Unknown mux frame type"
                        );
                    }
                }
            }
            // Connection lost: close all streams
            let mut map = streams_clone.lock().await;
            for (_, tx) in map.drain() {
                let _ = tx.send(Vec::new()).await;
            }
        });

        Self {
            next_stream_id: AtomicU32::new(1), // Client uses odd IDs
            max_streams,
            streams,
            writer: mux_writer,
            stream_removed,
        }
    }

    /// Open a new multiplexed stream. Blocks if max_streams is reached.
    pub async fn open_stream(&self, syn_payload: &[u8]) -> Result<MuxStream> {
        // Atomically wait for capacity and insert the new stream under a single lock
        // to prevent TOCTOU races between capacity check and insertion.
        let (stream_id, rx) = loop {
            let mut map = self.streams.lock().await;
            if (map.len() as u32) < self.max_streams {
                let stream_id = self.next_stream_id.fetch_add(2, Ordering::Relaxed); // Odd IDs for client
                let (tx, rx) = mpsc::channel(64);
                map.insert(stream_id, tx);
                break (stream_id, rx);
            }
            // Drop the lock before waiting for notification
            drop(map);
            self.stream_removed.notified().await;
        };

        // Send SYN frame
        let syn = MuxFrame {
            stream_id,
            frame_type: MUX_SYN,
            payload: syn_payload.to_vec(),
        };
        self.writer.send_frame(syn).await?;

        debug!(stream_id, "Mux stream opened");

        Ok(MuxStream {
            rx,
            stream_id,
            writer: self.writer.clone(),
            closed: false,
        })
    }

    /// Get the number of active streams.
    pub async fn active_streams(&self) -> usize {
        self.streams.lock().await.len()
    }
}

/// Server-side mux demuxer: accepts incoming streams from a multiplexed connection.
pub struct MuxDemuxer {
    new_stream_rx: mpsc::Receiver<(u32, Vec<u8>, mpsc::Receiver<Vec<u8>>)>,
    writer: Arc<MuxWriter>,
}

impl MuxDemuxer {
    /// Create a new server-side demuxer.
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let streams: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Writer task
        let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(256);
        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(data) = write_rx.recv().await {
                if writer.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        let mux_writer = Arc::new(MuxWriter { tx: write_tx });

        // Channel for new stream notifications
        let (new_stream_tx, new_stream_rx) =
            mpsc::channel::<(u32, Vec<u8>, mpsc::Receiver<Vec<u8>>)>(64);

        // Reader task
        let streams_clone = streams.clone();
        tokio::spawn(async move {
            let mut reader = reader;
            while let Ok(frame) = MuxFrame::decode(&mut reader).await {
                match frame.frame_type {
                    MUX_SYN => {
                        let (tx, rx) = mpsc::channel(64);
                        streams_clone.lock().await.insert(frame.stream_id, tx);
                        // Notify about new stream
                        if new_stream_tx
                            .send((frame.stream_id, frame.payload, rx))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    MUX_DATA => {
                        let map = streams_clone.lock().await;
                        if let Some(tx) = map.get(&frame.stream_id) {
                            let _ = tx.send(frame.payload).await;
                        }
                    }
                    MUX_FIN | MUX_RST => {
                        let mut map = streams_clone.lock().await;
                        if let Some(tx) = map.remove(&frame.stream_id) {
                            let _ = tx.send(Vec::new()).await;
                        }
                    }
                    _ => {
                        warn!(
                            stream_id = frame.stream_id,
                            frame_type = frame.frame_type,
                            "Unknown mux frame type (server)"
                        );
                    }
                }
            }
        });

        Self {
            new_stream_rx,
            writer: mux_writer,
        }
    }

    /// Accept the next incoming multiplexed stream.
    /// Returns `(stream_id, syn_payload, MuxStream)` or `None` if the connection closed.
    pub async fn accept(&mut self) -> Option<(Vec<u8>, MuxStream)> {
        let (stream_id, syn_payload, rx) = self.new_stream_rx.recv().await?;
        debug!(stream_id, "Server accepted mux stream");
        Some((
            syn_payload,
            MuxStream {
                rx,
                stream_id,
                writer: self.writer.clone(),
                closed: false,
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mux_frame_encode_decode() {
        let frame = MuxFrame {
            stream_id: 42,
            frame_type: MUX_DATA,
            payload: vec![1, 2, 3, 4, 5],
        };
        let encoded = frame.encode();
        assert_eq!(encoded.len(), MUX_HEADER_SIZE + 5);

        // Verify header
        assert_eq!(
            u32::from_be_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]),
            42
        );
        assert_eq!(encoded[4], MUX_DATA);
        assert_eq!(u16::from_be_bytes([encoded[5], encoded[6]]), 5);
        assert_eq!(&encoded[7..], &[1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_mux_frame_empty_payload() {
        let frame = MuxFrame {
            stream_id: 1,
            frame_type: MUX_FIN,
            payload: Vec::new(),
        };
        let encoded = frame.encode();
        assert_eq!(encoded.len(), MUX_HEADER_SIZE);
        assert_eq!(u16::from_be_bytes([encoded[5], encoded[6]]), 0);
    }

    #[tokio::test]
    async fn test_mux_frame_decode_round_trip() {
        let frame = MuxFrame {
            stream_id: 99,
            frame_type: MUX_SYN,
            payload: b"example.com:443".to_vec(),
        };
        let encoded = frame.encode();
        let mut cursor = std::io::Cursor::new(encoded);
        let decoded = MuxFrame::decode(&mut cursor).await.unwrap();
        assert_eq!(decoded.stream_id, 99);
        assert_eq!(decoded.frame_type, MUX_SYN);
        assert_eq!(decoded.payload, b"example.com:443");
    }

    #[tokio::test]
    async fn test_mux_session_stream_lifecycle() {
        // Create a pair of connected transports using DuplexStream
        let (client_stream, server_stream) = tokio::io::duplex(65536);
        let (client_read, client_write) = tokio::io::split(client_stream);
        let (server_read, server_write) = tokio::io::split(server_stream);

        let session = MuxSession::new(client_read, client_write, 10);
        let mut demuxer = MuxDemuxer::new(server_read, server_write);

        // Client opens a stream
        let mut client_mux_stream = session.open_stream(b"hello-dest").await.unwrap();

        // Server accepts it
        let (syn_payload, mut server_mux_stream) = demuxer.accept().await.unwrap();
        assert_eq!(syn_payload, b"hello-dest");

        // Client sends data
        client_mux_stream.write(b"ping").await.unwrap();

        // Server receives it
        let data = server_mux_stream.read().await.unwrap();
        assert_eq!(data, b"ping");

        // Server responds
        server_mux_stream.write(b"pong").await.unwrap();

        // Client receives it
        let data = client_mux_stream.read().await.unwrap();
        assert_eq!(data, b"pong");

        // Close stream
        client_mux_stream.close().await.unwrap();

        // Server sees close
        let data = server_mux_stream.read().await;
        assert!(data.is_none());
    }
}
