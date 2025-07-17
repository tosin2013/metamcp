import express from "express";

const oauthMetadataRouter = express.Router();

// Add JSON parsing middleware for POST endpoints
oauthMetadataRouter.use(express.json());

/**
 * Helper function to get the correct base URL from request
 * Prioritizes APP_URL environment variable, then checks proxy headers
 */
function getBaseUrl(req: express.Request): string {
  // Prioritize APP_URL environment variable
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }

  // Check for forwarded headers from Next.js proxy
  const forwardedHost = req.headers["x-forwarded-host"] as string;
  const forwardedProto = req.headers["x-forwarded-proto"] as string;

  if (forwardedHost) {
    const protocol = forwardedProto || "http";
    return `${protocol}://${forwardedHost}`;
  }

  // Fallback to request host
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * OAuth 2.0 Protected Resource Metadata endpoint
 * Implementation follows RFC 9728 and MCP OAuth specification
 * https://datatracker.ietf.org/doc/rfc9728/
 * https://modelcontextprotocol.io/specification/draft/basic/authorization
 */
oauthMetadataRouter.get(
  "/.well-known/oauth-protected-resource",
  async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);

      // For MCP implementation, we point to our better-auth OAuth server
      // The authorization server is hosted at the same base URL
      const authServerUrl = baseUrl;

      const metadata = {
        // Resource identifier - the protected resource's canonical URI
        resource: baseUrl,

        // List of OAuth authorization server issuer identifiers
        // Point to our better-auth authorization server
        authorization_servers: [authServerUrl],

        // Supported bearer token methods (required by RFC 9728)
        bearer_methods_supported: ["header"],

        // OAuth scopes supported by this protected resource
        // MCP requires admin scope for full access
        scopes_supported: [
          "admin", // Administrative access to all MCP resources
        ],

        // Resource name for display purposes
        resource_name: "MetaMCP Protected Resource",

        // Documentation URL for this resource
        resource_documentation: `${baseUrl}/docs`,

        // OAuth 2.0 DPoP support (disabled for now)
        dpop_bound_access_tokens_required: false,

        // Authorization details types supported (for fine-grained access)
        authorization_details_types_supported: ["mcp_endpoint_access"],

        // Resource server capabilities
        resource_server_capabilities: {
          // Supported token formats
          token_types_supported: ["Bearer"],

          // Token introspection support (proxied through frontend)
          introspection_endpoint: `${baseUrl}/oauth/introspect`,

          // Revocation support (proxied through frontend)
          revocation_endpoint: `${baseUrl}/oauth/revoke`,
        },
      };

      res.set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        "Access-Control-Allow-Origin": "*", // Allow CORS for discovery
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
      });

      return res.json(metadata);
    } catch (error) {
      console.error(
        "Error generating OAuth protected resource metadata:",
        error,
      );
      return res.status(500).json({
        error: "internal_server_error",
        error_description: "Failed to generate OAuth metadata",
      });
    }
  },
);

/**
 * OAuth 2.0 Authorization Server Metadata endpoint
 * This provides discovery information for MCP-compatible OAuth endpoints
 * Implementation follows RFC 8414 for OAuth 2.0 Authorization Server Metadata
 */
oauthMetadataRouter.get(
  "/.well-known/oauth-authorization-server",
  async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);

      const metadata = {
        // Issuer identifier (required by RFC 8414)
        issuer: baseUrl,

        // MCP-compatible OAuth endpoints (proxied through frontend)
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,

        // User info endpoint
        userinfo_endpoint: `${baseUrl}/oauth/userinfo`,

        // Supported grant types for MCP
        grant_types_supported: ["authorization_code", "client_credentials"],

        // Supported response types (required by RFC 8414)
        response_types_supported: ["code"],

        // Supported scopes for MCP
        scopes_supported: ["admin"],

        // Code challenge methods - PKCE is required for MCP (required by RFC 8414)
        code_challenge_methods_supported: ["S256"],

        // Authentication methods
        token_endpoint_auth_methods_supported: [
          "none", // For public clients with PKCE
          "client_secret_post",
          "client_secret_basic",
        ],

        // PKCE is required for all clients per MCP spec
        require_proof_key_for_code_exchange: true,

        // Additional metadata for compatibility
        authorization_response_iss_parameter_supported: false,

        // Service documentation
        service_documentation: `${baseUrl}/docs/oauth`,
      };

      res.set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        "Access-Control-Allow-Origin": "*", // Allow CORS for discovery
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
      });

      return res.json(metadata);
    } catch (error) {
      console.error(
        "Error generating OAuth authorization server metadata:",
        error,
      );
      return res.status(500).json({
        error: "server_error",
        error_description: "Failed to generate authorization server metadata",
      });
    }
  },
);

