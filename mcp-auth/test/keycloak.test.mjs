import assert from "node:assert/strict";
import test from "node:test";

process.env.KEYCLOAK_INTROSPECTION_ENDPOINT = "http://keycloak.test/introspect";
process.env.OAUTH_CLIENT_ID = "test-client";
process.env.OAUTH_CLIENT_SECRET = "test-secret";
process.env.OAUTH_STRICT = "true";

const { createTokenVerifier } = await import("../dist/providers/keycloak.js");
const verifier = createTokenVerifier(new URL("https://resource.test/mcp"));

test("verifies an active token with the expected audience and scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, process.env.KEYCLOAK_INTROSPECTION_ENDPOINT);
    const params = new URLSearchParams(options.body);
    assert.equal(params.get("token"), "valid-token");
    assert.equal(params.get("client_id"), "test-client");
    assert.equal(params.get("client_secret"), "test-secret");
    return new Response(
      JSON.stringify({
        active: true,
        aud: "https://resource.test/mcp",
        client_id: "test-client",
        scope: "mcp:tools profile",
        exp: 1_900_000_000,
        sub: "user-1",
      }),
      { status: 200 },
    );
  };

  try {
    const result = await verifier.verifyAccessToken("valid-token");
    assert.equal(result.clientId, "test-client");
    assert.deepEqual(result.scopes, ["mcp:tools", "profile"]);
    assert.equal(result.resource, "https://resource.test/mcp");
    assert.equal(result.expiresAt, 1_900_000_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an inactive token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ active: false }), { status: 200 });

  try {
    await assert.rejects(verifier.verifyAccessToken("inactive-token"), {
      message: "Inactive token",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});