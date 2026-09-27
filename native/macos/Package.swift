// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ClefVoice",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "ClefVoice", targets: ["ClefVoice"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "ClefVoice",
            dependencies: [],
            path: "Sources/ClefVoice"
        ),
        .testTarget(
            name: "ClefVoiceTests",
            dependencies: ["ClefVoice"],
            path: "Tests/ClefVoiceTests"
        )
    ]
)
