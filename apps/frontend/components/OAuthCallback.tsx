"use client";

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { useEffect, useRef } from "react";

import { useTranslations } from "@/hooks/useTranslations";

import { SESSION_KEYS } from "../lib/constants";
import { createAuthProvider } from "../lib/oauth-provider";
import { vanillaTrpcClient } from "../lib/trpc";

const OAuthCallback = () => {
  const { t } = useTranslations();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Skip if we've already processed this callback
      if (hasProcessedRef.current) {
        return;
      }
      hasProcessedRef.current = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const serverUrl = sessionStorage.getItem(SESSION_KEYS.SERVER_URL);
      const mcpServerUuid = sessionStorage.getItem(
        SESSION_KEYS.MCP_SERVER_UUID,
      );

      if (!code || !serverUrl || !mcpServerUuid) {
        console.error("Missing required OAuth parameters");
        window.location.href = "/mcp-servers";
        return;
      }

      try {
        // Create auth provider with existing server UUID
        const authProvider = createAuthProvider(mcpServerUuid);

        // Complete the OAuth flow
        const result = await auth(authProvider, {
          serverUrl,
          authorizationCode: code,
        });

        if (result !== "AUTHORIZED") {
          throw new Error(
            `Expected to be authorized after providing auth code, got: ${result}`,
          );
        }

        // Transfer OAuth data from session storage to database
        const storagePrefix = `oauth_${mcpServerUuid}_`;
        const clientInformation = sessionStorage.getItem(
          `${storagePrefix}client_information`,
        );
        const tokens = sessionStorage.getItem(`${storagePrefix}tokens`);
        const codeVerifier = sessionStorage.getItem(
          `${storagePrefix}code_verifier`,
        );

        // Save OAuth session in database using tRPC
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: mcpServerUuid,
          client_information: clientInformation
            ? JSON.parse(clientInformation)
            : undefined,
          tokens: tokens ? JSON.parse(tokens) : undefined,
          code_verifier: codeVerifier || undefined,
        });

        // Clean up session storage
        sessionStorage.removeItem(`${storagePrefix}client_information`);
        sessionStorage.removeItem(`${storagePrefix}tokens`);
        sessionStorage.removeItem(`${storagePrefix}code_verifier`);
        sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
        sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);
        
        // Redirect back to the MCP server detail page
        // window.location.href = `/mcp-servers/${mcpServerUuid}`;
      } catch (error) {
        console.error("OAuth callback error:", error);
        // window.location.href = "/mcp-servers";
      }
    };

    void handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">
        {t("common:oauth.processingCallback")}
      </p>
    </div>
  );
};

export default OAuthCallback;
