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
            print_status "SELinux is enforcing - using Z volume flags in podman-compose.yml"
            print_info "Podman-compose.yml is already configured with SELinux-compatible volume flags"
        elif [[ "$selinux_status" == "Permissive" ]]; then
            print_warning "SELinux is in permissive mode"
        else
            print_status "SELinux is disabled"
        fi
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
    echo "  View logs: podman-compose -f podman-compose.yml logs -f"
    echo "  Stop services: podman-compose -f podman-compose.yml down"
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
    
    echo "Setting up environment..."
    setup_env
    configure_selinux
    
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
}

# Run main function
main "$@"