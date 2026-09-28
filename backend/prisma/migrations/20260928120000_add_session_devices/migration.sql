-- Track the device which owns an authentication session for plan limits.
ALTER TABLE "AuthSession" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "AuthSession" ADD COLUMN "deviceName" TEXT;
