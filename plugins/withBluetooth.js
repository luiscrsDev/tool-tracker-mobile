const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Fix BLUETOOTH/BLUETOOTH_ADMIN permissions so they are visible on Android 12+.
 *
 * react-native-ble-plx injects maxSdkVersion="30" on these permissions, which
 * hides them from PackageManager on API 31+. AltBeacon's PermissionsInspector
 * then cannot find them and refuses to scan.
 *
 * Adding tools:remove="android:maxSdkVersion" at the app-manifest level (highest
 * priority in the merge) strips that attribute from the final merged manifest.
 */
module.exports = function withBluetoothLegacyPermissions(config) {
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

    return config;
  });
};
