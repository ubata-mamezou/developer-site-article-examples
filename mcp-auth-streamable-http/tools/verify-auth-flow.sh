#!/usr/bin/env bash
set -euo pipefail

MCP_ENDPOINT="${MCP_ENDPOINT:-http://localhost:3020/mcp}"
KEYCLOAK_TOKEN_ENDPOINT="${KEYCLOAK_TOKEN_ENDPOINT:-http://localhost:8080/realms/mcp-demo/protocol/openid-connect/token}"
CLIENT_ID="${CLIENT_ID:-mcp-demo-client}"
CLIENT_SECRET="${CLIENT_SECRET:-mcp-demo-client-secret}"

echo "[verify] requesting access token from Keycloak"
TOKEN_RESPONSE="$(curl -sS -X POST "$KEYCLOAK_TOKEN_ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET")"

ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(!j.access_token){console.error(s);process.exit(2)}process.stdout.write(j.access_token);});")"

echo "[verify] calling tools/list"
TOOLS_LIST_RESPONSE="$(curl -sS -X POST "$MCP_ENDPOINT" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
printf '%s\n' "$TOOLS_LIST_RESPONSE"
TOOLS_LIST_JSON="$(printf '%s\n' "$TOOLS_LIST_RESPONSE" | sed -n 's/^data: //p' | tail -n 1)"
if [[ -z "$TOOLS_LIST_JSON" ]]; then
  TOOLS_LIST_JSON="$TOOLS_LIST_RESPONSE"
fi
printf '%s' "$TOOLS_LIST_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.error){console.error('[verify] tools/list failed:',j.error.message);process.exit(3)}});"

echo "[verify] calling tools/call sum_numbers"
TOOLS_CALL_RESPONSE="$(curl -sS -X POST "$MCP_ENDPOINT" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":4,"b":7}}}')"
printf '%s\n' "$TOOLS_CALL_RESPONSE"
TOOLS_CALL_JSON="$(printf '%s\n' "$TOOLS_CALL_RESPONSE" | sed -n 's/^data: //p' | tail -n 1)"
if [[ -z "$TOOLS_CALL_JSON" ]]; then
  TOOLS_CALL_JSON="$TOOLS_CALL_RESPONSE"
fi
printf '%s' "$TOOLS_CALL_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.error){console.error('[verify] tools/call failed:',j.error.message);process.exit(4)}});"

echo "[verify] auth flow succeeded"
