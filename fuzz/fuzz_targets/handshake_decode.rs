//! Fuzz target: PrismaClientInit and PrismaServerInit decode.
//!
//! Exercises `decode_client_init` and `decode_server_init` with arbitrary
//! byte sequences to find panics, overflows, or undefined behavior in the
//! handshake message parser.

#![no_main]

use libfuzzer_sys::fuzz_target;

use prisma_core::protocol::codec::{
    decode_client_init, decode_client_resume, decode_server_init, decode_session_ticket,
};

fuzz_target!(|data: &[u8]| {
    // Try decoding as PrismaClientInit
    let _ = decode_client_init(data);

    // Try decoding as PrismaServerInit
    let _ = decode_server_init(data);

    // Try decoding as PrismaClientResume (0-RTT)
    let _ = decode_client_resume(data);

    // Try decoding as SessionTicket
    let _ = decode_session_ticket(data);
});
