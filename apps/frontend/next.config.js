/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    // Use localhost for rewrites since frontend and backend run in the same container
    const backendUrl = "http://localhost:12009";

    return [
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
      // OAuth endpoints - these need to be at the root level for MCP clients
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*`,
      },
      // OAuth discovery endpoints - must be at root level for MCP compliance
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${backendUrl}/metamcp/.well-known/oauth-authorization-server`,
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: `${backendUrl}/metamcp/.well-known/oauth-protected-resource`,
      },
      {
        source: "/.well-known/:path*",
        destination: `${backendUrl}/metamcp/.well-known/:path*`,
      },
      // OAuth endpoints for MCP clients
      {
        source: "/oauth/authorize",
        destination: `${backendUrl}/metamcp/oauth/authorize`,
      },
      {
        source: "/oauth/token",
        destination: `${backendUrl}/metamcp/oauth/token`,
      },
      {
        source: "/oauth/callback",
        destination: `${backendUrl}/metamcp/oauth/callback`,
      },
      {
        source: "/oauth/introspect",
        destination: `${backendUrl}/metamcp/oauth/introspect`,
      },
      {
        source: "/oauth/revoke",
        destination: `${backendUrl}/metamcp/oauth/revoke`,
      },
      {
        source: "/oauth/userinfo",
        destination: `${backendUrl}/metamcp/oauth/userinfo`,
      },
      // OAuth authorize endpoint (for MCP clients that don't use discovery)
      {
        source: "/authorize",
        destination: `${backendUrl}/metamcp/oauth/authorize`,
      },
      // OAuth token endpoint (for MCP clients that don't use discovery)
      {
        source: "/token",
        destination: `${backendUrl}/metamcp/oauth/token`,
      },
      // OAuth introspect endpoint (for MCP clients that don't use discovery)
      {
        source: "/introspect",
        destination: `${backendUrl}/metamcp/oauth/introspect`,
      },
      // OAuth revoke endpoint (for MCP clients that don't use discovery)
      {
        source: "/revoke",
        destination: `${backendUrl}/metamcp/oauth/revoke`,
      },
      // OAuth register endpoint (for dynamic client registration)
      {
        source: "/register",
        destination: `${backendUrl}/api/auth/register`,
      },
      {
        source: "/trpc/:path*",
        destination: `${backendUrl}/trpc/frontend/:path*`,
      },
      {
        source: "/mcp-proxy/:path*",
        destination: `${backendUrl}/mcp-proxy/:path*`,
      },
      {
        source: "/metamcp/:path*",
        destination: `${backendUrl}/metamcp/:path*`,
      },
      {
        source: "/service/:path*",
        destination: "https://metatool-service.jczstudio.workers.dev/:path*",
      },
    ];
  },
};

export default nextConfig;
