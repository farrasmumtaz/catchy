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

## Deployment Vercel

`vercel.json` menjalankan service frontend Vite dan backend NestJS dalam satu domain.
`/api/` dan `/socket.io/` diarahkan ke backend; path lainnya ke frontend. Cookie tetap same-origin.
Socket.IO produksi memakai WebSocket langsung, dengan PostgreSQL adapter untuk menjangkau
pengguna pada instance berbeda. Rate limiter juga disimpan di PostgreSQL. Mode kamera saja
masih tersedia lewat `npm run build:preview`, tetapi tidak lagi menjadi build produksi.

`.env` utama berisi konfigurasi produksi dan tidak di-commit/diunggah. `backend/.env` tetap
memakai database pengembangan WSL. `vite.config.js` tidak membaca file env lokal backend.
Untuk menyimpan environment produksi ke proyek Vercel yang sudah ditautkan:

```powershell
node backend/scripts/sync-vercel-env.mjs
```

Variabel produksi: DATABASE_URL, DATABASE_REALTIME_URL, APP_ORIGIN, NODE_ENV=production,
HOST, PORT, DATABASE_SCHEMA=cathcy, DATABASE_SSL=true. Kedua URL dikirim lewat stdin sebagai Secret.
DATABASE_URL memakai transaction pooler Supabase port 6543 untuk query biasa.
DATABASE_REALTIME_URL memakai session pooler port 5432 untuk adapter Socket.IO LISTEN/NOTIFY.
TLS memakai CA publik Supabase dengan verifikasi sertifikat aktif. Schema `cathcy` tidak
diekspos ke Data API; RLS aktif tanpa policy publik. Backend mengakses tabel menggunakan
role database server, bukan publishable/service-role key browser.

Migrasi produksi dijalankan dari root, memakai `.env` utama:

```powershell
npm --prefix backend run build
node --env-file=.env backend/dist/migrate.js
```

Database publik adalah database terpisah: akun dan pesan WSL tidak disalin otomatis.
Daftarkan akun pada server publik. Panggilan publik tetap memerlukan Kamailio WSS dan TURN;
koneksi SIP localhost hanya berlaku untuk pengujian lokal.

Dokumentasi Vercel terbaru mendukung WebSocket pada Functions (Fluid Compute), tetapi
koneksi memiliki batas durasi dan state antar-instance perlu disinkronkan. Kamailio dan
TURN tetap membutuhkan host terpisah. Referensi:
https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections

Backend Vercel memakai `outputDirectory: "."` untuk menjaga cakupan package ESM,
menyertakan modul gateway dinamis melalui `includeFiles`, dan mengekspor HTTP server
agar upgrade WebSocket diteruskan. Fungsi ditempatkan di Singapura dengan maksimum dua
koneksi per pool per instance (satu koneksi session digunakan untuk LISTEN). Kapasitas session pooler tetap
perlu ditingkatkan sebelum menambah banyak instance/pengguna bersamaan.

Pemeriksaan produksi (membuat dua akun QA lalu membersihkan data miliknya):

```powershell
node --env-file=.env backend/scripts/smoke-production.mjs
```

## Mobile, keyboard, dan koneksi otomatis

Chat memakai Socket.IO pada origin aplikasi, dengan path `/socket.io/`. Login, daftar,
dan pemulihan sesi langsung membuka koneksi; pengguna tidak perlu mengisi URL chat.
Pada domain produksi saat ini URL transport-nya `wss://catchy-smoky.vercel.app/socket.io/`.
Ini terpisah dari endpoint SIP Kamailio. Domain dan WSS SIP publik belum disediakan.

Jika server SIP publik sudah tersedia, pasang build variables `VITE_SIP_WS_URL` dan
`VITE_SIP_DOMAIN` di Vercel lalu redeploy. Keduanya hanya alamat publik, bukan password.
Pengaturan panggilan akan mengisi alamat server dan username aplikasi sebagai saran;
pengguna tetap memasukkan kredensial SIP miliknya. Daftar aplikasi belum membuat akun
Kamailio, dan password aplikasi tidak disalin atau disimpan sebagai password SIP.
Vite tidak memuat root `.env`; untuk development, berikan kedua build variables lewat
environment proses sebelum menjalankan Vite.

Pada HP, pilih percakapan untuk membuka chat, dan gunakan tombol kembali untuk daftar.
Kolom pesan memakai textarea dengan keyboard teks bawaan: Enter untuk kirim, Shift+Enter
untuk baris baru, tanpa mengganggu komposisi IME. Tinggi aplikasi mengikuti visual viewport
dan safe area. Tombol mata tersedia pada kedua form password, lalu kembali tersembunyi
saat form dikirim atau dialog ditutup. Kode aplikasi tidak menyimpan password di storage browser.
