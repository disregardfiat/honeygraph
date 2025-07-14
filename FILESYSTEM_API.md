# Filesystem API Documentation

The Filesystem API provides a familiar file system interface for accessing SPK Network storage contracts with intelligent IPFS gateway routing through actual storage nodes.

## Base URL

```
https://honeygraph.example.com/fs
```

## Endpoints

### Directory Listing

Get a listing of files and subdirectories for a user at a specific path.

```
GET /fs/:username/:path
```

#### Parameters
- `username` - The SPK account username
- `path` - The directory path (optional, defaults to root)

#### Example Requests
```bash
# Get root directory
GET /fs/alice

# Get Videos directory
GET /fs/alice/Videos

# Get nested directory
GET /fs/alice/Documents/Projects
```

#### Response Format
```json
{
  "path": "/Videos",
  "username": "alice",
  "type": "directory",
  "contents": [
    {
      "name": "vacation",
      "type": "directory",
      "path": "/Videos/vacation",
      "numberOfItems": 1
    },
    {
      "name": "tutorial.mp4",
      "type": "file",
      "cid": "QmXkEeNVh3Q2wK8MG5RCxA2tZsJmZaHtBFmkYgAPndu5jC",
      "size": 52428800,
      "mimeType": "video/mp4",
      "contract": {
        "id": "alice:0:94477061-457c1cb54b53658ec034b719ff8c158bd85ea430",
        "blockNumber": 94477061
      },
      "metadata": {
        "encrypted": false,
        "autoRenew": true
      }
    }
  ]
}
```

### File Access

Access a specific file by path. Automatically redirects to IPFS with version control.

```
GET /fs/:username/:filepath
```

#### Parameters
- `username` - The SPK account username
- `filepath` - Full path to the file including filename

#### Example Requests
```bash
# Access a video file
GET /fs/alice/Videos/tutorial.mp4

# Access a document
GET /fs/alice/Documents/report.pdf

# Access nested file
GET /fs/alice/Projects/website/index.html
```

#### Response
- **302 Redirect** to IPFS gateway URL
- **Headers**:
  - `X-IPFS-CID`: The IPFS content identifier
  - `X-Contract-ID`: The storage contract ID
  - `X-Block-Number`: Block number (for version tracking)
  - `X-File-Size`: File size in bytes
  - `X-Version-Count`: Number of versions available
  - `X-Storage-Node`: Account serving the file (if available)
  - `X-Gateway-Priority`: Gateway selection method used

#### Version Control
When multiple versions of a file exist (same path in different contracts), the API automatically selects the newest version based on block number.

## Features

### 1. Intelligent Gateway Routing
When accessing files, the system uses a multi-tier gateway selection strategy:

#### Primary: Contract Storage Nodes
- Queries the storage nodes assigned to the contract
- Looks for IPFS gateway services on those nodes
- Routes requests through nodes that actually have the file
- Ensures data locality and optimal performance

#### Fallback: Network-Wide Gateways
- If contract nodes don't have gateways, searches all network IPFS services
- Sorts by node health (lastGood block metric)
- Uses the healthiest available gateway

#### Final Fallback: Public Gateway
- Uses configured public IPFS gateway (default: ipfs.io)
- Ensures files are always accessible

### 2. Directory Navigation
- Browse user files like a traditional file system
- Support for nested directories
- Files and folders sorted alphabetically

### 3. Direct File Access
- Clean URLs that map to IPFS content
- Automatic IPFS gateway redirection
- No need to know IPFS CIDs

### 4. Version Control
- Automatic selection of newest file version
- Based on contract block number
- Transparent to the end user

### 5. Metadata Support
- File type detection via MIME types
- Encryption status
- Auto-renewal information
- Contract details

### 6. Path Resolution
- Support for both exact path matching
- Fallback to name-based search
- Case-sensitive file names

## Error Responses

### 404 Not Found
```json
{
  "error": "User not found",
  "username": "nonexistent"
}
```

