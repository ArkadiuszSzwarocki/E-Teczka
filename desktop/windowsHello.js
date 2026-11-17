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

async function checkWindowsHelloAvailability() {
  if (process.platform !== 'win32') return { available: false, status: 'UnsupportedPlatform' };
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
    return { available: status === 'Available', status };
  } catch {
    return { available: false, status: 'Error' };
  }
}

async function verifyWithWindowsHello(prompt = 'Odblokuj E-Teczkę') {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows Hello działa wyłącznie w systemie Windows.' };
  const safePrompt = String(prompt).replace(/'/g, "''").slice(0, 120);
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
    if (result === 'Verified') return { ok: true };
    return { ok: false, error: 'Weryfikacja Windows Hello nie została ukończona.' };
  } catch {
    return { ok: false, error: 'Nie udało się uruchomić Windows Hello.' };
  }
}

module.exports = { checkWindowsHelloAvailability, verifyWithWindowsHello };
