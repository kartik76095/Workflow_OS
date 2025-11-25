# ==================================================
# Stage 1: Build React Frontend
# ==================================================
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy ONLY package.json first (Safer than looking for specific lock files)
COPY frontend/package.json ./

# Install dependencies using standard NPM
RUN npm install --legacy-peer-deps && npm install ajv@8.12.0 --legacy-peer-deps

# Copy frontend source
COPY frontend/ ./

# Build React app
RUN npm run build

# ==================================================
# Stage 2: Setup Python Backend
# ==================================================
FROM python:3.11-slim AS backend-builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ==================================================
# Stage 3: Final Production Image
# ==================================================
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from builder
COPY --from=backend-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend-builder /usr/local/bin /usr/local/bin

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend from frontend-builder
COPY --from=frontend-builder /app/frontend/build ./backend/static/

# Create necessary directories
RUN mkdir -p /app/logs

# Copy entrypoint script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV WORKERS=4

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Set working directory
WORKDIR /app/backend

# Run the application via entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
