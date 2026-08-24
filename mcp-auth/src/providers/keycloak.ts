import { OAuthError, OAuthErrorCode, checkResourceAllowed } from "@modelcontextprotocol/server";
import type { OAuthTokenVerifier, OAuthMetadata } from "@modelcontextprotocol/server";

// Keycloak / OAuth configuration (demo-friendly defaults)
export const KEYCLOAK_ISSUER_URL =
  process.env.KEYCLOAK_ISSUER_URL ?? "http://localhost:8081/realms/mcp-demo";
export const KEYCLOAK_INTROSPECTION_ENDPOINT =
  process.env.KEYCLOAK_INTROSPECTION_ENDPOINT ??
  `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token/introspect`;
export const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? "mcp-server";
export const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? "mcp-server-secret";
export const REQUIRED_SCOPE = process.env.REQUIRED_SCOPE ?? "mcp:tools";
export const OAUTH_STRICT = (process.env.OAUTH_STRICT ?? "true").toLowerCase() === "true";

export const oauthMetadata: OAuthMetadata = {
  issuer: KEYCLOAK_ISSUER_URL,
  authorization_endpoint: `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/auth`,
  token_endpoint: `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
  introspection_endpoint: KEYCLOAK_INTROSPECTION_ENDPOINT,
  response_types_supported: ["code"],
};

export function createTokenVerifier(mcpServerUrl: URL): OAuthTokenVerifier {
  return {
    verifyAccessToken: async (token) => {
      // Keycloakのイントロスペクションでトークン検証
      const params = new URLSearchParams({token, client_id: OAUTH_CLIENT_ID});
      if (OAUTH_CLIENT_SECRET) params.set("client_secret", OAUTH_CLIENT_SECRET);
      const response = await fetch(KEYCLOAK_INTROSPECTION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      // 200 以外を返した場合は、トークンが無効または期限切れであると見なす
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new OAuthError(OAuthErrorCode.InvalidToken, `Invalid or expired token: ${text}`);
      }

      const data = (await response.json()) as {
        active?: boolean;
        client_id?: string;
        azp?: string;
        scope?: string;
        exp?: number;
        aud?: string | string[];
        sub?: string;
      };

      // トークンが無効または期限切れの場合
      if (!data.active) throw new OAuthError(OAuthErrorCode.InvalidToken, "Inactive token");

      // Audience (aud) クレームの検証
      if (OAUTH_STRICT) {
        // * audが存在しない場合は、リソースインジケーターが欠落している旨を返す
        if (!data.aud) throw new OAuthError(OAuthErrorCode.InvalidToken, "Resource indicator (aud) missing");
        const audiences = Array.isArray(data.aud) ? data.aud : [data.aud];
        const allowed = audiences.some((audience) =>
          checkResourceAllowed({ requestedResource: audience, configuredResource: mcpServerUrl }),
        );
        // * audが許可されているものと一致しない場合は、期待するAudienceと一致しない旨を返す
        if (!allowed) throw new OAuthError(OAuthErrorCode.InvalidToken, `Expected audience compatible with ${mcpServerUrl}, got: ${audiences.join(",")}`);
      }

      const authInfo = {
        token,
        clientId: data.client_id ?? data.azp ?? "unknown-client",
        scopes: data.scope ? data.scope.split(" ") : [],
        resource: mcpServerUrl.toString(),
        extra: { sub: data.sub },
      } as const;

      if (typeof data.exp === "number") return { ...authInfo, expiresAt: data.exp } as any;
      return authInfo as any;
    },
  };
}
