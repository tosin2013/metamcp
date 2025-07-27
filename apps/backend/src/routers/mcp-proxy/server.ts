import { createHash, randomUUID } from "node:crypto";

import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpServerTypeEnum } from "@repo/zod-types";
import express from "express";
import { parse as shellParseArgs } from "shell-quote";
import { findActualExecutable } from "spawn-rx";

import mcpProxy from "../../lib/mcp-proxy";
import { transformDockerUrl } from "../../lib/metamcp/client";
import { betterAuthMcpMiddleware } from "../../middleware/better-auth-mcp.middleware";

const SSE_HEADERS_PASSTHROUGH = ["authorization"];
const STREAMABLE_HTTP_HEADERS_PASSTHROUGH = [
  "authorization",
  "mcp-session-id",
  "last-event-id",
];

const defaultEnvironment = {
  ...getDefaultEnvironment(),
};

// Rate limiting for transport creation
const RATE_LIMIT_COOLDOWN_MS = 2000; // 2 seconds
const transportRateLimits = new Map<string, number>();

interface TransportQueryParams {
  transportType?: string;
  command?: string;
  args?: string;
  env?: string;
  url?: string;
}

// Function to create a hash of transport parameters for rate limiting
const createParametersHash = (query: TransportQueryParams): string => {
  const params = {
    transportType: query.transportType,
    command: query.command,
    args: query.args,
    env: query.env,
    url: query.url,
  };
  return createHash("sha256").update(JSON.stringify(params)).digest("hex");
};

// Function to check and enforce rate limits
const checkRateLimit = (paramsHash: string): boolean => {
  const now = Date.now();
  const lastCreated = transportRateLimits.get(paramsHash);

  if (lastCreated && now - lastCreated < RATE_LIMIT_COOLDOWN_MS) {
    return false; // Rate limited
  }

  transportRateLimits.set(paramsHash, now);

  // Clean up old entries to prevent memory leaks
  for (const [hash, timestamp] of transportRateLimits.entries()) {
    if (now - timestamp > RATE_LIMIT_COOLDOWN_MS) {
      transportRateLimits.delete(hash);
    }
  }

  return true; // Allowed
};

// Function to get HTTP headers.
// Supports only "SSE" and "STREAMABLE_HTTP" transport types.
const getHttpHeaders = (
  req: express.Request,
  transportType: string,
): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept:
      transportType === McpServerTypeEnum.Enum.SSE
        ? "text/event-stream"
        : "text/event-stream, application/json",
  };
  const defaultHeaders =
    transportType === McpServerTypeEnum.Enum.SSE
      ? SSE_HEADERS_PASSTHROUGH
      : STREAMABLE_HTTP_HEADERS_PASSTHROUGH;

  for (const key of defaultHeaders) {
    if (req.headers[key] === undefined) {
      continue;
    }

    const value = req.headers[key];
    headers[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }

  // If the header "x-custom-auth-header" is present, use its value as the custom header name.
  if (req.headers["x-custom-auth-header"] !== undefined) {
    const customHeaderName = req.headers["x-custom-auth-header"] as string;
    const lowerCaseHeaderName = customHeaderName.toLowerCase();
    if (req.headers[lowerCaseHeaderName] !== undefined) {
      const value = req.headers[lowerCaseHeaderName];
      headers[customHeaderName] = value as string;
    }
  }
  return headers;
};

const serverRouter = express.Router();

// Apply better auth middleware to all MCP proxy routes
serverRouter.use(betterAuthMcpMiddleware);

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Web app transports by web app sessionId
const serverTransports: Map<string, Transport> = new Map<string, Transport>(); // Server Transports by web app sessionId

// Session cleanup function
const cleanupSession = async (sessionId: string, mcpServerName?: string) => {
  console.log(
    `Cleaning up proxy session ${sessionId} for MCP server: ${mcpServerName || "Unknown"}`,
  );

  // Clean up web app transport
  const webAppTransport = webAppTransports.get(sessionId);
  if (webAppTransport) {
    try {
      await webAppTransport.close();
    } catch (error) {
      console.error(
        `Error closing web app transport for session ${sessionId}:`,
        error,
      );
    }
    webAppTransports.delete(sessionId);
  }

  // Clean up server transport
  const serverTransport = serverTransports.get(sessionId);
  if (serverTransport) {
    try {
      await serverTransport.close();
    } catch (error) {
      console.error(
        `Error closing server transport for session ${sessionId}:`,
        error,
      );
    }
    serverTransports.delete(sessionId);
  }

  console.log(`Session ${sessionId} cleanup completed`);
};

