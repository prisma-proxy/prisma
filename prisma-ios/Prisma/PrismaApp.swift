// PrismaApp.swift — App entry point.

import SwiftUI

@main
struct PrismaApp: App {
    @StateObject private var vpnManager = VPNManager.shared
    @StateObject private var profileStore = ProfileStore.shared
    @StateObject private var networkMonitor = NetworkMonitor.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(vpnManager)
                .environmentObject(profileStore)
                .environmentObject(networkMonitor)
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        PrismaEngine.shared.onForeground()
                    case .background:
                        PrismaEngine.shared.onBackground()
                    default:
                        break
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
                    PrismaEngine.shared.onMemoryWarning()
                }
        }
    }
}
