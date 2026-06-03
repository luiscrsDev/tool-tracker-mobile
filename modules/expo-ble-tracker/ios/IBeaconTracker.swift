import CoreLocation
import Foundation

// iBeacon UUID shared across all M1P tags configured for this app
let IBEACON_UUID = UUID(uuidString: "A4B0E09F-6C8B-4976-A22A-3D2B7E0B7E52")!
let PREFS_SUITE = "group.com.tooltracker.mobile"
let KEY_TAGS = "ble_tracked_tags"
let KEY_SUPABASE_URL = "supabase_url"
let KEY_SUPABASE_KEY = "supabase_key"
let KEY_LAST_POSITIONS = "last_positions"
let KEY_CURRENT_USER_ID = "current_user_id"
let KEY_REGISTRY = "tag_registry"
let THROTTLE_SEC: TimeInterval = 110
let MIN_DIST_M: Double = 15
let STOP_TIMEOUT: TimeInterval = 4 * 60
let REGISTRY_SYNC_SEC: TimeInterval = 15 * 60

typealias TagRecord = (toolId: String, toolName: String, contractorId: String)

class IBeaconTracker: NSObject, CLLocationManagerDelegate {

    static let shared = IBeaconTracker()

    var onTagDetected: (([String: Any]) -> Void)?
    var onDeviceFound: (([String: Any]) -> Void)?
    var onScanStateChange: ((Bool) -> Void)?

    private let locationManager = CLLocationManager()
    private let beaconRegion = CLBeaconRegion(uuid: IBEACON_UUID, identifier: "com.tooltracker.beacons")
    private var trackedTags: [String: TagRecord] = [:]    // user's own (from addTag)
    private var registry: [String: TagRecord] = [:]       // global, from bletracker_registry RPC
    private var lastPositions: [String: [String: Double]] = [:]  // toolId → {lat,lng,event,ts}
    private var supabaseUrl = ""
    private var supabaseKey = ""
    private var currentUserId = ""
    private var monitoring = false
    private var ranging = false
    private var pendingForegroundScan = false
    private var registrySyncTimer: Timer?

