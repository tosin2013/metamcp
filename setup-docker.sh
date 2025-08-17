#!/bin/bash

set -e

echo "🐳 MetaMCP Docker Setup Script"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if Docker is installed
check_docker() {
    if command -v docker &> /dev/null; then
        print_status "Docker is installed"
        docker --version
    else
        print_error "Docker is not installed. Please install Docker first."
        echo "Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi
}

# Check if Docker Compose is available
check_docker_compose() {
    if command -v docker-compose &> /dev/null; then
        print_status "Docker Compose is installed"
        docker-compose --version
    elif docker compose version &> /dev/null; then
        print_status "Docker Compose (plugin) is installed"
        docker compose version
        DOCKER_COMPOSE_CMD="docker compose"
    else
        print_error "Docker Compose is not installed. Please install Docker Compose."
        echo "Visit: https://docs.docker.com/compose/install/"
        exit 1
    fi
}

# Check if Docker daemon is running
check_docker_daemon() {
    if docker info &> /dev/null; then
        print_status "Docker daemon is running"
    else
        print_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
}

# Set up environment file
setup_env() {
    if [[ ! -f .env ]]; then
        if [[ -f example.env ]]; then
            cp example.env .env
            print_status "Created .env file from example.env"
            print_warning "Please review and update .env file with your settings"
        else
            print_error "example.env file not found. Please create a .env file manually."
            exit 1
        fi
    else
        print_status ".env file already exists"
    fi
}

# Start services
start_services() {
    echo ""
    echo "Starting MetaMCP with Docker..."
    
    # Use docker-compose if available, otherwise use docker compose
    if [[ -n "$DOCKER_COMPOSE_CMD" ]]; then
        $DOCKER_COMPOSE_CMD -f docker-compose.yml up -d
    else
        docker-compose -f docker-compose.yml up -d
    fi
    
    print_status "MetaMCP services started successfully!"
    echo ""
    echo "🌐 Access MetaMCP at: http://localhost:12008"
    echo "🗄️  PostgreSQL available at: localhost:9433"
    echo ""
    echo "To view logs: docker-compose logs -f"
    echo "To stop services: docker-compose down"
}

# Main execution
main() {
    echo "Checking Docker installation..."
    check_docker
    check_docker_compose
    check_docker_daemon
    
    echo ""
    echo "Setting up environment..."
    setup_env
    
    echo ""
    start_services
    
    echo ""
    echo "🎉 MetaMCP is now running with Docker!"
    echo "Visit the URL above to get started."
}

# Run main function
main "$@"