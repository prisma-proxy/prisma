// NetworkMonitor.swift — Monitors network connectivity changes and notifies the Rust core.

import Foundation
import Network
import Combine

@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published var isConnected: Bool = true
    @Published var connectionType: NetworkType = .wifi

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.prisma.network-monitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let wasConnected = self.isConnected
                self.isConnected = path.status == .satisfied

                let newType: NetworkType
                if path.usesInterfaceType(.wifi) {
                    newType = .wifi
                } else if path.usesInterfaceType(.cellular) {
                    newType = .cellular
                } else if path.usesInterfaceType(.wiredEthernet) {
                    newType = .ethernet
                } else if path.status != .satisfied {
                    newType = .disconnected
                } else {
                    newType = .wifi // Default fallback
                }

                let changed = self.connectionType != newType
                self.connectionType = newType

                // Notify Rust core of network changes
                if changed || wasConnected != self.isConnected {
                    PrismaEngine.shared.onNetworkChange(newType)
                }
            }
        }
        monitor.start(queue: queue)
    }
}
