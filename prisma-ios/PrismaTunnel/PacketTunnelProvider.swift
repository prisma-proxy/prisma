// PacketTunnelProvider.swift — Network Extension tunnel provider.
//
// This runs in a separate process managed by iOS. It creates the VPN
// tunnel and routes traffic through the Prisma proxy via the Rust core.

import NetworkExtension
import os.log

class PacketTunnelProvider: NEPacketTunnelProvider {
    private let logger = Logger(subsystem: "com.prisma.client.tunnel", category: "tunnel")
    private var engine: OpaquePointer?

    // MARK: - Tunnel lifecycle

    override func startTunnel(options: [String : NSObject]? = nil) async throws {
        logger.info("Starting Prisma tunnel")

        // Create the Rust engine handle
        engine = prisma_create()
        guard engine != nil else {
            logger.error("Failed to create PrismaClient")
            throw NEVPNError(.configurationInvalid)
        }

        // Get configuration from the provider
        guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
              let providerConfig = proto.providerConfiguration,
              let configJSON = providerConfig["config"] as? String else {
            logger.error("Missing provider configuration")
            throw NEVPNError(.configurationInvalid)
        }

        // Prepare tunnel network settings
        let tunnelConfig = prepareTunnelConfig(configJSON)
        let settings = createTunnelSettings(from: tunnelConfig)

        // Apply network settings
        try await setTunnelNetworkSettings(settings)
        logger.info("Tunnel network settings applied")

        // Pass the TUN file descriptor to the Rust core
        // The packetFlow provides the tunnel interface
        if let tunFd = self.packetFlow.value(forKey: "socket") as? Int32 {
            prisma_ios_set_tun_fd(engine, tunFd)
            logger.info("TUN fd set to \(tunFd)")
        }

        // Start the proxy connection through the Rust core
        let result = configJSON.withCString { cStr in
            prisma_connect(engine, cStr, 0x04) // TUN mode
        }

        if result != 0 {
            logger.error("prisma_connect failed with code \(result)")
            cleanup()
            throw NEVPNError(.connectionFailed)
        }

        logger.info("Prisma tunnel started successfully")

        // Set up callback for status updates
        setupCallback()

        // Start reading packets from the TUN interface
        startPacketForwarding()
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        logger.info("Stopping Prisma tunnel, reason: \(String(describing: reason))")
        cleanup()
    }

    override func handleAppMessage(_ messageData: Data) async -> Data? {
        // Handle messages from the containing app
        guard let message = String(data: messageData, encoding: .utf8) else { return nil }

        switch message {
        case "status":
            let status = prisma_get_status(engine)
            return String(status).data(using: .utf8)

        case "stats":
            if let raw = prisma_get_stats_json(engine) {
                let str = String(cString: raw)
                prisma_free_string(raw)
                return str.data(using: .utf8)
            }
            return nil

        default:
            return nil
        }
    }

    // MARK: - Sleep/wake

    override func sleep() async {
        logger.info("System going to sleep")
        prisma_on_background(engine)
    }

    override func wake() {
        logger.info("System waking up")
        prisma_on_foreground(engine)
    }

    // MARK: - Private helpers

    private func cleanup() {
        if let e = engine {
            prisma_disconnect(e)
            prisma_destroy(e)
            engine = nil
        }
    }

    private func prepareTunnelConfig(_ configJSON: String) -> [String: Any] {
        if let raw = configJSON.withCString({ prisma_ios_prepare_tunnel_config($0) }) {
            let str = String(cString: raw)
            prisma_free_string(raw)
            if let data = str.data(using: .utf8),
               let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return dict
            }
        }
        // Defaults
        return [
            "mtu": 1400,
            "dns_servers": ["1.1.1.1", "8.8.8.8"],
            "included_routes": ["0.0.0.0/0", "::/0"]
        ]
    }

    private func createTunnelSettings(from config: [String: Any]) -> NEPacketTunnelNetworkSettings {
        let mtu = config["mtu"] as? Int ?? 1400
        let dnsServers = config["dns_servers"] as? [String] ?? ["1.1.1.1", "8.8.8.8"]

        // Use a private IP for the tunnel interface
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.8.0.1")

        // IPv4
        let ipv4 = NEIPv4Settings(addresses: ["10.8.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = [NEIPv4Route.default()]

        // Exclude the proxy server address from the tunnel
        if let excludedRoutes = config["excluded_routes"] as? [String] {
            ipv4.excludedRoutes = excludedRoutes.compactMap { route in
                let parts = route.split(separator: "/")
                guard let addr = parts.first else { return nil }
                return NEIPv4Route(destinationAddress: String(addr), subnetMask: "255.255.255.255")
            }
        }
        settings.ipv4Settings = ipv4

        // IPv6
        let ipv6 = NEIPv6Settings(addresses: ["fd00::2"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        settings.ipv6Settings = ipv6

        // DNS
        let dns = NEDNSSettings(servers: dnsServers)
        dns.matchDomains = [""] // Route all DNS through tunnel
        settings.dnsSettings = dns

        // MTU
        settings.mtu = NSNumber(value: mtu)

        return settings
    }

    private func setupCallback() {
        let ud = Unmanaged.passUnretained(self).toOpaque()
        let callback: @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void = { jsonPtr, userdata in
            guard let jsonPtr = jsonPtr else { return }
            let json = String(cString: jsonPtr)
            // Log events in the tunnel extension
            if let data = json.data(using: .utf8),
               let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let type = event["type"] as? String {
                let provider = Unmanaged<PacketTunnelProvider>.fromOpaque(userdata!).takeUnretainedValue()
                provider.logger.debug("Event: \(type) — \(json)")

                // Forward status changes to the containing app
                if type == "status_changed" || type == "error" {
                    // The system UI will reflect status changes automatically
                }
            }
        }
        prisma_set_callback(engine, callback, ud)
    }

    private func startPacketForwarding() {
        // The Rust core handles packet forwarding through the TUN fd.
        // This method sets up a read loop for any out-of-band packets
        // that need to be handled at the Swift layer.
        readPackets()
    }

    private func readPackets() {
        packetFlow.readPackets { [weak self] packets, protocols in
            // Forward packets to the Rust TUN handler
            // In practice, the Rust core reads directly from the TUN fd,
            // so this is mainly for monitoring/debugging.
            self?.readPackets() // Continue reading
        }
    }
}
