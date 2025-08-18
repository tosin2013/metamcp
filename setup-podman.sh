#!/bin/bash

set -e

echo "🦭 MetaMCP Podman Setup Script (RHEL/Fedora Optimized)"
echo "======================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Check if running on RHEL/Fedora
check_rhel_system() {
    if [[ -f /etc/redhat-release ]] || [[ -f /etc/fedora-release ]]; then
        print_status "Detected RHEL/Fedora system"
        if [[ -f /etc/redhat-release ]]; then
            cat /etc/redhat-release
        fi
        if [[ -f /etc/fedora-release ]]; then
            cat /etc/fedora-release
        fi
    else
        print_warning "Not running on RHEL/Fedora. This script is optimized for RHEL systems but may work on others."
    fi
}

# Check if Podman is installed
check_podman() {
    if command -v podman &> /dev/null; then
        print_status "Podman is installed"
        podman --version
    else
        print_error "Podman is not installed."
        echo ""
        echo "To install Podman on RHEL 9/8:"
        echo "  sudo dnf install -y podman podman-compose"
        echo ""
        echo "To install on Fedora:"
        echo "  sudo dnf install -y podman podman-compose"
        echo ""
        echo "To install on Ubuntu/Debian:"
        echo "  sudo apt-get update && sudo apt-get install -y podman podman-compose"
        exit 1
    fi
}

# Check if podman-compose is available
check_podman_compose() {
    if command -v podman-compose &> /dev/null; then
        print_status "podman-compose is installed"
        podman-compose --version
    else
        print_warning "podman-compose not found. Will try to use 'podman compose' instead."
        if podman compose --help &> /dev/null 2>&1; then
            print_status "podman compose command available"
            PODMAN_COMPOSE_CMD="podman compose"
        else
            print_warning "Neither podman-compose nor 'podman compose' is available."
            echo ""
            echo "Installation options:"
            echo ""
            echo "Option 1 - Install podman-compose:"
            echo "  # For RHEL 9/8:"
            echo "  sudo dnf install -y podman-compose"
            echo ""
            echo "  # Or via pip:"
            echo "  pip3 install --user podman-compose"
            echo ""
            echo "Option 2 - Use podman run commands directly:"
            echo "  # This script can create individual podman run commands"
            echo "  # Run with --podman-run flag to use this method"
            echo ""
            
            if [[ "$1" == "--podman-run" ]]; then
                print_info "Falling back to podman run commands..."
                USE_PODMAN_RUN=true
            else
                print_error "Exiting. Run with --podman-run flag to use podman run instead of compose."
                exit 1
            fi
        fi
    fi
}

# Check Podman configuration
check_podman_config() {
    print_info "Checking Podman configuration..."
    
    # Check if running rootless
    if [[ $(id -u) -ne 0 ]]; then
        print_status "Running rootless Podman (recommended for security)"
        
        # Check user namespaces
        if [[ -f /proc/sys/user/max_user_namespaces ]]; then
            max_ns=$(cat /proc/sys/user/max_user_namespaces)
            if [[ $max_ns -gt 0 ]]; then
                print_status "User namespaces enabled (max: $max_ns)"
            else
                print_warning "User namespaces disabled. May need root privileges or system configuration."
            fi
        fi
        
        # Check subuid/subgid
        if [[ -f /etc/subuid ]] && [[ -f /etc/subgid ]]; then
            if grep -q "$(whoami)" /etc/subuid && grep -q "$(whoami)" /etc/subgid; then
                print_status "User has subuid/subgid entries"
            else
                print_warning "User may need subuid/subgid configuration for rootless Podman"
                echo "Run: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $(whoami)"
            fi
        fi
    else
        print_warning "Running as root. Consider running as non-root user for better security."
    fi
}

# Check and install uv for Python MCP servers
setup_uv() {
    # Add common uv installation paths to PATH
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    
    if command -v uvx &> /dev/null; then
        print_status "uv is already installed at $(which uvx)"
        uv --version
    else
        print_warning "uv not found. Installing uv for Python MCP server support..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        
        # Reload PATH after installation
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
        source $HOME/.cargo/env 2>/dev/null || true
        
        if command -v uvx &> /dev/null; then
            print_status "uv installed successfully at $(which uvx)"
            uv --version
        else
            print_warning "uv installation may require shell restart. Run 'source ~/.bashrc' or restart terminal."
            print_info "You can also manually add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
        fi
    fi
}

