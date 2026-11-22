package pl.arecki.mojateczka

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream

/** Exposes Android ACTION_SEND Share Sheet payloads (PDF, images, JSON, XML, text/links) to React Native. */
class ShareIntentModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ShareIntentModule"

  @ReactMethod
  fun getInitialShare(promise: Promise) {
    try {
      val activity = reactContext.currentActivity
      val intent = activity?.intent
      if (intent == null || intent.action != Intent.ACTION_SEND) {
        promise.resolve(null)
        return
      }
      val map = Arguments.createMap()
      val mimeType = intent.type ?: "application/octet-stream"
      map.putString("mimeType", mimeType)
      intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { map.putString("subject", it) }
      intent.getStringExtra(Intent.EXTRA_TEXT)?.let { map.putString("text", it) }

      @Suppress("DEPRECATION")
      val streamUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      if (streamUri != null) {
        val copied = copyUriToCache(streamUri, mimeType)
        if (copied != null) {
          map.putString("uri", "file://${copied.absolutePath}")
          map.putString("fileName", copied.name)
        }
      }
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("SHARE_INTENT_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun clearShare(promise: Promise) {
    try {
      val activity = reactContext.currentActivity
      if (activity?.intent?.action == Intent.ACTION_SEND) {
        activity.intent = Intent(Intent.ACTION_MAIN)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  private fun copyUriToCache(uri: Uri, mimeType: String): File? {
    val resolver = reactContext.contentResolver
    var displayName = "shared_${System.currentTimeMillis()}"
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (idx >= 0) {
          val candidate = cursor.getString(idx)
          if (!candidate.isNullOrBlank()) displayName = candidate.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        }
      }
    }
    if (!displayName.contains('.')) {
      val ext = when {
        mimeType.contains("pdf") -> "pdf"
        mimeType.contains("png") -> "png"
        mimeType.contains("xml") -> "xml"
        mimeType.contains("json") -> "json"
        mimeType.startsWith("image/") -> "jpg"
        else -> "txt"
      }
      displayName = "$displayName.$ext"
    }
    val dest = File(reactContext.cacheDir, "shared_${System.currentTimeMillis()}_$displayName")
    resolver.openInputStream(uri)?.use { input ->
      FileOutputStream(dest).use { output -> input.copyTo(output) }
    } ?: return null
    return dest
  }
}

class ShareIntentPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ShareIntentModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