const createTransport = async (req: express.Request): Promise<Transport> => {
  const query = req.query;
  console.log("Query parameters:", JSON.stringify(query));

  // Check rate limit based on parameters hash
  const paramsHash = createParametersHash(query);
  if (!checkRateLimit(paramsHash)) {
    const error = new Error(
      `Rate limit exceeded for transport creation. Please wait ${RATE_LIMIT_COOLDOWN_MS / 1000} seconds before retrying with the same parameters.`,
    );
    (error as any).code = "RATE_LIMIT_EXCEEDED";
    throw error;
  }

  const transportType = query.transportType as string;

  if (transportType === McpServerTypeEnum.Enum.STDIO) {
    const command = query.command as string;
    const origArgs = shellParseArgs(query.args as string) as string[];
    const queryEnv = query.env ? JSON.parse(query.env as string) : {};
    const env = { ...process.env, ...defaultEnvironment, ...queryEnv };

    const { cmd, args } = findActualExecutable(command, origArgs);

    console.log(`STDIO transport: command=${cmd}, args=${args}`);

    const transport = new StdioClientTransport({
      command: cmd,
      args,
      env,
      stderr: "pipe",
    });

    await transport.start();
    return transport;
  } else if (transportType === McpServerTypeEnum.Enum.SSE) {
    const url = transformDockerUrl(query.url as string);

    const headers = getHttpHeaders(req, transportType);

    console.log(
      `SSE transport: url=${url}, headers=${JSON.stringify(headers)}`,
    );

    const transport = new SSEClientTransport(new URL(url), {
      eventSourceInit: {
        fetch: (url, init) => fetch(url, { ...init, headers }),
      },
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else if (transportType === McpServerTypeEnum.Enum.STREAMABLE_HTTP) {
    const headers = getHttpHeaders(req, transportType);

    const transport = new StreamableHTTPClientTransport(
      new URL(transformDockerUrl(query.url as string)),
      {
        requestInit: {
          headers,
        },
      },
    );
    await transport.start();
    return transport;
  } else {
    console.error(`Invalid transport type: ${transportType}`);
    throw new Error("Invalid transport type specified");
  }
};

serverRouter.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  // console.log(`Received GET message for sessionId ${sessionId}`);
  try {
    const transport = webAppTransports.get(
      sessionId,
    ) as StreamableHTTPServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    } else {
      await transport.handleRequest(req, res);
    }
  } catch (error) {
    console.error("Error in /mcp route:", error);
    res.status(500).json(error);
  }
});

serverRouter.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let serverTransport: Transport | undefined;
  if (!sessionId) {
    try {
      console.log("New StreamableHttp connection request");
      try {
        serverTransport = await createTransport(req);
      } catch (error) {
        if (error instanceof SseError && error.code === 401) {
          console.error(
            "Received 401 Unauthorized from MCP server:",
            error.message,
          );
          res.status(401).json(error);
          return;
        }

        throw error;
      }

      console.log("Created StreamableHttp server transport");

      // Generate session ID upfront for better tracking
      const newSessionId = randomUUID();

      const webAppTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sessionId) => {
          webAppTransports.set(sessionId, webAppTransport);
          if (serverTransport) {
            serverTransports.set(sessionId, serverTransport);
          }
          console.log("Client <-> Proxy  sessionId: " + sessionId);
        },
      });
      console.log("Created StreamableHttp client transport");

      await webAppTransport.start();

      // Set up proxy connection with error handling
      try {
        mcpProxy({
          transportToClient: webAppTransport,
          transportToServer: serverTransport,
        });
      } catch (error) {
        console.error(
          `Error setting up proxy for session ${newSessionId}:`,
          error,
        );
        await cleanupSession(newSessionId, req.query.mcpServerName as string);
        throw error;
      }

      // Handle the actual request - don't pass req.body since it wasn't parsed
      await (webAppTransport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
      );
    } catch (error) {
      console.error("Error in /mcp POST route:", error);
      res.status(500).json(error);
    }
  } else {
    // console.log(`Received POST message for sessionId ${sessionId}`);
    try {
      const transport = webAppTransports.get(
        sessionId,
      ) as StreamableHTTPServerTransport;
      if (!transport) {
        res.status(404).end("Transport not found for sessionId " + sessionId);
      } else {
        await (transport as StreamableHTTPServerTransport).handleRequest(
          req,
          res,
        );
      }
    } catch (error) {
      console.error("Error in /mcp route:", error);
      res.status(500).json(error);
    }
  }
});

serverRouter.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const mcpServerName = (req.query.mcpServerName as string) || "Unknown Server";
  console.log(
    `Received DELETE message for sessionId ${sessionId}, MCP server: ${mcpServerName}`,
  );

  if (sessionId) {
    try {
      const serverTransport = serverTransports.get(
        sessionId,
      ) as StreamableHTTPClientTransport;
      if (!serverTransport) {
        res.status(404).end("Transport not found for sessionId " + sessionId);
        return;
      }

      // Terminate the session and clean up
      try {
        await serverTransport.terminateSession();
      } catch (error) {
        console.warn(`Warning: Error terminating session ${sessionId}:`, error);
        // Continue with cleanup even if termination fails
      }

      await cleanupSession(sessionId, mcpServerName);
      console.log(
        `Session ${sessionId} terminated and cleaned up successfully`,
      );
      res.status(200).end();
    } catch (error) {
      console.error("Error in /mcp DELETE route:", error);
      res.status(500).json(error);
    }
  } else {
    res.status(400).end("Missing sessionId");
  }
});

