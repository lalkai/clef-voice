import SwiftUI
import AppKit
import os

@main
struct ClefVoiceApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
        } label: {
            menuBarLabel
        }
        .menuBarExtraStyle(.window)
    }

    @ViewBuilder
    private var menuBarLabel: some View {
        if let image = Self.menuBarImage {
            Image(nsImage: image)
        } else {
            Image(systemName: "waveform.circle.fill")
        }
    }

    private static let menuBarImage: NSImage? = {
        guard let url = Bundle.main.url(forResource: "MenuBarIcon", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        image.size = NSSize(width: 22, height: 22)
        image.isTemplate = true
        return image
    }()
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        _ = AppViewModel.shared
        
        // Open dashboard window immediately on launch
        DispatchQueue.main.async {
            MainWindowController.shared.showSettings()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        MainWindowController.shared.showSettings()
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        AppViewModel.shared.checkPermissions()
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppViewModel.shared.session.engine.terminate()
    }
}
