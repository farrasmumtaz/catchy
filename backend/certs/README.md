# Supabase database CA

`supabase-ca.crt` adalah sertifikat CA publik, bukan private key atau credential.
Diambil melalui HTTPS dari:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Kode memakai CA ini dengan `rejectUnauthorized: true` saat DATABASE_SSL=true.
Koneksi telah diuji dengan verifikasi sertifikat dan hostname pada session pooler Supabase.
Referensi: https://supabase.com/docs/guides/platform/ssl-enforcement
