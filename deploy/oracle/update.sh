#!/usr/bin/env bash
# Kodni yangilash: git pull -> bog'liqliklar -> botni qayta ishga tushirish.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
git pull --ff-only
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund
sudo systemctl restart ttpu-bot
sleep 8
sudo journalctl -u ttpu-bot -n 15 --no-pager