/**
 * OAuth 2.0 Authorization Endpoint
 * Handles authorization requests from MCP clients
 */
oauthMetadataRouter.get("/oauth/authorize", async (req, res) => {
  try {
    const {
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query;

    console.log("OAuth authorize request:", {
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge_method,
    });

    // Validate required parameters
    if (response_type !== "code") {
      return res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      });
    }

    if (!client_id || !redirect_uri) {
      return res.status(400).json({
        error: "invalid_request",
        error_description:
          "Missing required parameters: client_id or redirect_uri",
      });
    }

    // For MCP clients, we'll redirect to the frontend login page and then back to the client
    const baseUrl = getBaseUrl(req);
    const authUrl = new URL("/en/login", baseUrl); // Use frontend login page with default locale

    // Store OAuth parameters in session/state for later use
    // For now, we'll encode them in the callbackURL
    const oauthParams = {
      client_id,
      redirect_uri,
      scope: scope || "admin",
      state,
      code_challenge,
      code_challenge_method,
    };

    const encodedParams = Buffer.from(JSON.stringify(oauthParams)).toString(
      "base64url",
    );
    authUrl.searchParams.set(
      "callbackUrl",
      `/metamcp/oauth/callback?params=${encodedParams}`,
    );

    // Redirect to frontend login page
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error("Error in OAuth authorize endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

// Store for authorization codes (in production, use a database or Redis)
const authorizationCodes = new Map<
  string,
  {
    client_id: string;
    redirect_uri: string;
    scope: string;
    user_id: string;
    code_challenge?: string;
    code_challenge_method?: string;
    expires_at: number;
  }
>();

/**
 * OAuth 2.0 Token Endpoint
 * Handles token exchange requests from MCP clients
 * Implements proper PKCE verification and code validation
 */
oauthMetadataRouter.post("/oauth/token", async (req, res) => {
  try {
    const { grant_type, code, redirect_uri, client_id, code_verifier } =
      req.body;

    console.log("OAuth token request:", {
      grant_type,
      code,
      redirect_uri,
      client_id,
    });

    // Validate grant type
    if (grant_type !== "authorization_code") {
      return res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Only 'authorization_code' grant type is supported",
      });
    }

    // Validate authorization code
    if (!code) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing authorization code",
      });
    }

    // Look up the authorization code
    const codeData = authorizationCodes.get(code);
    if (!codeData) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      });
    }

    // Check if code has expired (10 minutes)
    if (Date.now() > codeData.expires_at) {
      authorizationCodes.delete(code);
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Authorization code has expired",
      });
    }

    // Validate client_id and redirect_uri match the original request
    if (codeData.client_id !== client_id) {
      return res.status(400).json({
        error: "invalid_client",
        error_description: "Client ID does not match",
      });
    }

    if (codeData.redirect_uri !== redirect_uri) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Redirect URI does not match",
      });
    }

    // Verify PKCE if code_challenge was provided
    if (codeData.code_challenge) {
      if (!code_verifier) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "PKCE code verifier is required",
        });
      }

      // Verify code challenge (assuming S256 method)
      if (codeData.code_challenge_method === "S256") {
        const crypto = await import("crypto");
        const hash = crypto.createHash("sha256").update(code_verifier).digest();
        const challengeFromVerifier = hash.toString("base64url");

        if (challengeFromVerifier !== codeData.code_challenge) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed",
          });
        }
      }
    }

    // Code is valid, delete it (authorization codes are single-use)
    authorizationCodes.delete(code);

    // Generate access token
    const accessToken = `mcp_token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresIn = 3600; // 1 hour

    // Store access token data
    accessTokens.set(accessToken, {
      user_id: codeData.user_id,
      scope: codeData.scope,
      expires_at: Date.now() + expiresIn * 1000,
    });

    console.log("OAuth token issued for user:", codeData.user_id);

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: codeData.scope,
    });
  } catch (error) {
    console.error("Error in OAuth token endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Callback Handler
 * Handles the callback from frontend login and redirects back to the OAuth client
 * Verifies user authentication before issuing authorization code
 */
oauthMetadataRouter.get("/oauth/callback", async (req, res) => {
  try {
    let oauthParams: any;

    // Check if we have encoded params (from our internal redirect flow)
    const { params } = req.query;

    if (params) {
      // Decode OAuth parameters from our internal flow
      oauthParams = JSON.parse(
        Buffer.from(params as string, "base64url").toString(),
      );
    } else {
      // Handle direct callback with individual query parameters
      // This is likely from an external OAuth flow or direct URL access
      const { code, state } = req.query;

      if (!code) {
        return res.status(400).send("Missing authorization code");
      }

      // If we receive a code directly, look up the code data to get the original parameters
      const codeData = authorizationCodes.get(code as string);
      if (codeData) {
        // Check if code has expired
        if (Date.now() > codeData.expires_at) {
          authorizationCodes.delete(code as string);
          return res.status(400).send("Authorization code has expired");
        }

        // Check if the redirect_uri points back to our own callback endpoint
        // This would create an infinite loop, so we need to handle it differently
        const baseUrl = getBaseUrl(req);
        const ourCallbackUrl = `${baseUrl}/metamcp/oauth/callback`;

        if (
          codeData.redirect_uri === ourCallbackUrl ||
          codeData.redirect_uri.includes("/oauth/callback")
        ) {
          // This is likely a development/testing scenario where the client redirect_uri
          // points back to our callback. Instead of redirecting, show a success page.
          console.log(
            "OAuth callback - redirect URI points to our callback, showing success page",
          );

          return res.send(`
            <html>
              <head><title>OAuth Authorization Successful</title></head>
              <body>
                <h1>Authorization Successful</h1>
                <p>Authorization code: <code>${code}</code></p>
                <p>State: <code>${state || "none"}</code></p>
                <p>You can now exchange this code for an access token using the token endpoint.</p>
                <pre>
