CREATE TABLE "BackupRun" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "destinationId" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  CONSTRAINT "BackupRun_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "BackupDestination" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BackupRun_destinationId_startedAt_idx" ON "BackupRun"("destinationId", "startedAt");
