import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

const run = promisify(execFile);
const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
export type ScanPdfResult = { bytes: Buffer; pdfa: boolean; warning?: string };

/** Only for PDFs generated from scan images. A claim is accepted only after veraPDF validation. */
export async function prepareScannedPdf(source: Uint8Array): Promise<ScanPdfResult> {
  const original = Buffer.from(source);
  const validator = process.env.MOJATECZKA_VERAPDF_DIR;
  const iccPath = process.env.MOJATECZKA_PDFA_ICC;
  if (!validator || !iccPath) return { bytes: original, pdfa: false, warning: 'Brak konfiguracji walidatora PDF/A; zapisano zwykły PDF.' };
  let dir: string | undefined;
  try {
    const pdf = await PDFDocument.load(original, { updateMetadata: false });
    const context = pdf.context; const identifier = randomBytes(16).toString('hex');
    context.trailerInfo.ID = context.obj([PDFHexString.of(identifier), PDFHexString.of(identifier)]);
    const metadata = context.register(context.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' }));
    pdf.catalog.set(PDFName.of('Metadata'), metadata);
    const profile = await fs.readFile(iccPath);
    const icc = context.register(context.flateStream(profile, { N: 3, Alternate: 'DeviceRGB' }));
    const intent = context.register(context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: icc }));
    pdf.catalog.set(PDFName.of('OutputIntents'), context.obj([intent]));
    const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
    const root = process.env.MOJATECZKA_PDFA_TMP || os.tmpdir(); await fs.mkdir(root, { recursive: true });
    dir = await fs.mkdtemp(path.join(root, 'mojateczka-pdfa-')); const file = path.join(dir, 'scan.pdf'); await fs.writeFile(file, bytes);
    const { stdout } = await run('java', ['--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED', '-cp', path.join(validator, 'bin', '*'), `-Dapp.repo=${path.join(validator, 'bin')}`, `-Dapp.home=${validator}`, `-Dbasedir=${validator}`, 'org.verapdf.apps.GreenfieldCliWrapper', '--format', 'xml', '-f', '2b', file], { timeout: 180_000, maxBuffer: 10_000_000, windowsHide: true });
    if (!/isCompliant="true"/.test(stdout) || !/failedJobs="0"/.test(stdout)) throw new Error('Walidacja PDF/A nie powiodła się.');
    return { bytes, pdfa: true };
  } catch (error) {
    console.error('[pdfa] Nie udało się potwierdzić zgodności:', error instanceof Error ? error.message : 'błąd walidacji');
    return { bytes: original, pdfa: false, warning: 'Nie udało się potwierdzić PDF/A; zapisano zwykły PDF.' };
  } finally { if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}
