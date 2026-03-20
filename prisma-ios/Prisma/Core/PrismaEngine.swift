// PrismaEngine.swift — Swift bridge to the prisma-ffi Rust library.
//
// This is the single point of contact between the Swift app and the Rust
// core. All calls go through the C ABI defined in prisma_ffi.h.

import Foundation

// MARK: - Error types

enum PrismaError: Int32, Error, CustomStringConvertible {
    case ok = 0
    case invalidConfig = 1
    case alreadyConnected = 2
    case notConnected = 3
    case permissionDenied = 4
    case internalError = 5
    case nullPointer = 6

    var description: String {
        switch self {
        case .ok: return "OK"
        case .invalidConfig: return "Invalid configuration"
        case .alreadyConnected: return "Already connected"
        case .notConnected: return "Not connected"
        case .permissionDenied: return "Permission denied"
        case .internalError: return "Internal error"
        case .nullPointer: return "Null pointer"
        }
    }
}

// MARK: - Connection status

enum ConnectionStatus: Int32 {
    case disconnected = 0
    case connecting = 1
    case connected = 2
    case error = 3
}

// MARK: - Proxy modes

struct ProxyMode: OptionSet {
    let rawValue: UInt32
    static let socks5 = ProxyMode(rawValue: 0x01)
    static let systemProxy = ProxyMode(rawValue: 0x02)
    static let tun = ProxyMode(rawValue: 0x04)
    static let perApp = ProxyMode(rawValue: 0x08)
}

// MARK: - Network type

enum NetworkType: Int32 {
    case disconnected = 0
    case wifi = 1
    case cellular = 2
    case ethernet = 3
}

// MARK: - Event types

struct PrismaEvent: Codable {
    let type: String
    let status: String?
    let code: String?
    let msg: String?
    let network: String?
    let state: String?
    let bytesUp: UInt64?
    let bytesDown: UInt64?
    let speedUpBps: UInt64?
    let speedDownBps: UInt64?
    let uptimeSecs: UInt64?
    let connected: Bool?
    let downloadMbps: Double?
    let uploadMbps: Double?

    enum CodingKeys: String, CodingKey {
        case type, status, code, msg, network, state, connected
        case bytesUp = "bytes_up"
        case bytesDown = "bytes_down"
        case speedUpBps = "speed_up_bps"
        case speedDownBps = "speed_down_bps"
        case uptimeSecs = "uptime_secs"
        case downloadMbps = "download_mbps"
        case uploadMbps = "upload_mbps"
    }
}

// MARK: - Engine

/// Thread-safe singleton wrapping the Rust prisma-ffi library.
final class PrismaEngine: @unchecked Sendable {
    static let shared = PrismaEngine()

    private var handle: OpaquePointer?
    private let lock = NSLock()
    private var eventHandler: ((PrismaEvent) -> Void)?

    // MARK: Lifecycle

    private init() {
        handle = prisma_create()
        guard handle != nil else {
            fatalError("Failed to create PrismaClient handle")
        }
        setupCallback()
    }

    deinit {
        if let h = handle {
            prisma_destroy(h)
        }
    }

    // MARK: Callback

    /// Register a Swift closure to receive events from the Rust core.
    func onEvent(_ handler: @escaping (PrismaEvent) -> Void) {
        lock.lock()
        eventHandler = handler
        lock.unlock()
    }

    private func setupCallback() {
        // The C callback receives a JSON string and a userdata pointer.
        // We pass `self` as userdata (via Unmanaged) to route events.
        let ud = Unmanaged.passUnretained(self).toOpaque()

        let callback: @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void = { jsonPtr, userdata in
            guard let jsonPtr = jsonPtr, let userdata = userdata else { return }
            let engine = Unmanaged<PrismaEngine>.fromOpaque(userdata).takeUnretainedValue()
            let json = String(cString: jsonPtr)

            guard let data = json.data(using: .utf8),
                  let event = try? JSONDecoder().decode(PrismaEvent.self, from: data) else {
                return
            }

            engine.lock.lock()
            let handler = engine.eventHandler
            engine.lock.unlock()

            if let handler = handler {
                DispatchQueue.main.async {
                    handler(event)
                }
            }
        }

        prisma_set_callback(handle, callback, ud)
    }

    // MARK: Connection

    func connect(configJSON: String, modes: ProxyMode = .tun) throws {
        let result = configJSON.withCString { cStr in
            prisma_connect(handle, cStr, modes.rawValue)
        }
        let code = PrismaError(rawValue: result) ?? .internalError
        if code != .ok {
            throw code
        }
    }

    func disconnect() throws {
        let result = prisma_disconnect(handle)
        let code = PrismaError(rawValue: result) ?? .internalError
        if code != .ok {
            throw code
        }
    }

