import os, sqlite3, base64, json, win32crypt, shutil
from Crypto.Cipher import AES

local_state_path = os.path.expanduser('~\\AppData\\Local\\Microsoft\\Edge\\User Data\\Local State')
cookies_db_path = os.path.expanduser('~\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Network\\Cookies')

with open(local_state_path, 'r', encoding='utf-8') as file:
    local_state = json.loads(file.read())

encrypted_key = base64.b64decode(local_state['os_crypt']['encrypted_key'])[5:]
decrypted_key = win32crypt.CryptUnprotectData(encrypted_key, None, None, None, 0)[1]

temp_db = 'temp_cookies_ig.sqlite'
shutil.copyfile(cookies_db_path, temp_db)

conn = sqlite3.connect(temp_db)
cursor = conn.cursor()
cursor.execute("SELECT host_key, path, is_secure, expires_utc, name, encrypted_value FROM cookies WHERE host_key LIKE '%instagram%'")

with open('ig_cookies.txt', 'w', encoding='utf-8') as f:
    f.write('# Netscape HTTP Cookie File\n\n')
    for host_key, path, is_secure, expires_utc, name, encrypted_value in cursor.fetchall():
        try:
            nonce = encrypted_value[3:15]
            cipher = AES.new(decrypted_key, AES.MODE_GCM, nonce)
            plaintext = cipher.decrypt_and_verify(encrypted_value[15:-16], encrypted_value[-16:])
            value = plaintext.decode()
            f.write(f"{host_key}\t{'TRUE' if host_key.startswith('.') else 'FALSE'}\t{path}\t{'TRUE' if is_secure else 'FALSE'}\t0\t{name}\t{value}\n")
        except Exception as e:
            pass

conn.close()
os.remove(temp_db)
print('Done!')
