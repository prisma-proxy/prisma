//! FFI boundary tests for prisma-ffi.
//!
//! These tests exercise every exported `extern "C"` function with edge cases:
//! null pointers, invalid state transitions, error code correctness, and
//! UTF-8 encoding. Each unsafe FFI call is wrapped in a safe test helper.

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::ptr;

// ── Re-export FFI constants ──────────────────────────────────────────────────

use prisma_ffi::{
    PRISMA_ERR_ALREADY_CONNECTED, PRISMA_ERR_INTERNAL, PRISMA_ERR_INVALID_CONFIG,
    PRISMA_ERR_NOT_CONNECTED, PRISMA_ERR_NULL_POINTER, PRISMA_OK, PRISMA_STATUS_CONNECTED,
    PRISMA_STATUS_DISCONNECTED,
};

// ── Safe wrappers ─────────────────────────────────────────────────────────────

fn create_client() -> *mut prisma_ffi::PrismaClient {
    prisma_ffi::prisma_create()
}

fn destroy_client(handle: *mut prisma_ffi::PrismaClient) {
    unsafe { prisma_ffi::prisma_destroy(handle) };
}

fn get_status(handle: *mut prisma_ffi::PrismaClient) -> c_int {
    unsafe { prisma_ffi::prisma_get_status(handle) }
}

fn get_stats_json(handle: *mut prisma_ffi::PrismaClient) -> *mut c_char {
    unsafe { prisma_ffi::prisma_get_stats_json(handle) }
}

fn free_string(s: *mut c_char) {
    unsafe { prisma_ffi::prisma_free_string(s) };
}

fn connect_with(handle: *mut prisma_ffi::PrismaClient, json: &str, modes: u32) -> c_int {
    let cstr = CString::new(json).unwrap();
    unsafe { prisma_ffi::prisma_connect(handle, cstr.as_ptr(), modes) }
}

fn disconnect(handle: *mut prisma_ffi::PrismaClient) -> c_int {
    unsafe { prisma_ffi::prisma_disconnect(handle) }
}

fn set_callback(
    handle: *mut prisma_ffi::PrismaClient,
    cb: prisma_ffi::PrismaCallback,
    userdata: *mut c_void,
) {
    unsafe { prisma_ffi::prisma_set_callback(handle, cb, userdata) };
}

#[allow(dead_code)]
fn profile_save(json: &str) -> c_int {
    let cstr = CString::new(json).unwrap();
    unsafe { prisma_ffi::prisma_profile_save(cstr.as_ptr()) }
}

#[allow(dead_code)]
fn profile_delete(id: &str) -> c_int {
    let cstr = CString::new(id).unwrap();
    unsafe { prisma_ffi::prisma_profile_delete(cstr.as_ptr()) }
}

fn profile_to_qr_svg(json: &str) -> *mut c_char {
    let cstr = CString::new(json).unwrap();
    unsafe { prisma_ffi::prisma_profile_to_qr_svg(cstr.as_ptr()) }
}

fn profile_from_qr(data: &str, out: *mut *mut c_char) -> c_int {
    let cstr = CString::new(data).unwrap();
    unsafe { prisma_ffi::prisma_profile_from_qr(cstr.as_ptr(), out) }
}

fn profile_to_uri(json: &str) -> *mut c_char {
    let cstr = CString::new(json).unwrap();
    unsafe { prisma_ffi::prisma_profile_to_uri(cstr.as_ptr()) }
}

fn get_pac_url(handle: *mut prisma_ffi::PrismaClient, port: u16) -> *mut c_char {
    unsafe { prisma_ffi::prisma_get_pac_url(handle, port) }
}

#[allow(dead_code)]
fn ping(addr: &str) -> *mut c_char {
    let cstr = CString::new(addr).unwrap();
    unsafe { prisma_ffi::prisma_ping(cstr.as_ptr()) }
}

fn set_per_app_filter(json: &str) -> c_int {
    let cstr = CString::new(json).unwrap();
    unsafe { prisma_ffi::prisma_set_per_app_filter(cstr.as_ptr()) }
}

#[allow(dead_code)]
fn apply_update(url: &str, sha: &str) -> c_int {
    let curl = CString::new(url).unwrap();
    let csha = CString::new(sha).unwrap();
    unsafe { prisma_ffi::prisma_apply_update(curl.as_ptr(), csha.as_ptr()) }
}

#[allow(dead_code)]
fn set_system_proxy(host: &str, port: u16) -> c_int {
    let cstr = CString::new(host).unwrap();
    unsafe { prisma_ffi::prisma_set_system_proxy(cstr.as_ptr(), port) }
}

// ── Null pointer handling tests ──────────────────────────────────────────────

#[test]
fn test_destroy_null_handle() {
    // Must not crash
    destroy_client(ptr::null_mut());
}

