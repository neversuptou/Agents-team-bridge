#!/bin/sh
# Ежедневный бэкап базы хаба; хранятся 14 последних файлов
set -e
cd "$(dirname "$0")"
mkdir -p ../backups
docker compose exec -T postgres pg_dump -U tb tb | gzip > ../backups/tb-$(date +%F).sql.gz
ls -1t ../backups/tb-*.sql.gz | tail -n +15 | xargs -r rm --
