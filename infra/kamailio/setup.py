#!/usr/bin/env python3
"""Interactive local-only setup. Run with sudo from the Ubuntu terminal."""
import datetime
import getpass
import hashlib
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys


def pgpass_escape(value):
    return value.replace('\\', '\\\\').replace(':', '\\:')


def ask_password(label):
    password = getpass.getpass(label)
    if not password or '\n' in password or '\r' in password:
        raise ValueError('Password harus diisi dalam satu baris.')
    return password


def query(sql, password):
    result = subprocess.run(
        ['psql', '-X', '-qAt', '-h', '127.0.0.1', '-U', 'cathcy_sip',
         '-d', 'cathcy_sip', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True,
        env={**os.environ, 'PGPASSWORD': password},
    )
    if result.returncode:
        # Do not echo a query that could contain credential hashes.
        raise RuntimeError('Akses database gagal. Periksa password, layanan PostgreSQL, dan tabel subscriber.')
    return result.stdout.strip()


def install_file(path, content, mode, owner):
    if path.exists():
        backup = path.with_name(path.name + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S%f'))
        shutil.copy2(path, backup)
        os.chown(backup, owner.pw_uid, owner.pw_gid)
        os.chmod(backup, mode)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    os.fchmod(fd, mode)
    os.fchown(fd, owner.pw_uid, owner.pw_gid)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write(content)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Jalankan dengan sudo python3 infra/kamailio/setup.py.')
    source = Path(__file__).with_name('cathcy.cfg')
    # Syntax validation before database or service configuration changes.
    subprocess.run(['kamailio', '-c', '-f', str(source)], check=True)
    service_user = pwd.getpwnam('kamailio')
    db_password = ask_password('Password DATABASE cathcy_sip yang sudah kamu buat: ')
    existing = query("SELECT username FROM subscriber WHERE domain='localhost' AND username IN ('1001','1002');", db_password).splitlines()
    statements = []
    for username in ('1001', '1002'):
        if username in existing:
            print(f'Akun {username}@localhost sudah ada; password tetap dipertahankan.')
            continue
        password = ask_password(f'Buat password SIP untuk akun {username}: ')
        if password != getpass.getpass('Ulangi password SIP: '):
            raise ValueError('Konfirmasi password berbeda. Belum ada akun baru yang disimpan.')
        ha1 = hashlib.md5(f'{username}:localhost:{password}'.encode()).hexdigest()
        ha1b = hashlib.md5(f'{username}@localhost:localhost:{password}'.encode()).hexdigest()
        statements.append(
            "INSERT INTO subscriber (username,domain,password,ha1,ha1b) "
            f"VALUES ('{username}','localhost','','{ha1}','{ha1b}');"
        )
    if statements:
        query('BEGIN;\n' + '\n'.join(statements) + '\nCOMMIT;', db_password)
    install_file(Path('/etc/kamailio/cathcy.pgpass'),
                 '127.0.0.1:5432:cathcy_sip:cathcy_sip:' + pgpass_escape(db_password) + '\n',
                 0o600, service_user)
    install_file(Path('/etc/kamailio/cathcy.cfg'), source.read_text(encoding='utf-8'), 0o640, service_user)
    install_file(Path('/etc/systemd/system/kamailio.service.d/cathcy.conf'),
                 '[Service]\nEnvironment="PGPASSFILE=/etc/kamailio/cathcy.pgpass"\n'
                 'ExecStart=\nExecStart=/usr/sbin/kamailio -P /run/kamailio/kamailio.pid '
                 '-f /etc/kamailio/cathcy.cfg -m 64 -M 8\n', 0o644, pwd.getpwnam('root'))
    print('Konfigurasi terpasang. Konfigurasi bawaan kamailio.cfg tetap tersedia.')
    print('Jalankan: sudo systemctl daemon-reload')
    print('Lalu: sudo systemctl restart kamailio')
    print('Periksa: systemctl is-active kamailio')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f'Setup berhenti: {error}', file=sys.stderr)
        sys.exit(1)