serverRouter.get("/stdio", async (req, res) => {
  try {
    console.log("New STDIO connection request");
    let serverTransport: Transport | undefined;
    try {
      serverTransport = await createTransport(req);
      console.log("Created server transport");
    } catch (error) {
      if (error instanceof SseError && error.code === 401) {
        console.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        res.status(401).json(error);
        return;
      }

      throw error;
    }

    const webAppTransport = new SSEServerTransport(
      "/mcp-proxy/server/message",
      res,
    );
    console.log("Created client transport");

    webAppTransports.set(webAppTransport.sessionId, webAppTransport);
    serverTransports.set(webAppTransport.sessionId, serverTransport);

    // Handle cleanup when connection closes
    const handleConnectionClose = () => {
      const mcpServerName =
        (req.query.mcpServerName as string) || "Unknown Server";
      console.log(
        `Connection closed for session ${webAppTransport.sessionId}, MCP server: ${mcpServerName}`,
      );
      cleanupSession(webAppTransport.sessionId, mcpServerName);
    };

    // Handle various connection termination scenarios
    res.on("close", handleConnectionClose);
    res.on("finish", handleConnectionClose);
    res.on("error", (error) => {
      console.error(
        `Response error for SSE session ${webAppTransport.sessionId}:`,
        error,
      );
      handleConnectionClose();
    });

    await webAppTransport.start();

    const stdinTransport = serverTransport as StdioClientTransport;
    if (stdinTransport.stderr) {
      stdinTransport.stderr.on("data", (chunk) => {
        if (chunk.toString().includes("MODULE_NOT_FOUND")) {
          webAppTransport.send({
            jsonrpc: "2.0",
            method: "notifications/stderr",
            params: {
              content: "Command not found, transports removed",
            },
          });
          webAppTransport.close();
          cleanupSession(webAppTransport.sessionId);
          console.error("Command not found, transports removed");
        } else {
          webAppTransport.send({
            jsonrpc: "2.0",
            method: "notifications/stderr",
            params: {
              content: chunk.toString(),
            },
          });
        }
      });
    }

    mcpProxy({
      transportToClient: webAppTransport,
      transportToServer: serverTransport,
    });
  } catch (error) {
    console.error("Error in /stdio route:", error);
    res.status(500).json(error);
  }
});

serverRouter.get("/sse", async (req, res) => {
  try {
    console.log(
      "New SSE connection request. NOTE: The sse transport is deprecated and has been replaced by StreamableHttp",
    );
    let serverTransport: Transport | undefined;
    try {
      serverTransport = await createTransport(req);
    } catch (error) {
      if (error instanceof SseError && error.code === 401) {
        console.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        res.status(401).json(error);
        return;
      } else if (error instanceof SseError && error.code === 404) {
        console.error(
          "Received 404 not found from MCP server. Does the MCP server support SSE?",
        );
        res.status(404).json(error);
        return;
      } else if (JSON.stringify(error).includes("ECONNREFUSED")) {
        console.error("Connection refused. Is the MCP server running?");
        res.status(500).json(error);
      } else {
        throw error;
      }
    }

    if (serverTransport) {
      const webAppTransport = new SSEServerTransport(
        "/mcp-proxy/server/message",
        res,
      );
      webAppTransports.set(webAppTransport.sessionId, webAppTransport);
      console.log("Created client transport");
      if (serverTransport) {
        serverTransports.set(webAppTransport.sessionId, serverTransport);
      }
      console.log("Created server transport");

      // Handle cleanup when connection closes
      const handleConnectionClose = () => {
        const mcpServerName =
          (req.query.mcpServerName as string) || "Unknown Server";
        console.log(
          `Connection closed for session ${webAppTransport.sessionId}, MCP server: ${mcpServerName}`,
        );
        cleanupSession(webAppTransport.sessionId, mcpServerName);
      };

      // Handle various connection termination scenarios
      res.on("close", handleConnectionClose);
      res.on("finish", handleConnectionClose);
      res.on("error", (error) => {
        console.error(
          `Response error for STDIO session ${webAppTransport.sessionId}:`,
          error,
        );
        handleConnectionClose();
      });

      await webAppTransport.start();

      mcpProxy({
        transportToClient: webAppTransport,
        transportToServer: serverTransport,
      });
    }
  } catch (error) {
    console.error("Error in /sse route:", error);
    res.status(500).json(error);
  }
});

serverRouter.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    // console.log(`Received POST message for sessionId ${sessionId}`);

    const transport = webAppTransports.get(
      sessionId as string,
    ) as SSEServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Error in /message route:", error);
    res.status(500).json(error);
  }
});

serverRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

export default serverRouter;
