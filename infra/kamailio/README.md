# Kamailio lokal untuk Cathcy

Target: Ubuntu WSL, Kamailio 6.0.x, PostgreSQL, dua profil browser pada laptop yang sama.
Database `cathcy_sip` dan tabel `version`/`subscriber` harus sudah dibuat mengikuti langkah awal.

Jalankan di **terminal Ubuntu**, bukan PowerShell:

```bash
cd /mnt/c/Catchy
sudo python3 infra/kamailio/setup.py
sudo systemctl daemon-reload
sudo systemctl restart kamailio
systemctl is-active kamailio
sudo ss -ltnp 'sport = :8080'
```

Skrip meminta password database yang sudah ada, lalu password SIP baru untuk 1001 dan 1002.
Input password tersembunyi. Akun yang sudah ada dipertahankan. Password SIP disimpan sebagai
digest HA1 dalam database; digest ini tetap harus dianggap rahasia. Password database disimpan
di `/etc/kamailio/cathcy.pgpass` mode 0600 milik pengguna layanan `kamailio`, bukan dalam repo.
Skrip tidak memulai ulang layanan secara otomatis. Jangan jalankan dengan `python -m trace`
atau alat pencatat input. Backup dibuat jika file target sudah ada.

Konfigurasi layanan memakai `/etc/kamailio/cathcy.cfg` lewat systemd drop-in
`/etc/systemd/system/kamailio.service.d/cathcy.conf`; konfigurasi bawaan tidak ditimpa.
Registrasi berada di memori dan hilang saat Kamailio restart; akun SIP tetap di PostgreSQL.

Jika restart gagal:

```bash
sudo journalctl -u kamailio -n 60 --no-pager
```

## Hubungkan dua client

Jalankan `npm run dev` dari PowerShell di `C:\Catchy`. Pastikan port 5173 digunakan.
Buka `http://127.0.0.1:5173` di dua profil browser berbeda, lalu isi:

| Field | Profil pertama | Profil kedua |
| --- | --- | --- |
| WebSocket URL | `ws://localhost:8080/ws` | `ws://localhost:8080/ws` |
| Domain SIP | `localhost` | `localhost` |
| Username SIP | `1001` | `1002` |
| Password SIP | Password SIP 1001 | Password SIP 1002 |
| ICE servers | Kosong dahulu | Kosong dahulu |

Setelah kedua akun terdaftar, tambahkan tujuan `1002` pada client pertama dan `1001` pada client
kedua. Uji chat dua arah, lalu voice/video, penolakan, pembatalan, mute, dan menutup panggilan.
Sukses SIP atau berdering belum membuktikan media dua arah berhasil.

Listener terikat hanya ke loopback WSL. Origin dibatasi ke `http://127.0.0.1:5173` dan
`http://localhost:5173`. Jika localhost forwarding WSL tidak tersedia, koneksi Windows belum
bisa bekerja; jangan langsung membuka listener ke seluruh jaringan sebagai jalan pintas.
Pengujian perangkat lain memerlukan rancangan HTTPS/WSS, firewall dan STUN/TURN tersendiri.
RTPengine tidak digunakan pada konfigurasi browser-ke-browser ini.

## Kembali ke konfigurasi layanan sebelumnya

```bash
sudo mv /etc/systemd/system/kamailio.service.d/cathcy.conf /etc/systemd/system/kamailio.service.d/cathcy.conf.disabled
sudo systemctl daemon-reload
sudo systemctl restart kamailio
```

## Status validasi

- `kamailio -c` lulus pada Kamailio 6.0.5 terpasang.
- Pemasangan dengan password pengguna, restart, autentikasi dan media belum diverifikasi.

Referensi:
- https://www.kamailio.org/docs/modules/6.0.x/modules/websocket.html
- https://www.kamailio.org/docs/modules/6.0.x/modules/auth_db.html
- https://www.kamailio.org/docs/modules/6.0.x/modules/db_postgres.html
- https://www.postgresql.org/docs/current/libpq-pgpass.html
