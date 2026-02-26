import os
import sqlite3
import base64
import json
import win32crypt
from Crypto.Cipher import AES
import shutil

# Paths
local_state_path = os.path.expanduser('~\\AppData\\Local\\Microsoft\\Edge\\User Data\\Local State')
cookies_db_path = os.path.expanduser('~\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Network\\Cookies')

print(f"Reading Local State from: {local_state_path}")
print(f"Reading Cookies from: {cookies_db_path}")

try:
    with open(local_state_path, 'r', encoding='utf-8') as file:
        local_state = file.read()
        local_state = json.loads(local_state)
except Exception as e:
    print(f"Could not read local state: {e}")
    exit(1)

# Get Key
try:
    encrypted_key = base64.b64decode(local_state["os_crypt"]["encrypted_key"])
    encrypted_key = encrypted_key[5:]  # Remove DPAPI wrapper
    decrypted_key = win32crypt.CryptUnprotectData(encrypted_key, None, None, None, 0)[1]
except Exception as e:
    print(f"Could not decrypt DPAPI key! Are you running this directly on your user account? Error: {e}")
    exit(1)

# Copy DB to bypass lock
temp_db = "temp_cookies.sqlite"
shutil.copyfile(cookies_db_path, temp_db)

conn = sqlite3.connect(temp_db)
cursor = conn.cursor()
cursor.execute("SELECT host_key, path, is_secure, expires_utc, name, encrypted_value FROM cookies WHERE host_key LIKE '%youtube%'")

with open('clean_youtube_cookies.txt', 'w', encoding='utf-8') as f:
    f.write("# Netscape HTTP Cookie File\n")
    f.write("# This file was generated programmatically.\n\n")

    for host_key, path, is_secure, expires_utc, name, encrypted_value in cursor.fetchall():
        try:
            # Decrypt v10
            nonce = encrypted_value[3:15]
            cipher = AES.new(decrypted_key, AES.MODE_GCM, nonce)
            plaintext = cipher.decrypt_and_verify(
                encrypted_value[15:-16], encrypted_value[-16:])
            value = plaintext.decode()
            
            # Write to netscape
            f.write(f"{host_key}\t{'TRUE' if host_key.startswith('.') else 'FALSE'}\t{path}\t{'TRUE' if is_secure else 'FALSE'}\t0\t{name}\t{value}\n")
        except Exception as e:
            print(f"Failed to decrypt cookie {name}: {e}")

conn.close()
os.remove(temp_db)
print("Successfully wrote YouTube cookies to clean_youtube_cookies.txt")