```json
{
  "error": "File not found",
  "path": "/Videos/missing.mp4",
  "username": "alice"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Use Cases

### 1. Web Applications
Build file browsers and media galleries:
```javascript
// Fetch user's video directory
const response = await fetch('/fs/alice/Videos');
const directory = await response.json();

// Display files
directory.contents.forEach(item => {
  if (item.type === 'file' && item.mimeType.startsWith('video/')) {
    console.log(`Video: ${item.name} (${item.size} bytes)`);
  }
});
```

### 2. Direct Media Streaming
Embed media files directly:
```html
<!-- Video player -->
<video controls>
  <source src="/fs/alice/Videos/tutorial.mp4" type="video/mp4">
</video>

<!-- Image -->
<img src="/fs/alice/Photos/sunset.jpg" alt="Sunset">

<!-- Audio -->
<audio controls>
  <source src="/fs/alice/Music/song.mp3" type="audio/mpeg">
</audio>
```

### 3. Document Viewing
Link to documents:
```html
<a href="/fs/alice/Documents/report.pdf" target="_blank">
  View Report (PDF)
</a>
```

### 4. File Download
Direct download links:
```html
<a href="/fs/alice/Backups/data.zip" download>
  Download Backup
</a>
```

## Gateway Selection Details

### How It Works

1. **Contract Query**: For each file request, the system queries the storage contract to find assigned storage nodes
2. **Service Discovery**: Checks each storage node for active IPFS gateway services
3. **Priority Routing**: Routes through nodes that store the file when possible
4. **Health Monitoring**: Falls back to healthy network gateways if needed

### Example Gateway Response Headers
```
X-Gateway-Priority: contract-storage-node  # Served by actual storage node
X-Gateway-Priority: network-fallback       # Served by network gateway
X-Gateway-Priority: public-fallback        # Served by public gateway
X-Storage-Node: dlux-io                    # Gateway operator account
```

### Benefits

1. **Data Locality**: Files served by nodes that store them
2. **Load Distribution**: Spreads traffic across storage providers
3. **Reliability**: Multiple fallback options
4. **Performance**: Reduces IPFS DHT lookups
5. **Economics**: Storage nodes monetize gateway services

## Implementation Notes

1. **Performance**: Directory listings are built dynamically from contract data
2. **Caching**: Consider implementing caching for frequently accessed directories
3. **IPFS Gateway**: Configure `IPFS_GATEWAY` environment variable for fallback gateway
4. **Access Control**: Currently public - implement authentication if needed
5. **Large Directories**: Consider pagination for directories with many files
6. **Gateway Health**: Monitor storage node availability and performance

## Configuration

Set these environment variables:

```bash
# Fallback IPFS Gateway URL (defaults to https://ipfs.io)
# Only used when no storage node gateways are available
IPFS_GATEWAY=https://gateway.pinata.cloud

# Or use a local IPFS node
IPFS_GATEWAY=http://localhost:8080
```

## Service Registration

For storage nodes to provide gateway services:

1. **Register IPFS Service**:
```javascript
services['mynode']['IPFS']['gateway1'] = {
  a: "https://ipfs.mynode.com",  // Gateway URL
  b: "mynode",                    // Registered by
  c: 2000,                        // Cost in milliLARYNX
  e: 1,                           // Enabled (1 = yes)
  i: "12D3KooW...",              // IPFS peer ID
  m: "High-speed gateway"         // Description
}
```

2. **Maintain Node Health**:
- Keep `lastGood` block current
- Ensure gateway is accessible
- Monitor service availability

## Examples with cURL

```bash
# List root directory
curl https://honeygraph.example.com/fs/alice

# List Videos directory
curl https://honeygraph.example.com/fs/alice/Videos

# Get file (follow redirects)
curl -L https://honeygraph.example.com/fs/alice/Videos/tutorial.mp4

# Get file headers only
curl -I https://honeygraph.example.com/fs/alice/Videos/tutorial.mp4
```

This API makes SPK Network storage accessible through familiar file system semantics, enabling easy integration with existing applications and workflows.