# Check and install yq for YAML processing
setup_yq() {
    if command -v yq &> /dev/null; then
        print_status "yq is already installed at $(which yq)"
        yq --version
    else
        print_warning "yq not found. Installing yq for YAML processing..."
        
        # Try to install to user directory first, then system-wide
        if curl -fsSL https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o /tmp/yq; then
            # Try user installation first
            if mkdir -p "$HOME/.local/bin" && mv /tmp/yq "$HOME/.local/bin/yq" && chmod +x "$HOME/.local/bin/yq"; then
                export PATH="$HOME/.local/bin:$PATH"
                print_status "yq installed successfully to user directory at $HOME/.local/bin/yq"
                yq --version
            elif command -v sudo &> /dev/null && sudo mv "$HOME/.local/bin/yq" /usr/local/bin/yq 2>/dev/null; then
                print_status "yq installed successfully to system directory at /usr/local/bin/yq"
                yq --version
            else
                print_warning "yq downloaded but installation failed. You may need to manually install it."
                print_info "Try: chmod +x /tmp/yq && mv /tmp/yq \$HOME/.local/bin/yq"
                rm -f /tmp/yq "$HOME/.local/bin/yq" 2>/dev/null || true
            fi
        else
            print_warning "Failed to download yq. Path management script may not work properly."
        fi
    fi
}

# Set up environment file
setup_env() {
    if [[ ! -f .env ]]; then
        if [[ -f example.env ]]; then
            cp example.env .env
            print_status "Created .env file from example.env"
            
            # Update .env for Podman-specific settings
            if grep -q "TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL=true" .env; then
                sed -i 's/TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL=true/TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL=false/' .env
                print_status "Updated TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL for Podman"
            fi
            
            print_warning "Please review and update .env file with your settings"
        else
            print_error "example.env file not found. Please create a .env file manually."
            exit 1
        fi
    else
        print_status ".env file already exists"
    fi
}

# Configure SELinux if needed
configure_selinux() {
    if command -v getenforce &> /dev/null; then
        selinux_status=$(getenforce)
        if [[ "$selinux_status" == "Enforcing" ]]; then
            print_status "SELinux is enforcing - volume mounts will use :Z flags"
            print_info "Path management is handled by manage-paths.sh script"
        elif [[ "$selinux_status" == "Permissive" ]]; then
            print_warning "SELinux is in permissive mode"
        else
            print_status "SELinux is disabled"
        fi
    fi
}

# Initialize path management system
init_path_management() {
    if [[ -f manage-paths.sh ]]; then
        chmod +x manage-paths.sh
        ./manage-paths.sh init
        print_status "Initialized project path management system"
    else
        print_warning "manage-paths.sh not found. Path management will need to be set up manually."
    fi
}

# Start services with podman run (fallback method)
start_services_podman_run() {
    echo ""
    echo "Starting MetaMCP with individual podman run commands..."
    
    # Source environment variables
    if [[ -f .env ]]; then
        set -a
        source .env
        set +a
    fi
    
    # Set default values
    POSTGRES_USER=${POSTGRES_USER:-metamcp_user}
    POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-m3t4mcp}
    POSTGRES_DB=${POSTGRES_DB:-metamcp_db}
    POSTGRES_EXTERNAL_PORT=${POSTGRES_EXTERNAL_PORT:-9433}
    APP_URL=${APP_URL:-http://localhost:12008}
    BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-your-super-secret-key-change-this-in-production}
    
    # Create network
    podman network create metamcp-network 2>/dev/null || print_info "Network metamcp-network already exists"
    
    # Start PostgreSQL
    print_info "Starting PostgreSQL container..."
    podman run -d \
        --name metamcp-pg \
        --network metamcp-network \
        -p "${POSTGRES_EXTERNAL_PORT}:5432" \
        -e POSTGRES_DB="$POSTGRES_DB" \
        -e POSTGRES_USER="$POSTGRES_USER" \
        -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
        -v postgres_data:/var/lib/postgresql/data:Z \
        --restart unless-stopped \
        postgres:16-alpine
    
    # Wait for PostgreSQL to be ready
    print_info "Waiting for PostgreSQL to start..."
    sleep 10
    
    # Get current directory for volume mount
    current_dir=$(pwd)
    
    # Start MetaMCP application
    print_info "Starting MetaMCP application container..."
    podman run -d \
        --name metamcp \
        --network metamcp-network \
        -p "12008:12008" \
        -e POSTGRES_HOST=metamcp-pg \
        -e POSTGRES_PORT=5432 \
        -e POSTGRES_USER="$POSTGRES_USER" \
        -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
        -e POSTGRES_DB="$POSTGRES_DB" \
        -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@metamcp-pg:5432/${POSTGRES_DB}" \
        -e APP_URL="$APP_URL" \
        -e NEXT_PUBLIC_APP_URL="$APP_URL" \
        -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
        -e TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL=false \
        --add-host="host.containers.internal:host-gateway" \
        -v "${current_dir}:${current_dir}:Z" \
        ghcr.io/metatool-ai/metamcp:latest
    
    print_status "MetaMCP services started successfully with Podman!"
    echo ""
    echo "🌐 Access MetaMCP at: http://localhost:12008"
    echo "🗄️  PostgreSQL available at: localhost:${POSTGRES_EXTERNAL_PORT}"
    echo ""
    echo "Podman commands:"
    echo "  View logs: podman logs -f metamcp"
    echo "  Stop services: podman stop metamcp metamcp-pg && podman rm metamcp metamcp-pg"
    echo "  List containers: podman ps"
}