POST ${baseUrl}/metamcp/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "${code}",
  "client_id": "${codeData.client_id}",
  "redirect_uri": "${codeData.redirect_uri}"
}
                </pre>
              </body>
            </html>
          `);
        }

        // Code exists and is valid, redirect back to the original redirect_uri
        const redirectUrl = new URL(codeData.redirect_uri);
        redirectUrl.searchParams.set("code", code as string);
        if (state) {
          redirectUrl.searchParams.set("state", state as string);
        }
        console.log(
          "OAuth callback - existing code found, redirecting to:",
          redirectUrl.toString(),
        );
        return res.redirect(redirectUrl.toString());
      } else {
        return res.status(400).send("Invalid or expired authorization code");
      }
    }

    const { client_id, redirect_uri, state } = oauthParams;

    // Verify user authentication by checking session cookies
    if (!req.headers.cookie) {
      console.log("OAuth callback - no cookies found, redirecting to login");
      // Redirect back to login if no authentication
      const baseUrl = getBaseUrl(req);
      const loginUrl = new URL("/en/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", req.originalUrl);
      return res.redirect(loginUrl.toString());
    }

    // Import auth here to avoid circular dependency issues
    const { auth } = await import("../../auth");

    // Verify the session using better-auth
    const sessionUrl = new URL("/api/auth/get-session", getBaseUrl(req));
    const headers = new Headers();
    headers.set("cookie", req.headers.cookie);

    const sessionRequest = new Request(sessionUrl.toString(), {
      method: "GET",
      headers,
    });

    const sessionResponse = await auth.handler(sessionRequest);

    if (!sessionResponse.ok) {
      console.log(
        "OAuth callback - session verification failed, redirecting to login",
      );
      // Redirect back to login if session invalid
      const baseUrl = getBaseUrl(req);
      const loginUrl = new URL("/en/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", req.originalUrl);
      return res.redirect(loginUrl.toString());
    }

    const sessionData = (await sessionResponse.json()) as {
      user?: { id: string };
    };

    if (!sessionData?.user?.id) {
      console.log("OAuth callback - no valid user found, redirecting to login");
      // Redirect back to login if no user
      const baseUrl = getBaseUrl(req);
      const loginUrl = new URL("/en/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", req.originalUrl);
      return res.redirect(loginUrl.toString());
    }

    // User is authenticated, generate authorization code
    const code = `mcp_code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store authorization code with associated data
    authorizationCodes.set(code, {
      client_id,
      redirect_uri,
      scope: oauthParams.scope || "admin",
      user_id: sessionData.user.id,
      code_challenge: oauthParams.code_challenge,
      code_challenge_method: oauthParams.code_challenge_method,
      expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    console.log(
      "OAuth callback - user authenticated, issuing code for user:",
      sessionData.user.id,
    );

    // Redirect back to the MCP client with authorization code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    console.log("OAuth callback redirect to:", redirectUrl.toString());
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("OAuth callback error");
  }
});

