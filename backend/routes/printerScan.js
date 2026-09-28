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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrinterScanRouter = createPrinterScanRouter;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("../config/paths");
const folders_1 = require("../services/folders");
const wia_1 = require("../services/wia");
const errors_1 = require("../utils/errors");
function createPrinterScanRouter(prisma) {
    const router = express_1.default.Router();
    const jobs = new Map();
    let activeJobId = null;
    router.get('/devices', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            res.json(yield (0, wia_1.getWiaDevices)());
        }
        catch (error) {
            res.status(503).json({ error: (0, errors_1.errorMessage)(error, 'Nie udało się wykryć skanerów WIA.') });
        }
    }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const folderId = Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.folderId);
        const requestedDeviceId = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.deviceId) || '');
        if (!(yield (0, folders_1.isDocumentFolder)(prisma, folderId)))
            return res.status(400).json({ error: 'Wybierz podkartotekę docelową.' });
        if (activeJobId)
            return res.status(409).json({ error: 'Na komputerze trwa już inne skanowanie.' });
        let deviceNumber;
        try {
            deviceNumber = (yield (0, wia_1.getWiaDevices)()).findIndex(device => device.id === requestedDeviceId) + 1;
        }
        catch (error) {
            return res.status(503).json({ error: (0, errors_1.errorMessage)(error, 'Nie udało się odczytać skanerów.') });
        }
        if (!deviceNumber)
            return res.status(400).json({ error: 'Wybrany skaner nie jest już dostępny.' });
        const jobId = crypto_1.default.randomUUID();
        const job = { status: 'running', stage: 'Zlecenie odebrane przez komputer…', createdAt: Date.now() };
        jobs.set(jobId, job);
        activeJobId = jobId;
        res.status(202).json({ jobId });
        void runPrinterScan(job, deviceNumber).finally(() => { activeJobId = null; });
    }));
    router.get('/:jobId', (req, res) => {
        const job = jobs.get(req.params.jobId);
        if (!job)
            return res.status(404).json({ error: 'Zlecenie skanowania wygasło.' });
        res.json({ status: job.status, stage: job.stage, error: job.error, createdAt: job.createdAt });
    });
    router.get('/:jobId/file', (req, res) => {
        const job = jobs.get(req.params.jobId);
        if (!job || job.status !== 'completed' || !job.temporaryPath || !fs_1.default.existsSync(job.temporaryPath))
            return res.status(404).json({ error: 'Plik wersji roboczej nie jest dostępny.' });
        const temporaryPath = job.temporaryPath;
        res.type('jpeg').sendFile(temporaryPath, { dotfiles: 'allow' }, error => {
            var _a;
            if (error) {
                console.error('Nie udało się przekazać skanu do telefonu:', error);
                if (!res.headersSent)
                    res.status((_a = (0, errors_1.errorStatusCode)(error)) !== null && _a !== void 0 ? _a : 500).json({ error: 'Nie udało się przekazać skanu do telefonu.' });
                return;
            }
            if (fs_1.default.existsSync(temporaryPath))
                fs_1.default.unlinkSync(temporaryPath);
            jobs.delete(req.params.jobId);
        });
    });
    return router;
}
function runPrinterScan(job, deviceNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const temporaryPath = path_1.default.join(paths_1.scanDraftsDir, `scan_printer_${Date.now()}_${crypto_1.default.randomUUID()}.jpg`);
            const outputPath = temporaryPath.replace(/'/g, "''");
            const rawPath = path_1.default.join(paths_1.scanDraftsDir, `raw_${crypto_1.default.randomUUID()}.jpg`).replace(/'/g, "''");
            job.stage = 'Łączenie ze skanerem…';
            const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Drawing; $manager = New-Object -ComObject WIA.DeviceManager; $info = $manager.DeviceInfos.Item(${deviceNumber}); if ($info.Type -ne 1) { throw 'Wybrane urządzenie nie jest skanerem.' }; $device = $info.Connect(); $item = $device.Items.Item(1); $image = $item.Transfer('{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'); $image.SaveFile('${rawPath}'); $source = [System.Drawing.Image]::FromFile('${rawPath}'); try { $maxEdge = 2200; $scale = [Math]::Min(1.0, $maxEdge / [Math]::Max($source.Width, $source.Height)); $width = [Math]::Max(1, [int]($source.Width * $scale)); $height = [Math]::Max(1, [int]($source.Height * $scale)); $bitmap = New-Object System.Drawing.Bitmap($width, $height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality; $graphics.DrawImage($source, 0, 0, $width, $height); $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1); $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]68); $bitmap.Save('${outputPath}', $codec, $encoderParams); $encoderParams.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); } finally { $source.Dispose(); Remove-Item -LiteralPath '${rawPath}' -Force -ErrorAction SilentlyContinue }; Write-Output '${outputPath}'`;
            setTimeout(() => { if (job.status === 'running')
                job.stage = 'Skanowanie strony…'; }, 700);
            yield (0, wia_1.runWiaPowerShell)(script);
            if (!fs_1.default.existsSync(temporaryPath))
                throw new Error('Skaner nie zwrócił obrazu.');
            job.status = 'completed';
            job.stage = 'Skan gotowy do edycji.';
            job.temporaryPath = temporaryPath;
        }
        catch (error) {
            job.status = 'failed';
            job.stage = 'Skanowanie nie powiodło się.';
            job.error = (0, errors_1.errorMessage)(error, 'Nie udało się zeskanować dokumentu.');
        }
    });
}
