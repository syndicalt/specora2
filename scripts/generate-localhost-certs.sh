#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/certs"
KEY_FILE="$CERT_DIR/localhost-key.pem"
CERT_FILE="$CERT_DIR/localhost-cert.pem"
CONFIG_FILE="$CERT_DIR/localhost-openssl.cnf"

mkdir -p "$CERT_DIR"

if [[ -f "$KEY_FILE" && -f "$CERT_FILE" ]]; then
  echo "Localhost HTTPS certificates already exist in $CERT_DIR"
  exit 0
fi

cat > "$CONFIG_FILE" <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -days 825 \
  -nodes \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -config "$CONFIG_FILE"

chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo "Created localhost HTTPS certificate:"
echo "  cert: $CERT_FILE"
echo "  key:  $KEY_FILE"
