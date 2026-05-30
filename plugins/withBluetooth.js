const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

/**
 * Fix BLUETOOTH/BLUETOOTH_ADMIN permissions so they are visible on Android 12+,
 * disable Auto Backup on Android, and dedupe iOS Info.plist arrays so
 * re-running `expo prebuild` without --clean doesn't accumulate duplicate
 * UIBackgroundModes / UIRequiredDeviceCapabilities entries.
 *
 * react-native-ble-plx injects maxSdkVersion="30" on these permissions, which
 * hides them from PackageManager on API 31+. AltBeacon's PermissionsInspector
 * then cannot find them and refuses to scan.
 */
function withIosPlistDedupe(config) {
  return withInfoPlist(config, (config) => {
    const dedupeKeys = ['UIBackgroundModes', 'UIRequiredDeviceCapabilities'];
    for (const key of dedupeKeys) {
      const arr = config.modResults[key];
      if (Array.isArray(arr)) {
        config.modResults[key] = Array.from(new Set(arr));
      }
    }
    return config;
  });
}

function withBluetoothLegacyPermissions(config) {
  config = withIosPlistDedupe(config);
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const permissions = manifest.manifest['uses-permission'] || [];

    const targets = [
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
    ];

    for (const perm of permissions) {
      if (targets.includes(perm.$['android:name'])) {
        perm.$['tools:remove'] = 'android:maxSdkVersion';
      }
    }

    // Ensure the tools namespace is declared on the root manifest element
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Disable Auto Backup so encrypted-prefs masters + Supabase credentials
    // are not exfiltrated to the user's Google Drive backup.
    const application = manifest.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
      application.$['android:fullBackupContent'] = 'false';
      application.$['tools:replace'] =
        (application.$['tools:replace'] ? application.$['tools:replace'] + ',' : '') +
        'android:allowBackup';
    }

    return config;
  });
}

module.exports = withBluetoothLegacyPermissions;