#[test]
fn test_get_status_null_handle() {
    let status = get_status(ptr::null_mut());
    assert_eq!(status, PRISMA_STATUS_DISCONNECTED);
}

#[test]
fn test_get_stats_json_null_handle() {
    let result = get_stats_json(ptr::null_mut());
    assert!(result.is_null());
}

#[test]
fn test_connect_null_handle() {
    let json = CString::new("{}").unwrap();
    let result = unsafe { prisma_ffi::prisma_connect(ptr::null_mut(), json.as_ptr(), 0) };
    assert_eq!(result, PRISMA_ERR_NULL_POINTER);
}

#[test]
fn test_connect_null_config() {
    let handle = create_client();
    assert!(!handle.is_null());
    let result = unsafe { prisma_ffi::prisma_connect(handle, ptr::null(), 0) };
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
    destroy_client(handle);
}

#[test]
fn test_disconnect_null_handle() {
    let result = unsafe { prisma_ffi::prisma_disconnect(ptr::null_mut()) };
    assert_eq!(result, PRISMA_ERR_NULL_POINTER);
}

#[test]
fn test_set_callback_null_handle() {
    // Must not crash
    set_callback(ptr::null_mut(), None, ptr::null_mut());
}

#[test]
fn test_profile_save_null() {
    let result = unsafe { prisma_ffi::prisma_profile_save(ptr::null()) };
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
}

#[test]
fn test_profile_delete_null() {
    let result = unsafe { prisma_ffi::prisma_profile_delete(ptr::null()) };
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
}

#[test]
fn test_profile_to_qr_svg_null() {
    let result = unsafe { prisma_ffi::prisma_profile_to_qr_svg(ptr::null()) };
    assert!(result.is_null());
}

#[test]
fn test_profile_from_qr_null_data() {
    let mut out: *mut c_char = ptr::null_mut();
    let result = unsafe { prisma_ffi::prisma_profile_from_qr(ptr::null(), &mut out) };
    assert_eq!(result, PRISMA_ERR_NULL_POINTER);
}

#[test]
fn test_profile_from_qr_null_out() {
    let data = CString::new("test").unwrap();
    let result = unsafe { prisma_ffi::prisma_profile_from_qr(data.as_ptr(), ptr::null_mut()) };
    assert_eq!(result, PRISMA_ERR_NULL_POINTER);
}

#[test]
fn test_profile_to_uri_null() {
    let result = unsafe { prisma_ffi::prisma_profile_to_uri(ptr::null()) };
    assert!(result.is_null());
}

#[test]
fn test_import_subscription_null() {
    let result = unsafe { prisma_ffi::prisma_import_subscription(ptr::null()) };
    assert!(result.is_null());
}

#[test]
fn test_set_system_proxy_null_host() {
    let result = unsafe { prisma_ffi::prisma_set_system_proxy(ptr::null(), 8080) };
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
}

#[test]
fn test_ping_null_addr() {
    let result = unsafe { prisma_ffi::prisma_ping(ptr::null()) };
    assert!(!result.is_null());
    let json = unsafe { CStr::from_ptr(result) }.to_str().unwrap();
    assert!(json.contains("null server address"));
    free_string(result);
}

#[test]
fn test_apply_update_null_url() {
    let sha = CString::new("abc").unwrap();
    let result = unsafe { prisma_ffi::prisma_apply_update(ptr::null(), sha.as_ptr()) };
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
}

#[test]
fn test_apply_update_null_sha() {
    let url = CString::new("https://example.com").unwrap();
    let result = unsafe { prisma_ffi::prisma_apply_update(url.as_ptr(), ptr::null()) };
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
}

#[test]
fn test_speed_test_null_handle() {
    let server = CString::new("cloudflare").unwrap();
    let dir = CString::new("both").unwrap();
    let result = unsafe {
        prisma_ffi::prisma_speed_test(ptr::null_mut(), server.as_ptr(), 10, dir.as_ptr())
    };
    assert_eq!(result, PRISMA_ERR_NULL_POINTER);
}

#[test]
fn test_get_pac_url_null_handle() {
    let result = get_pac_url(ptr::null_mut(), 8070);
    // prisma_get_pac_url uses ffi_catch which ignores the handle
    // It should still produce a URL string even with null handle
    if !result.is_null() {
        free_string(result);
    }
}

#[test]
fn test_set_per_app_filter_null_disables() {
    let result = unsafe { prisma_ffi::prisma_set_per_app_filter(ptr::null()) };
    assert_eq!(result, PRISMA_OK);
}

// ── Invalid state transition tests ───────────────────────────────────────────

#[test]
fn test_disconnect_before_connect() {
    let handle = create_client();
    assert!(!handle.is_null());
    let result = disconnect(handle);
    assert_eq!(result, PRISMA_ERR_NOT_CONNECTED);
    destroy_client(handle);
}

