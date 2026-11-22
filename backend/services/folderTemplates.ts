import type { PrismaClient } from '@prisma/client';

export type FolderTemplateId = 'home' | 'business';

export type FolderTemplateNode = {
  name: string;
  children: string[];
};

export const FOLDER_TEMPLATES: Record<FolderTemplateId, { label: string; nodes: FolderTemplateNode[] }> = {
  home: {
    label: 'Dom i Rodzina',
    nodes: [
      { name: 'Auto', children: ['Polisy OC/AC', 'Serwis i przeglądy'] },
      { name: 'Zdrowie', children: ['Wyniki badań', 'Wizyty i recepty'] },
      { name: 'Rachunki', children: ['Prąd i gaz', 'Internet i telefon', 'Czynsz i media'] },
      { name: 'Gwarancje', children: ['Elektronika', 'AGD i dom'] },
      { name: 'Umowy', children: ['Bank i ubezpieczenia', 'Praca i inne'] },
    ],
  },
  business: {
    label: 'Firma JDG',
    nodes: [
      { name: 'KSeF Koszty', children: ['Faktury kosztowe', 'Paliwo i flota'] },
      { name: 'KSeF Sprzedaż', children: ['Faktury sprzedaży', 'Korekty'] },
      { name: 'ZUS i US', children: ['Deklaracje ZUS', 'Podatki PIT / VAT'] },
      { name: 'Umowy', children: ['Kontrahenci', 'Leasing i najem'] },
      { name: 'Środki trwałe', children: ['Sprzęt i oprogramowanie', 'Gwarancje firmowe'] },
    ],
  },
};

export function isFolderTemplateId(value: unknown): value is FolderTemplateId {
  return value === 'home' || value === 'business';
}

/** Creates a starter folder tree idempotently for the given owner inside one transaction. */
export async function applyFolderTemplate(
  prisma: PrismaClient,
  ownerId: number,
  templateId: FolderTemplateId,
): Promise<{ templateId: FolderTemplateId; createdCount: number }> {
  const template = FOLDER_TEMPLATES[templateId];
  let createdCount = 0;

  await prisma.$transaction(async tx => {
    const existing = await tx.folder.findMany({
      where: { ownerId },
      select: { id: true, name: true, parentId: true, order: true },
    });

    const rootByName = new Map<string, number>();
    let nextRootOrder = 0;
    for (const folder of existing) {
      if (folder.parentId === null) {
        rootByName.set(folder.name.trim().toLowerCase(), folder.id);
        nextRootOrder = Math.max(nextRootOrder, folder.order + 1);
      }
    }

    for (const node of template.nodes) {
      const rootKey = node.name.trim().toLowerCase();
      let rootId = rootByName.get(rootKey);
      if (!rootId) {
        const createdRoot = await tx.folder.create({
          data: { name: node.name, parentId: null, ownerId, order: nextRootOrder++ },
          select: { id: true },
        });
        rootId = createdRoot.id;
        rootByName.set(rootKey, rootId);
        createdCount++;
      }

      const existingChildren = existing.filter(f => f.parentId === rootId);
      const childNames = new Set(existingChildren.map(f => f.name.trim().toLowerCase()));
      let nextChildOrder = existingChildren.reduce((max, f) => Math.max(max, f.order + 1), 0);

      for (const childName of node.children) {
        const childKey = childName.trim().toLowerCase();
        if (childNames.has(childKey)) continue;
        await tx.folder.create({
          data: { name: childName, parentId: rootId, ownerId, order: nextChildOrder++ },
        });
        childNames.add(childKey);
        createdCount++;
      }
    }
  });

  return { templateId, createdCount };
}
