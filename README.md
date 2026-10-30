# Cathcy

Chat pribadi persisten melalui NestJS + PostgreSQL + Socket.IO, serta panggilan suara/video
melalui Kamailio + JsSIP + WebRTC. Frontend tetap JavaScript + Vite; belum dimigrasi ke React.

## Jalankan lokal

Node.js 24 dan PostgreSQL aktif dibutuhkan. Pada mesin ini database `cathcy_app` dan
`backend/.env` sudah disiapkan, terpisah dari database SIP.

```powershell
cd C:\Catchy
npm install
npm --prefix backend install
npm --prefix backend run build
npm --prefix backend run migrate
npm run api
```

Di terminal PowerShell kedua:

```powershell
cd C:\Catchy
npm run dev
```

Buka **http://127.0.0.1:5173/**. Gunakan origin yang sama dengan `APP_ORIGIN` dalam `.env`.
Vite meneruskan `/api` dan `/socket.io` ke API port 3001. Health check: `/api/health`.
Setelah perubahan TypeScript, build dan restart API. Untuk watch, jalankan `npx tsc --watch`
dari folder backend dan `npm run dev` backend pada terminal terpisah.

Untuk mesin Windows/WSL baru, `node backend/scripts/setup-local-db.mjs` membuat database aplikasi
baru dan `.env` berisi password acak. Tidak mengubah database SIP atau role yang sudah ada.
Untuk PostgreSQL lain, salin `backend/.env.example` ke `backend/.env` dan isi DATABASE_URL.
Jangan commit `.env`.

## Akun aplikasi dan akun SIP terpisah

1. Klik **Masuk / Daftar**, pilih **Daftar**, lalu buat username dan password 12–128 karakter.
2. Buat akun kedua di profil browser lain. Gunakan username aplikasi `1001` dan `1002` jika ingin
   cocok dengan akun SIP lokal. Akun SIP lama belum otomatis menjadi akun aplikasi.
3. Tambahkan username aplikasi teman, misalnya `1002`, lalu kirim pesan.
4. Untuk panggilan, buka **Pengaturan panggilan**: URL `ws://localhost:8080/ws`, domain `localhost`,
   username dan password SIP masing-masing; ICE kosong dahulu untuk pengujian satu laptop.
   Detail server: [infra/kamailio/README.md](infra/kamailio/README.md).
5. Username chat tujuan dipakai sebagai username SIP tujuan pada domain yang diisi di pengaturan.
   Daftar aplikasi belum otomatis membuat atau memverifikasi kepemilikan akun SIP.

Chat tidak membutuhkan registrasi SIP. Riwayat SIP MESSAGE lama di localStorage tidak dihapus
atau diunggah otomatis; chat baru tidak lagi menggunakan SIP MESSAGE.

## Penyimpanan dan sesi

- Database `cathcy_app`: `app_users`, `app_sessions`, `chat_messages`.
- Password aplikasi menggunakan scrypt dengan salt acak. Token sesi acak di-hash SHA-256 di server.
  Cookie HttpOnly, SameSite=Lax, berlaku 7 hari; Secure aktif dengan NODE_ENV=production.
  Password/token tidak disimpan ke localStorage.
- Refresh mengambil sesi dari cookie dan riwayat dari server. Logout mencabut sesi tersebut dan
  memutus socket-nya; sesi perangkat lain tetap berlaku.
- Pesan disimpan melalui HTTP API; notifikasi Socket.IO memperbarui pengirim dan penerima.
  Reconnect mengambil ulang percakapan aktif. Penerima offline mengambil pesan setelah masuk lagi.
- Pengirim yang offline harus mencoba kirim ulang; belum ada antrean offline persisten. ID pesan
  mencegah duplikasi untuk retry payload yang sama selama halaman masih terbuka.
- **Tersimpan** berarti sudah masuk database, bukan diterima/dibaca lawan bicara.
- Riwayat dipaginasi 50 pesan; daftar percakapan dibatasi 200 yang terbaru.
- Isi pesan memakai textContent; chat belum terenkripsi ujung ke ujung.
- Mutasi HTTP dan handshake socket memeriksa origin. Rate limiter berlaku per IP pada satu proses;
  perlukan storage limiter dan adapter Socket.IO bersama sebelum memakai beberapa instance.

## Verifikasi

```powershell
npm test
npm --prefix backend test
npm run build:all
```

Test backend memakai PostgreSQL nyata dari DATABASE_URL. Test membuat akun qa_ acak dan menghapus
hanya data miliknya; jalankan pada database pengembangan. Perilaku yang diperiksa: autentikasi,
cookie/sesi, origin, pengirim palsu, isolasi riwayat, notifikasi socket, idempotensi, paginasi,
penerima offline, logout, sesi kedaluwarsa dan persistensi setelah restart API.
Test frontend memock HTTP/SIP untuk memeriksa handler UI dan regresi tombol Terima.

Panggilan lokal sebelumnya dilaporkan berhasil oleh pengguna. Uji kembali audio/video di browser
setelah integrasi akun aplikasi. Media lintas jaringan dan deployment publik belum diverifikasi.

## Sebelum deployment

Belum ada deployment dilakukan. Konfigurasi Kamailio masih khusus localhost. Siapkan domain/realm
SIP publik beserta akun digest untuk realm tersebut, HTTPS/WSS, origin, STUN/TURN, firewall,
database persisten dengan backup, dan monitoring. Sajikan hasil dist melalui reverse proxy,
bukan Vite dev server. Proxy juga meneruskan /api dan /socket.io ke NestJS termasuk WebSocket
Upgrade. Gunakan NODE_ENV=production, APP_ORIGIN=https://domain-aplikasi, dan DATABASE_URL sebagai
secret server. Uji login/logout dan panggilan dua perangkat pada jaringan berbeda.
## Kamera

Klik **Periksa kamera** untuk preview lokal tanpa mikrofon. Pilih perangkat lalu klik
**Nyalakan preview** dan berikan izin kamera pada browser. **Matikan**, menutup dialog,
dan keluar halaman melepaskan stream preview. Preview ini tidak diunggah atau direkam.
Video call memakai kamera pilihan untuk panggilan keluar. Setelah video call tersambung,
pilihan kamera pada panel panggilan memakai replaceTrack dan mempertahankan status mute.
Gagal mengganti kamera tidak menghentikan kamera sebelumnya. Panggilan suara belum dapat
ditingkatkan menjadi video saat berlangsung.

## Preview publik Vercel

`vercel.json` menjalankan `npm run build:preview`. Mode ini hanya mengaktifkan tampilan dan
preview kamera lokal melalui HTTPS. Login/chat dan pengaturan panggilan dinonaktifkan secara
jelas karena PostgreSQL publik, Kamailio WSS, dan TURN belum disediakan. `npm run dev` serta
`npm run build` tetap memakai mode aplikasi lokal lengkap.

Tidak ada database/password lokal yang diunggah: `.vercelignore` mengecualikan backend,
infra, file env, dependency lokal, dan test dari paket frontend. Untuk mengaktifkan aplikasi
publik lengkap, siapkan database publik dan infrastruktur SIP/TURN dahulu, lalu konfigurasi
backend publik, origin/cookie, routing Socket.IO, dan sinkronisasi antar-instance sebelum
mengganti build preview dengan build aplikasi lengkap.

Dokumentasi Vercel terbaru mendukung WebSocket pada Functions (Fluid Compute), tetapi
koneksi memiliki batas durasi dan state antar-instance perlu disinkronkan. Kamailio dan
TURN tetap membutuhkan host terpisah. Referensi:
https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
