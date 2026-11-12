import FlyingFox
import FlyingSocks
import Foundation
import WebKit

struct ProcessingFiles: Sendable {
    let input: URL
    let movie: URL?
    let movieOutput: URL
    let output: URL
}

private final class ModelRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, var destination = URLComponents(url: url, resolvingAgainstBaseURL: false),
              destination.host != nil, destination.user == nil, destination.password == nil,
              destination.port == nil || destination.port == 443,
              destination.scheme == "http" || destination.scheme == "https" else {
            completionHandler(nil)
            return
        }
        destination.scheme = "https"
        guard let secureURL = destination.url else { completionHandler(nil); return }
        var secured = request
        secured.url = secureURL
        secured.httpMethod = "HEAD"
        completionHandler(secured)
    }
}

private actor EngineRoutes: HTTPHandler {
    private struct DetailManifest: Decodable {
        struct Model: Decodable {
            let file: String
            let sourceUrl: URL
        }
        let models: [String: Model]
    }

    static let port: UInt16 = 49327
    static let host = "127.0.0.1:\(port)"
    static let origin = "http://\(host)"
    private static let modelBase = URL(string: "https://wanthinnn.github.io/stylio/")!

    private let root: URL
    private let modelSession = URLSession(configuration: .ephemeral)
    private var jobs: [UUID: ProcessingFiles] = [:]
    private var probes: [UUID: URL] = [:]

    init(root: URL) { self.root = root }

    func register(_ files: ProcessingFiles, for id: UUID) { jobs[id] = files }
    func unregister(_ id: UUID) { jobs[id] = nil }
    func registerProbe(_ input: URL, for id: UUID) { probes[id] = input }
    func unregisterProbe(_ id: UUID) { probes[id] = nil }

    func handleRequest(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard request.headers[.host] == Self.host else { return HTTPResponse(statusCode: .forbidden) }
        let components = request.path.split(separator: "/")
        if components.first == "jobs" {
            return try await handleJob(request, components: components)
        }
        if components.first == "probes", request.method == .GET, components.count == 2,
           let id = UUID(uuidString: String(components[1])), let input = probes[id] {
            return try serve(input)
        }

        guard request.method == .GET,
              components.allSatisfy({ $0 != "." && $0 != ".." && !$0.contains("%") }),
              let first = components.first,
              ["index.html", "start.js", "src", "profiles", "vendor", "live-photo-video"].contains(String(first)) else {
            return HTTPResponse(statusCode: .notFound)
        }

        let path = components.joined(separator: "/")
        let file = root.appendingPathComponent(path)
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue {
            return try serve(file)
        }

        let isModelDirectory = components.count == 3 && first == "vendor"
            && ["ai-portrait", "ai-style", "ai-detail"].contains(String(components[1]))
        if isModelDirectory, file.pathExtension == "wasm" || path.hasSuffix(".onnx") || path.hasSuffix(".onnx_data") {
            return try await redirectModel(path)
        }
        return HTTPResponse(statusCode: .notFound)
    }

    private func redirectModel(_ path: String) async throws -> HTTPResponse {
        let destination: URL
        if path.hasPrefix("vendor/ai-detail/") {
            // These weights are distributed by their upstreams. The JS worker
            // checks the downloaded bytes against the bundled manifest.
            let file = root.appending(path: "vendor/ai-detail/assets.json")
            let manifest = try JSONDecoder().decode(DetailManifest.self, from: Data(contentsOf: file))
            let filename = (path as NSString).lastPathComponent
            guard let source = manifest.models.values.first(where: { $0.file == filename })?.sourceUrl,
                  source.scheme == "https" else {
                return HTTPResponse(statusCode: .notFound)
            }
            destination = source
        } else {
            guard let source = try await resolvePagesModel(path) else { return HTTPResponse(statusCode: .notFound) }
            destination = source
        }
        var headers = responseHeaders()
        headers[.location] = destination.absoluteString
        return HTTPResponse(statusCode: .temporaryRedirect, headers: headers)
    }

    private func resolvePagesModel(_ path: String) async throws -> URL? {
        let source = Self.modelBase.appending(path: path)
        var request = URLRequest(url: source, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = "HEAD"
        // Resolve the Pages custom-domain redirect before handing the download to WebKit.
        let (_, response) = try await modelSession.data(for: request, delegate: ModelRedirects())
        guard let http = response as? HTTPURLResponse, let destination = http.url, destination.scheme == "https",
              (200..<300).contains(http.statusCode) else {
            return nil
        }
        return destination
    }

    private func handleJob(_ request: HTTPRequest, components: [Substring]) async throws -> HTTPResponse {
        guard components.count == 3, let id = UUID(uuidString: String(components[1])), let job = jobs[id] else {
            return HTTPResponse(statusCode: .notFound)
        }
        switch (request.method, components[2]) {
        case (.GET, "input"):
            return try serve(job.input)
        case (.GET, "movie"):
            guard let movie = job.movie else { return HTTPResponse(statusCode: .notFound) }
            return try serve(movie)
        case (.POST, "output"), (.POST, "movie-output"):
            guard request.headers[HTTPHeader("X-Stylio-Result")] == "1",
                  request.headers[HTTPHeader("Origin")] == Self.origin else {
                return HTTPResponse(statusCode: .forbidden)
            }
            let destination = components[2] == "output" ? job.output : job.movieOutput
            let staging = destination.appendingPathExtension("partial")
            guard FileManager.default.createFile(atPath: staging.path, contents: nil) else {
                return HTTPResponse(statusCode: .internalServerError)
            }
            defer { try? FileManager.default.removeItem(at: staging) }
            let file = try FileHandle(forWritingTo: staging)
            defer { try? file.close() }
            for try await chunk in request.bodySequence { try file.write(contentsOf: chunk) }
            guard try file.offset() > 0 else { return HTTPResponse(statusCode: .badRequest) }
            try file.close()
            try FileManager.default.moveItem(at: staging, to: destination)
            return HTTPResponse(statusCode: .ok, headers: responseHeaders())
        default:
            return HTTPResponse(statusCode: .notFound)
        }
    }

    private func responseHeaders() -> HTTPHeaders {
        [
            HTTPHeader("Cross-Origin-Opener-Policy"): "same-origin",
            HTTPHeader("Cross-Origin-Embedder-Policy"): "require-corp",
            HTTPHeader("Cross-Origin-Resource-Policy"): "same-origin",
            .cacheControl: "no-store",
        ]
    }

    private func serve(_ file: URL) throws -> HTTPResponse {
        var headers = responseHeaders()
        switch file.pathExtension.lowercased() {
        case "js", "mjs": headers[.contentType] = "text/javascript; charset=utf-8"
        case "html": headers[.contentType] = "text/html; charset=utf-8"
        case "json": headers[.contentType] = "application/json"
        case "wasm": headers[.contentType] = "application/wasm"
        default: headers[.contentType] = "application/octet-stream"
        }
        return HTTPResponse(statusCode: .ok, headers: headers, body: try HTTPBodySequence(file: file, suggestedBufferSize: 65_536))
    }
}

@MainActor
final class NativeEngine: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    enum Movie: String {
        case none, compatible, repaired, mismatch
        case needsTracks = "needs-tracks"
    }

    struct Result {
        let name: String
        let movie: Movie
        let notes: [String]
        let depthWarning: String?
    }

    struct SharedPhotoInfo {
        let identifier: String?
        let captureDate: Date?
        let isJPEG: Bool
    }

    enum CacheAction: Equatable { case update, clear, reset }

    private enum EngineError: LocalizedError {
        case unavailable, invalidResult, interrupted, processing(String)

        var errorDescription: String? {
            switch self {
            case .unavailable: "The Stylio processing engine could not start."
            case .invalidResult: "The processing engine did not return a usable photo."
            case .interrupted: "iOS stopped the processing engine. Open Stylio and try the photo again."
            case .processing(let message): message
            }
        }
    }

    private let dataStore = WKWebsiteDataStore.default()
    private var webView: WKWebView?
    private var server: HTTPServer?
    private var routes: EngineRoutes?
    private var serverTask: Task<Void, Never>?
    private var startupError: Error?
    private var isReady = false
    private var progress: ((String?, Double?) -> Void)?

    func process(
        _ files: ProcessingFiles,
        name: String,
        options: [String: Any],
        progress: @escaping (String?, Double?) -> Void
    ) async throws -> Result {
        let view = try await readyView()
        guard let routes else { throw EngineError.unavailable }
        let id = UUID()
        await routes.register(files, for: id)
        self.progress = progress
        defer { self.progress = nil }

        let job: [String: Any] = [
            "route": "/jobs/\(id.uuidString)", "name": name,
            "paired": files.movie != nil, "options": options,
        ]
        let value: Any?
        do {
            value = try await view.callAsyncJavaScript(
                """
                try { return await globalThis.stylioNative.process(job); }
                catch (error) { return { error: String(error.message || error) }; }
                """,
                arguments: ["job": job], in: nil, contentWorld: .page
            )
        } catch {
            await routes.unregister(id)
            throw startupError ?? error
        }
        await routes.unregister(id)
        guard let info = value as? [String: Any] else { throw EngineError.invalidResult }
        if let message = info["error"] as? String { throw EngineError.processing(message) }
        guard let name = info["name"] as? String, !name.isEmpty,
              let movie = Movie(rawValue: info["movie"] as? String ?? ""),
              FileManager.default.fileExists(atPath: files.output.path) else {
            throw EngineError.invalidResult
        }
        return Result(name: name, movie: movie, notes: info["notes"] as? [String] ?? [],
                      depthWarning: info["depthWarning"] as? String)
    }

    func maintain(_ action: CacheAction) async throws {
        await stop()
        let browserCache: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
        let types: Set<String>
        switch action {
        case .update: types = browserCache
        case .clear: types = browserCache.union([WKWebsiteDataTypeFetchCache])
        case .reset: types = WKWebsiteDataStore.allWebsiteDataTypes()
        }
        await dataStore.removeData(ofTypes: types, modifiedSince: .distantPast)
        if action == .update { _ = try await readyView() }
    }

    func inspectSharedPhoto(_ input: URL) async throws -> SharedPhotoInfo? {
        let view = try await readyView()
        guard let routes else { throw EngineError.unavailable }
        let id = UUID()
        await routes.registerProbe(input, for: id)
        let value: Any?
        do {
            value = try await view.callAsyncJavaScript(
                "return await globalThis.stylioNative.inspectSharedPhoto(route);",
                arguments: ["route": "/probes/\(id.uuidString)"], in: nil, contentWorld: .page
            )
        } catch {
            await routes.unregisterProbe(id)
            throw error
        }
        await routes.unregisterProbe(id)
        guard let result = value as? [String: Any] else { return nil }
        var date: Date?
        if let timestamp = result["timestamp"] as? Double {
            date = Date(timeIntervalSince1970: timestamp / 1000)
        } else if let localDate = result["date"] as? String {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
            date = formatter.date(from: localDate)
        }
        return SharedPhotoInfo(identifier: result["identifier"] as? String, captureDate: date, isJPEG: result["format"] as? String == "jpeg")
    }

    private func readyView() async throws -> WKWebView {
        if isReady, let webView, let server {
            let address = await server.listeningAddress
            if address != nil { return webView }
        }
        await stop()
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("StylioEngine"),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            throw EngineError.unavailable
        }
        let routes = EngineRoutes(root: root)
        let server = HTTPServer(address: try .inet(ip4: "127.0.0.1", port: EngineRoutes.port), timeout: 120, handler: routes)
        self.routes = routes
        self.server = server
        serverTask = Task { [weak self] in
            do { try await server.run() }
            catch { self?.startupError = error }
        }

        for _ in 0..<100 {
            if let startupError { throw startupError }
            let address = await server.listeningAddress
            if address != nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let address = await server.listeningAddress
        guard address != nil else { throw EngineError.unavailable }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.userContentController.add(self, name: "stylio")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        webView = view
        let url = URL(string: "\(EngineRoutes.origin)/index.html")!
        view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        for _ in 0..<150 {
            if let startupError { throw startupError }
            if isReady { return view }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw EngineError.unavailable
    }

    private func stop() async {
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "stylio")
        webView?.navigationDelegate = nil
        webView = nil
        if let server { await server.stop() }
        serverTask?.cancel()
        await serverTask?.value
        serverTask = nil
        server = nil
        routes = nil
        startupError = nil
        isReady = false
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, isEnginePage(url),
              let body = message.body as? [String: Any] else { return }
        switch body["type"] as? String {
        case "ready": isReady = true
        case "progress": progress?(body["message"] as? String, body["progress"] as? Double)
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url, isEnginePage(url) else { return .cancel }
        return .allow
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        startupError = error
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isReady = false
        startupError = EngineError.interrupted
    }

    private func isEnginePage(_ url: URL) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(EngineRoutes.port) && url.path == "/index.html"
    }
}
