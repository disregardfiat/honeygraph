#!/bin/bash

# Setup script for ZFS-based Honeygraph deployment
# This script should be run with sudo

set -e

echo "=== Honeygraph ZFS Setup Script ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (use sudo)"
  exit 1
fi

# Check if ZFS is installed
if ! command -v zfs &> /dev/null; then
    echo "ZFS not found. Please install ZFS first:"
    echo "  Ubuntu/Debian: apt install zfsutils-linux"
    echo "  CentOS/RHEL: yum install zfs"
    exit 1
fi

# Configuration
POOL_NAME="${ZFS_POOL:-tank}"
DATASET_NAME="${ZFS_DATASET:-dgraph}"
MOUNT_POINT="${ZFS_MOUNT:-/tank/dgraph}"

echo "Configuration:"
echo "  Pool: $POOL_NAME"
echo "  Dataset: $DATASET_NAME"
echo "  Mount point: $MOUNT_POINT"
echo ""

# Check if pool exists
if ! zpool list $POOL_NAME &> /dev/null; then
    echo "⚠️  Warning: ZFS pool '$POOL_NAME' not found"
    echo ""
    echo "ZFS pools available on this system:"
    zpool list 2>/dev/null || echo "  No ZFS pools found"
    echo ""
    echo "Available block devices:"
    lsblk -d -o NAME,SIZE,TYPE,MOUNTPOINT | grep -E "^(sd|nvme|vd)" || echo "  No suitable devices found"
    echo ""
    echo "Options:"
    echo "1. Create a ZFS pool manually:"
    echo "   zpool create $POOL_NAME /dev/sdX  (replace sdX with your device)"
    echo "   zpool create $POOL_NAME /path/to/file  (for testing with a file)"
    echo ""
    echo "2. Use an existing pool by setting ZFS_POOL environment variable:"
    echo "   export ZFS_POOL=existing_pool_name"
    echo "   sudo -E ./scripts/setup-zfs.sh"
    echo ""
    echo "3. Create a test pool with a file (for development only):"
    echo -n "   Would you like to create a test pool using a file? (y/N): "
    read response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "Creating test ZFS pool..."
        TEST_FILE="/var/lib/zfs-test-$POOL_NAME.img"
        
        # Create a 10GB sparse file
        truncate -s 10G "$TEST_FILE"
        
        # Create the pool
        if zpool create "$POOL_NAME" "$TEST_FILE"; then
            echo "✅ Test pool '$POOL_NAME' created successfully"
            echo "⚠️  WARNING: This is a file-based pool for testing only!"
            echo "   For production, use real block devices."
            echo ""
        else
            echo "❌ Failed to create test pool"
            exit 1
        fi
    else
        echo "Please create a ZFS pool and run this script again."
        exit 1
    fi
fi

# Create datasets for Dgraph
echo "Creating ZFS datasets..."

# Main dataset
if ! zfs list $POOL_NAME/$DATASET_NAME &> /dev/null; then
    echo "Creating $POOL_NAME/$DATASET_NAME..."
    zfs create -o mountpoint=$MOUNT_POINT $POOL_NAME/$DATASET_NAME
    
    # Set ZFS properties for database workload
    zfs set compression=lz4 $POOL_NAME/$DATASET_NAME
    zfs set atime=off $POOL_NAME/$DATASET_NAME
    zfs set xattr=sa $POOL_NAME/$DATASET_NAME
    zfs set recordsize=8k $POOL_NAME/$DATASET_NAME  # Optimal for Dgraph
else
    echo "Dataset $POOL_NAME/$DATASET_NAME already exists"
fi

# Create sub-datasets for zero and alpha
for service in zero alpha; do
    if ! zfs list $POOL_NAME/$DATASET_NAME/$service &> /dev/null; then
        echo "Creating $POOL_NAME/$DATASET_NAME/$service..."
        zfs create $POOL_NAME/$DATASET_NAME/$service
    else
        echo "Dataset $POOL_NAME/$DATASET_NAME/$service already exists"
    fi
done

# Set permissions
echo "Setting permissions..."
mkdir -p $MOUNT_POINT/{zero,alpha}
chown -R 1000:1000 $MOUNT_POINT  # Dgraph runs as UID 1000

