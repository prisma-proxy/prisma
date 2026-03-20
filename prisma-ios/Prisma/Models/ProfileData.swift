// ProfileData.swift — Data models for profiles, servers, and related types.

import Foundation

struct ProfileData: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    let createdAt: String
    var lastUsed: String?
    var tags: [String]
    var config: ConfigData
    var subscriptionUrl: String?
    var lastUpdated: String?

    enum CodingKeys: String, CodingKey {
        case id, name, tags, config
        case createdAt = "created_at"
        case lastUsed = "last_used"
        case subscriptionUrl = "subscription_url"
        case lastUpdated = "last_updated"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: ProfileData, rhs: ProfileData) -> Bool {
        lhs.id == rhs.id
    }
}

struct ConfigData: Codable {
    var serverAddr: String?
    var identity: IdentityData?
    var transport: String?
    var cipherSuite: String?

    enum CodingKeys: String, CodingKey {
        case serverAddr = "server_addr"
        case identity, transport
        case cipherSuite = "cipher_suite"
    }
}

struct IdentityData: Codable {
    var clientId: String?
    var authSecret: String?

    enum CodingKeys: String, CodingKey {
        case clientId = "client_id"
        case authSecret = "auth_secret"
    }
}

struct ImportResult: Codable {
    let count: Int
    let profiles: [ProfileData]
}

struct PingResult: Codable {
    let latencyMs: UInt64?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case latencyMs = "latency_ms"
        case error
    }
}

struct UpdateInfo: Codable {
    let version: String
    let url: String
    let changelog: String?
}

struct TrafficStats {
    let bytesUp: UInt64
    let bytesDown: UInt64
    let speedUpBps: UInt64
    let speedDownBps: UInt64
    let uptimeSecs: UInt64

    static let zero = TrafficStats(bytesUp: 0, bytesDown: 0, speedUpBps: 0, speedDownBps: 0, uptimeSecs: 0)
}
