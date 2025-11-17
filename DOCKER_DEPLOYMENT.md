# 🐳 Docker Deployment Guide

## Quick Start

### Step 1: Generate Secure Secrets
```bash
# Generate JWT Secret (copy output)
openssl rand -hex 32

# Generate Encryption Key (copy output)
openssl rand -hex 32
```

### Step 2: Configure Environment
```bash
# Create .env file
cp .env.example .env

# Edit with your values
nano .env
```

Required values in `.env`:
```env
JWT_SECRET=<paste-generated-jwt-secret>
ENCRYPTION_KEY=<paste-generated-encryption-key>
EMERGENT_LLM_KEY=<your-emergent-llm-key>  # Optional, for AI features
```

### Step 3: Launch
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check health
curl http://localhost:8000/api/health
```

### Step 4: Access
- **Application**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

## 📁 Architecture

**Single Container Deployment:**
- FastAPI serves both API (`/api/*`) and React frontend (`/*`)
- React build files copied to `/app/backend/static/`
- MongoDB in separate container

## 🔧 Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f app

# Restart after code changes
docker-compose restart app

# Rebuild after major changes
docker-compose up -d --build

# View MongoDB logs
docker-compose logs -f mongodb

# Access app container shell
docker exec -it katalusis-app bash

# Access MongoDB shell
docker exec -it katalusis-mongodb mongosh -u admin -p katalusis_secret_2024
```

## 💾 Backup & Restore

**Backup MongoDB:**
```bash
# Create backup
docker exec katalusis-mongodb mongodump \
  -u admin -p katalusis_secret_2024 \
  --authenticationDatabase admin \
  --out /data/backup

# Copy to host
docker cp katalusis-mongodb:/data/backup ./backup-$(date +%Y%m%d)
```

**Restore MongoDB:**
```bash
# Copy backup to container
docker cp ./backup-20240101 katalusis-mongodb:/data/restore

# Restore
docker exec katalusis-mongodb mongorestore \
  -u admin -p katalusis_secret_2024 \
  --authenticationDatabase admin \
  /data/restore
```

## 🔐 Production Security

1. **Change MongoDB Password**
   - Edit `docker-compose.yml`
   - Update `MONGO_INITDB_ROOT_PASSWORD`
   - Update `MONGO_URL` accordingly

2. **Restrict CORS**
   ```env
   CORS_ORIGINS=https://yourdomain.com
   ```

3. **Use HTTPS Reverse Proxy**
   - Nginx or Caddy in front of port 8000
   - Handle SSL/TLS termination
   - Forward to app container

4. **Environment File Permissions**
   ```bash
   chmod 600 .env
   ```

## 📊 Monitoring

**Health Check:**
```bash
curl http://localhost:8000/api/health
```

**Resource Usage:**
```bash
docker stats katalusis-app katalusis-mongodb
```

**Container Status:**
```bash
docker-compose ps
```

## 🐛 Troubleshooting

**App won't start:**
```bash
# Check logs
docker-compose logs app

# Verify MongoDB connection
docker exec katalusis-app ping mongodb
```

**Frontend not loading:**
```bash
# Verify static files exist
docker exec katalusis-app ls -la /app/backend/static

# Rebuild with no cache
docker-compose build --no-cache app
docker-compose up -d
```

**Database connection error:**
```bash
# Check MongoDB is running
docker-compose ps mongodb

# Test connection
docker exec katalusis-mongodb mongosh \
  -u admin -p katalusis_secret_2024 \
  --eval "db.adminCommand('ping')"
```

## 🔄 Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Verify
docker-compose logs -f app
```

## 📦 Ports

- `8000`: Application (API + Frontend)
- `27017`: MongoDB (internal use, exposed for backups)

## 💡 Production Tips

1. **Use Docker Swarm or Kubernetes** for high availability
2. **Set up automated backups** (cron job with mongodump)
3. **Monitor logs** with ELK stack or similar
4. **Use volume backups** for MongoDB data
5. **Set resource limits** in docker-compose.yml:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
   ```

## 📝 Notes

- Default admin: `admin@katalusis.com` / `Admin@123` (CHANGE THIS!)
- MongoDB data persists in Docker volume `mongodb_data`
- Logs persist in Docker volume `app_logs`
