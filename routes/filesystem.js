import { Router } from 'express';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('filesystem-api');

export function createFileSystemRoutes({ dgraphClient, networkManager }) {
  const router = Router();

  /**
   * Get files shared with me (encrypted files I have access to)
   * GET /fse/:username/*path
   */
  router.get('/fse/:username/*', async (req, res) => {
    try {
      const { username } = req.params;
      const requestPath = req.params[0] || '/';
      
      logger.info('Shared with me request', { username, path: requestPath });
      
      // Handle shared encrypted files
      await handleSharedWithMeRequest(dgraphClient, username, requestPath, res);
    } catch (error) {
      logger.error('Shared with me request failed', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Get files I've shared with others
   * GET /fss/:username/*path
   */
  router.get('/fss/:username/*', async (req, res) => {
    try {
      const { username } = req.params;
      const requestPath = req.params[0] || '/';
      
      logger.info('Shared by me request', { username, path: requestPath });
      
      // Handle files shared by user
      await handleSharedByMeRequest(dgraphClient, username, requestPath, res);
    } catch (error) {
      logger.error('Shared by me request failed', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Get directory listing or file redirect
   * GET /fs/:username/*path
   */
  router.get('/fs/:username/*', async (req, res) => {
    const { username } = req.params;
    const requestPath = req.params[0] || '/';
    
    logger.info('=== FILESYSTEM ROUTE HIT ===', { username, requestPath, url: req.url });
    
    try {
      logger.info('Filesystem request', { username, path: requestPath });

      // Normalize path (ensure it starts with /)
      const normalizedPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
      
      // Check if this is a file or directory request
      const pathParts = normalizedPath.split('/').filter(p => p);
      const possibleFileName = pathParts[pathParts.length - 1];
      const hasExtension = possibleFileName && possibleFileName.includes('.');
      
      logger.info('Request type detection', {
        normalizedPath,
        pathParts,
        possibleFileName,
        hasExtension
      });
      
      if (hasExtension) {
        // This looks like a file request
        logger.info('Detected as file request, calling handleFileRequest');
        await handleFileRequest(dgraphClient, username, normalizedPath, res);
      } else {
        // This is a directory request
        logger.info('Detected as directory request, calling handleDirectoryRequest');
        await handleDirectoryRequest(dgraphClient, username, normalizedPath, res);
      }
    } catch (error) {
      logger.error('Filesystem request failed', { 
        error: error.message,
        stack: error.stack,
        username: username,
        path: requestPath
      });
      // Return a more detailed error for debugging
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        path: requestPath
      });
    }
  });

  /**
   * Get available IPFS gateways from storage nodes
   */
  async function getStorageNodeGateways(dgraphClient, contractId) {
    const query = `
      query getStorageGateways($contractId: string) {
        contract(func: eq(StorageContract.id, $contractId)) {
          id
          storageNodes {
            username
            services @filter(eq(serviceType, "IPFS")) {
              api
              active
              enabled
            }
          }
        }
      }
    `;

    try {
      const result = await dgraphClient.query(query, { $contractId: contractId });
      const contract = result.contract?.[0];
      
      if (!contract || !contract.storageNodes) {
        return [];
      }

      const gateways = [];
      
      for (const node of contract.storageNodes) {
        if (node.services) {
          for (const service of node.services) {
            if (service.active && service.enabled === 1 && service.api) {
              gateways.push({
                url: service.api,
                account: node.username,
                priority: gateways.length // First nodes have higher priority
              });
            }
          }
        }
      }
      
      return gateways;
    } catch (error) {
      logger.error('Failed to get storage gateways', { error: error.message, contractId });
      return [];
    }
  }

  /**
   * Get all available IPFS gateways from the network
   */
  async function getAllIPFSGateways(dgraphClient) {
    const query = `
      query getAllGateways {
        gateways(func: eq(Service.serviceType, "IPFS")) @filter(eq(active, true) AND eq(enabled, 1)) {
          api
          provider {
            username
            nodeMarketBid {
              domain
              lastGood
            }
          }
        }
      }
    `;

    try {
      const result = await dgraphClient.query(query);
      const services = result.gateways || [];
      
      return services
        .filter(s => s.api)
        .map(s => ({
          url: s.api,
          account: s.provider.username,
          lastGood: s.provider.nodeMarketBid?.lastGood || 0,
          domain: s.provider.nodeMarketBid?.domain
        }))
        .sort((a, b) => (b.lastGood || 0) - (a.lastGood || 0)); // Sort by health
    } catch (error) {
      logger.error('Failed to get all gateways', { error: error.message });
      return [];
    }
  }

  /**
   * Handle file requests - redirect to IPFS with version control
   */
  async function handleFileRequest(dgraphClient, username, filePath, res) {
    logger.info('handleFileRequest called', { username, filePath });
    
    // Get the correct network client (SPK network data is in spkccT_ namespace)
    const spkNetwork = networkManager.getNetwork('spkccT_');
    const networkClient = spkNetwork ? spkNetwork.dgraphClient : dgraphClient;
    
    logger.info('Using network client', { 
      hasSpkNetwork: !!spkNetwork,
      namespace: networkClient.namespace || 'default'
    });
    
    // Split the path to get directory and filename
    const pathParts = filePath.split('/');
    const fileNameWithExt = pathParts.pop();
    const parentPath = pathParts.join('/') || '/';
    
    // Split filename and extension
    const lastDotIndex = fileNameWithExt.lastIndexOf('.');
    let fileName, extension;
    if (lastDotIndex > 0) {
      fileName = fileNameWithExt.substring(0, lastDotIndex);
      extension = fileNameWithExt.substring(lastDotIndex + 1);
    } else {
      fileName = fileNameWithExt;
      extension = '';
    }
    
    // Query for files matching name with or without extension  
    // Debug: First find all paths for this user to see what exists
    const debugQuery = `
      query debugPaths($username: string) {
        user(func: eq(username, $username)) @filter(type(Account)) {
          uid
          username
          paths: ~owner @filter(type(Path)) {
            fullPath
            pathName
          }
        }
      }
    `;
    
    const debugResult = await networkClient.query(debugQuery, { $username: username });
    logger.info('Debug: All paths for user', {
      username,
      user: debugResult.user?.[0],
      pathCount: debugResult.user?.[0]?.paths?.length || 0,
      paths: debugResult.user?.[0]?.paths?.map(p => p.fullPath) || []
    });
    
    const query = `
      query getFile($username: string, $parentPath: string, $fileName: string, $extension: string) {
        paths(func: type(Path)) @filter(eq(fullPath, $parentPath) AND has(owner)) {
          fullPath
          owner @filter(eq(username, $username)) {
            username
          }
          files: ~parentPath @filter(type(ContractFile) AND eq(name, $fileName) AND eq(extension, $extension)) {
            uid
            cid
            name
            extension
            size
            mimeType
            flags
            isDeleted
            license
            labels
            thumbnail
            contract {
              id
              blockNumber
              purchaser {
                username
              }
              broker
              storageNodes {
                username
              }
            }
          }
        }
      }
    `;

    const vars = { 
      $username: username,
      $parentPath: parentPath,
      $fileName: fileName,
      $extension: extension
    };

    const result = await networkClient.query(query, vars);
    const paths = result.paths || [];
    
    // Extract files from the path result
    let files = [];
    if (paths.length > 0 && paths[0].files) {
      // Handle Dgraph single-element array issue
      files = Array.isArray(paths[0].files) ? paths[0].files : [paths[0].files];
    }
    
    logger.info('File query result', {
      username,
      parentPath,
      fileName,
      extension,
      fileNameWithExt,
      pathsFound: paths.length,
      resultCount: files.length,
      queryVars: vars,
      rawPaths: paths.map(p => ({ fullPath: p.fullPath, hasFiles: !!p.files, fileCount: p.files ? (Array.isArray(p.files) ? p.files.length : 1) : 0 })),
      files: files.map(f => ({ name: f.name, extension: f.extension, cid: f.cid }))
    });
    
    // Extension filtering is now done in the query

    // Filter out files with bitflag 2 (thumbnails/hidden files) and deleted files
    files = files.filter(file => !((file.flags || 0) & 2) && !file.isDeleted);
    
    if (files.length === 0) {
      return res.status(404).json({ 
        error: 'File not found',
        path: filePath,
        username 
      });
    }

    // Sort by block number (newest first) for version control
    files.sort((a, b) => (b.contract.blockNumber || 0) - (a.contract.blockNumber || 0));
    
    // Get the newest version
    const newestFile = files[0];
    
    // Try to get gateways from the storage nodes that have this file
    let gatewayUrl = null;
    const storageGateways = await getStorageNodeGateways(networkClient, newestFile.contract.id);
    
    if (storageGateways.length > 0) {
      // Use the first available gateway from nodes storing this file
      gatewayUrl = `${storageGateways[0].url}/ipfs/${newestFile.cid}`;
      
      res.set({
        'X-Storage-Node': storageGateways[0].account,
        'X-Gateway-Priority': 'contract-storage-node'
      });
    } else {
      // Fallback: Try to find any available IPFS gateway in the network
      const allGateways = await getAllIPFSGateways(networkClient);
      
      if (allGateways.length > 0) {
        gatewayUrl = `${allGateways[0].url}/ipfs/${newestFile.cid}`;
        
        res.set({
          'X-Storage-Node': allGateways[0].account,
          'X-Gateway-Priority': 'network-fallback'
        });
      } else {
        // Final fallback to public IPFS gateway
        const ipfsGateway = process.env.IPFS_GATEWAY || 'https://ipfs.dlux.io';
        gatewayUrl = `${ipfsGateway}/ipfs/${newestFile.cid}`;
        
        res.set({
          'X-Gateway-Priority': 'public-fallback'
        });
      }
    }
    
    // Add metadata headers
    res.set({
      'X-IPFS-CID': newestFile.cid,
      'X-Contract-ID': newestFile.contract.id,
      'X-Block-Number': newestFile.contract.blockNumber,
      'X-File-Size': newestFile.size,
      'X-Version-Count': files.length
    });

    // Redirect to IPFS gateway
    res.redirect(302, gatewayUrl);
  }

  /**
   * Handle directory requests - return listing of files and subdirectories
   */
  async function handleDirectoryRequest(dgraphClient, username, directoryPath, res) {
    logger.info('handleDirectoryRequest called', { username, directoryPath });
    
    // Get the correct network client (SPK network data is in spkccT_ namespace)
    const spkNetwork = networkManager.getNetwork('spkccT_');
    const networkClient = spkNetwork ? spkNetwork.dgraphClient : dgraphClient;
    
    logger.info('Using spkccT_ network client', { 
      clientNamespace: networkClient.namespace,
      hasClient: !!networkClient
    });
    
    // First get the user UID to ensure we can query with it
    // IMPORTANT: Accounts are global, not network-specific
    const userQuery = `
      query getUser($username: string) {
        user(func: eq(username, $username)) @filter(type(Account)) {
          uid
          username
        }
      }
    `;
    
    // Use global query for accounts - they exist across all networks
    const userResult = await (networkClient.queryGlobal ? 
      networkClient.queryGlobal(userQuery, { $username: username }) :
      networkClient.query(userQuery, { $username: username }));
    const user = userResult.user?.[0];
    
    if (!user) {
      logger.info('User not found', { username });
      return res.json({
        path: directoryPath,
        username: username,
        type: 'directory',
        contents: []
      });
    }
    
    // Normalize directory path - remove trailing slash unless it's root
    let normalizedPath;
    if (directoryPath === '' || directoryPath === '/') {
      normalizedPath = '/';
    } else {
      // Remove trailing slash
      normalizedPath = directoryPath.endsWith('/') ? directoryPath.slice(0, -1) : directoryPath;
      // Ensure it starts with /
      if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
      }
    }
    
    // Query all paths for this user to build directory structure
    // Use pagination to avoid exceeding gRPC message size limits
    const pageSize = 1000;
    let offset = 0;
    let allPaths = [];
    let hasMore = true;
    
    while (hasMore) {
      const allPathsQuery = `
        query getAllPaths($userUid: string, $offset: int, $limit: int) {
          paths(func: type(Path), first: $limit, offset: $offset) @filter(uid_in(owner, $userUid)) {
            uid
            fullPath
            pathName
            pathType
            itemCount
            files: ~parentPath @filter(type(ContractFile)) {
              uid
              cid
              name
              extension
              size
              mimeType
              license
              labels
              thumbnail
              flags
              isDeleted
              contract {
                id
                blockNumber
                encryptionData
                storageNodes {
                  username
                }
              }
            }
          }
        }
      `;

      logger.info('Querying paths page for user', { 
        username, 
        directoryPath: normalizedPath,
        userUid: user.uid,
        offset,
        limit: pageSize
      });
      
      let result;
      try {
        result = await networkClient.query(allPathsQuery, { 
          $userUid: user.uid,
          $offset: offset.toString(),
          $limit: pageSize.toString()
        });
        
        const pagePaths = result.paths || [];
        allPaths = allPaths.concat(pagePaths);
        
        // Debug log to check if files are being returned
        const pathsWithFiles = pagePaths.filter(p => p.files && p.files.length > 0);
        logger.info('Paths page query result', { 
          pagePathCount: pagePaths.length,
          totalPathCount: allPaths.length,
          offset,
          pathsWithFiles: pathsWithFiles.length,
          samplePath: pagePaths[0] ? {
            fullPath: pagePaths[0].fullPath,
            fileCount: pagePaths[0].files ? pagePaths[0].files.length : 0
          } : null
        });
        
        // Check if we got a full page (meaning there might be more)
        hasMore = pagePaths.length === pageSize;
        offset += pageSize;
        
      } catch (error) {
        logger.error('Paths page query failed', { 
          error: error.message, 
          stack: error.stack,
          offset 
        });
        throw error;
      }
    }
    const contents = new Map(); // Use Map to handle duplicates
    
    // Add preset folders if at root
    if (normalizedPath === '/') {
      const presetFolders = [
        'Documents', 'Images', 'Videos', 'Music', 'Archives', 'Code', 'Trash', 'Misc'
      ];
      
      for (const folderName of presetFolders) {
        contents.set(folderName, {
          name: folderName,
          type: 'directory',
          path: `/${folderName}`,
          itemCount: 0
        });
      }
    }
    
    // Process all paths to find items in the requested directory
    for (const pathEntity of allPaths) {
      const { fullPath, pathName, files } = pathEntity;
      
      // Debug log
      logger.debug('Checking path', {
        fullPath,
        normalizedPath,
        isMatch: fullPath === normalizedPath
      });
      
      // Check if this path is the requested directory
      if (fullPath === normalizedPath) {
        logger.debug('Found matching path for directory', {
          fullPath,
          hasFiles: !!files,
          fileCount: files ? (Array.isArray(files) ? files.length : 1) : 0
        });
        // Add files from this directory
        const filesArray = files ? (Array.isArray(files) ? files : [files]) : [];
        if (filesArray.length > 0) {
          for (const file of filesArray) {
            // Skip files with bitflag 2 (thumbnails/hidden) and deleted files
            if (((file.flags || 0) & 2) || file.isDeleted) {
              continue;
            }
            
            const contract = file.contract;
            
            // Skip files without names
            if (!file.name) {
              logger.warn('Skipping file without name', { 
                fileUid: file.uid,
                cid: file.cid,
                extension: file.extension
              });
              continue;
            }
            
            // Use name+extension as key for grouping versions
            const fileKey = file.extension ? `${file.name}.${file.extension}` : file.name;
            
            // Extract block number from contract ID (format: username:type:blockNumber-txid)
            let blockNumber = contract?.blockNumber;
            if (!blockNumber && contract?.id) {
              const parts = contract.id.split(':');
              if (parts.length >= 3) {
                const blockPart = parts[2].split('-')[0];
                blockNumber = parseInt(blockPart) || 0;
              }
            }
            
            const fileInfo = {
              name: file.name,
              type: 'file',
              cid: file.cid,
              extension: file.extension || '',
              size: file.size,
              mimeType: file.mimeType,
              license: file.license || '',
              labels: file.labels || '',
              thumbnail: file.thumbnail || '',
              contract: contract ? {
                id: contract.id,
                blockNumber: blockNumber,
                encryptionData: contract.encryptionData || null,
                storageNodeCount: contract.storageNodes ? (Array.isArray(contract.storageNodes) ? contract.storageNodes.length : 1) : 0,
                storageNodes: (() => {
                  console.log('Processing storageNodes for contract:', contract.id, {
                    hasStorageNodes: !!contract.storageNodes,
                    isArray: Array.isArray(contract.storageNodes),
                    storageNodes: contract.storageNodes
                  });
                  return contract.storageNodes ? (Array.isArray(contract.storageNodes) ? contract.storageNodes.map(n => n.username).filter(Boolean) : [contract.storageNodes.username].filter(Boolean)) : [];
                })()
              } : null,
              metadata: {
                encrypted: contract?.encryptionData ? true : false,
                autoRenew: true // TODO: get from contract metadata
              }
            };
            
            // Check if we already have a file with this key
            if (contents.has(fileKey)) {
              const existing = contents.get(fileKey);
              // Convert to revision structure if not already
              if (!existing.revisions) {
                // This is the first duplicate, convert to revision structure
                const currentFile = { ...existing };
                delete currentFile.revisions; // Remove any revision field from the copy
                
                contents.set(fileKey, {
                  name: existing.name,
                  type: 'file',
                  extension: existing.extension || '',
                  // Use the most recent file's CID as the primary
                  cid: blockNumber > (existing.contract?.blockNumber || 0) ? file.cid : existing.cid,
                  size: blockNumber > (existing.contract?.blockNumber || 0) ? file.size : existing.size,
                  mimeType: existing.mimeType,
                  license: existing.license || '',
                  labels: existing.labels || '',
                  thumbnail: existing.thumbnail || '',
                  contract: blockNumber > (existing.contract?.blockNumber || 0) ? fileInfo.contract : existing.contract,
                  metadata: blockNumber > (existing.contract?.blockNumber || 0) ? fileInfo.metadata : existing.metadata,
                  revisions: currentFile.cid === fileInfo.cid 
                    ? [blockNumber > (currentFile.contract?.blockNumber || 0) ? fileInfo : currentFile]
                    : [currentFile, fileInfo].sort((a, b) => (b.contract?.blockNumber || 0) - (a.contract?.blockNumber || 0))
                });
              } else {
                // Already has revisions, check if this CID already exists
                const existingRevisionIndex = existing.revisions.findIndex(r => r.cid === fileInfo.cid);
                
                if (existingRevisionIndex === -1) {
                  // New CID, add it
                  existing.revisions.push(fileInfo);
                } else {
                  // Same CID exists, update if this contract is newer
                  const existingRevision = existing.revisions[existingRevisionIndex];
                  if (blockNumber > (existingRevision.contract?.blockNumber || 0)) {
                    existing.revisions[existingRevisionIndex] = fileInfo;
                  }
                }
                
                // Resort by block number
                existing.revisions.sort((a, b) => (b.contract?.blockNumber || 0) - (a.contract?.blockNumber || 0));
                
                // Update the primary file info to the most recent
                const mostRecent = existing.revisions[0];
                existing.cid = mostRecent.cid;
                existing.size = mostRecent.size;
                existing.contract = mostRecent.contract;
                existing.metadata = mostRecent.metadata;
              }
            } else {
              // First file with this key
              contents.set(fileKey, fileInfo);
            }
          }
        }
      } else if (fullPath.startsWith(normalizedPath)) {
        // Check if this is a direct child directory
        const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/';
        if (fullPath.startsWith(prefix) && fullPath !== normalizedPath) {
          const remainingPath = fullPath.slice(prefix.length);
          // Only include if it's a direct child (no more slashes)
          if (!remainingPath.includes('/')) {
            contents.set(pathName, {
              name: pathName,
              type: 'directory',
              path: fullPath,
              itemCount: files ? (Array.isArray(files) ? files.filter(f => !((f.flags || 0) & 2) && !f.isDeleted).length : 1) : 0
            });
          }
        }
      }
    }
    
    // Item counts are now calculated directly from the files array in each path
    
    // Convert map to sorted array
    const contentsArray = Array.from(contents.values());
    
    // Sort contents: directories first, then files, alphabetically
    contentsArray.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      // Defensive check for missing names
      if (!a.name || !b.name) {
        logger.error('Missing name in sort', { 
          aName: a.name, 
          aType: a.type,
          bName: b.name,
          bType: b.type
        });
        return (!a.name ? 1 : 0) - (!b.name ? 1 : 0);
      }
      return a.name.localeCompare(b.name);
    });

    logger.info('Directory listing result', {
      directoryPath: normalizedPath,
      itemCount: contentsArray.length,
      directories: contentsArray.filter(i => i.type === 'directory').length,
      files: contentsArray.filter(i => i.type === 'file').length
    });

    // Format response
    const directoryResponse = {
      path: normalizedPath,
      username: username,
      type: 'directory',
      contents: contentsArray
    };

    res.json(directoryResponse);
  }

  /**
   * Build file system structure from contracts (DEPRECATED - using Path queries now)
   */
  function buildFileSystemStructure_DEPRECATED(contracts, requestedPath) {
    const normalizedPath = requestedPath.endsWith('/') && requestedPath !== '/' 
      ? requestedPath.slice(0, -1) 
      : requestedPath;

    const items = new Map(); // Use map to handle duplicates
    const seenPaths = new Set();
    
    // Add preset folders if we're at root
    logger.info('Building filesystem structure', { normalizedPath, requestedPath });
    if (normalizedPath === '' || normalizedPath === '/') {
      const presetFolders = {
        '2': 'Documents',
        '3': 'Images', 
        '4': 'Videos',
        '5': 'Music',
        '6': 'Archives',
        '7': 'Code',
        '8': 'Trash',
        '9': 'Misc'
      };
      
      for (const [index, folderName] of Object.entries(presetFolders)) {
        items.set(folderName, {
          name: folderName,
          type: 'directory',
          path: `/${folderName}`,
          itemCount: 0
        });
      }
    }
    
    // Track file counts per directory
    const directoryCounts = new Map();
    
    // First pass: Add all folders from metadata
    for (const contract of contracts) {
      const folderStructure = contract.metadata?.folderStructure 
        ? JSON.parse(contract.metadata.folderStructure) 
        : null;

      if (folderStructure) {
        logger.debug('Processing folder structure', { 
          contractId: contract.id,
          folderStructure,
          normalizedPath 
        });
        
        for (const [index, folderPath] of Object.entries(folderStructure)) {
          if (folderPath !== '/' && folderPath !== '') {
            // Handle subfolders like "1/Resources"
            if (folderPath.includes('/')) {
              const parts = folderPath.split('/');
              const parentIndex = parts[0];
              const folderName = parts[1];
              
              // Check if we should show this subfolder
              const parentFolder = Object.entries(folderStructure).find(([idx, path]) => idx === parentIndex);
              if (parentFolder) {
                const parentPath = parentFolder[1] === '/' ? '' : parentFolder[1];
                const parentFullPath = parentPath.startsWith('/') ? parentPath : `/${parentPath}`;
                
                // Show subfolder if we're in the parent directory
                if (normalizedPath === parentFullPath) {
                  items.set(folderName, {
                    name: folderName,
                    type: 'directory',
                    path: `${normalizedPath}/${folderName}`.replace('//', '/'),
                    itemCount: 0
                  });
                }
              }
            } else {
              // Top-level folder
              const folderName = folderPath.startsWith('/') ? folderPath.substring(1) : folderPath;
              
              // Only add top-level folders when at root
              if ((normalizedPath === '' || normalizedPath === '/') && folderName && !items.has(folderName)) {
                logger.info('Adding custom folder', { folderName, path: `/${folderName}` });
                items.set(folderName, {
                  name: folderName,
                  type: 'directory',
                  path: `/${folderName}`,
                  itemCount: 0
                });
              }
            }
          }
        }
      }
    }

    // Second pass: Process files and subdirectories
    for (const contract of contracts) {
      const files = contract.files || [];
      const folderStructure = contract.metadata?.folderStructure 
        ? JSON.parse(contract.metadata.folderStructure) 
        : null;

      // Process files
      for (const file of files) {
        // Skip files with bitflag 2 (thumbnails/hidden files)
        const fileFlags = file.flags || 0;
        if (fileFlags & 2) {
          continue;
        }
        
        const filePath = file.path || '/';
        const fileName = file.name || file.cid;

        // Check if file is in requested directory
        if (filePath === normalizedPath) {
          const existingFile = items.get(fileName);
          
          // Version control: keep the file from the newest contract
          if (!existingFile || contract.blockNumber > existingFile.contract.blockNumber) {
            items.set(fileName, {
              name: fileName,
              type: 'file',
              cid: file.cid,
              extension: file.extension || '',
              size: file.size,
              mimeType: file.mimeType,
              license: file.license || '',
              labels: file.labels || '',
              thumbnail: file.thumbnail || '',
              contract: {
                id: contract.id,
                blockNumber: contract.blockNumber,
                encryptionData: contract.encryptionData || null,
                storageNodeCount: contract.storageNodes ? (Array.isArray(contract.storageNodes) ? contract.storageNodes.length : 1) : 0,
                storageNodes: contract.storageNodes ? (Array.isArray(contract.storageNodes) ? contract.storageNodes.map(n => n.username).filter(Boolean) : [contract.storageNodes.username].filter(Boolean)) : []
              },
              metadata: {
                encrypted: contract.metadata?.encrypted || false,
                autoRenew: contract.metadata?.autoRenew || false
              }
            });
          }
        }

        // Track subdirectories
        if (filePath.startsWith(normalizedPath) && filePath !== normalizedPath) {
          const relativePath = filePath.substring(normalizedPath.length);
          const nextSlash = relativePath.indexOf('/', 1);
          
          if (nextSlash === -1) {
            // File in subdirectory
            const subPath = filePath;
            const subName = subPath.split('/').pop();
            
            if (!seenPaths.has(subPath)) {
              seenPaths.add(subPath);
              
              // Extract subdirectory
              const parts = relativePath.split('/').filter(p => p);
              if (parts.length > 0) {
                const subdirName = parts[0];
                if (!items.has(subdirName)) {
                  items.set(subdirName, {
                    name: subdirName,
                    type: 'directory',
                    path: `${normalizedPath}/${subdirName}`.replace('//', '/'),
                    itemCount: 0
                  });
                }
              }
            }
          } else {
            // Subdirectory
            const subdirName = relativePath.substring(1, nextSlash);
            if (!items.has(subdirName)) {
              items.set(subdirName, {
                name: subdirName,
                type: 'directory',
                path: `${normalizedPath}/${subdirName}`.replace('//', '/'),
                itemCount: 0
              });
            }
          }
        }
      }

      // Folders already processed in first pass
    }
    
    // Count files in subdirectories
    // We need to count files for any directory listing, not just root
    // Count files in subdirectories
    
    for (const contract of contracts) {
      const files = contract.files || [];
      // Process each file in the contract
      
      for (const file of files) {
        const fileFlags = file.flags || 0;
        if (fileFlags & 2) {
          // Skip thumbnails
          continue; // Skip thumbnails
        }
        
        const filePath = file.path || '/';
        // Check if file is in a subdirectory of our current path
        
        // For counting, we need to check if this file belongs to any subdirectory
        // that we're showing in the current listing
        if (filePath.startsWith(normalizedPath) && filePath !== normalizedPath) {
          const relativePath = filePath.substring(normalizedPath.length);
          const relativePathClean = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
          const pathParts = relativePathClean.split('/').filter(p => p);
          
          // File is in a subdirectory - count it for the immediate subdirectory
          
          // We need to count this file for its immediate parent directory
          // if that directory is shown in the current listing
          if (pathParts.length >= 1) {
            // Get the immediate subdirectory name relative to current path
            const immediateSubDir = pathParts[0];
            
            // Check if this subdirectory is shown in the current listing
            
            // Only count if this subdirectory is in our items listing
            if (items.has(immediateSubDir)) {
              const count = directoryCounts.get(immediateSubDir) || 0;
              directoryCounts.set(immediateSubDir, count + 1);
              // Increment count for this directory
            } else {
              // Subdirectory not shown in current listing
            }
          }
        }
      }
    }
    
    // File counting complete
    
    // Update item counts for ALL directories
    // Update item counts for all directories
    
    for (const [dirName, count] of directoryCounts) {
      if (items.has(dirName)) {
        const item = items.get(dirName);
        // Update the item count
        item.itemCount = count;
      } else {
        // Directory was removed or not found
      }
    }
    
    // Ensure all directories have itemCount set (even if 0)
    for (const item of items.values()) {
      if (item.type === 'directory' && !('itemCount' in item)) {
        item.itemCount = 0;
      }
    }

    // Convert map to sorted array
    const itemsArray = Array.from(items.values());
    
    // Sort: directories first, then files, alphabetically within each
    itemsArray.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      // Defensive check for missing names
      if (!a.name || !b.name) {
        return (!a.name ? 1 : 0) - (!b.name ? 1 : 0);
      }
      return a.name.localeCompare(b.name);
    });

    return itemsArray;
  }

  /**
   * Handle files shared with me (encrypted files where I have access)
   */
  async function handleSharedWithMeRequest(dgraphClient, username, requestPath, res) {
    // Query for encrypted contracts where this user has an encryption key
    const query = `
      query getSharedWithMe($username: string) {
        keys(func: eq(EncryptionKey.sharedWith, $username)) {
          encryptedKey
          keyType
          metadata {
            contract @filter(eq(status, 3)) {
              id
              purchaser {
                username
              }
              blockNumber
              files {
                cid
                name
                size
                mimeType
                path
                flags
                isDeleted
              }
              metadata {
                folderStructure
                encrypted
              }
            }
          }
        }
      }
    `;

    const result = await dgraphClient.query(query, { $username: username });
    const encryptionKeys = result.keys || [];

    // Build file system from shared contracts
    const contracts = [];
    const sharedInfo = new Map();
    
    for (const key of encryptionKeys) {
      if (key.metadata?.contract) {
        const contract = key.metadata.contract;
        contracts.push(contract);
        
        // Store sharing info for each contract
        sharedInfo.set(contract.id, {
          sharedBy: contract.purchaser.username,
          encryptedKey: key.encryptedKey,
          keyType: key.keyType
        });
      }
    }

    const normalizedPath = requestPath.endsWith('/') && requestPath !== '/' 
      ? requestPath.slice(0, -1) 
      : requestPath;

    // Check if this is a file request
    const pathParts = normalizedPath.split('/').filter(p => p);
    const possibleFileName = pathParts[pathParts.length - 1];
    const hasExtension = possibleFileName && possibleFileName.includes('.');

    if (hasExtension) {
      // File request - find and redirect
      await handleSharedFileRequest(dgraphClient, contracts, normalizedPath, sharedInfo, res);
    } else {
      // Directory listing
      const fileSystem = buildSharedFileSystemStructure(contracts, normalizedPath, sharedInfo);
      
      res.json({
        path: normalizedPath,
        username: username,
        type: 'shared-with-me',
        contents: fileSystem
      });
    }
  }

  /**
   * Handle files I've shared with others
   */
  async function handleSharedByMeRequest(dgraphClient, username, requestPath, res) {
    // Query for my encrypted contracts that have encryption keys
    const query = `
      query getSharedByMe($username: string) {
        user(func: eq(username, $username)) {
          contracts @filter(eq(status, 3)) @cascade {
            id
            blockNumber
            metadata @filter(eq(encrypted, true)) {
              encryptionKeys {
                sharedWith {
                  username
                }
                encryptedKey
                keyType
              }
              folderStructure
            }
            files {
              cid
              name
              size
              mimeType
              path
              isDeleted
            }
          }
        }
      }
    `;

    const result = await dgraphClient.query(query, { $username: username });
    const user = result.user?.[0];
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const contracts = user.contracts || [];
    const sharingInfo = new Map();
    
    // Build sharing info for each contract
    for (const contract of contracts) {
      if (contract.metadata?.encryptionKeys?.length > 0) {
        const sharedWith = contract.metadata.encryptionKeys.map(k => k.sharedWith.username);
        sharingInfo.set(contract.id, {
          sharedWith,
          totalShares: sharedWith.length
        });
      }
    }

    const normalizedPath = requestPath.endsWith('/') && requestPath !== '/' 
      ? requestPath.slice(0, -1) 
      : requestPath;

    // Check if this is a file request
    const pathParts = normalizedPath.split('/').filter(p => p);
    const possibleFileName = pathParts[pathParts.length - 1];
    const hasExtension = possibleFileName && possibleFileName.includes('.');

    if (hasExtension) {
      // File request - handle like normal but with sharing info
      await handleFileRequest(dgraphClient, username, normalizedPath, res);
    } else {
      // Directory listing with sharing info
      const fileSystem = buildSharedByMeFileSystemStructure(contracts, normalizedPath, sharingInfo);
      
      res.json({
        path: normalizedPath,
        username: username,
        type: 'shared-by-me',
        contents: fileSystem
      });
    }
  }

  /**
   * Handle shared file request
   */
  async function handleSharedFileRequest(dgraphClient, contracts, filePath, sharedInfo, res) {
    // Find the file in shared contracts
    let foundFile = null;
    let foundContract = null;
    
    for (const contract of contracts) {
      const files = contract.files || [];
      for (const file of files) {
        if (file.path === filePath || 
            (file.path + '/' + file.name) === filePath ||
            file.name === filePath.split('/').pop()) {
          if (!foundFile || contract.blockNumber > foundContract.blockNumber) {
            foundFile = file;
            foundContract = contract;
          }
        }
      }
    }
    
    if (!foundFile) {
      return res.status(404).json({ error: 'File not found in shared contracts' });
    }
    
    const shareInfo = sharedInfo.get(foundContract.id);
    
    // Try to get gateway URL using the same logic as regular files
    let gatewayUrl = null;
    const storageGateways = await getStorageNodeGateways(dgraphClient, foundContract.id);
    
    if (storageGateways.length > 0) {
      gatewayUrl = `${storageGateways[0].url}/ipfs/${foundFile.cid}`;
      res.set({
        'X-Storage-Node': storageGateways[0].account,
        'X-Gateway-Priority': 'contract-storage-node'
      });
    } else {
      const allGateways = await getAllIPFSGateways(dgraphClient);
      if (allGateways.length > 0) {
        gatewayUrl = `${allGateways[0].url}/ipfs/${foundFile.cid}`;
        res.set({
          'X-Storage-Node': allGateways[0].account,
          'X-Gateway-Priority': 'network-fallback'
        });
      } else {
        const ipfsGateway = process.env.IPFS_GATEWAY || 'https://ipfs.dlux.io';
        gatewayUrl = `${ipfsGateway}/ipfs/${foundFile.cid}`;
        res.set({ 'X-Gateway-Priority': 'public-fallback' });
      }
    }
    
    // Add sharing metadata
    res.set({
      'X-IPFS-CID': foundFile.cid,
      'X-Contract-ID': foundContract.id,
      'X-Shared-By': shareInfo.sharedBy,
      'X-Encrypted': 'true',
      'X-Encryption-Key': shareInfo.encryptedKey,
      'X-Key-Type': shareInfo.keyType
    });
    
    res.redirect(302, gatewayUrl);
  }

  /**
   * Build file system for shared contracts
   */
  function buildSharedFileSystemStructure(contracts, requestedPath, sharedInfo) {
    const items = new Map();
    
    for (const contract of contracts) {
      const shareInfo = sharedInfo.get(contract.id);
      const files = contract.files || [];
      
      for (const file of files) {
        // Skip files with bitflag 2 (thumbnails/hidden files)
        const fileFlags = file.flags || 0;
        if (fileFlags & 2) {
          continue;
        }
        
        const filePath = file.path || '/';
        const fileName = file.name || file.cid;
        
        if (filePath === requestedPath) {
          const existingFile = items.get(fileName);
          
          if (!existingFile || contract.blockNumber > existingFile.contract.blockNumber) {
            items.set(fileName, {
              name: fileName,
              type: 'file',
              cid: file.cid,
              size: file.size,
              mimeType: file.mimeType,
              contract: {
                id: contract.id,
                blockNumber: contract.blockNumber
              },
              sharing: {
                sharedBy: shareInfo.sharedBy,
                encrypted: true,
                hasKey: true
              }
            });
          }
        }
      }
    }
    
    return Array.from(items.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      // Defensive check for missing names
      if (!a.name || !b.name) {
        return (!a.name ? 1 : 0) - (!b.name ? 1 : 0);
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Build file system for contracts shared by me
   */
  function buildSharedByMeFileSystemStructure(contracts, requestedPath, sharingInfo) {
    const items = new Map();
    
    for (const contract of contracts) {
      const shareInfo = sharingInfo.get(contract.id);
      if (!shareInfo) continue; // Skip non-shared contracts
      
      const files = contract.files || [];
      
      for (const file of files) {
        // Skip files with bitflag 2 (thumbnails/hidden files)
        const fileFlags = file.flags || 0;
        if (fileFlags & 2) {
          continue;
        }
        
        const filePath = file.path || '/';
        const fileName = file.name || file.cid;
        
        if (filePath === requestedPath) {
          items.set(fileName, {
            name: fileName,
            type: 'file',
            cid: file.cid,
            size: file.size,
            mimeType: file.mimeType,
            contract: {
              id: contract.id,
              blockNumber: contract.blockNumber
            },
            sharing: {
              sharedWith: shareInfo.sharedWith,
              totalShares: shareInfo.totalShares,
              encrypted: true
            }
          });
        }
      }
    }
    
    return Array.from(items.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      // Defensive check for missing names
      if (!a.name || !b.name) {
        return (!a.name ? 1 : 0) - (!b.name ? 1 : 0);
      }
      return a.name.localeCompare(b.name);
    });
  }

  return router;
}

export default createFileSystemRoutes;