#[test]
fn test_status_initial_disconnected() {
    let handle = create_client();
    assert!(!handle.is_null());
    let status = get_status(handle);
    assert_eq!(status, PRISMA_STATUS_DISCONNECTED);
    destroy_client(handle);
}

#[test]
fn test_connect_invalid_config_json() {
    let handle = create_client();
    assert!(!handle.is_null());
    // Invalid JSON
    let result = connect_with(handle, "not json", 0);
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
    destroy_client(handle);
}

#[test]
fn test_connect_empty_json_object() {
    let handle = create_client();
    assert!(!handle.is_null());
    // Valid JSON but missing required fields
    let result = connect_with(handle, "{}", 0);
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
    destroy_client(handle);
}

// ── Error code correctness tests ─────────────────────────────────────────────

#[test]
fn test_error_codes_are_distinct() {
    let codes = [
        PRISMA_OK,
        PRISMA_ERR_INVALID_CONFIG,
        PRISMA_ERR_ALREADY_CONNECTED,
        PRISMA_ERR_NOT_CONNECTED,
        prisma_ffi::PRISMA_ERR_PERMISSION_DENIED,
        PRISMA_ERR_INTERNAL,
    ];
    // All error codes must be unique
    for (i, a) in codes.iter().enumerate() {
        for (j, b) in codes.iter().enumerate() {
            if i != j {
                assert_ne!(a, b, "Error codes {} and {} are not distinct", i, j);
            }
        }
    }
}

#[test]
fn test_status_codes_are_distinct() {
    let statuses = [
        PRISMA_STATUS_DISCONNECTED,
        prisma_ffi::PRISMA_STATUS_CONNECTING,
        PRISMA_STATUS_CONNECTED,
        prisma_ffi::PRISMA_STATUS_ERROR,
    ];
    for (i, a) in statuses.iter().enumerate() {
        for (j, b) in statuses.iter().enumerate() {
            if i != j {
                assert_ne!(a, b, "Status codes {} and {} are not distinct", i, j);
            }
        }
    }
}

// ── String encoding tests ────────────────────────────────────────────────────

#[test]
fn test_free_string_null() {
    // Must not crash
    free_string(ptr::null_mut());
}

#[test]
fn test_free_string_valid() {
    let handle = create_client();
    assert!(!handle.is_null());
    // Get PAC URL to obtain an allocated string
    let s = get_pac_url(handle, 8070);
    if !s.is_null() {
        let cstr = unsafe { CStr::from_ptr(s) };
        assert!(cstr.to_str().unwrap().contains("proxy.pac"));
        free_string(s);
    }
    destroy_client(handle);
}

#[test]
fn test_pac_url_default_port() {
    let handle = create_client();
    assert!(!handle.is_null());
    let s = get_pac_url(handle, 0);
    if !s.is_null() {
        let url = unsafe { CStr::from_ptr(s) }.to_str().unwrap();
        assert!(
            url.contains(":8070/"),
            "Default PAC port should be 8070: {}",
            url
        );
        free_string(s);
    }
    destroy_client(handle);
}

#[test]
fn test_pac_url_custom_port() {
    let handle = create_client();
    assert!(!handle.is_null());
    let s = get_pac_url(handle, 9999);
    if !s.is_null() {
        let url = unsafe { CStr::from_ptr(s) }.to_str().unwrap();
        assert!(
            url.contains(":9999/"),
            "Custom PAC port should be 9999: {}",
            url
        );
        free_string(s);
    }
    destroy_client(handle);
}

#[test]
fn test_per_app_filter_empty_string_disables() {
    let empty = CString::new("").unwrap();
    let result = unsafe { prisma_ffi::prisma_set_per_app_filter(empty.as_ptr()) };
    assert_eq!(result, PRISMA_OK);
}

#[test]
fn test_per_app_filter_invalid_json() {
    let result = set_per_app_filter("not json");
    assert_eq!(result, PRISMA_ERR_INVALID_CONFIG);
}

