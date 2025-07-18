import { DatabaseEndpoint } from "@repo/zod-types";
import express from "express";

import { ApiKeysRepository } from "../db/repositories/api-keys.repo";

// Extend Express Request interface for our custom properties
export interface ApiKeyAuthenticatedRequest extends express.Request {
  namespaceUuid: string;
  endpointName: string;
  endpoint: DatabaseEndpoint;
  apiKeyUserId?: string;
  apiKeyUuid?: string;
  oauthUserId?: string; // For OAuth-authenticated requests
  authMethod?: "api_key" | "oauth"; // Track which auth method was used
}

const apiKeysRepository = new ApiKeysRepository();

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
 * Validates OAuth bearer token using MCP token introspection
 * @param token OAuth bearer token
 * @param req Express request object
 * @returns OAuth validation result
 */
async function validateOAuthToken(
  token: string,
  req: express.Request,
): Promise<{
  valid: boolean;
  user_id?: string;
  scopes?: string[];
  error?: string;
}> {
  try {
    // Check if this is our MCP OAuth token format
    if (token.startsWith("mcp_token_")) {
      // For MCP tokens, use introspection endpoint to validate
      // This allows us to check against the stored token data
      try {
        const baseUrl = getBaseUrl(req);
        const introspectUrl = new URL("/metamcp/oauth/introspect", baseUrl);

        const introspectRequest = new Request(introspectUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });

        const introspectResponse = await fetch(introspectRequest);

        if (!introspectResponse.ok) {
          return { valid: false, error: "Token introspection failed" };
        }

        const introspectData = (await introspectResponse.json()) as {
          active?: boolean;
          sub?: string;
          scope?: string;
        };

        if (!introspectData.active) {
          return { valid: false, error: "Token is not active" };
        }

        return {
          valid: true,
          user_id: introspectData.sub,
          scopes: introspectData.scope
            ? introspectData.scope.split(" ")
            : ["admin"],
        };
      } catch (error) {
        console.error("Error introspecting MCP token:", error);
        return { valid: false, error: "Token validation failed" };
      }
    }

    // Token is not a recognized MCP token format
    return { valid: false, error: "Unsupported token format" };
  } catch (error) {
    console.error("Error validating OAuth token:", error);
    return { valid: false, error: "OAuth validation failed" };
  }
}

/**
 * Enhanced authentication middleware with API Key and OAuth fallback
 * Follows MCP OAuth specification with proper WWW-Authenticate headers
 * - First attempts API key authentication
 * - Falls back to OAuth bearer token validation
 * - Returns proper WWW-Authenticate headers per RFC 9728
 */
