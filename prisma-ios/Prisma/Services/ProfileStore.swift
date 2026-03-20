// ProfileStore.swift — Observable store for profile management.

import Foundation
import Combine

@MainActor
final class ProfileStore: ObservableObject {
    static let shared = ProfileStore()

    @Published var profiles: [ProfileData] = []
    @Published var selectedProfileId: String?
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let engine = PrismaEngine.shared
    private let defaults = UserDefaults.standard
    private let selectedKey = "selectedProfileId"

    private init() {
        selectedProfileId = defaults.string(forKey: selectedKey)
        reload()
    }

    var selectedProfile: ProfileData? {
        profiles.first { $0.id == selectedProfileId }
    }

    // MARK: - CRUD

    func reload() {
        profiles = engine.profilesList()
        // Validate selection still exists
        if let id = selectedProfileId, !profiles.contains(where: { $0.id == id }) {
            selectedProfileId = profiles.first?.id
        }
    }

    func select(_ profile: ProfileData) {
        selectedProfileId = profile.id
        defaults.set(profile.id, forKey: selectedKey)
    }

    func save(_ profile: ProfileData) throws {
        let json = try JSONEncoder().encode(profile)
        guard let jsonStr = String(data: json, encoding: .utf8) else {
            throw PrismaError.invalidConfig
        }
        try engine.saveProfile(jsonStr)
        reload()
    }

    func delete(_ profile: ProfileData) throws {
        try engine.deleteProfile(id: profile.id)
        if selectedProfileId == profile.id {
            selectedProfileId = nil
            defaults.removeObject(forKey: selectedKey)
        }
        reload()
    }

    // MARK: - Import

    func importFromSubscription(url: String) async -> ImportResult? {
        isLoading = true
        defer { isLoading = false }

        let result = engine.importSubscription(url: url)
        if result != nil {
            reload()
        }
        return result
    }

    func refreshAll() async -> ImportResult? {
        isLoading = true
        defer { isLoading = false }

        let result = engine.refreshSubscriptions()
        if result != nil {
            reload()
        }
        return result
    }

    func importFromURI(_ uri: String) -> Bool {
        guard let json = engine.importURI(uri) else { return false }

        // Check for error
        if json.contains("\"error\"") { return false }

        // Parse and save as profile
        guard let data = json.data(using: .utf8),
              var profile = try? JSONDecoder().decode(ProfileData.self, from: data) else {
            return false
        }

        profile = ProfileData(
            id: UUID().uuidString,
            name: profile.name.isEmpty ? "Imported Server" : profile.name,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            lastUsed: nil,
            tags: ["imported"],
            config: profile.config,
            subscriptionUrl: nil,
            lastUpdated: nil
        )

        do {
            try save(profile)
            return true
        } catch {
            return false
        }
    }

    func importFromQR(_ data: String) -> Bool {
        guard let json = engine.profileFromQR(data) else { return false }
        return importFromURI(json)
    }

    // MARK: - Config generation

    func configJSON(for profile: ProfileData) -> String? {
        guard let data = try? JSONEncoder().encode(profile.config) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Latency

    func ping(_ profile: ProfileData) async -> UInt64? {
        guard let addr = profile.config.serverAddr else { return nil }
        let result = engine.ping(server: addr)
        return result?.latencyMs
    }
}
