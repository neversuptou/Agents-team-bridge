#!/bin/sh
# Выкладка хаба на 10.10.140.2: архив текущего коммита → ~/teambridge, TLS (один раз), сборка и запуск, cron бэкапа
set -e
HOST=admins@10.10.140.2
SSH="ssh -i $HOME/.ssh/amo_tg_server -o IdentitiesOnly=yes -o BatchMode=yes $HOST"
cd "$(dirname "$0")/.."
# код — заново (удалённые файлы не остаются), deploy/.env, deploy/tls и backups не трогаем
git archive --format=tar HEAD | $SSH "mkdir -p ~/teambridge && cd ~/teambridge && rm -rf hub cli scripts docs && tar xf - -C ~/teambridge"
$SSH 'cd ~/teambridge/deploy && if [ ! -f .env ]; then printf "TB_DB_PASSWORD=%s\nTB_SALT=%s\n" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env; chmod 600 .env; fi; sed -i "/^TB_INVITE_CODE=/d" .env'
$SSH 'sh ~/teambridge/deploy/tls.sh 10.10.140.2'
$SSH 'cd ~/teambridge/deploy && chmod +x backup.sh && docker compose up -d --build'
$SSH '(crontab -l 2>/dev/null | grep -v teambridge/deploy/backup.sh; echo "15 3 * * * $HOME/teambridge/deploy/backup.sh >> $HOME/teambridge/backups/backup.log 2>&1") | crontab -'
