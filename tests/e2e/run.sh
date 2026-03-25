#!/bin/bash
# Prisma E2E Integration Tests
# Usage: ./tests/e2e/run.sh [--quick]
#
# Prerequisites:
#   - prisma binary built (cargo build --release -p prisma-cli)
#   - curl available
#
# This script starts a server + client, verifies proxy traffic, then cleans up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRISMA="${REPO_ROOT}/target/release/prisma"
WORK_DIR=$(mktemp -d)
PASSED=0
FAILED=0
QUICK=${1:-""}

cleanup() {
  echo ""
  echo "=== Cleanup ==="
  [ -f "$WORK_DIR/server.pid" ] && kill "$(cat "$WORK_DIR/server.pid")" 2>/dev/null || true
  [ -f "$WORK_DIR/client.pid" ] && kill "$(cat "$WORK_DIR/client.pid")" 2>/dev/null || true
  sleep 1
  rm -rf "$WORK_DIR"
  echo ""
  echo "=== Results: $PASSED passed, $FAILED failed ==="
  [ "$FAILED" -eq 0 ] && exit 0 || exit 1
}
trap cleanup EXIT

pass() { echo "  PASS: $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  FAIL: $1"; FAILED=$((FAILED + 1)); }

# Check binary exists
if [ ! -f "$PRISMA" ]; then
  echo "Error: prisma binary not found at $PRISMA"
  echo "Build first: cargo build --release -p prisma-cli"
  exit 1
fi

echo "=== Prisma E2E Tests ==="
echo "Binary: $PRISMA"
echo "Work dir: $WORK_DIR"
echo ""

# Generate credentials
echo "--- Setup ---"
"$PRISMA" gen-key > "$WORK_DIR/credentials.txt"
CLIENT_ID=$(grep "client_id" "$WORK_DIR/credentials.txt" | awk '{print $2}')
AUTH_SECRET=$(grep "auth_secret" "$WORK_DIR/credentials.txt" | awk '{print $2}')
echo "Client ID: $CLIENT_ID"

# Generate TLS cert
"$PRISMA" gen-cert --output "$WORK_DIR" --cn localhost 2>/dev/null

# Create server config
cat > "$WORK_DIR/server.toml" <<EOF
listen_addr = "127.0.0.1:18443"
quic_listen_addr = "127.0.0.1:18443"

[tls]
cert_path = "$WORK_DIR/prisma-cert.pem"
key_path = "$WORK_DIR/prisma-key.pem"

[[authorized_clients]]
id = "$CLIENT_ID"
auth_secret = "$AUTH_SECRET"

[management_api]
enabled = true
listen_addr = "127.0.0.1:19090"
auth_token = "test-token-e2e"
EOF

# Create client config
cat > "$WORK_DIR/client.toml" <<EOF
server_addr = "127.0.0.1:18443"
transport = "tcp"
skip_cert_verify = true
socks5_listen_addr = "127.0.0.1:11080"
http_listen_addr = "127.0.0.1:18080"

[identity]
client_id = "$CLIENT_ID"
auth_secret = "$AUTH_SECRET"
EOF

# Start server
echo ""
echo "--- Starting server ---"
"$PRISMA" server -c "$WORK_DIR/server.toml" &
echo $! > "$WORK_DIR/server.pid"
sleep 2

# Start client
echo "--- Starting client ---"
"$PRISMA" client -c "$WORK_DIR/client.toml" &
echo $! > "$WORK_DIR/client.pid"
sleep 2

echo ""
echo "--- Tests ---"

# Test 1: Management API health
echo "[Test 1] Management API health check"
HEALTH=$(curl -sf -H "Authorization: Bearer test-token-e2e" "http://127.0.0.1:19090/api/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status"'; then
  pass "Health endpoint returns valid JSON"
else
  fail "Health endpoint unreachable or invalid response"
fi

# Test 2: SOCKS5 proxy (if not quick mode)
if [ "$QUICK" != "--quick" ]; then
  echo "[Test 2] SOCKS5 proxy connectivity"
  SOCKS_RESULT=$(curl -sf --socks5-hostname 127.0.0.1:11080 "http://httpbin.org/ip" --connect-timeout 10 2>/dev/null || echo "")
  if echo "$SOCKS_RESULT" | grep -q '"origin"'; then
    pass "SOCKS5 proxy works (httpbin.org responded)"
  else
    fail "SOCKS5 proxy failed or timed out"
  fi

  # Test 3: HTTP CONNECT proxy
  echo "[Test 3] HTTP CONNECT proxy connectivity"
  HTTP_RESULT=$(curl -sf --proxy http://127.0.0.1:18080 "http://httpbin.org/ip" --connect-timeout 10 2>/dev/null || echo "")
  if echo "$HTTP_RESULT" | grep -q '"origin"'; then
    pass "HTTP proxy works (httpbin.org responded)"
  else
    fail "HTTP proxy failed or timed out"
  fi
fi

# Test 4: Metrics endpoint
echo "[Test 4] Metrics endpoint"
METRICS=$(curl -sf -H "Authorization: Bearer test-token-e2e" "http://127.0.0.1:19090/api/metrics" 2>/dev/null || echo "")
if echo "$METRICS" | grep -q '"active_connections"'; then
  pass "Metrics endpoint returns valid data"
else
  fail "Metrics endpoint unreachable or invalid"
fi

# Test 5: Client list
echo "[Test 5] Client list endpoint"
CLIENTS=$(curl -sf -H "Authorization: Bearer test-token-e2e" "http://127.0.0.1:19090/api/clients" 2>/dev/null || echo "")
if echo "$CLIENTS" | grep -q "$CLIENT_ID"; then
  pass "Client list contains our test client"
else
  fail "Client list doesn't contain test client"
fi

# Test 6: Config endpoint
echo "[Test 6] Config endpoint"
CONFIG=$(curl -sf -H "Authorization: Bearer test-token-e2e" "http://127.0.0.1:19090/api/config" 2>/dev/null || echo "")
if echo "$CONFIG" | grep -q '"listen_addr"'; then
  pass "Config endpoint returns server configuration"
else
  fail "Config endpoint unreachable or invalid"
fi

echo ""
echo "=== All tests complete ==="
