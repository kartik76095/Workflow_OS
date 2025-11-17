#!/bin/bash
set -e

echo "=========================================="
echo "Katalusis Workflow OS - Starting..."
echo "=========================================="

# Wait for MongoDB to be ready
echo "Waiting for MongoDB..."
until curl -s http://mongodb:27017 > /dev/null 2>&1; do
    echo "MongoDB is unavailable - sleeping"
    sleep 2
done
echo "✅ MongoDB is ready!"

# Print environment info
echo "Environment: ${ENVIRONMENT:-development}"
echo "Port: ${PORT:-8000}"

# Start the FastAPI application
echo "Starting Katalusis Workflow OS..."
exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WORKERS:-4}
