import { spawn } from 'child_process';

export type WiaDevice = { id: string; name: string; manufacturer?: string };

export const runWiaPowerShell = (script: string) => new Promise<string>((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || 'Skaner WIA nie odpowiedział.')));
});

export async function getWiaDevices(): Promise<WiaDevice[]> {
  const script = "$ErrorActionPreference = 'Stop'; $manager = New-Object -ComObject WIA.DeviceManager; $devices = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { [PSCustomObject]@{ id = $_.DeviceID; name = [string]$_.Properties.Item('Name').Value; manufacturer = try { [string]$_.Properties.Item('Manufacturer').Value } catch { '' } } }); $devices | ConvertTo-Json -Compress";
  const output = await runWiaPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}
