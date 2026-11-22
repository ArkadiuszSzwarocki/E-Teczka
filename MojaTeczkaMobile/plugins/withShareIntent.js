const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const SHARE_MIME_TYPES = [
  'application/pdf',
  'image/*',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
];

module.exports = function withShareIntent(config) {
  config = withAndroidManifest(config, cfg => {
    const app = cfg.modResults.manifest.application?.[0];
    const mainActivity = app?.activity?.find(a => a.$?.['android:name'] === '.MainActivity') || app?.activity?.[0];
    if (mainActivity) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
      const alreadyExists = mainActivity['intent-filter'].some(f =>
        Array.isArray(f.action) && f.action.some(a => a.$?.['android:name'] === 'android.intent.action.SEND'),
      );
      if (!alreadyExists) {
        mainActivity['intent-filter'].push({
          action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: SHARE_MIME_TYPES.map(mime => ({ $: { 'android:mimeType': mime } })),
        });
      }
    }
    return cfg;
  });

  return withDangerousMod(config, ['android', async cfg => {
    const kotlinDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', 'pl', 'arecki', 'mojateczka');
    fs.mkdirSync(kotlinDir, { recursive: true });
    fs.copyFileSync(
      path.join(cfg.modRequest.projectRoot, 'plugins', 'share-intent', 'ShareIntentModule.kt'),
      path.join(kotlinDir, 'ShareIntentModule.kt'),
    );
    const mainApp = path.join(kotlinDir, 'MainApplication.kt');
    if (fs.existsSync(mainApp)) {
      let source = fs.readFileSync(mainApp, 'utf8');
      if (!source.includes('add(ShareIntentPackage())')) {
        source = source.replace('add(LocalTlsPackage())', 'add(LocalTlsPackage())\n              add(ShareIntentPackage())');
        fs.writeFileSync(mainApp, source);
      }
    }
    return cfg;
  }]);
};
