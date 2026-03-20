// HomeView.swift — Main dashboard with connect button, stats, and status.

import SwiftUI
import NetworkExtension

struct HomeView: View {
    @EnvironmentObject var vpnManager: VPNManager
    @EnvironmentObject var profileStore: ProfileStore
    @EnvironmentObject var networkMonitor: NetworkMonitor

    @State private var stats = TrafficStats.zero
    @State private var timer: Timer?
    @State private var showError: Bool = false
    @State private var errorText: String = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Status card
                    statusCard

                    // Connect button
                    connectButton

                    // Active server
                    if let profile = profileStore.selectedProfile {
                        activeServerCard(profile)
                    } else {
                        noServerCard
                    }

                    // Traffic stats
                    if vpnManager.vpnStatus == .connected {
                        trafficStatsCard
                    }

                    // Network info
                    networkInfoCard
                }
                .padding()
            }
            .navigationTitle("Prisma")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Text("v\(PrismaEngine.shared.version)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .alert("Connection Error", isPresented: $showError) {
                Button("OK") {}
            } message: {
                Text(errorText)
            }
            .onAppear { startStatsPolling() }
            .onDisappear { stopStatsPolling() }
        }
    }

    // MARK: - Status card

    private var statusCard: some View {
        VStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 80, height: 80)
                .overlay {
                    Image(systemName: statusIcon)
                        .font(.system(size: 36))
                        .foregroundStyle(.white)
                }
                .shadow(color: statusColor.opacity(0.4), radius: 12, y: 4)

            Text(vpnManager.vpnStatus.displayText)
                .font(.title2.weight(.semibold))

            if vpnManager.vpnStatus == .connected {
                Text(formatDuration(stats.uptimeSecs))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    private var statusColor: Color {
        switch vpnManager.vpnStatus {
        case .connected: return .green
        case .connecting, .reasserting: return .yellow
        case .disconnecting: return .orange
        default: return Color(.systemGray3)
        }
    }

    private var statusIcon: String {
        switch vpnManager.vpnStatus {
        case .connected: return "checkmark.shield.fill"
        case .connecting, .reasserting: return "arrow.triangle.2.circlepath"
        case .disconnecting: return "xmark.shield"
        default: return "shield.slash"
        }
    }

    // MARK: - Connect button

    private var connectButton: some View {
        Button(action: toggleConnection) {
            HStack {
                if vpnManager.vpnStatus == .connecting || vpnManager.vpnStatus == .disconnecting {
                    ProgressView()
                        .tint(.white)
                }
                Text(connectButtonText)
                    .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(connectButtonColor)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(profileStore.selectedProfile == nil || vpnManager.vpnStatus == .connecting || vpnManager.vpnStatus == .disconnecting)
    }

    private var connectButtonText: String {
        switch vpnManager.vpnStatus {
        case .connected: return "Disconnect"
        case .connecting: return "Connecting..."
        case .disconnecting: return "Disconnecting..."
        default: return "Connect"
        }
    }

    private var connectButtonColor: Color {
        if profileStore.selectedProfile == nil { return Color(.systemGray4) }
        switch vpnManager.vpnStatus {
        case .connected: return .red
        case .connecting, .disconnecting: return .orange
        default: return .accentColor
        }
    }

    // MARK: - Server cards

    private func activeServerCard(_ profile: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "server.rack")
                    .foregroundStyle(.accentColor)
                Text("Active Server")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(profile.name)
                .font(.headline)

            if let addr = profile.config.serverAddr {
                Text(addr)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let transport = profile.config.transport {
                HStack(spacing: 4) {
                    Image(systemName: "network")
                    Text(transport.uppercased())
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var noServerCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.title2)
                .foregroundStyle(.orange)
            Text("No Server Selected")
                .font(.subheadline.weight(.medium))
            Text("Go to the Servers tab to add or select a server.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Traffic stats

    private var trafficStatsCard: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "chart.bar.fill")
                    .foregroundStyle(.accentColor)
                Text("Traffic")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer()
            }

            HStack(spacing: 20) {
                statItem(
                    icon: "arrow.up",
                    label: "Upload",
                    value: formatBytes(stats.bytesUp),
                    speed: formatSpeed(stats.speedUpBps),
                    color: .blue
                )
                Divider().frame(height: 40)
                statItem(
                    icon: "arrow.down",
                    label: "Download",
                    value: formatBytes(stats.bytesDown),
                    speed: formatSpeed(stats.speedDownBps),
                    color: .green
                )
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func statItem(icon: String, label: String, value: String, speed: String, color: Color) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.title3.weight(.semibold).monospacedDigit())
            Text(speed)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Network info

    private var networkInfoCard: some View {
        HStack {
            Image(systemName: networkIcon)
                .foregroundStyle(networkMonitor.isConnected ? .green : .red)
            Text(networkLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal)
    }

    private var networkIcon: String {
        switch networkMonitor.connectionType {
        case .wifi: return "wifi"
        case .cellular: return "antenna.radiowaves.left.and.right"
        case .ethernet: return "cable.connector"
        case .disconnected: return "wifi.slash"
        }
    }

    private var networkLabel: String {
        if !networkMonitor.isConnected { return "No network connection" }
        switch networkMonitor.connectionType {
        case .wifi: return "Connected via Wi-Fi"
        case .cellular: return "Connected via Cellular"
        case .ethernet: return "Connected via Ethernet"
        case .disconnected: return "No connection"
        }
    }

    // MARK: - Actions

    private func toggleConnection() {
        Task {
            do {
                if vpnManager.vpnStatus.isActive {
                    vpnManager.disconnect()
                } else {
                    guard let profile = profileStore.selectedProfile,
                          let configJSON = profileStore.configJSON(for: profile) else {
                        errorText = "No valid server configuration selected."
                        showError = true
                        return
                    }
                    try await vpnManager.connect(profileConfig: configJSON)
                }
            } catch {
                errorText = error.localizedDescription
                showError = true
            }
        }
    }

    // MARK: - Stats polling

    private func startStatsPolling() {
        PrismaEngine.shared.onEvent { event in
            if event.type == "stats" {
                stats = TrafficStats(
                    bytesUp: event.bytesUp ?? 0,
                    bytesDown: event.bytesDown ?? 0,
                    speedUpBps: event.speedUpBps ?? 0,
                    speedDownBps: event.speedDownBps ?? 0,
                    uptimeSecs: event.uptimeSecs ?? 0
                )
            }
        }
    }

    private func stopStatsPolling() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Formatters

    private func formatBytes(_ bytes: UInt64) -> String {
        let units = ["B", "KB", "MB", "GB", "TB"]
        var value = Double(bytes)
        var idx = 0
        while value >= 1024 && idx < units.count - 1 {
            value /= 1024
            idx += 1
        }
        return String(format: "%.1f %@", value, units[idx])
    }

    private func formatSpeed(_ bps: UInt64) -> String {
        let value = Double(bps) / 8.0 // bps -> Bytes/s
        if value < 1024 { return String(format: "%.0f B/s", value) }
        if value < 1024 * 1024 { return String(format: "%.1f KB/s", value / 1024) }
        return String(format: "%.1f MB/s", value / (1024 * 1024))
    }

    private func formatDuration(_ seconds: UInt64) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 {
            return String(format: "%dh %02dm %02ds", h, m, s)
        }
        return String(format: "%dm %02ds", m, s)
    }
}
