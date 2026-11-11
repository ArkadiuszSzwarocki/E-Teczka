ALTER TABLE "BackupDestination" ADD COLUMN "lastBackupAt" DATETIME;
ALTER TABLE "BackupDestination" ADD COLUMN "lastBackupStatus" TEXT;
ALTER TABLE "BackupDestination" ADD COLUMN "lastBackupError" TEXT;