    private var prefs: UserDefaults {
        UserDefaults(suiteName: PREFS_SUITE) ?? UserDefaults.standard
    }

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.pausesLocationUpdatesAutomatically = false
        beaconRegion.notifyOnEntry = true
        beaconRegion.notifyOnExit = true
        beaconRegion.notifyEntryStateOnDisplay = true
        loadConfig()
        loadLastPositions()
        loadCachedRegistry()
        startRegistrySync()
    }

    deinit {
        registrySyncTimer?.invalidate()
    }

    func setCurrentUser(userId: String) {
        currentUserId = userId
        prefs.set(userId, forKey: KEY_CURRENT_USER_ID)
    }

    // MARK: - Config

    func configure(url: String, key: String) {
        supabaseUrl = url
        supabaseKey = key
        prefs.set(url, forKey: KEY_SUPABASE_URL)
        prefs.set(key, forKey: KEY_SUPABASE_KEY)
    }

    func addTag(tagId: String, toolId: String, toolName: String, contractorId: String) {
        trackedTags[tagId.uppercased()] = (toolId, toolName, contractorId)
        saveTags()
    }

    func removeTag(tagId: String) {
        trackedTags.removeValue(forKey: tagId.uppercased())
        saveTags()
    }

    func clearTags() {
        trackedTags.removeAll()
        saveTags()
    }

    func tagCount() -> Int { trackedTags.count }

    // MARK: - Service (background iBeacon monitoring)

    func startService() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.locationManager.allowsBackgroundLocationUpdates = true
            guard CLLocationManager.isMonitoringAvailable(for: CLBeaconRegion.self) else { return }
            let status = self.locationManager.authorizationStatus
            if status == .notDetermined {
                self.locationManager.requestAlwaysAuthorization()
                return
            }
            guard status == .authorizedAlways else { return }
            self.locationManager.startMonitoring(for: self.beaconRegion)
            self.locationManager.requestState(for: self.beaconRegion)
            self.monitoring = true
        }
    }

    func stopService() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.locationManager.stopMonitoring(for: self.beaconRegion)
            self.locationManager.stopRangingBeacons(satisfying: self.beaconRegion.beaconIdentityConstraint)
            self.monitoring = false
            self.ranging = false
        }
    }

    func isRunning() -> Bool { monitoring }

    // MARK: - Foreground Scan (ranging)

    func startForegroundScan() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, CLLocationManager.isRangingAvailable() else { return }
            let status = self.locationManager.authorizationStatus
            if status == .notDetermined {
                self.pendingForegroundScan = true
                self.locationManager.requestWhenInUseAuthorization()
                return
            }
            guard status == .authorizedWhenInUse || status == .authorizedAlways else { return }
            self.locationManager.startRangingBeacons(satisfying: self.beaconRegion.beaconIdentityConstraint)
            self.ranging = true
            self.onScanStateChange?(true)
        }
    }

    func stopForegroundScan() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.locationManager.stopRangingBeacons(satisfying: self.beaconRegion.beaconIdentityConstraint)
            self.ranging = false
            self.onScanStateChange?(false)
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .authorizedAlways {
            startService()
        }
        if (status == .authorizedWhenInUse || status == .authorizedAlways) && (ranging || pendingForegroundScan) {
            pendingForegroundScan = false
            ranging = true
            locationManager.startRangingBeacons(satisfying: beaconRegion.beaconIdentityConstraint)
            onScanStateChange?(true)
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier == beaconRegion.identifier else { return }
        locationManager.startRangingBeacons(satisfying: beaconRegion.beaconIdentityConstraint)
    }

    func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        if state == .inside {
            locationManager.startRangingBeacons(satisfying: beaconRegion.beaconIdentityConstraint)
        }
    }

    func locationManager(_ manager: CLLocationManager, didRange beacons: [CLBeacon], satisfying constraint: CLBeaconIdentityConstraint) {
        for beacon in beacons {
            let key = "\(beacon.major):\(beacon.minor)"
            let rssi = beacon.rssi

            if ranging {
                onDeviceFound?([
                    "id": key,
                    "name": "MK Sensor (\(key))",
                    "rssi": rssi,
                    "manufacturerData": ""
                ])
            }

            // Lookup in global registry first, fall back to user's own tags.
            guard let record = registry[key] ?? trackedTags[key] else { continue }
            handleDetection(key: key, record: record, rssi: rssi)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[BleTracker] CLLocationManager error: \(error)")
        // Drain pending detections using last known position so beacons aren't silently dropped
        guard !pendingDetections.isEmpty else { return }
        let detections = pendingDetections
        pendingDetections.removeAll()
        for detection in detections {
            let last = lastPositions[detection.record.toolId]
            guard let last = last,
                  let lat = last["lat"], let lng = last["lng"],
                  lat != 0 || lng != 0 else { continue }
            let fallback = CLLocation(latitude: lat, longitude: lng)
            processLocation(location: fallback, record: detection.record, last: last, now: detection.now)
        }
    }

    // MARK: - Detection Logic

    private func handleDetection(key: String, record: TagRecord, rssi: Int) {
        let now = Date().timeIntervalSince1970
        let last = lastPositions[record.toolId]
        let lastTime = last?["ts"] ?? 0

        guard now - lastTime >= THROTTLE_SEC else { return }

        // Update timestamp immediately to prevent concurrent fetches
        var updated = last ?? [:]
        updated["ts"] = now
        lastPositions[record.toolId] = updated
        saveLastPositions()

        fetchGpsAndSave(record: record, last: last, now: now)
    }

    private func fetchGpsAndSave(record: TagRecord, last: [String: Double]?, now: TimeInterval) {
        locationManager.requestLocation()
        pendingDetections.append((record: record, last: last, now: now))
    }

    private var pendingDetections: [(record: TagRecord, last: [String: Double]?, now: TimeInterval)] = []

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        guard location.horizontalAccuracy <= 150 else { return }

        let detections = pendingDetections
        pendingDetections.removeAll()

        for detection in detections {
            processLocation(location: location, record: detection.record, last: detection.last, now: detection.now)
        }
    }

    private func processLocation(location: CLLocation, record: TagRecord, last: [String: Double]?, now: TimeInterval) {
        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let speed = max(0, location.speed) * 3.6
        let accuracy = location.horizontalAccuracy

        guard let last = last else {
            lastPositions[record.toolId] = ["lat": lat, "lng": lng, "event": 0, "ts": now]
            saveLastPositions()
            return
        }

        let lastLat = last["lat"] ?? 0
        let lastLng = last["lng"] ?? 0
        let lastEvent = Int(last["event"] ?? 0)
        let lastTime = last["ts"] ?? 0
        let dist = haversine(lat1: lat, lon1: lng, lat2: lastLat, lon2: lastLng)
        let timeSince = now - lastTime
        let threshold = max(MIN_DIST_M, accuracy * 2)

        let event: String
        let eventCode: Double

        if speed >= 10 {
            event = "speed"; eventCode = 1
        } else if dist > threshold {
            event = "movement"; eventCode = 2
        } else if timeSince > STOP_TIMEOUT && lastEvent != 3 {
            event = "stop"; eventCode = 3
        } else if timeSince > 3600 {
            event = "stop"; eventCode = 3
        } else {
            lastPositions[record.toolId] = ["lat": lat, "lng": lng, "event": last["event"] ?? 0, "ts": now]
            saveLastPositions()
            return
        }

        saveMovement(record: record, event: event, lat: lat, lng: lng, speed: speed)
        lastPositions[record.toolId] = ["lat": lat, "lng": lng, "event": eventCode, "ts": now]
        saveLastPositions()

        onTagDetected?([
            "tagId": "",
            "toolId": record.toolId,
            "toolName": record.toolName,
            "lat": lat,
            "lng": lng,
            "event": event
        ])
    }

    // MARK: - Supabase

    private func saveMovement(record: TagRecord, event: String, lat: Double, lng: Double, speed: Double) {
        guard !supabaseUrl.isEmpty, !supabaseKey.isEmpty else { return }
        DispatchQueue.global().async { [weak self] in
            guard let self = self else { return }
            var body: [String: Any] = [
                "tool_id": record.toolId,
                "contractor_id": record.contractorId,
                "event": event,
                "latitude": lat,
                "longitude": lng,
                "speed_kmh": speed,
                "platform": "ios"
            ]
            if !self.currentUserId.isEmpty {
                body["detected_by"] = self.currentUserId
            }
            self.post(path: "/rest/v1/tool_movements", body: body)

            let isoDate = ISO8601DateFormatter().string(from: Date())
            let locBody: [String: Any] = [
                "last_seen_location": ["latitude": lat, "longitude": lng, "timestamp": isoDate]
            ]
            self.patch(path: "/rest/v1/tools?id=eq.\(record.toolId)", body: locBody)
        }
    }

    private func post(path: String, body: [String: Any]) {
        guard let url = URL(string: supabaseUrl + path),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(supabaseKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = data
        URLSession.shared.dataTask(with: req) { _, response, error in
            if let error = error {
                print("[BleTracker] POST \(path) error: \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse, http.statusCode >= 300 {
                print("[BleTracker] POST \(path) status: \(http.statusCode)")
            }
        }.resume()
    }

    private func patch(path: String, body: [String: Any]) {
        guard let url = URL(string: supabaseUrl + path),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(supabaseKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = data
        URLSession.shared.dataTask(with: req) { _, response, error in
            if let error = error {
                print("[BleTracker] PATCH \(path) error: \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse, http.statusCode >= 300 {
                print("[BleTracker] PATCH \(path) status: \(http.statusCode)")
            }
        }.resume()
    }

    // MARK: - Persistence

    private func loadConfig() {
        supabaseUrl = prefs.string(forKey: KEY_SUPABASE_URL) ?? ""
        supabaseKey = prefs.string(forKey: KEY_SUPABASE_KEY) ?? ""
        currentUserId = prefs.string(forKey: KEY_CURRENT_USER_ID) ?? ""
        if let data = prefs.data(forKey: KEY_TAGS),
           let obj = try? JSONDecoder().decode([String: [String: String]].self, from: data) {
            trackedTags = obj.compactMapValues { d in
                guard let toolId = d["toolId"], let toolName = d["toolName"], let cId = d["contractorId"]
                else { return nil }
                return (toolId, toolName, cId)
            }
        }
    }

    // MARK: - Registry (crowd-source)

    private func loadCachedRegistry() {
        guard let data = prefs.data(forKey: KEY_REGISTRY),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        var next: [String: TagRecord] = [:]
        for item in arr {
            guard let key = item["ibeacon_id"] as? String, !key.isEmpty,
                  let toolId = item["tool_id"] as? String,
                  let toolName = item["tool_name"] as? String,
                  let cId = item["contractor_id"] as? String
            else { continue }
            next[key] = (toolId, toolName, cId)
        }
        registry = next
    }

    private func startRegistrySync() {
        registrySyncTimer?.invalidate()
        // First sync soon (10s), then every REGISTRY_SYNC_SEC.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.fetchRegistry() }
        registrySyncTimer = Timer.scheduledTimer(withTimeInterval: REGISTRY_SYNC_SEC, repeats: true) { [weak self] _ in
            self?.fetchRegistry()
        }
    }

    private func fetchRegistry() {
        guard !supabaseUrl.isEmpty, !supabaseKey.isEmpty,
              supabaseUrl.hasPrefix("https://"),
              let url = URL(string: supabaseUrl + "/rest/v1/rpc/bletracker_registry")
        else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(supabaseKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)
        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            guard let self = self else { return }
            if let error = error {
                print("[BleTracker] registry fetch error: \(error.localizedDescription)")
                return
            }
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return }
            var next: [String: TagRecord] = [:]
            for item in arr {
                guard let key = item["ibeacon_id"] as? String, !key.isEmpty,
                      let toolId = item["tool_id"] as? String,
                      let toolName = item["tool_name"] as? String,
                      let cId = item["contractor_id"] as? String
                else { continue }
                next[key] = (toolId, toolName, cId)
            }
            DispatchQueue.main.async { self.registry = next }
            self.prefs.set(data, forKey: KEY_REGISTRY)
            print("[BleTracker] Registry synced: \(next.count) tag(s)")
        }.resume()
    }

    private func saveTags() {
        let obj = trackedTags.mapValues { r in
            ["toolId": r.toolId, "toolName": r.toolName, "contractorId": r.contractorId]
        }
        if let data = try? JSONEncoder().encode(obj) {
            prefs.set(data, forKey: KEY_TAGS)
        }
    }

    private func loadLastPositions() {
        if let data = prefs.data(forKey: KEY_LAST_POSITIONS),
           let obj = try? JSONDecoder().decode([String: [String: Double]].self, from: data) {
            lastPositions = obj
        }
    }

    private func saveLastPositions() {
        if let data = try? JSONEncoder().encode(lastPositions) {
            prefs.set(data, forKey: KEY_LAST_POSITIONS)
        }
    }

    // MARK: - Utils

    private func haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let R = 6371000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat/2)*sin(dLat/2) + cos(lat1 * .pi/180)*cos(lat2 * .pi/180)*sin(dLon/2)*sin(dLon/2)
        return R * 2 * atan2(sqrt(a), sqrt(1-a))
    }
}
