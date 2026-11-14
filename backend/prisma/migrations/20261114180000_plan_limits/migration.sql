CREATE TABLE IF NOT EXISTS "PlanTrial" ("ownerKey" TEXT NOT NULL, "feature" TEXT NOT NULL, "startedAt" BIGINT NOT NULL, PRIMARY KEY ("ownerKey", "feature"));
CREATE TABLE IF NOT EXISTS "PlanUsage" ("ownerKey" TEXT NOT NULL, "feature" TEXT NOT NULL, "operationId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "usedAt" BIGINT NOT NULL, PRIMARY KEY ("ownerKey", "feature", "operationId"));
CREATE INDEX IF NOT EXISTS "PlanUsage_window_idx" ON "PlanUsage"("ownerKey", "feature", "usedAt");
CREATE TABLE IF NOT EXISTS "PlanPrinterClaim" ("ownerKey" TEXT NOT NULL, "jobId" TEXT NOT NULL, "draftId" TEXT NOT NULL, PRIMARY KEY ("ownerKey", "jobId"));
CREATE TABLE IF NOT EXISTS "PlanScanReceipt" ("ownerKey" TEXT NOT NULL, "draftId" TEXT NOT NULL, "documentId" INTEGER NOT NULL, "fingerprint" TEXT NOT NULL, PRIMARY KEY ("ownerKey", "draftId"));
CREATE TABLE IF NOT EXISTS "PlanTagOwner" ("ownerId" INTEGER NOT NULL, "tagId" INTEGER NOT NULL, PRIMARY KEY ("ownerId", "tagId"), FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE NO ACTION);
CREATE TABLE IF NOT EXISTS "PlanMeta" ("key" TEXT NOT NULL PRIMARY KEY);
