# MCP Server Documentation

This directory contains documentation for configuring various MCP servers with MetaMCP.

## Container Path Management

When running MetaMCP in a container (Docker/Podman), MCP servers need explicit access to host directories. MetaMCP provides a simple path management system to handle this.

### Managing Project Directories

Use the `manage-paths.sh` script to manage directories that MCP servers can access:

```bash
# Add a directory for MCP server access
./manage-paths.sh add /path/to/your/project

# List currently accessible directories
./manage-paths.sh list

# Remove a directory
./manage-paths.sh remove /path/to/old/project

# Get help
./manage-paths.sh help
```

### How It Works

1. **Config File**: Project paths are stored in `mcp-project-paths.conf`
2. **YAML Sync**: The script uses `yq` to sync paths to `podman-compose.yml`
3. **SELinux**: Paths are mounted with `:Z` flag for SELinux compatibility
4. **Auto Restart**: Services are automatically restarted when paths change

### Common MCP Server Path Requirements

| MCP Server | Environment Variable | Purpose | Example |
|------------|---------------------|---------|---------|
| adr-analysis-server | `PROJECT_PATH` | Project to analyze | `/home/user/my-webapp` |
| Claude-Memory | `MEMORY_FILE_PATH` | Memory storage | `/home/user/claude-memory` |
| filesystem | `ROOT_PATH` | File access root | `/home/user/documents` |

### Best Practices

1. **Create specific directories** for MCP server data when possible
2. **Use absolute paths** in both the path manager and MCP server configs
3. **Verify paths exist** before adding them to the configuration
4. **Use descriptive directory names** to identify their purpose

### Example Workflow

1. Create and add a project directory:
   ```bash
   mkdir -p /home/user/architecture-project
   ./manage-paths.sh add /home/user/architecture-project
   ```

2. Configure your MCP server to use the same path:
   ```json
   {
     "mcpServers": {
       "my-server": {
         "command": "server-command",
         "env": {
           "PROJECT_PATH": "/home/user/architecture-project"
         }
       }
     }
   }
   ```

3. The MCP server now has access to files in that directory

## Troubleshooting

### Permission Denied Errors
- Ensure the directory is added via `./manage-paths.sh add`
- Check that the path in your MCP server config matches exactly
- Verify SELinux isn't blocking access (paths should have `:Z` flag)

### Path Not Found
- Use `./manage-paths.sh list` to see currently mounted paths
- Ensure the directory exists before adding it
- Use absolute paths, not relative ones

### Container Issues
- Restart services with `./manage-paths.sh restart` after changes
- Check container logs: `podman logs metamcp`
- Verify the compose file has the correct mounts: `yq eval '.services.app.volumes' podman-compose.yml`

## Security Considerations

- Only mount directories that MCP servers actually need
- Avoid mounting sensitive system directories
- Regularly review mounted paths with `./manage-paths.sh list`
- Remove unused paths to minimize attack surface

## Available MCP Servers

- [adr-analysis-server](./adr-analysis-server.md) - AI-powered architectural analysis
- [claude-memory](./claude-memory.md) - Persistent memory capabilities

For more MCP servers, visit the [MCP Server Registry](https://mcp-servers.com).