//! Fuzz target: DataFrame decode.
//!
//! Exercises `decode_data_frame` with arbitrary byte sequences to find panics,
//! out-of-bounds reads, or unexpected behavior in the frame decoder. Also tests
//! all command variants by manipulating the command byte and flags.

#![no_main]

use libfuzzer_sys::fuzz_target;

use prisma_core::protocol::codec::decode_data_frame;

fuzz_target!(|data: &[u8]| {
    // Basic decode attempt
    let _ = decode_data_frame(data);

    // If long enough, try with various flag combinations
    if data.len() >= 7 {
        let mut modified = data.to_vec();

        // Try with FLAG_PADDED (0x0001 LE)
        modified[1] = 0x01;
        modified[2] = 0x00;
        let _ = decode_data_frame(&modified);

        // Try with FLAG_BUCKETED (0x0040 LE)
        modified[1] = 0x40;
        modified[2] = 0x00;
        let _ = decode_data_frame(&modified);

        // Try each command byte
        for cmd in [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F] {
            modified[0] = cmd;
            modified[1] = 0x00;
            modified[2] = 0x00;
            let _ = decode_data_frame(&modified);
        }
    }
});