/**
 * OAuth 2.0 Token Introspection Endpoint
 * Allows clients to introspect access tokens
 */
oauthMetadataRouter.post("/oauth/introspect", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing token parameter",
      });
    }

    // Check if token exists and is valid
    const tokenData = accessTokens.get(token);

    if (!tokenData || !token.startsWith("mcp_token_")) {
      return res.json({
        active: false,
      });
    }

    // Check if token has expired
    if (Date.now() > tokenData.expires_at) {
      accessTokens.delete(token);
      return res.json({
        active: false,
      });
    }

    // Token is active, return introspection details
    res.json({
      active: true,
      scope: tokenData.scope,
      client_id: "mcp_client", // In production, store and return actual client_id
      token_type: "Bearer",
      exp: Math.floor(tokenData.expires_at / 1000),
      iat: Math.floor((tokenData.expires_at - 3600 * 1000) / 1000), // Issued 1 hour before expiry
      sub: tokenData.user_id,
    });
  } catch (error) {
    console.error("Error in OAuth introspect endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Token Revocation Endpoint
 * Allows clients to revoke access tokens
 */
oauthMetadataRouter.post("/oauth/revoke", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing token parameter",
      });
    }

    // Revoke the token by removing it from storage
    if (accessTokens.has(token)) {
      accessTokens.delete(token);
      console.log(
        "Successfully revoked token:",
        token.substring(0, 20) + "...",
      );
    } else {
      console.log(
        "Token not found for revocation:",
        token.substring(0, 20) + "...",
      );
      // RFC 7009 specifies that the endpoint should return success even if token doesn't exist
    }

    // RFC 7009 specifies that revocation endpoint should return 200 OK
    res.status(200).send();
  } catch (error) {
    console.error("Error in OAuth revoke endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

// Store for access tokens (in production, use a database or Redis)
const accessTokens = new Map<
  string,
  {
    user_id: string;
    scope: string;
    expires_at: number;
  }
>();

/**
 * OAuth 2.0 UserInfo Endpoint
 * Returns information about the authenticated user
 */
oauthMetadataRouter.get("/oauth/userinfo", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "invalid_token",
        error_description: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Validate MCP token format
    if (!token.startsWith("mcp_token_")) {
      return res.status(401).json({
        error: "invalid_token",
        error_description: "Invalid access token format",
      });
    }

    // Look up token data (in production, this should validate signature and lookup in database)
    const tokenData = accessTokens.get(token);
    if (!tokenData) {
      return res.status(401).json({
        error: "invalid_token",
        error_description: "Token not found or expired",
      });
    }

    // Check if token has expired
    if (Date.now() > tokenData.expires_at) {
      accessTokens.delete(token);
      return res.status(401).json({
        error: "invalid_token",
        error_description: "Access token has expired",
      });
    }

    // For MCP tokens, return basic user info based on the user_id stored with the token
    // In a real implementation, you would fetch actual user data from the database
    res.json({
      sub: tokenData.user_id,
      email: `user-${tokenData.user_id}@metamcp.local`,
      name: `MetaMCP User ${tokenData.user_id}`,
      preferred_username: `user_${tokenData.user_id}`,
      scope: tokenData.scope,
    });
  } catch (error) {
    console.error("Error in OAuth userinfo endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

export default oauthMetadataRouter;
