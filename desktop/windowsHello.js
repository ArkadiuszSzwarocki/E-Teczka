'use strict';
const { spawn } = require('node:child_process');

function runWinRtPowerShell(script) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('UNSUPPORTED_OS'));
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve(stdout.trim());
      reject(new Error(stderr.trim() || `PowerShell exited with ${code}`));
    });
  });
}

function resolveSystemPreferences(customPrefs) {
  if (customPrefs) return customPrefs;
  try {
    return require('electron').systemPreferences || null;
  } catch {
    return null;
  }
}

async function checkWindowsHelloAvailability(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    const sysPrefs = resolveSystemPreferences(options.systemPreferences);
    try {
      const canTouchId = Boolean(sysPrefs && typeof sysPrefs.canPromptTouchID === 'function' && sysPrefs.canPromptTouchID());
      return {
        available: canTouchId,
        status: canTouchId ? 'TouchIDAvailable' : 'TouchIDUnavailable',
        provider: 'touch_id',
      };
    } catch {
      return { available: false, status: 'Error', provider: 'touch_id' };
    }
  }
  if (platform !== 'win32') return { available: false, status: 'UnsupportedPlatform', provider: 'none' };
  const script = `
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
    $type = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
    $op = $type::CheckAvailabilityAsync()
    $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @($op))
    $task.Wait()
    Write-Output $task.Result.ToString()
  `;
  try {
    const status = await runWinRtPowerShell(script);
    return { available: status === 'Available', status, provider: 'windows_hello' };
  } catch {
    return { available: false, status: 'Error', provider: 'windows_hello' };
  }
}

async function verifyWithWindowsHello(prompt = 'Odblokuj MojąTeczkę', options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    const sysPrefs = resolveSystemPreferences(options.systemPreferences);
    if (!sysPrefs || typeof sysPrefs.promptTouchID !== 'function' || (typeof sysPrefs.canPromptTouchID === 'function' && !sysPrefs.canPromptTouchID())) {
      return { ok: false, error: 'Touch ID jest niedostępne na tym komputerze Mac.', provider: 'touch_id' };
    }
    try {
      await sysPrefs.promptTouchID(String(prompt || 'Odblokuj MojąTeczkę').slice(0, 120));
      return { ok: true, provider: 'touch_id' };
    } catch {
      return { ok: false, error: 'Weryfikacja Touch ID nie została ukończona.', provider: 'touch_id' };
    }
  }
  if (platform !== 'win32') return { ok: false, error: 'Logowanie biometryczne jest obsługiwane w systemach Windows (Windows Hello) i macOS (Touch ID).' };
  const safePrompt = String(prompt).slice(0, 120).replace(/'/g, "''");
  const script = `
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
    $type = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
    $op = $type::RequestVerificationAsync('${safePrompt}')
    $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))
    $task.Wait()
    Write-Output $task.Result.ToString()
  `;
  try {
    const result = await runWinRtPowerShell(script);
    if (result === 'Verified') return { ok: true, provider: 'windows_hello' };
    return { ok: false, error: 'Weryfikacja Windows Hello nie została ukończona.', provider: 'windows_hello' };
  } catch {
    return { ok: false, error: 'Nie udało się uruchomić Windows Hello.', provider: 'windows_hello' };
  }
}

module.exports = { checkWindowsHelloAvailability, verifyWithWindowsHello };
