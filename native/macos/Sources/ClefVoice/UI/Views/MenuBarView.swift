import SwiftUI
import AppKit

public struct MenuBarView: View {
    @ObservedObject private var vm = AppViewModel.shared
    @State private var showingHistory = false
    @State private var copiedRecently = false
    @State private var copiedEntryId: String? = nil

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            if showingHistory {
                historyView
            } else {
                mainView
            }
        }
        .frame(width: 320, height: 195)
        .onAppear { vm.checkPermissions() }
    }

    // MARK: - Main View

    private var mainView: some View {
        VStack(spacing: 0) {
            // Top Header: Title + Status Pill
            HStack {
                Text(AppConfig.name)
                    .font(.system(size: 15, weight: .bold))
                Spacer()
                statusBadgePill
            }
            .padding(10)

            // Always visible Last Transcription Card
            lastTranscriptionCard

            Spacer(minLength: 12)

            Divider()

            // Action Buttons
            actionButtonsSection
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Status Pill Badge

    private var statusBadgePill: some View {
        Button {
            dismissPopover()
            if !vm.areAllPermissionsGranted {
                MainWindowController.shared.showSettings(tab: "preferences")
            } else {
                MainWindowController.shared.showSettings()
            }
        } label: {
            HStack(spacing: 5) {
                if vm.isDownloadingModel {
                    ProgressView(value: vm.downloadProgress)
                        .progressViewStyle(.circular)
                        .controlSize(.mini)
                    Text("Downloading")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.secondary)
                    Text("\(Int(vm.downloadProgress * 100))%")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundColor(.primary.opacity(0.85))
                } else if vm.isModelLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.mini)
                    Text("Loading Model")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.secondary)
                } else if !vm.areAllPermissionsGranted {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 5, height: 5)
                    Text("Need Permission")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.secondary)
                } else if vm.status == .recording || vm.isRecording {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 5, height: 5)
                    Text("Recording")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.primary.opacity(0.85))
                } else if vm.status == .transcribing {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.mini)
                    Text("Transcribing")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.secondary)
                } else if vm.status == .error {
                    Circle()
                        .fill(Color.yellow)
                        .frame(width: 5, height: 5)
                    Text("Error")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.secondary)
                } else {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 5, height: 5)
                    Text("Ready")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3.5)
            .background(
                Capsule()
                    .fill(Color.secondary.opacity(0.12))
            )
            .overlay(
                Capsule()
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Last Transcription Card (Always Visible)

    private var lastTranscriptionCard: some View {
        let hasText = !vm.lastTranscribedText.isEmpty && !vm.isRecording

        return HStack(spacing: 8) {
            Image(systemName: "quote.opening")
                .font(.caption)
                .foregroundColor(hasText ? .accentColor.opacity(0.8) : .secondary.opacity(0.4))

            Text(hasText ? vm.lastTranscribedText : "No recent transcription")
                .font(.caption)
                .foregroundColor(hasText ? .primary : .secondary.opacity(0.5))
                .italic(!hasText)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            if hasText && vm.lastWPM > 0 {
                Text("\(Int(vm.lastWPM)) wpm")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundColor(.secondary)
            } else {
                Text("-- wpm")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundColor(.secondary.opacity(0.3))
            }

            Button {
                guard hasText else { return }
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(vm.lastTranscribedText, forType: .string)
                copiedRecently = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copiedRecently = false }
            } label: {
                Image(systemName: copiedRecently ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11))
                    .foregroundColor(copiedRecently ? .green : (hasText ? .secondary : .secondary.opacity(0.3)))
            }
            .buttonStyle(.plain)
            .disabled(!hasText)
        }
        .padding(9)
        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
        .cornerRadius(6)
        .padding(.horizontal, 10)
    }

    // MARK: - Action Buttons Section

    private var actionButtonsSection: some View {
        VStack(spacing: 0) {
            settingsButton
            Divider().padding(.horizontal, 8)
            historyButton
            Divider().padding(.horizontal, 8)
            quitButton
        }
        .padding(.vertical, 6)
    }

    private var settingsButton: some View {
        Button {
            dismissPopover()
            MainWindowController.shared.showSettings()
        } label: {
            HStack {
                Image(systemName: "square.grid.2x2.fill")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                Text("Open \(AppConfig.name)")
                    .font(.system(size: 13))

                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }

    private var historyButton: some View {
        Button { showingHistory = true } label: {
            HStack {
                Image(systemName: "clock")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                Text("History")
                    .font(.system(size: 13))

                Spacer()

                Text("\(vm.transcriptionHistory.count)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Color.secondary.opacity(0.12))
                    .cornerRadius(8)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }

    private var quitButton: some View {
        Button { NSApplication.shared.terminate(nil) } label: {
            HStack {
                Image(systemName: "power")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                Text("Quit \(AppConfig.name)")
                    .font(.system(size: 13))

                Spacer()

                Text("⌘Q")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
        .keyboardShortcut("q", modifiers: .command)
    }

    private func dismissPopover() {
        for window in NSApp.windows where window.isVisible && window != MainWindowController.shared.window {
            if window.className.contains("StatusBar") || window.className.contains("Panel") || window.level.rawValue > 0 {
                window.orderOut(nil)
            }
        }
    }

    // MARK: - History View

    private var historyView: some View {
        VStack(spacing: 0) {
            // Header Bar
            HStack {
                Button { showingHistory = false } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)

                Spacer()

                HStack(spacing: 4) {
                    Text("History")
                        .font(.system(size: 13, weight: .bold))
                    if !vm.transcriptionHistory.isEmpty {
                        Text("\(vm.transcriptionHistory.count)")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.secondary.opacity(0.15)))
                    }
                }

                Spacer()

                Button {
                    vm.clearHistory()
                } label: {
                    Text("Clear All")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(vm.transcriptionHistory.isEmpty ? .secondary.opacity(0.4) : .red)
                }
                .buttonStyle(.plain)
                .disabled(vm.transcriptionHistory.isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            if vm.transcriptionHistory.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 28))
                        .foregroundColor(.secondary.opacity(0.4))
                    Text("No dictation history yet")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.secondary)
                }
                Spacer()
            } else {
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 6) {
                        ForEach(vm.transcriptionHistory) { entry in
                            historyRowCard(entry)
                        }
                    }
                    .padding(8)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func historyRowCard(_ entry: TranscriptionEntry) -> some View {
        let isCopied = copiedEntryId == entry.id

        return HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.text)
                    .font(.system(size: 12))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    Text(entry.timeString)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.secondary)

                    Text(entry.language.uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.accentColor)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.accentColor.opacity(0.12))
                        .cornerRadius(4)

                    if entry.wpm > 0 {
                        Text("\(Int(entry.wpm)) wpm")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer(minLength: 4)

            // Copy Action Button
            Button {
                vm.copyHistoryEntry(entry)
                copiedEntryId = entry.id
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    if copiedEntryId == entry.id { copiedEntryId = nil }
                }
            } label: {
                Image(systemName: isCopied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11))
                    .foregroundColor(isCopied ? .green : .secondary.opacity(0.7))
                    .frame(width: 22, height: 22)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Copy to clipboard")
        }
        .padding(8)
        .background(Color(NSColor.controlBackgroundColor).opacity(0.6))
        .cornerRadius(6)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.05), lineWidth: 1))
        .contextMenu {
            Button("Copy") { vm.copyHistoryEntry(entry) }
            Button("Delete", role: .destructive) { vm.deleteHistoryEntry(entry) }
        }
    }
}