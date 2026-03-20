/**
 * prisma_ffi.h — C API for Prisma GUI and mobile clients.
 *
 * All strings are null-terminated UTF-8.
 * Strings returned by prisma_* functions must be freed with prisma_free_string()
 * unless documented otherwise (e.g., prisma_version).
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
    PRISMA_ERR_NULL_POINTER      = 6,
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

/* ── Network type (mobile lifecycle) ─────────────────────────────────────── */
typedef enum PrismaNetworkType {
    PRISMA_NET_DISCONNECTED = 0,
    PRISMA_NET_WIFI         = 1,
    PRISMA_NET_CELLULAR     = 2,
    PRISMA_NET_ETHERNET     = 3,
} PrismaNetworkType;

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
 *   {"type":"error","code":"...","msg":"..."}
 *   {"type":"network_changed","network":"wifi"|"cellular"|"disconnected"|"ethernet","previous":N}
 *   {"type":"lifecycle","state":"background"|"foreground"}
 *   {"type":"warning","code":"network_lost","msg":"..."}
 *   {"type":"info","code":"network_reconnect"|"memory_warning","msg":"..."}
 */
typedef void (*PrismaCallback)(const char* event_json, void* userdata);

/* ── Lifecycle ────────────────────────────────────────────────────────────── */
PrismaClient* prisma_create(void);
void          prisma_destroy(PrismaClient* handle);

/* ── Version ─────────────────────────────────────────────────────────────── */
/** Returns a static string — do NOT call prisma_free_string() on it. */
const char*   prisma_version(void);

/* ── Connection ──────────────────────────────────────────────────────────── */
PrismaError   prisma_connect(PrismaClient* handle, const char* config_json, uint32_t modes);
PrismaError   prisma_disconnect(PrismaClient* handle);
int           prisma_get_status(PrismaClient* handle); /* returns PrismaStatus */
char*         prisma_get_stats_json(PrismaClient* handle); /* caller must prisma_free_string() */
void          prisma_free_string(char* s);
void          prisma_set_callback(PrismaClient* handle, PrismaCallback cb, void* userdata);

/* ── Profile management ──────────────────────────────────────────────────── */
char*         prisma_profiles_list_json(void);           /* caller must prisma_free_string() */
PrismaError   prisma_profile_save(const char* profile_json);
PrismaError   prisma_profile_delete(const char* id);
char*         prisma_import_subscription(const char* url); /* caller must prisma_free_string() */
char*         prisma_refresh_subscriptions(void);          /* caller must prisma_free_string() */

/* ── QR code ─────────────────────────────────────────────────────────────── */
char*         prisma_profile_to_qr_svg(const char* profile_json); /* caller must prisma_free_string() */
PrismaError   prisma_profile_from_qr(const char* data, char** out_json);

/* ── Profile sharing ─────────────────────────────────────────────────────── */
char*         prisma_profile_to_uri(const char* profile_json);       /* caller must prisma_free_string() */
char*         prisma_profile_config_to_toml(const char* config_json); /* caller must prisma_free_string() */

/* ── System proxy ────────────────────────────────────────────────────────── */
PrismaError   prisma_set_system_proxy(const char* host, uint16_t port);
PrismaError   prisma_clear_system_proxy(void);

/* ── Auto-update ─────────────────────────────────────────────────────────── */
char*         prisma_check_update_json(void); /* {version,url,changelog} or NULL; caller must prisma_free_string() */
PrismaError   prisma_apply_update(const char* download_url, const char* sha256);

/* ── URI import ──────────────────────────────────────────────────────────── */
/** Import a single proxy URI (ss://, vmess://, trojan://, prisma://). Caller must prisma_free_string(). */
char*         prisma_import_uri(const char* uri);
/** Import multiple URIs from text (line-separated or base64). Caller must prisma_free_string(). */
char*         prisma_import_batch(const char* text);

/* ── Network testing ─────────────────────────────────────────────────────── */
char*         prisma_ping(const char* server_addr); /* caller must prisma_free_string() */

/* ── Speed test ──────────────────────────────────────────────────────────── */
PrismaError   prisma_speed_test(PrismaClient* handle, const char* server,
                                uint32_t duration_secs, const char* direction);

/* ── PAC URL ─────────────────────────────────────────────────────────────── */
char*         prisma_get_pac_url(PrismaClient* handle, uint16_t pac_port); /* caller must prisma_free_string() */

/* ── Per-app proxy ───────────────────────────────────────────────────────── */
PrismaError   prisma_set_per_app_filter(const char* app_names_json); /* NULL to disable */
char*         prisma_get_per_app_filter(void);  /* caller must prisma_free_string() */
char*         prisma_get_running_apps(void);    /* caller must prisma_free_string() */

/* ── Mobile lifecycle ────────────────────────────────────────────────────── */
/**
 * Get the current cached network type.
 * Returns: 0=disconnected, 1=WiFi, 2=cellular, 3=ethernet, -1=null handle
 */
int32_t       prisma_get_network_type(PrismaClient* handle);

/**
 * Notify library of network connectivity change.
 * network_type: 0=disconnected, 1=WiFi, 2=cellular, 3=ethernet
 */
PrismaError   prisma_on_network_change(PrismaClient* handle, int32_t network_type);

/** Notify library of low-memory warning from the OS. */
PrismaError   prisma_on_memory_warning(PrismaClient* handle);

/** Notify library that app entered background. */
PrismaError   prisma_on_background(PrismaClient* handle);

/** Notify library that app returned to foreground. */
PrismaError   prisma_on_foreground(PrismaClient* handle);

/**
 * Get traffic stats as JSON for mobile status bar widgets.
 * Returns: {"bytes_up":N,"bytes_down":N,"connected":bool}
 * Caller must prisma_free_string(). Returns NULL if not connected.
 */
char*         prisma_get_traffic_stats(PrismaClient* handle);

/* ── iOS-specific (only available on iOS builds) ─────────────────────────── */
#if defined(__APPLE__) && defined(__IPHONE_OS_VERSION_MIN_REQUIRED)

/** Prepare VPN tunnel config with iOS defaults. Caller must prisma_free_string(). */
char*         prisma_ios_prepare_tunnel_config(const char* tunnel_config_json);

/** Get the stored TUN fd. Returns -1 if not set. */
int           prisma_ios_get_tun_fd(void);

/** Set the TUN fd from NetworkExtension. */
PrismaError   prisma_ios_set_tun_fd(PrismaClient* handle, int fd);

/** Get the iOS data directory path. Caller must prisma_free_string(). */
char*         prisma_ios_get_data_dir(void);

/** Get VPN permission status: 1=granted, 0=not granted, -1=unknown. */
int           prisma_ios_vpn_permission_status(void);

/** Set VPN permission status (called from Swift). */
void          prisma_ios_set_vpn_permission(int granted);

#endif /* iOS */

#ifdef __cplusplus
}
#endif

#endif /* PRISMA_FFI_H */
