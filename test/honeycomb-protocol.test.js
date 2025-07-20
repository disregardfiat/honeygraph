import { jest } from '@jest/globals';
import { HoneycombProtocolAdapter } from '../lib/honeycomb-protocol-adapter.js';
import WSHoneycombHandler from '../lib/ws-honeycomb-handler.js';
import { BlockDownloadRecovery } from '../lib/block-download-recovery.js';
import { 
  createMockWebSocket, 
  createMockLogger, 
  createMockDgraphClient,
  createMockRequest,
  getTestEnvironment
} from './utils/test-helpers.js';

describe('Honeycomb Protocol Integration Tests', () => {
  let protocolAdapter;
  let honeycombHandler;
  let blockRecovery;
  let mockLogger;
  let testEnv;

  beforeAll(() => {
    testEnv = getTestEnvironment();
  });

  beforeEach(() => {
    mockLogger = createMockLogger();

    protocolAdapter = new HoneycombProtocolAdapter({
      supportedTokens: ['DLUX', 'SPK', 'LARYNX', 'BROCA'],
      autoDetectNetwork: true
    });

    honeycombHandler = new WSHoneycombHandler({
      blockRecoveryEnabled: true,
      honeycombUrls: ['http://test.dlux.io'],
      zfsCheckpoints: null, // Use mock
      dgraphClient: createMockDgraphClient(),
      logger: mockLogger
    });

    blockRecovery = new BlockDownloadRecovery({
      honeycombUrls: ['http://test.dlux.io'],
      logger: mockLogger
    });
  });

  describe('Protocol Adapter', () => {
    test('should handle Honeycomb identify message', () => {
      const mockWS = createMockWebSocket('honeycomb-node-1');
      const mockReq = createMockRequest('192.168.1.100');

      // Initialize connection
      protocolAdapter.handleConnection(mockWS, mockReq);

      // Send identify message (Honeycomb format)
      const identifyMsg = {
        type: 'identify',
        source: 'honeycomb-spkcc',
        version: '1.5.0',
        token: 'SPK'
      };

      const translated = protocolAdapter.translateMessage(mockWS, identifyMsg);

      expect(translated.type).toBe('identify');
      expect(translated.source).toBe('honeycomb-spkcc');
      expect(translated.token).toBe('SPK');
      expect(mockWS.send).toHaveBeenCalledWith(
        expect.stringContaining('Identification received')
      );
    });

    test('should translate Honeycomb operation to internal format', () => {
      const mockWS = createMockWebSocket('honeycomb-node-1');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      // Honeycomb operation format (matches trackOperation output)
      const honeycombOp = {
        type: 'put',
        index: 123,
        blockNum: 12345,
        forkHash: 'QmForkABC123...',
        prevCheckpointHash: 'QmCheckpoint456...',
        path: 'accounts/alice',
        data: { balance: 1000 },
        timestamp: Date.now()
      };

      const translated = protocolAdapter.translateMessage(mockWS, honeycombOp);

      expect(translated.type).toBe('put');
      expect(translated.index).toBe(123);
      expect(translated.blockNum).toBe(12345);
      expect(translated.forkHash).toBe('QmForkABC123...');
      expect(translated.prevCheckpointHash).toBe('QmCheckpoint456...');
      expect(translated.path).toBe('accounts/alice');
      expect(translated.data).toEqual({ balance: 1000 });
      expect(translated.nodeId).toBe('honeycomb-node-1');
      expect(translated.token).toBe('DLUX'); // Default token
    });

    test('should handle write marker from Honeycomb', () => {
      const mockWS = createMockWebSocket('honeycomb-node-1');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      // Write marker (matches trackOperation('W') output)
      const writeMarker = {
        type: 'write_marker',
        index: 10,
        blockNum: 12345,
        forkHash: 'QmForkABC123...',
        prevCheckpointHash: 'QmCheckpoint456...'
      };

      const translated = protocolAdapter.translateMessage(mockWS, writeMarker);

      expect(translated.type).toBe('write_marker');
      expect(translated.index).toBe(10);
      expect(translated.blockNum).toBe(12345);
      expect(translated.forkHash).toBe('QmForkABC123...');
    });

    test('should handle checkpoint from Honeycomb', () => {
      const mockWS = createMockWebSocket('honeycomb-node-1');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      // Checkpoint (matches HoneycombWSClient.sendCheckpoint format)
      const checkpoint = {
        type: 'checkpoint',
        blockNum: 12346,
        hash: 'QmNewCheckpoint789...',
        timestamp: Date.now(),
        token: 'DLUX'
      };

      const translated = protocolAdapter.translateMessage(mockWS, checkpoint);

      expect(translated.type).toBe('sendCheckpoint');
      expect(translated.blockNum).toBe(12346);
      expect(translated.hash).toBe('QmNewCheckpoint789...');
    });

    test('should auto-detect SPK network', () => {
      const mockWS = createMockWebSocket('spk-node');
      const mockReq = createMockRequest('192.168.1.200');

      protocolAdapter.handleConnection(mockWS, mockReq);

      const identifyMsg = {
        type: 'identify',
        source: 'honeycomb-spkcc',
        version: '1.5.0',
        token: 'SPK'
      };

      const networkEventSpy = jest.fn();
      protocolAdapter.on('network:identified', networkEventSpy);

      protocolAdapter.translateMessage(mockWS, identifyMsg);

      expect(networkEventSpy).toHaveBeenCalledWith({
        nodeId: 'spk-node',
        prefix: 'spkcc_',
        tokens: ['SPK', 'LARYNX', 'BROCA'],
        source: 'honeycomb-spkcc',
        version: '1.5.0'
      });
    });

    test('should handle sync status exchange', () => {
      const mockWS = createMockWebSocket('honeycomb-node-1');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      const syncMsg = {
        type: 'sync_status',
        lastIndex: 150,
        token: 'DLUX'
      };

      const syncEventSpy = jest.fn();
      protocolAdapter.on('sync:status', syncEventSpy);

      const translated = protocolAdapter.translateMessage(mockWS, syncMsg);

      expect(translated).toBeNull(); // Handled internally
      expect(syncEventSpy).toHaveBeenCalledWith({
        nodeId: 'honeycomb-node-1',
        lastIndex: 150,
        token: 'DLUX'
      });
      expect(mockWS.send).toHaveBeenCalledWith(
        expect.stringContaining('sync_status')
      );
    });
  });

  describe('Honeycomb Handler Integration', () => {
    test('should handle complete Honeycomb flow', async () => {
      const mockWS = createMockWebSocket('honeycomb-integration');
      const mockReq = createMockRequest('192.168.1.100');

      // Track events
      const operationEvents = [];
      const checkpointEvents = [];

      honeycombHandler.on('operation', (event) => operationEvents.push(event));
      honeycombHandler.on('checkpoint', (event) => checkpointEvents.push(event));

      // 1. Connection
      honeycombHandler.handleConnection(mockWS, mockReq);

      // 2. Identify
      const identifyMsg = {
        type: 'identify',
        source: 'honeycomb-spkcc',
        version: '1.5.0',
        token: 'SPK'
      };
      honeycombHandler.handleMessage(mockWS, JSON.stringify(identifyMsg));

      // 3. Operations (Honeycomb format)
      const operations = [
        {
          type: 'put',
          index: 1,
          blockNum: 15000,
          forkHash: 'QmTestFork123...',
          prevCheckpointHash: 'QmPrevCheck456...',
          path: 'governance/proposals/1',
          data: { title: 'Test Proposal', votes: 100 },
          timestamp: Date.now()
        },
        {
          type: 'put',
          index: 2,
          blockNum: 15000,
          forkHash: 'QmTestFork123...',
          prevCheckpointHash: 'QmPrevCheck456...',
          path: 'governance/votes/alice',
          data: { proposal: 1, vote: 'yes' },
          timestamp: Date.now()
        }
      ];

      for (const op of operations) {
        honeycombHandler.handleMessage(mockWS, JSON.stringify(op));
      }

      // 4. Write marker
      const writeMarker = {
        type: 'write_marker',
        index: 10,
        blockNum: 15000,
        forkHash: 'QmTestFork123...',
        prevCheckpointHash: 'QmPrevCheck456...'
      };
      honeycombHandler.handleMessage(mockWS, JSON.stringify(writeMarker));

      // 5. Checkpoint
      const checkpoint = {
        type: 'checkpoint',
        blockNum: 15001,
        hash: 'QmNewCheckpoint789...',
        timestamp: Date.now(),
        token: 'SPK'
      };
      honeycombHandler.handleMessage(mockWS, JSON.stringify(checkpoint));

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify events
      expect(operationEvents).toHaveLength(3); // 2 ops + 1 write marker
      expect(checkpointEvents).toHaveLength(1);

      // Verify fork was created
      expect(honeycombHandler.forks.has('QmTestFork123...')).toBe(true);
      const fork = honeycombHandler.forks.get('QmTestFork123...');
      expect(fork.operations).toHaveLength(3);
      expect(fork.lastWriteMarker).toBeDefined();

      // Verify acknowledgments were sent
      expect(mockWS.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"ack"')
      );
    });

    test('should detect and handle fork mismatch', async () => {
      const mockWS = createMockWebSocket('fork-detector');
      const mockReq = createMockRequest('192.168.1.100');

      honeycombHandler.handleConnection(mockWS, mockReq);

      const forkDetectedSpy = jest.fn();
      honeycombHandler.on('fork:detected', forkDetectedSpy);

      // Set up existing checkpoint
      honeycombHandler.checkpoints.set(14999, 'QmExpectedHash...');

      // Send checkpoint with different prevHash (fork detected)
      const forkCheckpoint = {
        type: 'checkpoint',
        blockNum: 15000,
        hash: 'QmNewHash...',
        prevHash: 'QmDifferentHash...', // Doesn't match expected
        timestamp: Date.now(),
        token: 'DLUX'
      };

      honeycombHandler.handleMessage(mockWS, JSON.stringify(forkCheckpoint));

      expect(forkDetectedSpy).toHaveBeenCalledWith({
        blockNum: 15000,
        canonicalHash: 'QmNewHash...',
        forkHash: 'QmDifferentHash...',
        nodeId: 'fork-detector'
      });
    });
  });

  describe('Block Download Recovery', () => {
    test('should validate block data structure', () => {
      const validBlock = {
        blockNum: 12345,
        hash: 'QmBlockHash123...',
        operations: [
          { type: 'put', path: 'test/data', data: { value: 1 } }
        ]
      };

      const isValid = blockRecovery._validateBlockData(validBlock, 12345);
      expect(isValid).toBe(true);

      const invalidBlock = {
        blockNum: 12346, // Wrong block number
        operations: []
      };

      const isInvalid = blockRecovery._validateBlockData(invalidBlock, 12345);
      expect(isInvalid).toBe(false);
    });

    test('should handle cache management', () => {
      const blockData = {
        blockNum: 12345,
        blockHash: 'QmTest123...',
        operations: [],
        metadata: { downloadedAt: Date.now() }
      };

      blockRecovery.blockCache.set(12345, blockData);
      expect(blockRecovery.blockCache.has(12345)).toBe(true);

      const stats = blockRecovery.getCacheStats();
      expect(stats.cacheSize).toBe(1);
      expect(stats.activeDownloads).toBe(0);
    });

    test('should calculate recovery status', async () => {
      // Add some cached blocks
      blockRecovery.blockCache.set(100, { blockNum: 100 });
      blockRecovery.blockCache.set(102, { blockNum: 102 });

      const status = await blockRecovery.getRecoveryStatus(100, 105);

      expect(status.totalBlocks).toBe(6);
      expect(status.cachedBlocks).toBe(2);
      expect(status.missingBlocks).toEqual([101, 103, 104, 105]);
    });

    // Note: Network-dependent tests would need mocking of fetch
    test('should handle download errors gracefully', async () => {
      // Mock fetch to fail
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(blockRecovery.downloadBlock(99999))
        .rejects.toThrow('Failed to download block 99999 from any node');
    });
  });

  describe('Protocol Alignment', () => {
    test('should match exact Honeycomb trackOperation format', () => {
      const mockWS = createMockWebSocket('exact-match-test');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      // Exact format from honeycomb-spkcc/index.mjs trackOperation
      const honeycombFormat = {
        type: 'put',
        index: 123,
        blockNum: 12345,
        forkHash: 'QmLastIBlock123...',
        prevCheckpointHash: 'QmSecIBlock456...',
        path: 'accounts/alice',
        data: { balance: 500, stake: 200 },
        // Note: timestamp added by trackOperation
      };

      const translated = protocolAdapter.translateMessage(mockWS, honeycombFormat);

      // Should preserve all Honeycomb fields
      expect(translated.type).toBe('put');
      expect(translated.index).toBe(123);
      expect(translated.blockNum).toBe(12345);
      expect(translated.forkHash).toBe('QmLastIBlock123...');
      expect(translated.prevCheckpointHash).toBe('QmSecIBlock456...');
      expect(translated.path).toBe('accounts/alice');
      expect(translated.data).toEqual({ balance: 500, stake: 200 });
    });

    test('should handle write marker W format', () => {
      const mockWS = createMockWebSocket('write-marker-test');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      // Raw 'W' as sent by trackOperation('W')
      const translated = protocolAdapter.translateMessage(mockWS, 'W');

      expect(translated.type).toBe('write_marker');
      expect(translated.nodeId).toBe('write-marker-test');
    });

    test('should maintain lightweight Honeycomb client', () => {
      // Verify that Honeycomb only needs to send simple formats
      const honeycombMessages = [
        // Identify
        {
          type: 'identify',
          source: 'honeycomb-spkcc',
          version: '1.5.0',
          token: 'DLUX'
        },
        // Operation
        {
          type: 'put',
          index: 1,
          blockNum: 100,
          forkHash: 'abc',
          path: 'test',
          data: { value: 1 }
        },
        // Write marker
        'W',
        // Checkpoint
        {
          type: 'checkpoint',
          blockNum: 101,
          hash: 'def',
          timestamp: Date.now(),
          token: 'DLUX'
        }
      ];

      const mockWS = createMockWebSocket('lightweight-test');
      const mockReq = createMockRequest('192.168.1.100');

      protocolAdapter.handleConnection(mockWS, mockReq);

      // All messages should translate successfully
      honeycombMessages.forEach((msg, index) => {
        expect(() => {
          const translated = protocolAdapter.translateMessage(mockWS, msg);
          console.log(`Message ${index} translated:`, translated?.type);
        }).not.toThrow();
      });

      // Complexity stays in Honeygraph, not Honeycomb
      expect(protocolAdapter.connectionState.size).toBe(1);
      expect(protocolAdapter.getStats().connections).toBe(1);
    });
  });
});