"""Створює нову пару ключів для шифрування даних сайту.

Використання (лише якщо пароль втрачено або ключ треба замінити):
    python scripts/new_keys.py "тимчасовий пароль"
Пише pubkey.json і keyring.json у корінь репозиторію. Після коміту старі зашифровані файли
стануть нечитабельними, але наступне оновлення даних перезапише їх новим ключем (історія за 150 днів).
"""
import base64, json, os, sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
ITER = 600_000
b64 = lambda b: base64.b64encode(b).decode()


def main(pw: str) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    spki = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    pkcs8 = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    salt, iv = os.urandom(16), os.urandom(12)
    kek = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode())
    wrapped = AESGCM(kek).encrypt(iv, pkcs8, None)
    (ROOT / "pubkey.json").write_text(json.dumps({"v": 1, "alg": "RSA-OAEP-256", "spki": b64(spki)}, indent=1))
    (ROOT / "keyring.json").write_text(json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "wrapped": b64(wrapped)}, indent=1))
    print("ok")


if __name__ == "__main__":
    main(sys.argv[1])
