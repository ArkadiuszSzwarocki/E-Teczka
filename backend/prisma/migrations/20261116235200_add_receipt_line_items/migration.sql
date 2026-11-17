ALTER TABLE "Document" ADD COLUMN "merchantName" TEXT;

CREATE TABLE IF NOT EXISTS "DocumentLineItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "documentId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" REAL NOT NULL DEFAULT 1,
  "totalCents" INTEGER NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'Inne',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentLineItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DocumentLineItem_documentId_idx" ON "DocumentLineItem"("documentId");