#[test]
fn test_per_app_filter_valid_json() {
    let result = set_per_app_filter(r#"{"mode":"include","apps":["Firefox"]}"#);
    assert_eq!(result, PRISMA_OK);

    // Get the filter config back
    let config_ptr = prisma_ffi::prisma_get_per_app_filter();
    if !config_ptr.is_null() {
        let json = unsafe { CStr::from_ptr(config_ptr) }.to_str().unwrap();
        assert!(json.contains("Firefox"));
        free_string(config_ptr);
    }

    // Reset
    let _ = unsafe { prisma_ffi::prisma_set_per_app_filter(ptr::null()) };
}

// ── QR / URI encoding tests ─────────────────────────────────────────────────

#[test]
fn test_profile_to_uri_valid_json() {
    let json = r#"{"name":"test"}"#;
    let uri_ptr = profile_to_uri(json);
    assert!(!uri_ptr.is_null());
    let uri = unsafe { CStr::from_ptr(uri_ptr) }.to_str().unwrap();
    assert!(
        uri.starts_with("prisma://"),
        "URI should start with prisma://"
    );
    free_string(uri_ptr);
}

#[test]
fn test_profile_to_uri_invalid_json() {
    let uri_ptr = profile_to_uri("not json");
    assert!(uri_ptr.is_null());
}

#[test]
fn test_profile_qr_round_trip() {
    let original_json = r#"{"name":"test","server":"1.2.3.4:8443"}"#;

    // JSON -> URI
    let uri_ptr = profile_to_uri(original_json);
    assert!(!uri_ptr.is_null());
    let uri = unsafe { CStr::from_ptr(uri_ptr) }
        .to_str()
        .unwrap()
        .to_owned();
    free_string(uri_ptr);

    // URI -> JSON (via profile_from_qr)
    let mut out: *mut c_char = ptr::null_mut();
    let result = profile_from_qr(&uri, &mut out);
    assert_eq!(result, PRISMA_OK);
    assert!(!out.is_null());
    let decoded_json = unsafe { CStr::from_ptr(out) }.to_str().unwrap();
    assert!(decoded_json.contains("test"));
    assert!(decoded_json.contains("1.2.3.4:8443"));
    free_string(out);
}

#[test]
fn test_profile_from_qr_invalid_base64() {
    let mut out: *mut c_char = ptr::null_mut();
    let result = profile_from_qr("prisma://!!!invalid!!!", &mut out);
    assert_ne!(result, PRISMA_OK);
}

#[test]
fn test_profile_to_qr_svg_valid_json() {
    let json = r#"{"name":"test"}"#;
    let svg_ptr = profile_to_qr_svg(json);
    assert!(!svg_ptr.is_null());
    let svg = unsafe { CStr::from_ptr(svg_ptr) }.to_str().unwrap();
    assert!(svg.contains("<svg"), "QR SVG should contain SVG markup");
    free_string(svg_ptr);
}

#[test]
fn test_profile_to_qr_svg_invalid_json() {
    let svg_ptr = profile_to_qr_svg("not valid json");
    assert!(svg_ptr.is_null());
}

// ── Lifecycle tests ──────────────────────────────────────────────────────────

#[test]
fn test_create_destroy_cycle() {
    // Create and destroy multiple times to check for leaks
    for _ in 0..5 {
        let handle = create_client();
        assert!(!handle.is_null());
        destroy_client(handle);
    }
}

#[test]
fn test_callback_registration() {
    let handle = create_client();
    assert!(!handle.is_null());

    // Register callback
    unsafe extern "C" fn test_cb(_event: *const c_char, _userdata: *mut c_void) {}
    set_callback(handle, Some(test_cb), ptr::null_mut());

    // Register None callback (clear)
    set_callback(handle, None, ptr::null_mut());

    destroy_client(handle);
}

// ── Running apps list ────────────────────────────────────────────────────────

#[test]
fn test_get_running_apps_returns_json_array() {
    let result = prisma_ffi::prisma_get_running_apps();
    assert!(!result.is_null());
    let json = unsafe { CStr::from_ptr(result) }.to_str().unwrap();
    // Should be a JSON array
    assert!(json.starts_with('['), "Expected JSON array, got: {}", json);
    free_string(result);
}

// ── Profiles list ────────────────────────────────────────────────────────────

#[test]
fn test_profiles_list_json_returns_array() {
    let result = prisma_ffi::prisma_profiles_list_json();
    // May be NULL if profiles dir doesn't exist, which is OK in CI
    if !result.is_null() {
        let json = unsafe { CStr::from_ptr(result) }.to_str().unwrap();
        assert!(json.starts_with('['), "Expected JSON array, got: {}", json);
        free_string(result);
    }
}

// ── Check update ─────────────────────────────────────────────────────────────

#[test]
fn test_check_update_returns_null_or_json() {
    let result = prisma_ffi::prisma_check_update_json();
    // In CI without network, this typically returns NULL
    if !result.is_null() {
        let json = unsafe { CStr::from_ptr(result) }.to_str().unwrap();
        assert!(json.starts_with('{'), "Expected JSON object, got: {}", json);
        free_string(result);
    }
}

// ── Refresh subscriptions ────────────────────────────────────────────────────

#[test]
fn test_refresh_subscriptions_returns_null_or_json() {
    let result = prisma_ffi::prisma_refresh_subscriptions();
    // May return NULL if no subscriptions configured
    if !result.is_null() {
        free_string(result);
    }
}
