import express from "express";

const oauthMetadataRouter = express.Router();

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

      // For the basic implementation, we'll point to our better-auth OAuth server
      // In a production environment, this could point to external authorization servers
      const authServerUrl = process.env.APP_URL || baseUrl;

      const metadata = {
        // Resource identifier - the protected resource's canonical URI
        resource: baseUrl,

        // List of OAuth authorization server issuer identifiers
        // Using better-auth as our authorization server
        authorization_servers: [authServerUrl],

        // Supported bearer token methods
        bearer_methods_supported: ["header"],

        // OAuth scopes supported by this protected resource
        // Single admin scope for simplified access control
        scopes_supported: [
          "admin", // Administrative access to all MCP resources
        ],

        // Resource name for display purposes
        resource_name: "MetaMCP Protected Resource",

        // Documentation URL
        resource_documentation: `${baseUrl}/docs`,

        // OAuth 2.0 DPoP support (if enabled)
        dpop_bound_access_tokens_required: false,

        // Authorization details types supported
        authorization_details_types_supported: ["mcp_endpoint_access"],
      };

      res.set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
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
 * This provides discovery information for better-auth OAuth endpoints
 */
oauthMetadataRouter.get(
  "/.well-known/oauth-authorization-server",
  async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);

      const metadata = {
        // Issuer identifier
        issuer: baseUrl,

        // OAuth 2.1 endpoints (better-auth provides these)
        authorization_endpoint: `${baseUrl}/api/auth/oauth/authorize`,
        token_endpoint: `${baseUrl}/api/auth/oauth/token`,

        // Dynamic Client Registration (if supported by better-auth)
        registration_endpoint: `${baseUrl}/api/auth/oauth/register`,

        // Supported response types
        response_types_supported: ["code"],

        // Supported grant types
        grant_types_supported: ["authorization_code", "refresh_token"],

        // Supported scopes
        scopes_supported: ["admin"],

        // Code challenge methods (PKCE is required for MCP)
        code_challenge_methods_supported: ["S256"],

        // Token endpoint authentication methods
        token_endpoint_auth_methods_supported: [
          "none", // For public clients (PKCE required)
          "client_secret_post",
          "client_secret_basic",
        ],

        // Additional OAuth 2.1 security features
        require_pushed_authorization_requests: false,
        pushed_authorization_request_endpoint: `${baseUrl}/api/auth/oauth/par`,

        // PKCE is required for all clients per MCP spec
        require_proof_key_for_code_exchange: true,
      };

      res.set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
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

export default oauthMetadataRouter;
