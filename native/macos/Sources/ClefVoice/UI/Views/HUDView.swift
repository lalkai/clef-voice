import SwiftUI
import AppKit

public struct HUDView: View {
    @ObservedObject var viewModel: AppViewModel

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let t = timeline.date.timeIntervalSince1970

            HStack(spacing: 3.5) {
                ForEach(0..<5, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(barColor(i))
                        .frame(width: 3, height: barHeight(i, t))
                        .animation(.spring(response: 0.2, dampingFraction: 0.5, blendDuration: 0.05), value: barHeight(i, t))
                }
            }
            .frame(width: 54, height: 26, alignment: .center)
            .background(
                Capsule()
                    .fill(Color(red: 0.10, green: 0.10, blue: 0.11).opacity(0.92))
                    .overlay(
                        Capsule()
                            .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.75)
                    )
            )
            .scaleEffect(dynamicScale)
            .animation(.spring(response: 0.22, dampingFraction: 0.55), value: dynamicScale)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.clear)
    }

    private var dynamicScale: CGFloat {
        if viewModel.status == .recording {
            return 1.0 + min(CGFloat(viewModel.audioLevel) * 0.12, 0.10)
        }
        return 1.0
    }

    private func barColor(_ idx: Int) -> Color {
        switch viewModel.status {
        case .recording:
            return Color.white.opacity(0.95)
        case .transcribing:
            return Color.white.opacity(0.60)
        default:
            return Color.white.opacity(viewModel.isWaitingForModel || viewModel.isStartingCapture ? 0.65 : 0.35)
        }
    }

    private func barHeight(_ idx: Int, _ time: Double) -> CGFloat {
        let lo: CGFloat = 3.5
        let hi: CGFloat = 16.0

        switch viewModel.status {
        case .recording:
            let level = CGFloat(max(viewModel.audioLevel, 0.05))
            let center = 2.0
            let dist = abs(CGFloat(idx) - center) / center
            let weight = 1.0 - dist * 0.35
            let wave = sin(Double(idx) * 1.1 + time * 10.0) * 1.5
            return max(lo, min(hi, lo + (hi - lo) * level * weight * 1.8 + CGFloat(wave)))

        case .transcribing:
            let phase = Double(idx) * 0.8 + time * 10.0
            return lo + CGFloat((sin(phase) + 1.0) / 2.0) * (hi - lo) * 0.8

        default:
            if viewModel.isWaitingForModel || viewModel.isStartingCapture {
                let phase = Double(idx) * 0.7 + time * 6.0
                return lo + CGFloat((sin(phase) + 1.0) / 2.0) * (hi - lo) * 0.35
            }
            return lo
        }
    }
}

public final class HUDWindowController: NSWindowController {
    public static let shared = HUDWindowController()

    private var hostingView: NSHostingView<HUDView>?
    private var hideItem: DispatchWorkItem?

    private let hudSize = CGSize(width: 80, height: 44)
    private var isVisible = false

    private init() {
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: CGSize(width: 80, height: 44)),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.alphaValue = 0
        super.init(window: panel)
    }

    required init?(coder: NSCoder) { fatalError() }

    public func setup(viewModel: AppViewModel) {
        guard let panel = window as? NSPanel, hostingView == nil else { return }
        let hv = NSHostingView(rootView: HUDView(viewModel: viewModel))
        hv.wantsLayer = true
        hv.layer?.backgroundColor = NSColor.clear.cgColor
        hostingView = hv
        panel.contentView = hv
        panel.contentView?.wantsLayer = true
        panel.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
        panel.setContentSize(hudSize)
    }

    public func updateHUD(viewModel: AppViewModel) {
        guard let panel = window as? NSPanel else { return }

        let shouldShow = viewModel.isStartingCapture || viewModel.isWaitingForModel || viewModel.status == .recording || viewModel.status == .transcribing

        if shouldShow {
            hideItem?.cancel()
            hideItem = nil

            if !isVisible {
                let origin = computeOrigin(panelSize: hudSize)
                panel.setContentSize(hudSize)
                panel.setFrameOrigin(origin)
                panel.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup {
                    $0.duration = 0.16
                    $0.timingFunction = CAMediaTimingFunction(name: .easeOut)
                    panel.animator().alphaValue = 1.0
                }
                isVisible = true
            }
        } else {
            scheduleHide(panel: panel)
        }
    }

    private func computeOrigin(panelSize: CGSize) -> NSPoint {
        let mouseLoc = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouseLoc, $0.frame, false) }
            ?? NSScreen.main
            ?? NSScreen.screens.first
        let screenFrame = screen?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let visibleFrame = screen?.visibleFrame ?? screenFrame

        let isDockAtBottom = visibleFrame.minY > screenFrame.minY + 10
        let bottomOffset: CGFloat = isDockAtBottom ? 24 : 64

        return NSPoint(
            x: visibleFrame.midX - panelSize.width / 2,
            y: visibleFrame.minY + bottomOffset
        )
    }

    private func scheduleHide(panel: NSPanel) {
        guard hideItem == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            NSAnimationContext.runAnimationGroup({
                $0.duration = 0.18
                $0.timingFunction = CAMediaTimingFunction(name: .easeIn)
                panel.animator().alphaValue = 0
            }, completionHandler: {
                panel.orderOut(nil)
                self?.isVisible = false
            })
        }
        hideItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
    }
}
