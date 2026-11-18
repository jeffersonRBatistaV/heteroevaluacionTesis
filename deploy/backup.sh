#!/bin/sh
# Respaldo diario de la base SQLite (se conservan 30 días)
set -e
mkdir -p /opt/heteroevaluacion-backups
cd /opt/heteroevaluacion
/usr/bin/node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('data/app.db').exec(\"VACUUM INTO '/opt/heteroevaluacion-backups/app-$(date +%F).db'\")" 2>/dev/null || true
find /opt/heteroevaluacion-backups -name 'app-*.db' -mtime +30 -delete
