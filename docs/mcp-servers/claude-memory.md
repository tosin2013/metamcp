# Adding Claude-Memory MCP Server

The Claude-Memory MCP Server provides persistent memory capabilities through sentence transformers and vector similarity search, enabling storage and retrieval of conversations, facts, documents, and code snippets across sessions.

## Configuration

Add this to your MCP servers configuration:

```json
{
  "mcpServers": {
    "Claude-Memory": {
      "type": "STDIO",
      "description": "Provides persistent memory capabilities through sentence transformers and vector similarity search, enabling storage and retrieval of conversations, facts, documents, and code snippets across sessions",
      "command": "uvx",
      "args": [
        "memory_mcp",
        "-m",
        "memory_mcp"
      ],
      "env": {
        "MEMORY_FILE_PATH": "/home/ec2-user/metamcp/memory"
      }
    }
  }
}
```

## Container Setup (Docker/Podman)

When running MetaMCP in a container, the MCP server needs access to your memory storage directory. You must mount the directory where memory files will be stored.

### Adding Memory Directory

Use the `manage-paths.sh` script to add your memory storage directory:

```bash
# Create and add memory directory for Claude-Memory
mkdir -p /home/user/claude-memory
./manage-paths.sh add /home/user/claude-memory

# Or use a subdirectory of your existing project
./manage-paths.sh add /home/user/my-project/memory

# List currently mounted directories
./manage-paths.sh list
```

### Important Notes

- The `MEMORY_FILE_PATH` in your MCP server configuration must match a directory that's been added via `manage-paths.sh`
- Memory directories are automatically mounted with SELinux compatibility (`:Z` flag)  
- The directory must be writable for the MCP server to store memory files
- Changes take effect after container restart (managed automatically by the script)

### Example Workflow

1. Create and add your memory directory:
   ```bash
   mkdir -p /home/user/claude-memory
   ./manage-paths.sh add /home/user/claude-memory
   ```

2. Configure the MCP server with the same path:
   ```json
   {
     "mcpServers": {
       "Claude-Memory": {
         "type": "STDIO",
         "command": "uvx",
         "args": ["memory_mcp", "-m", "memory_mcp"],
         "env": {
           "MEMORY_FILE_PATH": "/home/user/claude-memory"
         },
         "description": "Persistent memory capabilities"
       }
     }
   }
   ```

3. The MCP server will now have read/write access to store and retrieve memories

## Required Environment Variables

- `MEMORY_FILE_PATH`: Path to the directory where memory files will be stored (required)

## Prerequisites

- Python 3.8+
- uv package manager (for uvx command)

## Features

- Persistent memory storage across sessions
- Vector similarity search for memory retrieval
- Support for conversations, facts, documents, and code snippets
- Sentence transformer-based embeddings
- Automatic memory indexing and search