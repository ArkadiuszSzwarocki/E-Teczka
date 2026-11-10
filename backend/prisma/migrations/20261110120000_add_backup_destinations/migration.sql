CREATE TABLE "BackupDestination" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ownerKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "endpoint" TEXT,
  "encryptedCredentials" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BackupDestination_ownerKey_key" UNIQUE ("ownerKey")
);
