#!/bin/sh
# Свой центр сертификации команды и сертификат хаба (один раз; ключи не покидают сервер)
set -e
HOST_IP="${1:-10.10.140.2}"
cd "$(dirname "$0")"
mkdir -p tls && chmod 700 tls && cd tls
if [ ! -f ca.crt ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -keyout ca.key -out ca.crt -days 3650 -subj "/CN=TeamBridge Evapps CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
fi
if [ ! -f server.crt ]; then
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$HOST_IP"
  printf "subjectAltName=IP:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" "$HOST_IP" > server.ext
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 -extfile server.ext
  rm -f server.csr server.ext
fi
chmod 600 ca.key server.key
echo "Отпечаток сертификата центра (передавайте вместе с приглашением):"
openssl x509 -noout -fingerprint -sha256 -in ca.crt