# Start services with compose
start_services() {
    echo ""
    echo "Starting MetaMCP with Podman..."
    
    # Use podman-compose if available, otherwise use podman compose
    if [[ -n "$PODMAN_COMPOSE_CMD" ]]; then
        $PODMAN_COMPOSE_CMD -f podman-compose.yml up -d
    else
        podman-compose -f podman-compose.yml up -d
    fi
    
    print_status "MetaMCP services started successfully with Podman!"
    echo ""
    echo "🌐 Access MetaMCP at: http://localhost:12008"
    echo "🗄️  PostgreSQL available at: localhost:9433"
    echo ""
    echo "Podman commands:"
    if [[ -n "$PODMAN_COMPOSE_CMD" ]]; then
        echo "  View logs: $PODMAN_COMPOSE_CMD -f podman-compose.yml logs -f"
        echo "  Stop services: $PODMAN_COMPOSE_CMD -f podman-compose.yml down"
    else
        echo "  View logs: podman-compose -f podman-compose.yml logs -f"
        echo "  Stop services: podman-compose -f podman-compose.yml down"
    fi
    echo "  List containers: podman ps"
    echo "  View pod: podman pod ls"
}

# Main execution
main() {
    echo "Checking system and Podman installation..."
    check_rhel_system
    echo ""
    check_podman
    check_podman_compose "$1"
    check_podman_config
    echo ""
    
    echo "Setting up development tools..."
    setup_uv
    setup_yq
    echo ""
    
    echo "Setting up environment..."
    setup_env
    configure_selinux
    init_path_management
    
    echo ""
    if [[ "$USE_PODMAN_RUN" == "true" ]]; then
        start_services_podman_run
    else
        start_services
    fi
    
    echo ""
    echo "🎉 MetaMCP is now running with Podman!"
    echo "This configuration is optimized for RHEL/Fedora systems."
    echo "Visit the URL above to get started."
    echo ""
    echo "📁 Project Path Management:"
    echo "  Use ./manage-paths.sh to manage directories that MCP servers can access:"
    echo "  Add project: ./manage-paths.sh add /path/to/project"
    echo "  Remove project: ./manage-paths.sh remove /path/to/project" 
    echo "  List projects: ./manage-paths.sh list"
    echo "  Help: ./manage-paths.sh help"
}

# Show usage
show_help() {
    echo "MetaMCP Podman Setup Script"
    echo ""
    echo "Usage:"
    echo "  $0                    Setup and start MetaMCP (default)"
    echo "  $0 --podman-run       Use podman run instead of compose"
    echo "  $0 --help             Show this help message"
    echo ""
    echo "This script will:"
    echo "  - Check system requirements (Podman, uv, yq)"
    echo "  - Set up environment configuration"
    echo "  - Initialize path management system"  
    echo "  - Start MetaMCP services"
    echo ""
}

# Handle command line arguments
case "${1:-setup}" in
    "setup"|"")
        main "$@"
        ;;
    "--podman-run")
        main "$@"
        ;;
    "--help"|"-h"|"help")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac