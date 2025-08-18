#!/bin/bash

# MetaMCP Project Path Management using yq
# Manages project directories that MCP servers can access by directly modifying podman-compose.yml

set -e

CONFIG_FILE="mcp-project-paths.conf"
COMPOSE_FILE="podman-compose.yml"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if yq is installed
check_yq() {
    if ! command -v yq &> /dev/null; then
        print_error "yq is required but not installed"
        echo "Install with: curl -fsSL https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o /tmp/yq && sudo mv /tmp/yq /usr/local/bin/yq && sudo chmod +x /usr/local/bin/yq"
        exit 1
    fi
}

# Initialize config file if it doesn't exist
init_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        cat > "$CONFIG_FILE" << EOF
# MetaMCP Project Paths Configuration
# This file lists directories that should be mounted in the MetaMCP container
# for MCP servers to access. One directory per line.
#
# Examples:
# /home/user/my-project       # For adr-analysis-server PROJECT_PATH
# /home/user/memories         # For Claude-Memory MEMORY_FILE_PATH
# /opt/data                   # For any other MCP server data access

# Default: Current MetaMCP directory
$(pwd)
EOF
        print_status "Created config file: $CONFIG_FILE"
    fi
}

# Sync volumes from config file to compose file
sync_volumes() {
    local temp_volumes=()
    
    # Read paths from config file
    while IFS= read -r path; do
        # Skip comments and empty lines
        if [[ -n "$path" && ! "$path" =~ ^[[:space:]]*# ]]; then
            # Expand path if needed
            path=$(realpath "$path" 2>/dev/null || echo "$path")
            temp_volumes+=("$path:$path:Z")
        fi
    done < "$CONFIG_FILE"
    
    # Clear existing volumes for the app service
    yq eval 'del(.services.app.volumes)' -i "$COMPOSE_FILE"
    
    # Add comment
    yq eval '.services.app.volumes = [] | .services.app.volumes line_comment = "Mount project directories for MCP server access (managed by manage-paths.sh)"' -i "$COMPOSE_FILE"
    
    # Add each volume mount
    for volume in "${temp_volumes[@]}"; do
        yq eval ".services.app.volumes += [\"$volume\"]" -i "$COMPOSE_FILE"
    done
    
    print_status "Synchronized volumes in $COMPOSE_FILE"
}

# Add a project path
add_path() {
    local project_path="$1"
    
    if [[ -z "$project_path" ]]; then
        print_error "Usage: $0 add /path/to/project"
        exit 1
    fi
    
    if [[ ! -d "$project_path" ]]; then
        print_error "Directory does not exist: $project_path"
        exit 1
    fi
    
    project_path=$(realpath "$project_path")
    
    # Check if already exists
    if [[ -f "$CONFIG_FILE" ]] && grep -Fxq "$project_path" "$CONFIG_FILE"; then
        print_warning "Path already exists: $project_path"
        return 0
    fi
    
    # Add to config file
    echo "$project_path" >> "$CONFIG_FILE"
    print_status "Added path to config: $project_path"
    
    # Sync to compose file
    sync_volumes
    
    # Restart services
    restart_services
}

# Remove a project path
remove_path() {
    local project_path="$1"
    
    if [[ -z "$project_path" ]]; then
        print_error "Usage: $0 remove /path/to/project"
        exit 1
    fi
    
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_warning "Config file not found"
        return 0
    fi
    
    project_path=$(realpath "$project_path" 2>/dev/null || echo "$project_path")
    
    # Remove from config file
    if grep -Fxq "$project_path" "$CONFIG_FILE"; then
        grep -Fvx "$project_path" "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        print_status "Removed path from config: $project_path"
        
        # Sync to compose file
        sync_volumes
        
        # Restart services
        restart_services
    else
        print_warning "Path not found in config: $project_path"
    fi
}

# List current paths
list_paths() {
    print_info "Current project paths for MCP servers:"
    echo ""
    
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_warning "No config file found. Run '$0 init' to create one."
        return 0
    fi
    
    local found_paths=false
    while IFS= read -r path; do
        # Skip comments and empty lines
        if [[ -n "$path" && ! "$path" =~ ^[[:space:]]*# ]]; then
            found_paths=true
            path=$(realpath "$path" 2>/dev/null || echo "$path")
            if [[ -d "$path" ]]; then
                print_status "$path"
            else
                print_error "$path (directory not found)"
            fi
        fi
    done < "$CONFIG_FILE"
    
    if [[ "$found_paths" == false ]]; then
        print_warning "No paths configured"
    fi
    
    echo ""
    print_info "Volume mounts in $COMPOSE_FILE:"
    yq eval '.services.app.volumes[]' "$COMPOSE_FILE" | while read -r mount; do
        echo "  $mount"
    done
}

# Restart services
restart_services() {
    print_info "Restarting MetaMCP services..."
    
    # Stop services
    if command -v podman-compose &> /dev/null; then
        podman-compose -f "$COMPOSE_FILE" down 2>/dev/null || true
        podman-compose -f "$COMPOSE_FILE" up -d
    else
        podman compose -f "$COMPOSE_FILE" down 2>/dev/null || true
        podman compose -f "$COMPOSE_FILE" up -d
    fi
    
    print_status "Services restarted successfully"
}

# Initialize configuration
init_cmd() {
    init_config
    sync_volumes
    print_status "Initialized MetaMCP path management"
}

# Show usage
show_help() {
    echo "MetaMCP Project Path Management (using yq)"
    echo ""
    echo "This tool manages project directories that MCP servers can access."
    echo "Paths are stored in $CONFIG_FILE and synchronized to $COMPOSE_FILE."
    echo ""
    echo "Usage:"
    echo "  $0 init                     Initialize configuration"
    echo "  $0 add /path/to/project     Add a project directory"
    echo "  $0 remove /path/to/project  Remove a project directory"
    echo "  $0 list                     List current project paths"
    echo "  $0 sync                     Sync config to compose file"
    echo "  $0 restart                  Restart services"
    echo ""
    echo "Examples:"
    echo "  $0 add /home/user/my-app                    # For general MCP access"
    echo "  $0 add /home/user/documents                 # For Claude-Memory storage"  
    echo "  $0 add /opt/projects/architecture-docs     # For adr-analysis-server"
    echo ""
    echo "MCP Server Examples:"
    echo "  adr-analysis-server needs PROJECT_PATH      -> add your project directory"
    echo "  Claude-Memory needs MEMORY_FILE_PATH        -> add your memory directory"
    echo ""
}

# Check prerequisites
check_yq

# Main command handling
case "${1:-list}" in
    "init")
        init_cmd
        ;;
    "add")
        init_config
        add_path "$2"
        ;;
    "remove"|"rm")
        remove_path "$2"
        ;;
    "list"|"ls"|"")
        init_config
        list_paths
        ;;
    "sync")
        init_config
        sync_volumes
        print_status "Synchronized volumes"
        ;;
    "restart")
        restart_services
        ;;
    "help"|"--help"|"-h")
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use 'help' for usage information"
        exit 1
        ;;
esac