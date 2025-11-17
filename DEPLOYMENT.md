# Katalusis Workflow OS - Production Deployment Guide

## 🚀 Quick Start with Docker

### Prerequisites
- Docker Engine 20.10+
- Docker Compose 2.0+
- 2GB RAM minimum, 4GB recommended
- 10GB disk space

### 1. Clone and Configure

```bash
# Navigate to project directory
cd katalusis-workflow-os

# Copy environment template
cp .env.example .env

# Edit .env with your secure values
nano .env
```

### 2. Generate Secure Keys

```bash
# Generate JWT Secret
openssl rand -hex 32

# Generate Encryption Key
openssl rand -hex 32
```

Update `.env` with these generated keys.

### 3. Launch Application

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Check service health
docker-compose ps
```

### 4. Access Application

- **Application URL**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs (Swagger UI)
- **Health Check**: http://localhost:8000/api/health

### 5. Create Admin User

```bash
# Connect to app container
docker exec -it katalusis-app bash

# Use the API or create via MongoDB
# Default credentials (CHANGE IMMEDIATELY):
# Email: admin@katalusis.com
# Password: Admin@123
```

## 📋 Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for JWT tokens | Generate with `openssl rand -hex 32` |
| `EMERGENT_LLM_KEY` | API key for AI features | Get from emergent.agent |
| `ENCRYPTION_KEY` | Key for encrypting secrets | Generate with `openssl rand -hex 32` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_EXPIRATION_HOURS` | Token expiration time | 24 |
| `CORS_ORIGINS` | Allowed origins for CORS | * |
| `MONGO_INITDB_ROOT_USERNAME` | MongoDB admin username | admin |
| `MONGO_INITDB_ROOT_PASSWORD` | MongoDB admin password | katalusis_secret_2024 |

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           Katalusis Workflow OS         │
│  ┌───────────────────────────────────┐  │
│  │   FastAPI Backend (Port 8000)     │  │
│  │   - API Endpoints (/api/*)        │  │
│  │   - Static React Files (/*)       │  │
│  │   - WebSocket Support             │  │
│  └───────────────────────────────────┘  │
│                  ↓                       │
│  ┌───────────────────────────────────┐  │
│  │   MongoDB (Port 27017)            │  │
│  │   - Document Storage              │  │
│  │   - Persistent Volumes            │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 🔧 Production Best Practices

### Security

1. **Change Default Credentials**
   ```bash
   # Update MongoDB password in docker-compose.yml
   MONGO_INITDB_ROOT_PASSWORD: your-strong-password-here
   ```

2. **Enable HTTPS** (Recommended: Use Nginx or Caddy as reverse proxy)
   ```nginx
   server {
       listen 443 ssl;
       server_name your-domain.com;
       
       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;
       
       location / {
           proxy_pass http://localhost:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

3. **Restrict CORS**
   ```env
   CORS_ORIGINS=https://your-domain.com
   ```

### Performance

1. **Increase Workers** (in Dockerfile CMD)
   ```dockerfile
   CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "8"]
   ```

2. **Add Redis for Caching** (Optional)
   ```yaml
   redis:
     image: redis:7-alpine
     ports:
       - "6379:6379"
   ```

### Monitoring

1. **View Application Logs**
   ```bash
   docker-compose logs -f app
   ```

2. **View MongoDB Logs**
   ```bash
   docker-compose logs -f mongodb
   ```

3. **Check Resource Usage**
   ```bash
   docker stats
   ```

## 🔄 Updates and Maintenance

### Update Application

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Backup Database

```bash
# Create backup
docker exec katalusis-mongodb mongodump --out /data/backup

# Copy backup to host
docker cp katalusis-mongodb:/data/backup ./mongodb-backup-$(date +%Y%m%d)
```

### Restore Database

```bash
# Copy backup to container
docker cp ./mongodb-backup katalusis-mongodb:/data/restore

# Restore data
docker exec katalusis-mongodb mongorestore /data/restore
```

## 🐛 Troubleshooting

### Application Won't Start

```bash
# Check logs
docker-compose logs app

# Verify MongoDB is running
docker-compose ps mongodb

# Test MongoDB connection
docker exec katalusis-mongodb mongosh -u admin -p katalusis_secret_2024
```

### Frontend Not Loading

```bash
# Verify static files were built
docker exec katalusis-app ls -la /app/backend/static

# Rebuild frontend
docker-compose build --no-cache app
```

### Database Connection Failed

```bash
# Check MONGO_URL format
# Should be: mongodb://username:password@mongodb:27017/database?authSource=admin

# Verify network connectivity
docker exec katalusis-app ping mongodb
```

## 📊 Scaling

### Horizontal Scaling with Load Balancer

```yaml
# docker-compose.scale.yml
services:
  app:
    deploy:
      replicas: 3
  
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
```

### Database Replication

For production, consider MongoDB Atlas or a replica set configuration.

## 🆘 Support

- **Documentation**: `/docs` in your deployment
- **API Reference**: `/docs` (Swagger UI)
- **GitHub Issues**: Create issue with logs and environment details

## 📄 License

Enterprise-ready deployment for Katalusis Workflow OS.
