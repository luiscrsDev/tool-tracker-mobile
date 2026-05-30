package expo.modules.bletracker

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Centralized SharedPreferences access for the BLE tracker.
 *
 * Two stores:
 *   - regular: tracked tags, cached positions, offline queue (not sensitive)
 *   - secure : Supabase URL + API key (encrypted at rest)
 *
 * On first access of secure(), legacy values stored in the regular prefs are
 * migrated and then deleted from the plaintext store.
 */
internal object PrefsStore {
    private const val TAG = "BleTracker"

    const val PREFS_REGULAR = "ble_tracker_prefs"
    const val PREFS_SECURE = "ble_tracker_secure_prefs"

    const val KEY_TRACKED_TAGS = "tracked_tags"
    const val KEY_LAST_POSITIONS = "last_positions"
    const val KEY_PENDING_MOVEMENTS = "pending_movements"
    const val KEY_SUPABASE_URL = "supabase_url"
    const val KEY_SUPABASE_KEY = "supabase_key"

    @Volatile private var secureInstance: SharedPreferences? = null
    @Volatile private var migrationAttempted = false

    fun regular(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_REGULAR, Context.MODE_PRIVATE)

    @Synchronized
    fun secure(context: Context): SharedPreferences {
        val cached = secureInstance
        if (cached != null) return cached

        val app = context.applicationContext
        val resolved = try {
            val masterKey = MasterKey.Builder(app)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                app,
                PREFS_SECURE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            Log.e(TAG, "EncryptedSharedPreferences unavailable, falling back to plaintext: ${e.message}")
            // Last-resort fallback so the app does not crash on devices without
            // the AndroidKeystore (rare). Same file name so behavior is uniform.
            app.getSharedPreferences(PREFS_SECURE, Context.MODE_PRIVATE)
        }
        secureInstance = resolved
        maybeMigrateLegacy(app, resolved)
        return resolved
    }

    private fun maybeMigrateLegacy(app: Context, secure: SharedPreferences) {
        if (migrationAttempted) return
        migrationAttempted = true
        try {
            val legacy = app.getSharedPreferences(PREFS_REGULAR, Context.MODE_PRIVATE)
            val legacyUrl = legacy.getString(KEY_SUPABASE_URL, null)
            val legacyKey = legacy.getString(KEY_SUPABASE_KEY, null)
            if (legacyUrl.isNullOrEmpty() && legacyKey.isNullOrEmpty()) return

            val editorSecure = secure.edit()
            if (!legacyUrl.isNullOrEmpty() && secure.getString(KEY_SUPABASE_URL, "").isNullOrEmpty()) {
                editorSecure.putString(KEY_SUPABASE_URL, legacyUrl)
            }
            if (!legacyKey.isNullOrEmpty() && secure.getString(KEY_SUPABASE_KEY, "").isNullOrEmpty()) {
                editorSecure.putString(KEY_SUPABASE_KEY, legacyKey)
            }
            editorSecure.apply()
            legacy.edit()
                .remove(KEY_SUPABASE_URL)
                .remove(KEY_SUPABASE_KEY)
                .apply()
            Log.i(TAG, "Migrated Supabase credentials from plaintext to encrypted store")
        } catch (e: Exception) {
            Log.w(TAG, "Legacy prefs migration failed: ${e.message}")
        }
    }
}
