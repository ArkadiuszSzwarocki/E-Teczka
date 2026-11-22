$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$envFile = Join-Path $backend '.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw 'Missing backend/.env file.'
}

$account = Read-Host 'Email address of the sending WP mailbox'
if ($account -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
  throw 'Invalid email address.'
}
$secret = Read-Host 'WP mail app password (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($plain) -or $plain.Contains("`r") -or $plain.Contains("`n")) {
    throw 'Password is empty or contains a line break.'
  }
  $quotedPassword = '"' + $plain.Replace([string][char]92, '\\').Replace('"', '\"') + '"'
  $lines = @(Get-Content -LiteralPath $envFile)
  $values = [ordered]@{
    MOJATECZKA_SMTP_HOST = 'smtp.wp.pl'
    MOJATECZKA_SMTP_PORT = '465'
    MOJATECZKA_SMTP_USER = $account
    MOJATECZKA_SMTP_PASSWORD = $quotedPassword
    MOJATECZKA_SMTP_FROM = $account
  }
  foreach ($name in $values.Keys) {
    $lines = @($lines | Where-Object { $_ -notmatch ('^\s*' + [regex]::Escape($name) + '\s*=') })
  }
  $lines += ''
  foreach ($name in $values.Keys) { $lines += "$name=$($values[$name])" }
  [System.IO.File]::WriteAllLines($envFile, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $plain = $null
  $secret.Dispose()
}

Push-Location $backend
try {
  node (Join-Path $PSScriptRoot 'desktop\verifyRecoveryMail.js')
  if ($LASTEXITCODE -ne 0) { throw 'SMTP verification failed.' }
} finally { Pop-Location }
