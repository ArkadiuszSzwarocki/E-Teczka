const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withQuickScanWidget(config) {
  config = withAndroidManifest(config, cfg => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.receiver = app.receiver || [];
      const exists = app.receiver.some(r => r.$?.['android:name'] === '.QuickScanWidgetProvider');
      if (!exists) {
        app.receiver.push({
          $: {
            'android:name': '.QuickScanWidgetProvider',
            'android:exported': 'false',
            'android:label': 'MojaTeczka — Szybki skan',
          },
          'intent-filter': [
            { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
          ],
          'meta-data': [
            {
              $: {
                'android:name': 'android.appwidget.provider',
                'android:resource': '@xml/widget_quick_scan_info',
              },
            },
          ],
        });
      }
    }
    return cfg;
  });

  return withDangerousMod(config, ['android', async cfg => {
    const root = cfg.modRequest.platformProjectRoot;
    const srcDir = path.join(cfg.modRequest.projectRoot, 'plugins', 'quick-scan-widget');
    const kotlinDir = path.join(root, 'app', 'src', 'main', 'java', 'pl', 'arecki', 'mojateczka');
    const layoutDir = path.join(root, 'app', 'src', 'main', 'res', 'layout');
    const xmlDir = path.join(root, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(kotlinDir, { recursive: true });
    fs.mkdirSync(layoutDir, { recursive: true });
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, 'QuickScanWidgetProvider.kt'), path.join(kotlinDir, 'QuickScanWidgetProvider.kt'));
    fs.copyFileSync(path.join(srcDir, 'widget_quick_scan.xml'), path.join(layoutDir, 'widget_quick_scan.xml'));
    fs.copyFileSync(path.join(srcDir, 'widget_quick_scan_info.xml'), path.join(xmlDir, 'widget_quick_scan_info.xml'));
    return cfg;
  }]);
};
