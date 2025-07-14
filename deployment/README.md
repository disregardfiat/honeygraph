# Honeygraph Deployment Guide

This guide covers deploying Honeygraph in production with proper domain configuration and SSL support.

## Quick Start

### 1. Domain Setup

Point the following DNS records to your server:
- `honeygraph.example.com` → Your server IP
- `api.honeygraph.example.com` → Your server IP  
- `dgraph.honeygraph.example.com` → Your server IP
- `ratel.honeygraph.example.com` → Your server IP

### 2. Environment Configuration

```bash
# Copy the production environment template
cp .env.production .env

# Edit the configuration
nano .env
```

Key settings to update:
- `DOMAIN`: Your base domain (e.g., `honeygraph.example.com`)
- `JWT_SECRET`: Generate a strong secret key
- `AUTHORIZED_HONEYCOMB_NODES`: Comma-separated list of authorized Hive accounts

### 3. Deploy with Docker Compose

#### Option A: With Traefik (Automatic SSL)

```bash
# Use the production compose file
docker-compose -f docker-compose.production.yml up -d
```

Traefik will automatically:
- Request SSL certificates from Let's Encrypt
- Configure HTTPS for all services
- Handle SSL renewal

#### Option B: With Nginx

```bash
# Use the standard compose file
docker-compose up -d

# Install Nginx
sudo apt update && sudo apt install nginx certbot python3-certbot-nginx

# Copy nginx configuration
sudo cp deployment/nginx.conf /etc/nginx/sites-available/honeygraph
sudo ln -s /etc/nginx/sites-available/honeygraph /etc/nginx/sites-enabled/

# Update domain in config
sudo sed -i 's/honeygraph.example.com/your-domain.com/g' /etc/nginx/sites-available/honeygraph

# Get SSL certificates
sudo certbot --nginx -d honeygraph.example.com -d api.honeygraph.example.com -d dgraph.honeygraph.example.com -d ratel.honeygraph.example.com

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx
```

#### Option C: With Caddy

```bash
# Use the standard compose file  
docker-compose up -d

# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Copy Caddy configuration
sudo cp deployment/Caddyfile /etc/caddy/Caddyfile

# Update domain in config
sudo sed -i 's/honeygraph.example.com/your-domain.com/g' /etc/caddy/Caddyfile

# Reload Caddy
sudo systemctl reload caddy
```

## Service URLs

After deployment, your services will be available at:

- **API**: `https://api.honeygraph.example.com`
- **GraphQL**: `https://dgraph.honeygraph.example.com`
- **Ratel UI**: `https://ratel.honeygraph.example.com`

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Base domain for all services | `honeygraph.example.com` |
| `JWT_SECRET` | Secret key for JWT tokens | `your-super-secret-key` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_SUBDOMAIN` | Subdomain for API | `api` |
| `DGRAPH_SUBDOMAIN` | Subdomain for Dgraph | `dgraph` |
| `RATEL_SUBDOMAIN` | Subdomain for Ratel UI | `ratel` |
| `REQUIRE_HIVE_AUTH` | Enable Hive authentication | `true` |
| `AUTHORIZED_HONEYCOMB_NODES` | Authorized Hive accounts | (empty = all authenticated) |
| `LOG_LEVEL` | Logging level | `info` |
| `CORS_ORIGIN` | Allowed CORS origins | `https://${DOMAIN}` |

## Security Considerations

1. **Change Default Secrets**: Always change `JWT_SECRET` in production
2. **Restrict Access**: Use `AUTHORIZED_HONEYCOMB_NODES` to limit access
3. **Firewall**: Only expose ports 80/443, block direct access to service ports
4. **Updates**: Regularly update Docker images and host system

## Monitoring

### Check Service Status

```bash
# View all services
docker-compose ps

# View logs
docker-compose logs -f honeygraph-api
docker-compose logs -f dgraph-alpha

# Check specific service
docker logs honeygraph-api --tail 100
```

### Health Checks

- API Health: `https://api.honeygraph.example.com/health`
- Dgraph Health: `https://dgraph.honeygraph.example.com/health`

## Backup

### Automated Backups

```bash
# Create backup script
cat > backup-honeygraph.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/honeygraph/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# Backup Dgraph
docker exec honeygraph-alpha bash -c "curl localhost:8080/admin/export"
docker cp honeygraph-alpha:/dgraph/export $BACKUP_DIR/dgraph

# Backup Redis
docker exec honeygraph-redis redis-cli BGSAVE
sleep 5
docker cp honeygraph-redis:/data/dump.rdb $BACKUP_DIR/redis.rdb

# Compress
tar -czf $BACKUP_DIR.tar.gz -C $(dirname $BACKUP_DIR) $(basename $BACKUP_DIR)
rm -rf $BACKUP_DIR

# Keep only last 7 days
find /backups/honeygraph -name "*.tar.gz" -mtime +7 -delete
EOF

chmod +x backup-honeygraph.sh

# Add to crontab
echo "0 2 * * * /path/to/backup-honeygraph.sh" | crontab -
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check what's using the port
   sudo lsof -i :6379
   
   # Stop conflicting service or change port in docker-compose.yml
   ```

2. **SSL Certificate Issues**
   - Ensure DNS is properly configured before requesting certificates
   - Check Traefik logs: `docker logs honeygraph-traefik`

3. **Connection Refused**
   - Check firewall rules: `sudo ufw status`
   - Verify services are running: `docker-compose ps`

4. **Performance Issues**
   - Monitor resources: `docker stats`
   - Check logs for errors: `docker-compose logs`

## Scaling

For high-availability setups:

1. **Multiple Dgraph Alphas**: Add more alpha nodes in docker-compose
2. **Redis Cluster**: Replace single Redis with Redis Cluster
3. **Load Balancer**: Use external load balancer for API instances
4. **Monitoring**: Add Prometheus + Grafana for metrics

## Support

- Documentation: [https://github.com/your-org/honeygraph](https://github.com/your-org/honeygraph)
- Issues: [https://github.com/your-org/honeygraph/issues](https://github.com/your-org/honeygraph/issues)