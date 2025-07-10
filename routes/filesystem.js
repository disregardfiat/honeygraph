import { Router } from 'express';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('filesystem-api');

export function createFileSystemRoutes({ dgraphClient }) {
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
    try {
      const { username } = req.params;
      const requestPath = req.params[0] || '/';
      
      logger.info('Filesystem request', { username, path: requestPath });

      // Normalize path (ensure it starts with /)
      const normalizedPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
      
      // Check if this is a file or directory request
      const pathParts = normalizedPath.split('/').filter(p => p);
      const possibleFileName = pathParts[pathParts.length - 1];
      const hasExtension = possibleFileName && possibleFileName.includes('.');
      
      if (hasExtension) {
        // This looks like a file request
        await handleFileRequest(dgraphClient, username, normalizedPath, res);
      } else {
        // This is a directory request
        await handleDirectoryRequest(dgraphClient, username, normalizedPath, res);
      }
    } catch (error) {
      logger.error('Filesystem request failed', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
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
            storageAccount {
              username
              services @filter(eq(serviceType, "IPFS")) {
                api
                active
                enabled
              }
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
        if (node.storageAccount?.services) {
          for (const service of node.storageAccount.services) {
            if (service.active && service.enabled === 1 && service.api) {
              gateways.push({
                url: service.api,
                account: node.storageAccount.username,
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
    // Query for files matching this path, ordered by block number (newest first)
    const query = `
      query getFile($username: string, $filePath: string) {
        files(func: eq(ContractFile.path, $filePath)) @cascade {
          cid
          name
          size
          mimeType
          contract @filter(eq(purchaser.username, $username) AND eq(status, 3)) {
            id
            blockNumber
            purchaser {
              username
            }
            broker
          }
        }
      }
    `;

    const vars = { 
      $username: username,
      $filePath: filePath
    };

    const result = await dgraphClient.query(query, vars);
    const files = result.files || [];

    if (files.length === 0) {
      // Try to find by name in the parent directory
      const pathParts = filePath.split('/');
      const fileName = pathParts.pop();
      const parentPath = pathParts.join('/') || '/';

      const nameQuery = `
        query getFileByName($username: string, $parentPath: string, $fileName: string) {
          files(func: alloftext(ContractFile.name, $fileName)) @cascade {
            cid
            name
            size
            mimeType
            path
            contract @filter(
              eq(purchaser.username, $username) 
              AND eq(status, 3)
              AND eq(path, $parentPath)
            ) {
              id
              blockNumber
              purchaser {
                username
              }
              broker
            }
          }
        }
      `;

      const nameResult = await dgraphClient.queryWithVars(nameQuery, {
        $username: username,
        $parentPath: parentPath,
        $fileName: fileName
      });

      const namedFiles = nameResult.files || [];
      
      if (namedFiles.length === 0) {
        return res.status(404).json({ 
          error: 'File not found',
          path: filePath,
          username 
        });
      }

      files.push(...namedFiles);
    }

    // Sort by block number (newest first) for version control
    files.sort((a, b) => (b.contract.blockNumber || 0) - (a.contract.blockNumber || 0));
    
    // Get the newest version
    const newestFile = files[0];
    
    // Try to get gateways from the storage nodes that have this file
    let gatewayUrl = null;
    const storageGateways = await getStorageNodeGateways(dgraphClient, newestFile.contract.id);
    
    if (storageGateways.length > 0) {
      // Use the first available gateway from nodes storing this file
      gatewayUrl = `${storageGateways[0].url}/ipfs/${newestFile.cid}`;
      
      res.set({
        'X-Storage-Node': storageGateways[0].account,
        'X-Gateway-Priority': 'contract-storage-node'
      });
    } else {
      // Fallback: Try to find any available IPFS gateway in the network
      const allGateways = await getAllIPFSGateways(dgraphClient);
      
      if (allGateways.length > 0) {
        gatewayUrl = `${allGateways[0].url}/ipfs/${newestFile.cid}`;
        
        res.set({
          'X-Storage-Node': allGateways[0].account,
          'X-Gateway-Priority': 'network-fallback'
        });
      } else {
        // Final fallback to public IPFS gateway
        const ipfsGateway = process.env.IPFS_GATEWAY || 'https://ipfs.io';
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
    // First, get all contracts for the user
    const contractsQuery = `
      query getUserContracts($username: string) {
        user(func: eq(Account.username, $username)) {
          username
          contracts @filter(eq(status, 3)) {
            id
            blockNumber
            metadata {
              folderStructure
              encrypted
              autoRenew
            }
            files {
              cid
              name
              size
              mimeType
              path
            }
          }
        }
      }
    `;

    const result = await dgraphClient.queryWithVars(contractsQuery, { 
      $username: username 
    });

    if (!result.user || result.user.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        username 
      });
    }

    const user = result.user[0];
    const contracts = user.contracts || [];

    // Build file system structure
    const fileSystem = buildFileSystemStructure(contracts, directoryPath);

    // Format response
    const response = {
      path: directoryPath,
      username: username,
      type: 'directory',
      contents: fileSystem
    };

    res.json(response);
  }

  /**
   * Build file system structure from contracts
   */
  function buildFileSystemStructure(contracts, requestedPath) {
    const normalizedPath = requestedPath.endsWith('/') && requestedPath !== '/' 
      ? requestedPath.slice(0, -1) 
      : requestedPath;

    const items = new Map(); // Use map to handle duplicates
    const seenPaths = new Set();

    // Process all contracts
    for (const contract of contracts) {
      const files = contract.files || [];
      const folderStructure = contract.metadata?.folderStructure 
        ? JSON.parse(contract.metadata.folderStructure) 
        : null;

      // Process files
      for (const file of files) {
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
              size: file.size,
              mimeType: file.mimeType,
              contract: {
                id: contract.id,
                blockNumber: contract.blockNumber
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
                    path: `${normalizedPath}/${subdirName}`.replace('//', '/')
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
                path: `${normalizedPath}/${subdirName}`.replace('//', '/')
              });
            }
          }
        }
      }

      // Add folders from metadata if available
      if (folderStructure) {
        for (const [index, folderPath] of Object.entries(folderStructure)) {
          if (folderPath !== '/' && folderPath.startsWith(normalizedPath)) {
            const relativePath = folderPath.substring(normalizedPath.length);
            if (relativePath && !relativePath.includes('/')) {
              const folderName = relativePath.startsWith('/') 
                ? relativePath.substring(1) 
                : relativePath;
                
              if (folderName && !items.has(folderName)) {
                items.set(folderName, {
                  name: folderName,
                  type: 'directory',
                  path: `${normalizedPath}/${folderName}`.replace('//', '/')
                });
              }
            }
          }
        }
      }
    }

    // Convert map to sorted array
    const itemsArray = Array.from(items.values());
    
    // Sort: directories first, then files, alphabetically within each
    itemsArray.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
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
        user(func: eq(Account.username, $username)) {
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
        const ipfsGateway = process.env.IPFS_GATEWAY || 'https://ipfs.io';
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
      return a.name.localeCompare(b.name);
    });
  }

  return router;
}

export default createFileSystemRoutes;