    var status: ConnectionStatus {
        let raw = prisma_get_status(handle)
        return ConnectionStatus(rawValue: raw) ?? .disconnected
    }

    var isConnected: Bool {
        status == .connected
    }

    // MARK: Stats

    func getStatsJSON() -> String? {
        guard let raw = prisma_get_stats_json(handle) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)
        return str
    }

    func getTrafficStats() -> (bytesUp: UInt64, bytesDown: UInt64, connected: Bool)? {
        guard let raw = prisma_get_traffic_stats(handle) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)

        guard let data = str.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let up = json["bytes_up"] as? UInt64 ?? 0
        let down = json["bytes_down"] as? UInt64 ?? 0
        let connected = json["connected"] as? Bool ?? false
        return (up, down, connected)
    }

    // MARK: Version

    var version: String {
        guard let ptr = prisma_version() else { return "unknown" }
        return String(cString: ptr)
    }

    // MARK: Profiles

    func profilesList() -> [ProfileData] {
        guard let raw = prisma_profiles_list_json() else { return [] }
        let str = String(cString: raw)
        prisma_free_string(raw)

        guard let data = str.data(using: .utf8),
              let profiles = try? JSONDecoder().decode([ProfileData].self, from: data) else {
            return []
        }
        return profiles
    }

    func saveProfile(_ json: String) throws {
        let result = json.withCString { prisma_profile_save($0) }
        let code = PrismaError(rawValue: result) ?? .internalError
        if code != .ok { throw code }
    }

    func deleteProfile(id: String) throws {
        let result = id.withCString { prisma_profile_delete($0) }
        let code = PrismaError(rawValue: result) ?? .internalError
        if code != .ok { throw code }
    }

    func importSubscription(url: String) -> ImportResult? {
        guard let raw = url.withCString({ prisma_import_subscription($0) }) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)

        guard let data = str.data(using: .utf8),
              let result = try? JSONDecoder().decode(ImportResult.self, from: data) else {
            return nil
        }
        return result
    }

    func refreshSubscriptions() -> ImportResult? {
        guard let raw = prisma_refresh_subscriptions() else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)

        guard let data = str.data(using: .utf8),
              let result = try? JSONDecoder().decode(ImportResult.self, from: data) else {
            return nil
        }
        return result
    }

    // MARK: QR / URI

    func profileToQRSVG(_ json: String) -> String? {
        guard let raw = json.withCString({ prisma_profile_to_qr_svg($0) }) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)
        return str
    }

    func profileToURI(_ json: String) -> String? {
        guard let raw = json.withCString({ prisma_profile_to_uri($0) }) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)
        return str
    }

    func profileFromQR(_ data: String) -> String? {
        var outPtr: UnsafeMutablePointer<CChar>?
        let result = data.withCString { prisma_profile_from_qr($0, &outPtr) }
        guard result == 0, let out = outPtr else { return nil }
        let str = String(cString: out)
        prisma_free_string(out)
        return str
    }

    // MARK: Import URI

    func importURI(_ uri: String) -> String? {
        guard let raw = uri.withCString({ prisma_import_uri($0) }) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)
        return str
    }

    // MARK: Ping

    func ping(server: String) -> PingResult? {
        guard let raw = server.withCString({ prisma_ping($0) }) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)

        guard let data = str.data(using: .utf8),
              let result = try? JSONDecoder().decode(PingResult.self, from: data) else {
            return nil
        }
        return result
    }

    // MARK: Update

    func checkUpdate() -> UpdateInfo? {
        guard let raw = prisma_check_update_json() else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)

        guard let data = str.data(using: .utf8),
              let info = try? JSONDecoder().decode(UpdateInfo.self, from: data) else {
            return nil
        }
        return info
    }

    // MARK: Mobile lifecycle

    func onNetworkChange(_ type: NetworkType) {
        prisma_on_network_change(handle, type.rawValue)
    }

    func onMemoryWarning() {
        prisma_on_memory_warning(handle)
    }

    func onBackground() {
        prisma_on_background(handle)
    }

    func onForeground() {
        prisma_on_foreground(handle)
    }

    // MARK: iOS specific

    func setTunFd(_ fd: Int32) {
        prisma_ios_set_tun_fd(handle, fd)
    }

    func prepareTunnelConfig(_ json: String) -> String? {
        guard let raw = json.withCString({ prisma_ios_prepare_tunnel_config($0) }) else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)
        return str
    }

    func getDataDir() -> String? {
        guard let raw = prisma_ios_get_data_dir() else { return nil }
        let str = String(cString: raw)
        prisma_free_string(raw)
        return str
    }

    func setVPNPermission(_ granted: Bool) {
        prisma_ios_set_vpn_permission(granted ? 1 : 0)
    }
}
