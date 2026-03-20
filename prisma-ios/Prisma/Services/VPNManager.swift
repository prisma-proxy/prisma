// VPNManager.swift — Manages NETunnelProviderManager for VPN lifecycle.
//
// This service handles:
// - VPN configuration installation
// - Starting/stopping the VPN tunnel
// - Monitoring VPN status changes
// - Interacting with the Network Extension process

import Foundation
import NetworkExtension
import Combine

@MainActor
final class VPNManager: ObservableObject {
    static let shared = VPNManager()

    @Published var vpnStatus: NEVPNStatus = .disconnected
    @Published var isInstalled: Bool = false
    @Published var errorMessage: String?

    private var manager: NETunnelProviderManager?
    private var statusObserver: NSObjectProtocol?

    private let tunnelBundleId = "com.prisma.client.tunnel"

    private init() {
        Task {
            await loadManager()
        }
    }

    // MARK: - Manager lifecycle

    func loadManager() async {
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            if let existing = managers.first {
                manager = existing
                isInstalled = true
            } else {
                manager = nil
                isInstalled = false
            }
            observeStatus()
            PrismaEngine.shared.setVPNPermission(isInstalled)
        } catch {
            errorMessage = "Failed to load VPN configuration: \(error.localizedDescription)"
        }
    }

    func installProfile() async throws {
        let mgr = NETunnelProviderManager()
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = tunnelBundleId
        proto.serverAddress = "Prisma Proxy"
        proto.disconnectOnSleep = false

        mgr.protocolConfiguration = proto
        mgr.localizedDescription = "Prisma VPN"
        mgr.isEnabled = true

        try await mgr.saveToPreferences()
        try await mgr.loadFromPreferences()

        manager = mgr
        isInstalled = true
        observeStatus()
        PrismaEngine.shared.setVPNPermission(true)
    }

    func removeProfile() async throws {
        guard let mgr = manager else { return }
        try await mgr.removeFromPreferences()
        manager = nil
        isInstalled = false
        PrismaEngine.shared.setVPNPermission(false)
    }

    // MARK: - Connection

    func connect(profileConfig: String) async throws {
        if !isInstalled {
            try await installProfile()
        }

        guard let mgr = manager else {
            throw PrismaError.internalError
        }

        // Reload to get fresh preferences
        try await mgr.loadFromPreferences()

        // Pass the config to the tunnel extension via provider configuration
        let proto = mgr.protocolConfiguration as? NETunnelProviderProtocol
        proto?.providerConfiguration = [
            "config": profileConfig,
            "mode": "tun"
        ]
        mgr.isEnabled = true
        try await mgr.saveToPreferences()
        try await mgr.loadFromPreferences()

        let session = mgr.connection as! NETunnelProviderSession
        try session.startTunnel(options: nil)
    }

    func disconnect() {
        guard let mgr = manager else { return }
        let session = mgr.connection as? NETunnelProviderSession
        session?.stopTunnel()
    }

    func reconnect(profileConfig: String) async throws {
        disconnect()
        // Brief delay to ensure clean shutdown
        try await Task.sleep(nanoseconds: 500_000_000)
        try await connect(profileConfig: profileConfig)
    }

    // MARK: - Status observation

    private func observeStatus() {
        if let old = statusObserver {
            NotificationCenter.default.removeObserver(old)
        }

        guard let mgr = manager else { return }

        vpnStatus = mgr.connection.status

        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: mgr.connection,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            Task { @MainActor in
                self.vpnStatus = mgr.connection.status
            }
        }
    }
}

// MARK: - Status display helpers

extension NEVPNStatus {
    var displayText: String {
        switch self {
        case .invalid: return "Not Configured"
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .reasserting: return "Reconnecting..."
        case .disconnecting: return "Disconnecting..."
        @unknown default: return "Unknown"
        }
    }

    var isActive: Bool {
        self == .connected || self == .connecting || self == .reasserting
    }

    var color: String {
        switch self {
        case .connected: return "green"
        case .connecting, .reasserting: return "yellow"
        case .disconnecting: return "orange"
        default: return "gray"
        }
    }
}
