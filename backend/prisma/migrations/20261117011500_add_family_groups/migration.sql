CREATE TABLE IF NOT EXISTS "FamilyGroup" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "hostUserId" INTEGER NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "FamilyMember" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "groupId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL UNIQUE,
  "role" TEXT NOT NULL DEFAULT 'member',
  "status" TEXT NOT NULL DEFAULT 'active',
  "joinedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "FamilyMember_group_status_idx" ON "FamilyMember"("groupId", "status");

CREATE TABLE IF NOT EXISTS "FamilyInvite" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "groupId" INTEGER NOT NULL,
  "email" TEXT NOT NULL,
  "code" TEXT NOT NULL UNIQUE,
  "createdByUserId" INTEGER NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "acceptedAt" TEXT,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "FamilyInvite_email_idx" ON "FamilyInvite"("email");
