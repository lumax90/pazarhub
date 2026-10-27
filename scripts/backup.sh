#!/bin/sh
set -eu
trap 'exit 0' TERM INT
mkdir -p /backups
while true; do
  target="/backups/pazarhub-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump --format=custom --file="$target.partial"; then
    mv "$target.partial" "$target"
    printf 'Database backup completed: %s\n' "$target"
    find /backups -maxdepth 1 -type f -name 'pazarhub-*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-30}" -delete
  else
    rm -f "$target.partial"
    printf 'Database backup failed.\n' >&2
  fi
  sleep 86400 &
  wait $!
done
