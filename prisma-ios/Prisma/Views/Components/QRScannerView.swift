// QRScannerView.swift — Camera-based QR code scanner using AVFoundation.

import SwiftUI
import AVFoundation

struct QRScannerView: View {
    @Environment(\.dismiss) var dismiss
    let onScan: (String) -> Void

    @State private var cameraPermission: AVAuthorizationStatus = .notDetermined
    @State private var scannedCode: String?
    @State private var showManualInput = false
    @State private var manualInput = ""

    var body: some View {
        NavigationStack {
            ZStack {
                switch cameraPermission {
                case .authorized:
                    CameraPreview(onScan: handleScan)
                        .ignoresSafeArea()

                    // Scanner overlay
                    VStack {
                        Spacer()

                        RoundedRectangle(cornerRadius: 16)
                            .stroke(.white, lineWidth: 3)
                            .frame(width: 250, height: 250)

                        Spacer()

                        VStack(spacing: 12) {
                            Text("Scan a Prisma QR code")
                                .font(.subheadline)
                                .foregroundStyle(.white)

                            Button("Enter manually") {
                                showManualInput = true
                            }
                            .font(.subheadline)
                        }
                        .padding(.bottom, 60)
                    }

                case .denied, .restricted:
                    VStack(spacing: 16) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("Camera Access Required")
                            .font(.title3.weight(.medium))
                        Text("Enable camera access in Settings to scan QR codes.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Enter Code Manually") {
                            showManualInput = true
                        }
                    }
                    .padding()

                default:
                    ProgressView("Requesting camera access...")
                }
            }
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                checkCameraPermission()
            }
            .sheet(isPresented: $showManualInput) {
                NavigationStack {
                    Form {
                        Section("Paste prisma:// URI or config") {
                            TextEditor(text: $manualInput)
                                .frame(minHeight: 100)
                                .textInputAutocapitalization(.never)
                        }
                    }
                    .navigationTitle("Manual Input")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { showManualInput = false }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Import") {
                                if !manualInput.isEmpty {
                                    onScan(manualInput)
                                    showManualInput = false
                                }
                            }
                            .disabled(manualInput.isEmpty)
                        }
                    }
                }
            }
        }
    }

    private func checkCameraPermission() {
        cameraPermission = AVCaptureDevice.authorizationStatus(for: .video)
        if cameraPermission == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    cameraPermission = granted ? .authorized : .denied
                }
            }
        }
    }

    private func handleScan(_ code: String) {
        guard scannedCode == nil else { return } // Prevent duplicate scans
        scannedCode = code
        onScan(code)
    }
}

// MARK: - Camera Preview (AVFoundation wrapper)

struct CameraPreview: UIViewRepresentable {
    let onScan: (String) -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        let session = AVCaptureSession()

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else {
            return view
        }

        if session.canAddInput(input) {
            session.addInput(input)
        }

        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(context.coordinator, queue: .main)
            output.metadataObjectTypes = [.qr]
        }

        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = UIScreen.main.bounds
        view.layer.addSublayer(previewLayer)

        context.coordinator.session = session

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }

        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let onScan: (String) -> Void
        var session: AVCaptureSession?

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  let value = obj.stringValue else { return }

            session?.stopRunning()
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            onScan(value)
        }
    }
}
