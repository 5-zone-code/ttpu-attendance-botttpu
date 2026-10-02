#!/usr/bin/env bash
# Oracle Cloud (Ubuntu) serverida botni doimiy ishga tushirish.
# Loyiha papkasidan ishga tushiring:   bash deploy/oracle/setup.sh
#
# Nima qiladi: Node 20 + Caddy (avtomatik HTTPS) o'rnatadi, 80/443 portlarni ochadi,
# botni systemd xizmati sifatida yoqadi (server qayta yonsa ham o'zi ishga tushadi).
# Qayta ishga tushirish xavfsiz (idempotent).
#
# Ixtiyoriy:  DOMAIN=bot.example.com bash deploy/oracle/setup.sh   (o'z domeningiz bo'lsa)
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_USER="$(id -un)"
PORT=3000

[ "$(id -u)" -eq 0 ] && { echo "root bilan emas, oddiy foydalanuvchi (ubuntu) bilan ishga tushiring."; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "❌ $APP_DIR/.env topilmadi. Avval: cp .env.example .env  va qiymatlarni yozing."; exit 1; }

echo "==> 1/6 Paketlar"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "==> 2/6 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> 3/6 Bog'liqliklar"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

echo "==> 4/6 Manzil"
if [ -n "${DOMAIN:-}" ]; then
  HOST="$DOMAIN"
else
  IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me)"
  [ -n "$IP" ] || { echo "❌ Ommaviy IP aniqlanmadi"; exit 1; }
  HOST="${IP//./-}.sslip.io"   # IP ga bog'langan bepul domen, ro'yxatdan o'tish shart emas
fi
echo "Bot manzili: https://$HOST"

# .env ga LOCAL_URL va PORT (eskilarini almashtiradi)
sed -i '/^LOCAL_URL=/d;/^PORT=/d;/^NO_TUNNEL=/d' .env
printf '\nLOCAL_URL=https://%s\nPORT=%s\n' "$HOST" "$PORT" >> .env
chmod 600 .env

echo "==> 5/6 Caddy (HTTPS) va xavfsizlik devori"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$HOST {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
sudo systemctl enable caddy
sudo systemctl restart caddy

# Oracle Ubuntu tasvirlarida iptables 80/443 ni to'sib qo'yadi — REJECT qoidasidan oldin ochamiz
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

echo "==> 6/6 Bot xizmati (systemd)"
sudo tee /etc/systemd/system/ttpu-bot.service >/dev/null <<EOF
[Unit]
Description=TTPU attendance bot
After=network-online.target caddy.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) local/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable ttpu-bot
sudo systemctl restart ttpu-bot

echo
echo "Kutilmoqda (HTTPS sertifikat olinishi 10-60 soniya)..."
sleep 20
sudo journalctl -u ttpu-bot -n 25 --no-pager || true
echo
echo "Tayyor. Loglar:   sudo journalctl -u ttpu-bot -f"
echo "Yangilash:        bash deploy/oracle/update.sh"
echo "Agar '✅ Bot mahalliy ishga tushdi' chiqmagan bo'lsa, loglarni yuqoridan qarang."
