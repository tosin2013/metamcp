import express from "express";

import { oauthRepository } from "../../db/repositories";

const registrationRouter = express.Router();

/**
 * OAuth 2.0 Dynamic Client Registration Endpoint
 * Allows clients to dynamically register with the authorization server
 * Implementation follows RFC 7591
 */
registrationRouter.post("/oauth/register", async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Request body is missing or malformed",
      });
    }

    const {
      redirect_uris,
      response_types,
      grant_types,
      client_name,
      client_uri,
      logo_uri,
      scope,
      contacts,
      tos_uri,
      policy_uri,
      token_endpoint_auth_method,
      software_id,
      software_version,
    } = req.body;

    // Validate required parameters
    if (
      !redirect_uris ||
      !Array.isArray(redirect_uris) ||
      redirect_uris.length === 0
    ) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description:
          "redirect_uris is required and must be a non-empty array",
      });
    }

    // Validate redirect URIs
    for (const uri of redirect_uris) {
      try {
        const parsedUri = new URL(uri);
        // For security, we might want to restrict certain schemes or domains
        if (!["http:", "https:", "custom:"].includes(parsedUri.protocol)) {
          return res.status(400).json({
            error: "invalid_redirect_uri",
            error_description: `Invalid redirect URI scheme: ${parsedUri.protocol}`,
          });
        }
      } catch {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Invalid redirect URI format: ${uri}`,
        });
      }
    }

    // Set defaults for optional parameters
    const clientGrantTypes =
      grant_types && Array.isArray(grant_types)
        ? grant_types
        : ["authorization_code"];

    const clientResponseTypes =
      response_types && Array.isArray(response_types)
        ? response_types
        : ["code"];

    const clientTokenEndpointAuthMethod = token_endpoint_auth_method || "none";

    // Validate grant types and response types consistency
    const validGrantTypes = [
      "authorization_code",
      "refresh_token",
      "client_credentials",
    ];
    const validResponseTypes = ["code"];
    const validAuthMethods = [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ];

    for (const grantType of clientGrantTypes) {
      if (!validGrantTypes.includes(grantType)) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: `Unsupported grant type: ${grantType}`,
        });
      }
    }

    for (const responseType of clientResponseTypes) {
      if (!validResponseTypes.includes(responseType)) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: `Unsupported response type: ${responseType}`,
        });
      }
    }

    if (!validAuthMethods.includes(clientTokenEndpointAuthMethod)) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: `Unsupported token endpoint auth method: ${clientTokenEndpointAuthMethod}`,
      });
    }

    // Generate client credentials
    const clientId = `mcp_client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate client secret only if auth method requires it
    let clientSecret: string | null = null;
    if (clientTokenEndpointAuthMethod !== "none") {
      clientSecret = `mcp_secret_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
    }

    // Create client registration
    const clientRegistration = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || "Unnamed MCP Client",
      redirect_uris: redirect_uris,
      grant_types: clientGrantTypes,
      response_types: clientResponseTypes,
      token_endpoint_auth_method: clientTokenEndpointAuthMethod,
      scope: scope || "admin",
      client_uri: client_uri || null,
      logo_uri: logo_uri || null,
      contacts: contacts && Array.isArray(contacts) ? contacts : null,
      tos_uri: tos_uri || null,
      policy_uri: policy_uri || null,
      software_id: software_id || null,
      software_version: software_version || null,
      created_at: new Date(),
    };

    // Store the client registration
    await oauthRepository.upsertClient(clientRegistration);

    // Prepare response according to RFC 7591
    const response: any = {
      client_id: clientId,
      client_name: clientRegistration.client_name,
      redirect_uris: clientRegistration.redirect_uris,
      grant_types: clientRegistration.grant_types,
      response_types: clientRegistration.response_types,
      token_endpoint_auth_method: clientRegistration.token_endpoint_auth_method,
      scope: clientRegistration.scope,
    };

    // Include client_secret only if one was generated
    if (clientSecret) {
      response.client_secret = clientSecret;
    }

    // Include optional metadata if provided
    if (client_uri) response.client_uri = client_uri;
    if (logo_uri) response.logo_uri = logo_uri;
    if (contacts) response.contacts = contacts;
    if (tos_uri) response.tos_uri = tos_uri;
    if (policy_uri) response.policy_uri = policy_uri;
    if (software_id) response.software_id = software_id;
    if (software_version) response.software_version = software_version;

    res.status(201).json(response);
  } catch (error) {
    console.error("Error in OAuth registration endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error during client registration",
    });
  }
});

export default registrationRouter;
