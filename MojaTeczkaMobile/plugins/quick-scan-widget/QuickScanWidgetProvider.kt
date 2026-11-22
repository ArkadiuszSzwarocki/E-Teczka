package pl.arecki.mojateczka

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/** Android Home Screen 1-Tap widget launching MojaTeczka straight into receipt or document scanning. */
class QuickScanWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (widgetId in appWidgetIds) {
      val views = RemoteViews(context.packageName, R.layout.widget_quick_scan)
      views.setOnClickPendingIntent(
        R.id.btn_scan_receipt,
        buildScanIntent(context, "mojateczka://scan?preset=receipt", 101),
      )
      views.setOnClickPendingIntent(
        R.id.btn_scan_document,
        buildScanIntent(context, "mojateczka://scan?preset=document", 102),
      )
      appWidgetManager.updateAppWidget(widgetId, views)
    }
  }

  private fun buildScanIntent(context: Context, uriString: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uriString)).apply {
      setPackage(context.packageName)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
