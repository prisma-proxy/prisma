// SettingsView.swift — App settings, about, diagnostics.

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var vpnManager: VPNManager

    @AppStorage("autoConnect") private var autoConnect = false
    @AppStorage("connectOnLaunch") private var connectOnLaunch = false
    @AppStorage("killSwitch") private var killSwitch = false
    @AppStorage("showNotifications") private var showNotifications = true
    @AppStorage("theme") private var theme = "system"

    @State private var showResetConfirm = false
    @State private var updateInfo: UpdateInfo?
    @State private var checkingUpdate = false

    var body: some View {
        NavigationStack {
            List {
                // VPN settings
                Section("VPN") {
                    Toggle("Auto-reconnect on network change", isOn: $autoConnect)
                    Toggle("Connect on app launch", isOn: $connectOnLaunch)
                    Toggle("Kill switch (block all traffic when disconnected)", isOn: $killSwitch)

                    if vpnManager.isInstalled {
                        Button("Remove VPN Profile", role: .destructive) {
                            Task {
                                try? await vpnManager.removeProfile()
                            }
                        }
                    }
                }

                // Notifications
                Section("Notifications") {
                    Toggle("Connection status notifications", isOn: $showNotifications)
                }

                // Appearance
                Section("Appearance") {
                    Picker("Theme", selection: $theme) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                }

                // Diagnostics
                Section("Diagnostics") {
                    NavigationLink(destination: LogsView()) {
                        Label("View Logs", systemImage: "doc.text")
                    }
                    Button {
                        UIPasteboard.general.string = collectDiagnostics()
                    } label: {
                        Label("Copy Diagnostics to Clipboard", systemImage: "doc.on.clipboard")
                    }
                }

                // Update
                Section("Update") {
                    HStack {
                        Text("Current Version")
                        Spacer()
                        Text(PrismaEngine.shared.version)
                            .foregroundStyle(.secondary)
                    }

                    Button {
                        checkForUpdate()
                    } label: {
                        HStack {
                            Label("Check for Updates", systemImage: "arrow.clockwise")
                            if checkingUpdate {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(checkingUpdate)

                    if let info = updateInfo {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Version \(info.version) available")
                                .font(.subheadline.weight(.medium))
                            if let changelog = info.changelog {
                                Text(changelog)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Link("Download", destination: URL(string: info.url)!)
                                .font(.subheadline)
                        }
                        .padding(.vertical, 4)
                    }
                }

                // About
                Section("About") {
                    HStack {
                        Text("Prisma")
                        Spacer()
                        Text("Encrypted Proxy System")
                            .foregroundStyle(.secondary)
                    }
                    Link("GitHub Repository", destination: URL(string: "https://github.com/example/prisma")!)
                    Link("Documentation", destination: URL(string: "https://prisma.example.com/docs")!)
                }

                // Reset
                Section {
                    Button("Reset All Settings", role: .destructive) {
                        showResetConfirm = true
                    }
                }
            }
            .navigationTitle("Settings")
            .alert("Reset Settings", isPresented: $showResetConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    resetSettings()
                }
            } message: {
                Text("This will reset all settings to defaults. Server profiles will not be deleted.")
            }
        }
    }

    private func checkForUpdate() {
        checkingUpdate = true
        Task {
            updateInfo = PrismaEngine.shared.checkUpdate()
            checkingUpdate = false
        }
    }

    private func collectDiagnostics() -> String {
        let engine = PrismaEngine.shared
        var lines: [String] = []
        lines.append("Prisma iOS Diagnostics")
        lines.append("Version: \(engine.version)")
        lines.append("Status: \(vpnManager.vpnStatus.displayText)")
        lines.append("VPN Installed: \(vpnManager.isInstalled)")
        lines.append("Profiles: \(ProfileStore.shared.profiles.count)")
        lines.append("Date: \(ISO8601DateFormatter().string(from: Date()))")

        if let stats = engine.getTrafficStats() {
            lines.append("Bytes Up: \(stats.bytesUp)")
            lines.append("Bytes Down: \(stats.bytesDown)")
            lines.append("Connected: \(stats.connected)")
        }
        return lines.joined(separator: "\n")
    }

    private func resetSettings() {
        autoConnect = false
        connectOnLaunch = false
        killSwitch = false
        showNotifications = true
        theme = "system"
    }
}

// MARK: - Logs View

struct LogsView: View {
    @State private var logs: [LogEntry] = []
    @State private var filterLevel: String = "all"

    struct LogEntry: Identifiable {
        let id = UUID()
        let level: String
        let message: String
        let timestamp: Date
    }

    var filteredLogs: [LogEntry] {
        if filterLevel == "all" { return logs }
        return logs.filter { $0.level == filterLevel }
    }

    var body: some View {
        List(filteredLogs) { entry in
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(entry.level.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(logColor(entry.level))
                    Spacer()
                    Text(entry.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(entry.message)
                    .font(.caption)
                    .foregroundStyle(.primary)
            }
            .padding(.vertical, 2)
        }
        .navigationTitle("Logs")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Level", selection: $filterLevel) {
                    Text("All").tag("all")
                    Text("Error").tag("error")
                    Text("Warn").tag("warn")
                    Text("Info").tag("info")
                }
                .pickerStyle(.menu)
            }
        }
        .onAppear {
            PrismaEngine.shared.onEvent { event in
                if event.type == "log", let msg = event.msg {
                    let entry = LogEntry(
                        level: event.code ?? "info",
                        message: msg,
                        timestamp: Date()
                    )
                    logs.insert(entry, at: 0)
                    if logs.count > 500 { logs.removeLast() }
                }
            }
        }
    }

    private func logColor(_ level: String) -> Color {
        switch level.lowercased() {
        case "error": return .red
        case "warn", "warning": return .orange
        case "info": return .blue
        default: return .secondary
        }
    }
}
