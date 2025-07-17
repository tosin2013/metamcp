import { DatabaseEndpoint } from "@repo/zod-types";
import express from "express";

import { auth } from "../auth";
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
 * Validates OAuth bearer token using better-auth session validation
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
      console.log(
        "Validating MCP OAuth token:",
        token.substring(0, 20) + "...",
      );

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

    // Try to validate as better-auth session token
    const baseUrl = getBaseUrl(req);
    const sessionUrl = new URL("/api/auth/get-session", baseUrl);

    const headers = new Headers();
    headers.set("authorization", `Bearer ${token}`);

    const sessionRequest = new Request(sessionUrl.toString(), {
      method: "GET",
      headers,
    });

    const sessionResponse = await auth.handler(sessionRequest);

    if (!sessionResponse.ok) {
      return { valid: false, error: "Invalid OAuth token" };
    }

    const sessionData = (await sessionResponse.json()) as any;

    if (!sessionData?.user?.id) {
      return { valid: false, error: "No valid user session found" };
    }

    // For better-auth sessions, grant admin scope to all authenticated users
    const scopes = ["admin"];

    return {
      valid: true,
      user_id: sessionData.user.id,
      scopes,
    };
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
        // We'll determine if it's an API key or OAuth token during validation
      }
    }

    // Check query parameters for API key (if enabled)
    if (!authToken && endpoint.use_query_param_auth) {
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

    // Try API key authentication first (only if enabled)
    let authResult: {
      valid: boolean;
      user_id?: string | null;
      key_uuid?: string;
    } | null = null;

    if (endpoint.enable_api_key_auth) {
      if (isApiKey) {
        authResult = await apiKeysRepository.validateApiKey(authToken);
      } else {
        // Try API key validation first even for Bearer tokens (backwards compatibility)
        authResult = await apiKeysRepository.validateApiKey(authToken);
      }

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

    // If API key failed or not enabled, try OAuth token validation if OAuth is enabled
    if (
      (!authResult?.valid || !endpoint.enable_api_key_auth) &&
      endpoint.enable_oauth
    ) {
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

    // Both API key and OAuth authentication failed
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
 */
function sendAuthenticationChallenge(
  req: express.Request,
  res: express.Response,
  endpoint: DatabaseEndpoint,
): express.Response {
  const baseUrl = getBaseUrl(req);

  // Determine which authentication methods are available
  const authMethods = [];

  // OAuth Bearer challenge (if OAuth is enabled)
  if (endpoint.enable_oauth) {
    authMethods.push("Authorization header (Bearer token)");

    // Set WWW-Authenticate header with proper OAuth Bearer challenge
    // According to MCP OAuth spec and RFC 6750, this should trigger OAuth flow
    const bearerChallenge = [
      `Bearer realm="MetaMCP"`,
      `scope="admin"`,
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    ].join(", ");

    res.set("WWW-Authenticate", bearerChallenge);
  }

  // API key methods (if enabled)
  if (endpoint.enable_api_key_auth) {
    authMethods.push("X-API-Key header");

    // Add query parameter auth method if enabled
    if (endpoint.use_query_param_auth) {
      authMethods.push("query parameter (api_key or apikey)");
    }
  }

  const errorDescription = endpoint.enable_oauth
    ? "Authentication required via OAuth bearer token or API key"
    : "Authentication required via API key";

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