export const authenticateApiKey = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const authReq = req as ApiKeyAuthenticatedRequest;
  const endpoint = authReq.endpoint;

  // Skip authentication if neither method is enabled for this endpoint
  if (!endpoint?.enable_api_key_auth && !endpoint?.enable_oauth) {
    return next();
  }

  try {
    let authToken: string | undefined;
    let isApiKey = false;
    let isOAuthToken = false;

    // Check for API key first (X-API-Key header)
    const apiKeyHeader = req.headers["x-api-key"] as string;
    if (apiKeyHeader) {
      authToken = apiKeyHeader;
      isApiKey = true;
    }

    // Check Authorization header (could be API key or OAuth token)
    if (!authToken) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        authToken = authHeader.substring(7);
        // Determine if this looks like an OAuth token or API key
        // MCP OAuth tokens start with "mcp_token_" or are session tokens
        // API keys typically don't start with these prefixes
        if (authToken.startsWith("mcp_token_")) {
          isOAuthToken = true;
        } else {
          // For backward compatibility, try as API key first, then OAuth
          // But prioritize OAuth if OAuth is enabled and API key is disabled
          if (endpoint.enable_oauth && !endpoint.enable_api_key_auth) {
            isOAuthToken = true;
          }
        }
      }
    }

    // Check query parameters for API key (if enabled)
    if (
      !authToken &&
      endpoint.enable_api_key_auth &&
      endpoint.use_query_param_auth
    ) {
      const queryApiKey =
        (req.query.api_key as string) || (req.query.apikey as string);
      if (queryApiKey) {
        authToken = queryApiKey;
        isApiKey = true;
      }
    }

    if (!authToken) {
      return sendAuthenticationChallenge(req, res, endpoint);
    }

    // Try API key authentication first (only if enabled and token looks like API key)
    let authResult: {
      valid: boolean;
      user_id?: string | null;
      key_uuid?: string;
    } | null = null;

    if (endpoint.enable_api_key_auth && (isApiKey || !isOAuthToken)) {
      authResult = await apiKeysRepository.validateApiKey(authToken);

      if (authResult?.valid) {
        // API key authentication successful
        authReq.apiKeyUserId = authResult.user_id || undefined;
        authReq.apiKeyUuid = authResult.key_uuid;
        authReq.authMethod = "api_key";

        // Perform API key access control checks
        const accessCheckResult = checkApiKeyAccess(authResult, endpoint);
        if (!accessCheckResult.allowed) {
          return res.status(403).json({
            error: "Access denied",
            message: accessCheckResult.message,
            timestamp: new Date().toISOString(),
          });
        }

        return next();
      }
    }

    // If API key failed or not attempted, try OAuth token validation if OAuth is enabled
    if (endpoint.enable_oauth && (!authResult?.valid || isOAuthToken)) {
      const oauthResult = await validateOAuthToken(authToken, req);

      if (oauthResult.valid) {
        // OAuth authentication successful
        authReq.oauthUserId = oauthResult.user_id;
        authReq.authMethod = "oauth";

        // Perform OAuth access control checks
        const accessCheckResult = checkOAuthAccess(oauthResult);
        if (!accessCheckResult.allowed) {
          return res.status(403).json({
            error: "insufficient_scope",
            error_description: accessCheckResult.message,
            timestamp: new Date().toISOString(),
          });
        }

        return next();
      }
    }

    // Authentication failed for the provided token
    // Determine the most appropriate error response based on what was attempted
    if (isApiKey && endpoint.enable_api_key_auth && !endpoint.enable_oauth) {
      // API key was provided but failed, and OAuth is not enabled
      return res.status(401).json({
        error: "invalid_api_key",
        error_description: "The provided API key is invalid or expired",
        timestamp: new Date().toISOString(),
      });
    }

    if (
      isOAuthToken &&
      endpoint.enable_oauth &&
      !endpoint.enable_api_key_auth
    ) {
      // OAuth token was provided but failed, and API key auth is not enabled
      return res.status(401).json({
        error: "invalid_token",
        error_description: "The provided OAuth token is invalid or expired",
        timestamp: new Date().toISOString(),
      });
    }

    // If both methods are enabled or token type is ambiguous, send challenge
    return sendAuthenticationChallenge(req, res, endpoint);
  } catch (error) {
    console.error("Error in authentication middleware:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "Failed to validate authentication",
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Check if API key has access to the endpoint
 */
function checkApiKeyAccess(
  validation: { user_id?: string | null },
  endpoint: DatabaseEndpoint,
): { allowed: boolean; message?: string } {
  const isPublicApiKey = validation.user_id === null;
  const isPrivateEndpoint = endpoint.user_id !== null;

  if (isPublicApiKey && isPrivateEndpoint) {
    return {
      allowed: false,
      message:
        "Public API keys cannot access private endpoints. Use a private API key owned by the endpoint owner.",
    };
  }

  if (
    !isPublicApiKey &&
    isPrivateEndpoint &&
    endpoint.user_id !== validation.user_id
  ) {
    return {
      allowed: false,
      message: "You can only access endpoints you own or public endpoints.",
    };
  }

  return { allowed: true };
}

/**
 * Check if OAuth token has required scopes for the endpoint
 */
function checkOAuthAccess(oauthResult: {
  user_id?: string;
  scopes?: string[];
}): { allowed: boolean; message?: string } {
  const scopes = oauthResult.scopes || [];

  // Check for admin access - with admin scope, user can access any endpoint
  if (scopes.includes("admin")) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: "Insufficient scope. Required: admin",
  };
}

/**
 * Send WWW-Authenticate challenge following MCP OAuth specification
 * CRITICAL: Only set Bearer WWW-Authenticate header when OAuth is enabled
 * to prevent MCP inspector from triggering unwanted OAuth flows
 */
function sendAuthenticationChallenge(
  req: express.Request,
  res: express.Response,
  endpoint: DatabaseEndpoint,
): express.Response {
  const baseUrl = getBaseUrl(req);

  // Determine which authentication methods are available
  const authMethods = [];

  // Set appropriate WWW-Authenticate header based on enabled methods
  if (endpoint.enable_oauth) {
    authMethods.push("Authorization header (Bearer token)");

    // ONLY set WWW-Authenticate header with Bearer challenge when OAuth is enabled
    // This prevents MCP inspector from triggering OAuth flow when OAuth is disabled
    const bearerChallenge = [
      `Bearer realm="MetaMCP"`,
      `scope="admin"`,
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    ].join(", ");

    res.set("WWW-Authenticate", bearerChallenge);
  } else if (endpoint.enable_api_key_auth) {
    // When only API key auth is enabled, don't set WWW-Authenticate header
    // to avoid triggering OAuth flow in MCP inspector
    authMethods.push("X-API-Key header");

    // Add query parameter auth method if enabled
    if (endpoint.use_query_param_auth) {
      authMethods.push("query parameter (api_key or apikey)");
    }
  }

  // Add API key methods when both OAuth and API key are enabled
  if (endpoint.enable_oauth && endpoint.enable_api_key_auth) {
    authMethods.push("X-API-Key header");

    // Add query parameter auth method if enabled
    if (endpoint.use_query_param_auth) {
      authMethods.push("query parameter (api_key or apikey)");
    }
  }

  let errorDescription: string;
  if (endpoint.enable_oauth && endpoint.enable_api_key_auth) {
    errorDescription =
      "Authentication required via OAuth bearer token or API key";
  } else if (endpoint.enable_oauth) {
    errorDescription = "Authentication required via OAuth bearer token";
  } else {
    errorDescription = "Authentication required via API key";
  }

  return res.status(401).json({
    error: "authentication_required",
    error_description: errorDescription,
    resource_metadata: endpoint.enable_oauth
      ? `${baseUrl}/.well-known/oauth-protected-resource`
      : undefined,
    supported_methods: authMethods,
    timestamp: new Date().toISOString(),
  });
}
