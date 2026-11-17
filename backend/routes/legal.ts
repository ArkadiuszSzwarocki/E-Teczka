import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

export type LegalDocId = 'privacy' | 'terms' | 'consents' | 'storage';

const DOCS: Array<{ id: LegalDocId; title: string; filename: string }> = [
  { id: 'privacy', title: 'Polityka prywatności', filename: 'POLITYKA-PRYWATNOSCI.md' },
  { id: 'terms', title: 'Regulamin aplikacji', filename: 'REGULAMIN-APLIKACJI.md' },
  { id: 'consents', title: 'Zgody użytkownika', filename: 'ZGODY-UZYTKOWNIKA.md' },
  { id: 'storage', title: 'Bazy i przechowywanie danych', filename: 'ARCHITEKTURA-DANYCH-I-BAZY.md' },
];

function resolveDocsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../docs'),
    path.resolve(__dirname, '../docs'),
    path.resolve(process.cwd(), '../docs'),
    path.resolve(process.cwd(), 'docs'),
  ];
  return candidates.find(dir => fs.existsSync(dir)) ?? candidates[0];
}

/** Public endpoint serving legal & architecture documents from /docs. */
export function createLegalRouter() {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const docsDir = resolveDocsDir();
    const items = DOCS.map(doc => {
      const filePath = path.join(docsDir, doc.filename);
      let content = 'Dokument nie jest obecnie dostępny.';
      try {
        if (fs.existsSync(filePath)) content = fs.readFileSync(filePath, 'utf8');
      } catch { /* keep fallback */ }
      return { id: doc.id, title: doc.title, content };
    });
    res.json({ documents: items });
  });

  return router;
}
