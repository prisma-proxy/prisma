/**
 * prisma_ffi.h — C API for Prisma GUI clients.
 *
 * All strings are null-terminated UTF-8.
 * Strings returned by prisma_* functions must be freed with prisma_free_string().
 * Thread-safety: all functions are thread-safe unless documented otherwise.
 */

#ifndef PRISMA_FFI_H
#define PRISMA_FFI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Opaque handle ───────────────────────────────────────────────────────── */
typedef struct PrismaClient PrismaClient;

/* ── Error codes ─────────────────────────────────────────────────────────── */
typedef enum PrismaError {
    PRISMA_OK                    = 0,
    PRISMA_ERR_INVALID_CONFIG    = 1,
    PRISMA_ERR_ALREADY_CONNECTED = 2,
    PRISMA_ERR_NOT_CONNECTED     = 3,
    PRISMA_ERR_PERMISSION_DENIED = 4,
    PRISMA_ERR_INTERNAL          = 5,
} PrismaError;

/* ── Status codes ────────────────────────────────────────────────────────── */
typedef enum PrismaStatus {
    PRISMA_STATUS_DISCONNECTED = 0,
    PRISMA_STATUS_CONNECTING   = 1,
    PRISMA_STATUS_CONNECTED    = 2,
    PRISMA_STATUS_ERROR        = 3,
} PrismaStatus;

/* ── Proxy mode flags (OR together) ──────────────────────────────────────── */
typedef enum PrismaProxyMode {
    PRISMA_MODE_SOCKS5       = 0x01,
    PRISMA_MODE_SYSTEM_PROXY = 0x02,
    PRISMA_MODE_TUN          = 0x04,
    PRISMA_MODE_PER_APP      = 0x08,
} PrismaProxyMode;

/* ── Callback ─────────────────────────────────────────────────────────────── */
/**
 * Event callback — called on an arbitrary thread with a JSON-encoded event.
 * The event_json pointer is only valid for the duration of the call.
 * userdata is passed through unchanged.
 *
 * Event types:
 *   {"type":"status_changed","status":"connected"|"connecting"|"disconnected"|"error"}
 *   {"type":"stats","bytes_up":N,"bytes_down":N,"speed_up_bps":N,"speed_down_bps":N,"uptime_secs":N}
 *   {"type":"log","level":"info"|"warn"|"error","target":"...","msg":"..."}
 *   {"type":"speed_test_result","download_mbps":N,"upload_mbps":N}
 *   {"type":"update_available","version":"v0.7.0","changelog":"..."}
 *   {"type":"error","code":"...","msg":"..."}
 */
typedef void (*PrismaCallback)(const char* event_json, void* userdata);

/* ── Lifecycle ────────────────────────────────────────────────────────────── */
PrismaClient* prisma_create(void);
void          prisma_destroy(PrismaClient* handle);

/* ── Connection ──────────────────────────────────────────────────────────── */
PrismaError   prisma_connect(PrismaClient* handle, const char* config_json, uint32_t modes);
PrismaError   prisma_disconnect(PrismaClient* handle);
int           prisma_get_status(PrismaClient* handle); /* returns PrismaStatus */
const char*   prisma_get_stats_json(PrismaClient* handle); /* caller must prisma_free_string() */
void          prisma_free_string(char* s);
void          prisma_set_callback(PrismaClient* handle, PrismaCallback cb, void* userdata);

/* ── Profile management ──────────────────────────────────────────────────── */
const char*   prisma_profiles_list_json(void);           /* caller must prisma_free_string() */
PrismaError   prisma_profile_save(const char* profile_json);
PrismaError   prisma_profile_delete(const char* id);

/* ── QR code ─────────────────────────────────────────────────────────────── */
const char*   prisma_profile_to_qr_svg(const char* profile_json); /* caller must prisma_free_string() */
PrismaError   prisma_profile_from_qr(const char* data, char** out_json);

/* ── System proxy ────────────────────────────────────────────────────────── */
PrismaError   prisma_set_system_proxy(const char* host, uint16_t port);
PrismaError   prisma_clear_system_proxy(void);

/* ── Auto-update ─────────────────────────────────────────────────────────── */
const char*   prisma_check_update_json(void); /* {version,url,changelog} or NULL; caller must prisma_free_string() */
PrismaError   prisma_apply_update(const char* download_url, const char* sha256);

/* ── Speed test ──────────────────────────────────────────────────────────── */
PrismaError   prisma_speed_test(PrismaClient* handle, const char* server,
                                uint32_t duration_secs, const char* direction);

#ifdef __cplusplus
}
#endif

#endif /* PRISMA_FFI_H */
