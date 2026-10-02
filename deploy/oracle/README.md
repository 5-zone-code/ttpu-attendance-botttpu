# Botni Oracle Cloud (Always Free) serverida ishga tushirish

Natija: bot 24/7 ishlaydi, kompyuteringiz o'chiq bo'lsa ham; manzil doimiy; Vercel kerak emas. Baza (Supabase) o'z joyida qoladi.

## 1. Server yaratish (Oracle konsoli)

1. **Compute → Instances → Create instance**
2. Image: **Ubuntu 22.04** (yoki 24.04). Shape: `VM.Standard.E2.1.Micro` (AMD, 1 GB, "Always Free") — bot uchun yetadi va "Out of capacity" xatosi kam chiqadi. `A1.Flex` (ARM) ham bo'ladi, lekin ko'pincha joy bo'lmaydi.
3. **Add SSH keys → Generate a key pair** → ikkala faylni (private va public) yuklab oling. Private kalitni yo'qotmang.
4. Create. Ishga tushgach **Public IP address** ni ko'chirib oling.
5. Instance sahifasi → **Subnet** → **Default Security List** → **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, protokol TCP, Destination port `80,443`. (Buni qilmasangiz sayt ochilmaydi.)
6. Tavsiya: **Networking → Reserved public IPs** orqali bepul IP biriktiring, shunda server qayta qurilsa ham manzil o'zgarmaydi.

## 2. Serverga kirish

Windows PowerShell:

```
ssh -i C:\Users\user\Downloads\ssh-key.key ubuntu@<PUBLIC_IP>
```

(Birinchi marta `yes` deng. Kalit fayli "too open" desa: `icacls <fayl> /inheritance:r /grant:r "%USERNAME%:R"`.)

## 3. Kodni olish

Serverda:

```
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/<GITHUB-NOM>/<REPO>.git ttpu-bot
cd ttpu-bot
```

Repo private bo'lsa, GitHub → Settings → Developer settings → Personal access tokens (Fine-grained, faqat shu repo, Contents: read) yarating va parol o'rniga shuni kiriting.

## 4. .env

```
cp .env.example .env
nano .env
```

Vercel'dagi qiymatlarning o'zini yozing: `BOT_TOKEN`, `SUPABASE_URL` (`https://qguhivnefidxlxowzuvw.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY`, `APP_SECRET`, `ADMIN_KEY`, `OWNER_ID`. Saqlash: Ctrl+O, Enter, Ctrl+X. `WEBAPP_URL`, `LOCAL_URL`, `PORT` ga tegmang — o'rnatuvchi o'zi yozadi.

## 5. O'rnatish

```
bash deploy/oracle/setup.sh
```

Oxirida `✅ Bot mahalliy ishga tushdi` chiqishi kerak. Keyin Telegramda botga `/start` yozing.

Muhim: bir vaqtning o'zida bitta joyda ishlasin. Vercel va noutbukdagi `npm run local` ni to'xtating (Telegram webhook faqat bitta manzilga ketadi; oxirgi o'rnatilgani ishlaydi).

## Foydali buyruqlar

| Nima | Buyruq |
|---|---|
| Loglarni ko'rish | `sudo journalctl -u ttpu-bot -f` |
| Qayta ishga tushirish | `sudo systemctl restart ttpu-bot` |
| Kodni yangilash (GitHub'dan) | `bash deploy/oracle/update.sh` |
| Holat | `systemctl status ttpu-bot caddy` |

## Muammolar

- **Sertifikat olinmayapti / sayt ochilmayapti**: 1-bosqichdagi 5-qadam (Ingress 80,443) bajarilganini tekshiring; `sudo journalctl -u caddy -n 50`.
- **`sslip.io` sertifikati rad etilsa** (Let's Encrypt bu domen uchun umumiy limit qo'yishi mumkin): DuckDNS.org'da bepul subdomen oling (masalan `ttpubot.duckdns.org` → server IP) va `DOMAIN=ttpubot.duckdns.org bash deploy/oracle/setup.sh` ni ishga tushiring.
- **Webhook o'rnatilmadi**: `BOT_TOKEN` ni tekshiring.
- **Oracle bo'sh serverni o'chirishi mumkin**: Always Free serverlar uzoq vaqt (taxminan 7 kun) deyarli ishlatilmasa, Oracle ularni to'xtatishi mumkin [taxminiy, qoidalar o'zgaradi]. Bot yengil bo'lgani uchun xavf bor. Himoya: akkauntni Pay As You Go ga o'tkazish (Always Free resurslar baribir bepul qoladi) yoki serverni vaqti-vaqti bilan tekshirib turish.
