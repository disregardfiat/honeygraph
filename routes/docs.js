import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

export function createDocsRoutes() {
  const router = Router();

  // Serve individual documentation files
  router.get('/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      
      // Security: only allow specific file types and prevent directory traversal
      const allowedExtensions = ['.md', '.yml', '.yaml', '.js', '.json', '.txt'];
      const allowedFiles = [
        'INSTALLATION.md',
        'README.md', 
        'ARCHITECTURE.md',
        'QUERY_EXAMPLES.md',
        'MULTI_TOKEN_SETUP.md',
        'FILESYSTEM_API.md',
        'docker-compose.yml',
        'server.js',
        'package.json',
        'ACCOUNT_DATA_PATHS.md',
        'CONTRACT_QUERIES.md',
        'DEX_DATA_PATHS.md',
        'FILE_QUERIES.md',
        'OPERATION_FILTERING.md',
        'SHARING_API.md',
        'TRANSACTION_HISTORY.md'
      ];
      
      if (!allowedFiles.includes(filename)) {
        return res.status(404).json({ error: 'File not found or not allowed' });
      }
      
      const filePath = path.join(projectRoot, filename);
      const content = await readFile(filePath, 'utf-8');
      
      // Set appropriate content type
      const ext = path.extname(filename);
      if (ext === '.md') {
        res.type('text/plain');
      } else if (ext === '.json') {
        res.type('application/json');
      } else if (ext === '.js') {
        res.type('text/javascript');
      } else if (ext === '.yml' || ext === '.yaml') {
        res.type('text/yaml');
      } else {
        res.type('text/plain');
      }
      
      res.send(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: 'Error reading file', details: error.message });
      }
    }
  });

  // List available documentation files
  router.get('/', async (req, res) => {
    try {
      const docs = [
        { name: 'INSTALLATION.md', description: 'Installation and setup guide' },
        { name: 'README.md', description: 'Project overview and quick start' },
        { name: 'ARCHITECTURE.md', description: 'System architecture documentation' },
        { name: 'QUERY_EXAMPLES.md', description: 'GraphQL query examples' },
        { name: 'MULTI_TOKEN_SETUP.md', description: 'Multi-token configuration' },
        { name: 'FILESYSTEM_API.md', description: 'File system API documentation' },
        { name: 'docker-compose.yml', description: 'Docker Compose configuration' },
        { name: 'server.js', description: 'Main server application code' },
        { name: 'package.json', description: 'Node.js package configuration' }
      ];
      
      res.json({
        message: 'Honeygraph Documentation API',
        available_docs: docs,
        usage: 'GET /api/docs/:filename to view a specific file'
      });
    } catch (error) {
      res.status(500).json({ error: 'Error listing documentation', details: error.message });
    }
  });

  return router;
}