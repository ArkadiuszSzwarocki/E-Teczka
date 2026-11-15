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
exports.prepareScannedPdf = prepareScannedPdf;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const pdf_lib_1 = require("pdf-lib");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
/** Only for PDFs generated from scan images. A claim is accepted only after veraPDF validation. */
function prepareScannedPdf(source) {
    return __awaiter(this, void 0, void 0, function* () {
        const original = Buffer.from(source);
        const validator = process.env.ETECZKA_VERAPDF_DIR;
        const iccPath = process.env.ETECZKA_PDFA_ICC;
        if (!validator || !iccPath)
            return { bytes: original, pdfa: false, warning: 'Brak konfiguracji walidatora PDF/A; zapisano zwykły PDF.' };
        let dir;
        try {
            const pdf = yield pdf_lib_1.PDFDocument.load(original, { updateMetadata: false });
            const context = pdf.context;
            const identifier = (0, node_crypto_1.randomBytes)(16).toString('hex');
            context.trailerInfo.ID = context.obj([pdf_lib_1.PDFHexString.of(identifier), pdf_lib_1.PDFHexString.of(identifier)]);
            const metadata = context.register(context.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' }));
            pdf.catalog.set(pdf_lib_1.PDFName.of('Metadata'), metadata);
            const profile = yield promises_1.default.readFile(iccPath);
            const icc = context.register(context.flateStream(profile, { N: 3, Alternate: 'DeviceRGB' }));
            const intent = context.register(context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: pdf_lib_1.PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: icc }));
            pdf.catalog.set(pdf_lib_1.PDFName.of('OutputIntents'), context.obj([intent]));
            const bytes = Buffer.from(yield pdf.save({ useObjectStreams: false }));
            const root = process.env.ETECZKA_PDFA_TMP || node_os_1.default.tmpdir();
            yield promises_1.default.mkdir(root, { recursive: true });
            dir = yield promises_1.default.mkdtemp(node_path_1.default.join(root, 'eteczka-pdfa-'));
            const file = node_path_1.default.join(dir, 'scan.pdf');
            yield promises_1.default.writeFile(file, bytes);
            const { stdout } = yield run('java', ['--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED', '-cp', node_path_1.default.join(validator, 'bin', '*'), `-Dapp.repo=${node_path_1.default.join(validator, 'bin')}`, `-Dapp.home=${validator}`, `-Dbasedir=${validator}`, 'org.verapdf.apps.GreenfieldCliWrapper', '--format', 'xml', '-f', '2b', file], { timeout: 180000, maxBuffer: 10000000, windowsHide: true });
            if (!/isCompliant="true"/.test(stdout) || !/failedJobs="0"/.test(stdout))
                throw new Error('Walidacja PDF/A nie powiodła się.');
            return { bytes, pdfa: true };
        }
        catch (error) {
            console.error('[pdfa] Nie udało się potwierdzić zgodności:', error instanceof Error ? error.message : 'błąd walidacji');
            return { bytes: original, pdfa: false, warning: 'Nie udało się potwierdzić PDF/A; zapisano zwykły PDF.' };
        }
        finally {
            if (dir)
                yield promises_1.default.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    });
}
