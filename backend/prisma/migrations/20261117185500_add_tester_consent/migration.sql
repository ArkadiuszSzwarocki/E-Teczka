CREATE TABLE IF NOT EXISTS "TesterConsent" (
  "userId" INTEGER NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "accepted" INTEGER NOT NULL,
  "storageMode" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "acceptedAt" TEXT NOT NULL
);
