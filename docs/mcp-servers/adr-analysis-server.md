# Adding ADR Analysis MCP Server

The ADR Analysis MCP Server provides AI-powered architectural insights and development workflow automation.

## Configuration

Add this to your MCP servers configuration:

```json
{
  "mcpServers": {
    "adr-analysis-server": {
      "command": "npx",
      "args": ["mcp-adr-analysis-server"],
      "env": {
        "OPENROUTER_API_KEY": "your-openrouter-api-key",
        "PROJECT_PATH": "/path/to/your/project",
        "AI_MODEL": "anthropic/claude-3.5-sonnet-20241022",
        "EXECUTION_MODE": "production",
        "LOG_LEVEL": "info"
      },
      "description": "AI-powered architectural analysis and ADR management",
      "type": "stdio"
    }
  }
}
```

## Alternative Installation Methods

### From Source
```json
{
  "mcpServers": {
    "adr-analysis-server": {
      "command": "node",
      "args": ["/path/to/mcp-adr-analysis-server/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your-openrouter-api-key",
        "PROJECT_PATH": "/path/to/your/project"
      },
      "description": "AI-powered architectural analysis and ADR management",
      "type": "stdio"
    }
  }
}
```

### Global Installation
```json
{
  "mcpServers": {
    "adr-analysis-server": {
      "command": "mcp-adr-analysis-server",
      "args": [],
      "env": {
        "OPENROUTER_API_KEY": "your-openrouter-api-key",
        "PROJECT_PATH": "/path/to/your/project"
      },
      "description": "AI-powered architectural analysis and ADR management",
      "type": "stdio"
    }
  }
}
```

## Required Environment Variables

- `OPENROUTER_API_KEY`: Your OpenRouter API key (required)
- `PROJECT_PATH`: Path to the project to analyze (required)

## Optional Environment Variables

- `AI_MODEL`: AI model to use (default: `anthropic/claude-3.5-sonnet-20241022`)
- `EXECUTION_MODE`: `development` or `production` (default: `production`)
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error` (default: `info`)

## Supported AI Models

- `anthropic/claude-3.5-sonnet-20241022` (default)
- `anthropic/claude-3.5-haiku-20241022`
- `openai/gpt-4o`
- `openai/gpt-4o-mini`

## Prerequisites

- Node.js >= 18.0.0
- OpenRouter API key

## Container Setup (Docker/Podman)

When running MetaMCP in a container, the MCP server needs access to your project directory. You must mount the directory containing your project files.

### Adding Project Directories

Use the `manage-paths.sh` script to add your project directory:

```bash
# Add your project directory for adr-analysis-server access
./manage-paths.sh add /path/to/your/project

# Example: Add a specific project
./manage-paths.sh add /home/user/my-webapp

# List currently mounted directories
./manage-paths.sh list

# Remove a directory if no longer needed
./manage-paths.sh remove /path/to/old/project
```

### Important Notes

- The `PROJECT_PATH` in your MCP server configuration must match a directory that's been added via `manage-paths.sh`
- Project directories are automatically mounted with SELinux compatibility (`:Z` flag)
- Changes take effect after container restart (managed automatically by the script)

### Example Workflow

1. Add your project directory:
   ```bash
   ./manage-paths.sh add /home/user/architecture-project
   ```

2. Configure the MCP server with the same path:
   ```json
   {
     "mcpServers": {
       "adr-analysis-server": {
         "command": "npx",
         "args": ["mcp-adr-analysis-server"],
         "env": {
           "OPENROUTER_API_KEY": "your-openrouter-api-key",
           "PROJECT_PATH": "/home/user/architecture-project",
           "AI_MODEL": "anthropic/claude-3.5-sonnet-20241022"
         },
         "description": "AI-powered architectural analysis and ADR management",
         "type": "stdio"
       }
     }
   }
   ```

3. The MCP server will now have read/write access to your project files

## Features

- AI-powered architectural insights
- Technology stack detection
- Architectural Decision Record (ADR) management
- Security and compliance checks
- Test-Driven Development (TDD) integration
- Deployment readiness validation