# Create snapshot policy script
cat > /usr/local/bin/honeygraph-snapshot-cleanup.sh << 'EOF'
#!/bin/bash
# Cleanup old honeygraph snapshots

DATASET="${1:-tank/dgraph}"
MAX_SNAPSHOTS="${2:-100}"

# List snapshots sorted by creation time
snapshots=$(zfs list -t snapshot -o name,creation -s creation | grep "$DATASET@checkpoint" | awk '{print $1}')
count=$(echo "$snapshots" | wc -l)

if [ $count -gt $MAX_SNAPSHOTS ]; then
    to_delete=$((count - MAX_SNAPSHOTS))
    echo "$snapshots" | head -n $to_delete | while read snap; do
        echo "Deleting old snapshot: $snap"
        zfs destroy $snap
    done
fi
EOF

chmod +x /usr/local/bin/honeygraph-snapshot-cleanup.sh

# Add sudo rules for honeygraph user
echo "Setting up sudo permissions..."
cat > /etc/sudoers.d/honeygraph << EOF
# Allow honeygraph API to manage ZFS snapshots
honeygraph ALL=(ALL) NOPASSWD: /sbin/zfs snapshot tank/dgraph*
honeygraph ALL=(ALL) NOPASSWD: /sbin/zfs rollback *
honeygraph ALL=(ALL) NOPASSWD: /sbin/zfs destroy tank/dgraph@*
honeygraph ALL=(ALL) NOPASSWD: /sbin/zfs list *
honeygraph ALL=(ALL) NOPASSWD: /sbin/zfs diff *
honeygraph ALL=(ALL) NOPASSWD: /sbin/zfs clone *
honeygraph ALL=(ALL) NOPASSWD: /usr/bin/docker-compose stop dgraph-*
honeygraph ALL=(ALL) NOPASSWD: /usr/bin/docker-compose start dgraph-*
EOF

# Create systemd timer for snapshot cleanup (optional)
cat > /etc/systemd/system/honeygraph-snapshot-cleanup.service << EOF
[Unit]
Description=Honeygraph Snapshot Cleanup
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/honeygraph-snapshot-cleanup.sh $POOL_NAME/$DATASET_NAME 100
EOF

cat > /etc/systemd/system/honeygraph-snapshot-cleanup.timer << EOF
[Unit]
Description=Honeygraph Snapshot Cleanup Timer
Requires=honeygraph-snapshot-cleanup.service

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Enable timer
systemctl daemon-reload
systemctl enable honeygraph-snapshot-cleanup.timer

# Display ZFS status
echo ""
echo "=== ZFS Status ==="
zfs list -t all | grep $DATASET_NAME || true
echo ""

# Display snapshot settings
echo "=== Snapshot Settings ==="
echo "Auto-snapshot cleanup: Enabled (daily)"
echo "Max snapshots: 100"
echo "Snapshot prefix: checkpoint_"
echo ""

# Create .env template
cat > .env.zfs << EOF
# ZFS Configuration for Honeygraph
ZFS_CHECKPOINTS_ENABLED=true
ZFS_DATASET=$POOL_NAME/$DATASET_NAME
DGRAPH_DATA_PATH=$MOUNT_POINT
ZFS_MAX_SNAPSHOTS=100

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379

# Dgraph Configuration
DGRAPH_URL=http://dgraph-alpha:9080

# API Configuration
API_PORT=3030
NODE_ENV=production
EOF

echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy .env.zfs to .env and adjust settings"
echo "2. Run: docker-compose -f docker-compose.zfs.yml up -d"
echo "3. Initialize schema: docker-compose exec honeygraph-api npm run init-schema"
echo ""
echo "ZFS Commands:"
echo "  List snapshots: zfs list -t snapshot | grep $DATASET_NAME"
echo "  Create snapshot: zfs snapshot $POOL_NAME/$DATASET_NAME@manual_$(date +%Y%m%d_%H%M%S)"
echo "  Rollback: zfs rollback $POOL_NAME/$DATASET_NAME@snapshot_name"
echo ""