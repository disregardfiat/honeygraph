#!/bin/bash

# Initialize ZFS pool for testing
set -e

echo "Initializing ZFS pool for testing..."

# Load ZFS kernel module
modprobe zfs 2>/dev/null || echo "ZFS module already loaded or not available"

# Create a file-backed pool for testing
ZFS_POOL_NAME=${ZFS_POOL_NAME:-testpool}
ZFS_DATASET=${ZFS_DATASET:-testpool/honeygraph}
POOL_FILE="/zfs-pool/testpool.img"
POOL_SIZE="1G"

# Create pool file if it doesn't exist
if [ ! -f "$POOL_FILE" ]; then
    echo "Creating ZFS pool file: $POOL_FILE ($POOL_SIZE)"
    dd if=/dev/zero of="$POOL_FILE" bs=1M count=1024
    
    # Create ZFS pool
    echo "Creating ZFS pool: $ZFS_POOL_NAME"
    zpool create -f "$ZFS_POOL_NAME" "$POOL_FILE"
    
    # Create dataset for honeygraph
    echo "Creating ZFS dataset: $ZFS_DATASET"
    zfs create "$ZFS_DATASET"
    
    # Set properties for testing
    zfs set compression=lz4 "$ZFS_DATASET"
    zfs set atime=off "$ZFS_DATASET"
    
    echo "ZFS pool initialized successfully"
else
    echo "ZFS pool file exists, importing..."
    # Try to import existing pool
    zpool import -d /zfs-pool "$ZFS_POOL_NAME" 2>/dev/null || echo "Pool already imported or import failed"
fi

# Verify pool status
echo "ZFS pool status:"
zpool status "$ZFS_POOL_NAME" || echo "Failed to get pool status"

echo "ZFS datasets:"
zfs list | grep "$ZFS_POOL_NAME" || echo "No datasets found"

# Make ZFS commands available to testuser
echo "Setting up ZFS permissions..."
echo 'testuser ALL=(ALL) NOPASSWD: /sbin/zfs, /sbin/zpool' >> /etc/sudoers.d/zfs-testuser

# Execute the original command
exec "$@"