CREATE TABLE "SyncOperation" (
    "ownerKey" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("ownerKey", "operationId")
);

CREATE INDEX "SyncOperation_createdAt_idx" ON "SyncOperation"("createdAt");
