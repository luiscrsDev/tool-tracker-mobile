import ExpoModulesCore

public class ExpoBleTrackerModule: Module {

    private var tracker: IBeaconTracker { IBeaconTracker.shared }

    public func definition() -> ModuleDefinition {
        Name("ExpoBleTracker")

        Events(
            "onDeviceFound",
            "onTagDetected",
            "onScanStateChange",
            "onPairResult",
            "onRingResult"
        )

        OnCreate {
            DispatchQueue.main.async {
                IBeaconTracker.shared.onTagDetected = { [weak self] data in
                    self?.sendEvent("onTagDetected", data)
                }
                IBeaconTracker.shared.onDeviceFound = { [weak self] data in
                    self?.sendEvent("onDeviceFound", data)
                }
                IBeaconTracker.shared.onScanStateChange = { [weak self] scanning in
                    self?.sendEvent("onScanStateChange", ["scanning": scanning])
                }
            }
        }

        // ─── Config ─────────────────────────────────────────────────────
        Function("configure") { (url: String, key: String) in
            self.tracker.configure(url: url, key: key)
        }

        // ─── Tag Management ─────────────────────────────────────────────
        Function("addTag") { (tagId: String, toolId: String, toolName: String, contractorId: String) in
            self.tracker.addTag(tagId: tagId, toolId: toolId, toolName: toolName, contractorId: contractorId)
        }

        Function("removeTag") { (tagId: String) in
            self.tracker.removeTag(tagId: tagId)
        }

        Function("clearTags") {
            self.tracker.clearTags()
        }

        // ─── Background Service ─────────────────────────────────────────
        Function("startService") { () -> Bool in
            self.tracker.startService()
            return true
        }

        Function("stopService") { () -> Bool in
            self.tracker.stopService()
            return true
        }

        Function("isRunning") { () -> Bool in
            self.tracker.isRunning()
        }

        Function("getTagCount") { () -> Int in
            self.tracker.tagCount()
        }

        Function("getServiceStatus") { () -> [String: Any] in
            [
                "isRunning": self.tracker.isRunning(),
                "tagCount": self.tracker.tagCount(),
                "lastScanTime": 0
            ]
        }

        // ─── Foreground Scan ─────────────────────────────────────────────
        Function("startForegroundScan") { () -> Bool in
            self.tracker.startForegroundScan()
            return true
        }

        Function("stopForegroundScan") { () -> Bool in
            self.tracker.stopForegroundScan()
            return true
        }

        // ─── Ring / Pair (not supported on iOS) ─────────────────────────
        AsyncFunction("ringTag") { (deviceId: String, command: String) -> Bool in
            self.sendEvent("onRingResult", [
                "success": false,
                "deviceId": deviceId,
                "message": "Ring not supported on iOS"
            ])
            return false
        }

        AsyncFunction("pairTag") { (deviceId: String, tagName: String) -> Bool in
            self.sendEvent("onPairResult", [
                "success": false,
                "deviceId": deviceId,
                "message": "Pair not supported on iOS"
            ])
            return false
        }
    }
}
