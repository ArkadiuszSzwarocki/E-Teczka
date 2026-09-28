"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWiaPowerShell = void 0;
exports.getWiaDevices = getWiaDevices;
const child_process_1 = require("child_process");
const runWiaPowerShell = (script) => new Promise((resolve, reject) => {
    const child = (0, child_process_1.spawn)('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || 'Skaner WIA nie odpowiedział.')));
});
exports.runWiaPowerShell = runWiaPowerShell;
function getWiaDevices() {
    return __awaiter(this, void 0, void 0, function* () {
        const script = "$ErrorActionPreference = 'Stop'; $manager = New-Object -ComObject WIA.DeviceManager; $devices = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { [PSCustomObject]@{ id = $_.DeviceID; name = [string]$_.Properties.Item('Name').Value; manufacturer = try { [string]$_.Properties.Item('Manufacturer').Value } catch { '' } } }); $devices | ConvertTo-Json -Compress";
        const output = yield (0, exports.runWiaPowerShell)(script);
        if (!output)
            return [];
        const parsed = JSON.parse(output);
        return Array.isArray(parsed) ? parsed : [parsed];
    });
}
