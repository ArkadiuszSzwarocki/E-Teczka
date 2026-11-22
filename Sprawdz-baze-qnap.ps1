param(
  [string]$Email = 'urszulaszwarocka@gmail.com',
  [string]$NasHost = '192.168.0.12',
  [string]$NasUser = 'Arecki',
  [string]$Container = 'eteczka-test'
)

$ErrorActionPreference = 'Stop'
$normalizedEmail = $Email.Trim().ToLower()
$keyPath = Join-Path $env:USERPROFILE '.ssh\id_ed25519_eteczka_qnap'

$nodeScript = @'
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
(async () => {
  const prisma = new PrismaClient();
  const targetEmail = '__EMAIL__';
  try {
    const dbFiles = fs.readdirSync('/app/backend/prisma/data').filter(f => f.endsWith('.db'));
    const user = await prisma.user.findUnique({
      where: { email: targetEmail },
      select: { id: true, email: true, name: true, createdAt: true }
    });
    if (!user) {
      console.log(JSON.stringify({ dbFiles, found: false, email: targetEmail }, null, 2));
      return;
    }
    const [folders, docsActive, docsArchived, docsDeleted, sessions, consent] = await Promise.all([
      prisma.folder.count({ where: { ownerId: user.id } }),
      prisma.document.count({ where: { folder: { ownerId: user.id }, isDeleted: false, isArchived: false } }),
      prisma.document.count({ where: { folder: { ownerId: user.id }, isDeleted: false, isArchived: true } }),
      prisma.document.count({ where: { folder: { ownerId: user.id }, isDeleted: true } }),
      prisma.authSession.count({ where: { userId: user.id } }),
      prisma.$queryRawUnsafe('SELECT storageMode, accepted, acceptedAt FROM TesterConsent WHERE userId = ?', user.id).catch(() => []),
    ]);
    console.log(JSON.stringify({ dbFiles, found: true, user, folders, docsActive, docsArchived, docsDeleted, sessions, consent }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})();
'@.Replace('__EMAIL__', $normalizedEmail)

$remoteCmd = "/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i $Container node"
if (Test-Path -LiteralPath $keyPath) {
  $nodeScript | & ssh -i $keyPath "$NasUser@$NasHost" $remoteCmd
} else {
  $nodeScript | & ssh "$NasUser@$NasHost" $remoteCmd
}
