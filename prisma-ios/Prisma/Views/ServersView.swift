// ServersView.swift — Server list, add, import, QR scan.

import SwiftUI
import AVFoundation

struct ServersView: View {
    @EnvironmentObject var profileStore: ProfileStore
    @EnvironmentObject var vpnManager: VPNManager

    @State private var showAddSheet = false
    @State private var showQRScanner = false
    @State private var showSubscriptionSheet = false
    @State private var searchText = ""
    @State private var pingResults: [String: UInt64] = [:]
    @State private var isPinging = false
    @State private var profileToDelete: ProfileData?
    @State private var showDeleteConfirm = false

    var filteredProfiles: [ProfileData] {
        if searchText.isEmpty { return profileStore.profiles }
        return profileStore.profiles.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            ($0.config.serverAddr ?? "").contains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if filteredProfiles.isEmpty {
                    emptyState
                } else {
                    ForEach(filteredProfiles) { profile in
                        serverRow(profile)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    profileToDelete = profile
                                    showDeleteConfirm = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search servers")
            .navigationTitle("Servers")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(action: { showAddSheet = true }) {
                            Label("Add Manually", systemImage: "plus")
                        }
                        Button(action: { showQRScanner = true }) {
                            Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                        }
                        Button(action: { showSubscriptionSheet = true }) {
                            Label("Import Subscription", systemImage: "link")
                        }
                        Button(action: { Task { await profileStore.refreshAll() }}) {
                            Label("Refresh All", systemImage: "arrow.clockwise")
                        }
                        Divider()
                        Button(action: pingAll) {
                            Label("Ping All Servers", systemImage: "antenna.radiowaves.left.and.right")
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .refreshable {
                await profileStore.refreshAll()
            }
            .sheet(isPresented: $showAddSheet) {
                AddServerSheet()
                    .environmentObject(profileStore)
            }
            .sheet(isPresented: $showQRScanner) {
                QRScannerView { code in
                    if profileStore.importFromQR(code) || profileStore.importFromURI(code) {
                        showQRScanner = false
                    }
                }
            }
            .sheet(isPresented: $showSubscriptionSheet) {
                SubscriptionSheet()
                    .environmentObject(profileStore)
            }
            .alert("Delete Server", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    if let p = profileToDelete {
                        try? profileStore.delete(p)
                    }
                }
            } message: {
                Text("Are you sure you want to delete \"\(profileToDelete?.name ?? "")\"?")
            }
        }
    }

    // MARK: - Row

    private func serverRow(_ profile: ProfileData) -> some View {
        Button {
            profileStore.select(profile)
        } label: {
            HStack(spacing: 12) {
                // Selection indicator
                Image(systemName: profile.id == profileStore.selectedProfileId ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(profile.id == profileStore.selectedProfileId ? .accentColor : .secondary)

                VStack(alignment: .leading, spacing: 2) {
                    Text(profile.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)

                    HStack(spacing: 8) {
                        if let addr = profile.config.serverAddr {
                            Text(addr)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let transport = profile.config.transport {
                            Text(transport.uppercased())
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.accentColor.opacity(0.1))
                                .clipShape(Capsule())
                        }
                    }

                    if !profile.tags.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(profile.tags.prefix(3), id: \.self) { tag in
                                Text(tag)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(Color(.systemGray5))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }

                Spacer()

                // Ping result
                if let latency = pingResults[profile.id] {
                    Text("\(latency)ms")
                        .font(.caption.weight(.medium).monospacedDigit())
                        .foregroundStyle(latencyColor(latency))
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "server.rack")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No Servers")
                .font(.title3.weight(.medium))
            Text("Add a server manually, scan a QR code, or import from a subscription URL.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                Button("Scan QR") { showQRScanner = true }
                    .buttonStyle(.borderedProminent)
                Button("Add URL") { showSubscriptionSheet = true }
                    .buttonStyle(.bordered)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
        .listRowBackground(Color.clear)
    }

    // MARK: - Helpers

    private func latencyColor(_ ms: UInt64) -> Color {
        if ms < 100 { return .green }
        if ms < 200 { return .yellow }
        return .red
    }

    private func pingAll() {
        isPinging = true
        Task {
            for profile in profileStore.profiles {
                if let ms = await profileStore.ping(profile) {
                    await MainActor.run {
                        pingResults[profile.id] = ms
                    }
                }
            }
            isPinging = false
        }
    }
}

// MARK: - Add Server Sheet

struct AddServerSheet: View {
    @EnvironmentObject var profileStore: ProfileStore
    @Environment(\.dismiss) var dismiss

    @State private var name = ""
    @State private var serverAddr = ""
    @State private var clientId = ""
    @State private var authSecret = ""
    @State private var transport = "prisma-tls"
    @State private var showError = false
    @State private var errorText = ""

    let transports = ["prisma-tls", "quic-v2", "websocket", "grpc", "xporta"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Server Info") {
                    TextField("Name", text: $name)
                    TextField("Server Address (host:port)", text: $serverAddr)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                }

                Section("Authentication") {
                    TextField("Client ID", text: $clientId)
                        .textInputAutocapitalization(.never)
                    SecureField("Auth Secret", text: $authSecret)
                }

                Section("Transport") {
                    Picker("Transport", selection: $transport) {
                        ForEach(transports, id: \.self) { t in
                            Text(t.uppercased()).tag(t)
                        }
                    }
                }
            }
            .navigationTitle("Add Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { saveProfile() }
                        .disabled(name.isEmpty || serverAddr.isEmpty)
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK") {}
            } message: {
                Text(errorText)
            }
        }
    }

    private func saveProfile() {
        let profile = ProfileData(
            id: UUID().uuidString,
            name: name,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            lastUsed: nil,
            tags: [],
            config: ConfigData(
                serverAddr: serverAddr,
                identity: IdentityData(clientId: clientId.isEmpty ? nil : clientId,
                                       authSecret: authSecret.isEmpty ? nil : authSecret),
                transport: transport,
                cipherSuite: nil
            ),
            subscriptionUrl: nil,
            lastUpdated: nil
        )

        do {
            try profileStore.save(profile)
            profileStore.select(profile)
            dismiss()
        } catch {
            errorText = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - Subscription Sheet

struct SubscriptionSheet: View {
    @EnvironmentObject var profileStore: ProfileStore
    @Environment(\.dismiss) var dismiss

    @State private var url = ""
    @State private var isLoading = false
    @State private var result: ImportResult?
    @State private var showError = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Subscription URL") {
                    TextField("https://...", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                }

                if isLoading {
                    HStack {
                        ProgressView()
                        Text("Importing...")
                    }
                }

                if let result = result {
                    Section("Result") {
                        Text("Imported \(result.count) server(s)")
                            .foregroundStyle(.green)
                    }
                }
            }
            .navigationTitle("Import Subscription")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Import") { importSub() }
                        .disabled(url.isEmpty || isLoading)
                }
            }
        }
    }

    private func importSub() {
        isLoading = true
        Task {
            result = await profileStore.importFromSubscription(url: url)
            isLoading = false
            if result != nil {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                dismiss()
            } else {
                showError = true
            }
        }
    }
}
