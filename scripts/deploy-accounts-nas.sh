#!/bin/sh
set -eu
umask 077
base=$1
release_id=$2
expected_hash=$3
update_secrets=$4
case "$base" in /share/Container/eteczka-accounts) ;; *) echo 'Unexpected deployment path'; exit 1;; esac
case "$release_id" in *[!a-zA-Z0-9_-]*|'') echo 'Invalid release'; exit 1;; esac
archive="$base/incoming/$release_id.tar.gz"
release="$base/releases/$release_id"
config_changed=no
finish() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$config_changed" = 'yes' ] && [ -f "$base/shared/.env.nas.previous" ]; then
    cp "$base/shared/.env.nas.previous" "$base/shared/.env.nas"
    chmod 600 "$base/shared/.env.nas"
  fi
}
trap finish EXIT

# QNAP does not always include Container Station in the SSH PATH.
if ! command -v docker >/dev/null 2>&1; then
  for candidate in /share/*/.qpkg/container-station/bin/docker; do
    if [ -x "$candidate" ]; then PATH="$(dirname "$candidate"):$PATH"; export PATH; break; fi
  done
fi
command -v docker >/dev/null 2>&1 || { echo 'Docker not found. Check Container Station installation.'; exit 1; }
docker info >/dev/null 2>&1 || { echo 'No access to Docker. Run again with -Sudo, or use a NAS user with Docker access.'; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required.'; exit 1; }
docker network inspect proxy_shared >/dev/null
actual_hash=$(sha256sum "$archive" | cut -d ' ' -f 1)
[ "$actual_hash" = "$expected_hash" ] || { echo 'Archive checksum mismatch'; exit 1; }
[ ! -e "$release" ] || { echo 'Release directory already exists'; exit 1; }
mkdir -p "$release" "$base/shared"
tar -xzf "$archive" -C "$release"
chmod 600 "$release/.env.nas"
if [ ! -f "$base/shared/.env.nas" ] || [ "$update_secrets" = 'yes' ]; then
  # Preserve the existing privacy key when refreshing SMTP/DB credentials.
  if [ -f "$base/shared/.env.nas" ]; then
    old_key=$(grep '^CENTRAL_RATE_LIMIT_KEY=' "$base/shared/.env.nas" || true)
    if [ -n "$old_key" ]; then
      grep -v '^CENTRAL_RATE_LIMIT_KEY=' "$release/.env.nas" > "$release/.env.updated"
      printf '%s\n' "$old_key" >> "$release/.env.updated"
      mv "$release/.env.updated" "$release/.env.nas"
    fi
    old_signing_key=$(grep '^CENTRAL_ENTITLEMENT_PRIVATE_KEY=' "$base/shared/.env.nas" || true)
    if [ -n "$old_signing_key" ]; then
      grep -v '^CENTRAL_ENTITLEMENT_PRIVATE_KEY=' "$release/.env.nas" > "$release/.env.updated"
      printf '%s\n' "$old_signing_key" >> "$release/.env.updated"
      mv "$release/.env.updated" "$release/.env.nas"
    fi
    old_admin_key=$(grep '^CENTRAL_CATALOG_ADMIN_TOKEN=' "$base/shared/.env.nas" || true)
    if [ -n "$old_admin_key" ]; then
      grep -v '^CENTRAL_CATALOG_ADMIN_TOKEN=' "$release/.env.nas" > "$release/.env.updated"
      printf '%s\n' "$old_admin_key" >> "$release/.env.updated"
      mv "$release/.env.updated" "$release/.env.nas"
    fi
    cp "$base/shared/.env.nas" "$base/shared/.env.nas.previous"
    config_changed=yes
  fi
  cp "$release/.env.nas" "$base/shared/.env.nas"
fi
if ! grep -q '^CENTRAL_ENTITLEMENT_PRIVATE_KEY=' "$base/shared/.env.nas"; then
  if [ "$config_changed" != 'yes' ]; then
    cp "$base/shared/.env.nas" "$base/shared/.env.nas.previous"
    config_changed=yes
  fi
  grep '^CENTRAL_ENTITLEMENT_PRIVATE_KEY=' "$release/.env.nas" >> "$base/shared/.env.nas"
fi
chmod 600 "$base/shared/.env.nas"
if ! grep -q '^CENTRAL_CATALOG_ADMIN_TOKEN=' "$base/shared/.env.nas"; then
  if [ "$config_changed" != 'yes' ]; then
    cp "$base/shared/.env.nas" "$base/shared/.env.nas.previous"
    config_changed=yes
  fi
  grep '^CENTRAL_CATALOG_ADMIN_TOKEN=' "$release/.env.nas" >> "$base/shared/.env.nas"
fi
rm -f "$release/.env.nas"
ln -s "$base/shared/.env.nas" "$release/.env.nas"
cd "$release"
docker compose -p eteczka-accounts -f compose.nas.yml config --quiet
docker compose -p eteczka-accounts -f compose.nas.yml build --pull
docker compose -p eteczka-accounts -f compose.nas.yml run --rm --no-deps accounts node -e '
const {createDatabasePool}=require("./mariadb/database");
(async()=>{const pool=createDatabasePool();try{for(const table of ["accounts","identities","verifications","sessions","password_resets","google_challenges","sign_in_handoffs","auth_rate_limits"])await pool.query("SELECT * FROM `"+table+"` LIMIT 0");console.log("MariaDB: connection and required tables OK");}finally{await pool.end();}})().catch(e=>{console.error("Database check failed:",e.code||"CONFIG_ERROR");process.exitCode=1});'
docker compose -p eteczka-accounts -f compose.nas.yml up -d --no-build
count=0
while [ "$count" -lt 30 ]; do
  state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' eteczka-accounts)
  if [ "$state" = 'healthy' ]; then
    printf '%s\n' "$release" > "$base/current-release.txt"
    rm -f "$archive"
    echo 'SUCCESS: eteczka-accounts is healthy; no NAS port was published.'
    echo 'Nginx Proxy Manager: konto.arecki.pl -> http://eteczka-accounts:3001'
    exit 0
  fi
  count=$((count + 1))
  sleep 2
done
echo 'Container did not become healthy. Previous releases remain in releases/.'
docker compose -p eteczka-accounts -f compose.nas.yml ps
if [ -f "$base/current-release.txt" ]; then
  previous=$(cat "$base/current-release.txt")
  case "$previous" in
    "$base/releases/"*)
      if [ -f "$previous/compose.nas.yml" ] && [ "$previous" != "$release" ]; then
        echo 'Restoring the previous source release...'
        if [ "$config_changed" = 'yes' ] && [ -f "$base/shared/.env.nas.previous" ]; then
          cp "$base/shared/.env.nas.previous" "$base/shared/.env.nas"
        fi
        cd "$previous"
        docker compose -p eteczka-accounts -f compose.nas.yml build
        docker compose -p eteczka-accounts -f compose.nas.yml up -d --no-build
      fi
      ;;
  esac
fi
exit 1
