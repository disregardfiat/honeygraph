#!/usr/bin/env node
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import chalk from 'chalk';
import ora from 'ora';

const logger = createLogger('cleanup-duplicate-paths');

async function cleanupDuplicatePaths() {
  const dgraphClient = createDgraphClient();
  
  let spinner = ora('Querying for duplicate paths...').start();
  
  try {
    // Simple query to find duplicate paths
    const duplicateQuery = `
      query findDuplicatePaths {
        paths(func: type(Path)) {
          uid
          fullPath
          pathType
          owner {
            uid
            username
          }
          newestBlockNumber
          currentFile {
            uid
          }
          itemCount
        }
      }
    `;
    
    // Get all paths and group them manually
    spinner.text = 'Fetching all paths...';
    const result = await dgraphClient.query(duplicateQuery);
    const allPaths = result.paths || [];
    
    spinner.succeed(`Found ${allPaths.length} total paths`);
    
    // Group paths by owner + fullPath
    const pathGroups = new Map();
    for (const path of allPaths) {
      if (!path.owner || !path.owner.username) continue;
      
      const key = `${path.owner.username}:${path.fullPath}`;
      if (!pathGroups.has(key)) {
        pathGroups.set(key, []);
      }
      pathGroups.get(key).push(path);
    }
    
    // Count duplicates
    let duplicateCount = 0;
    for (const [key, paths] of pathGroups.entries()) {
      if (paths.length > 1) {
        duplicateCount += paths.length - 1;
      }
    }
    
    console.log(chalk.yellow(`Unique path combinations: ${pathGroups.size}`));
    console.log(chalk.yellow(`Duplicate paths to clean: ${duplicateCount}`));
    
    // Process duplicates
    spinner = ora('Processing duplicate paths...').start();
    const deletions = [];
    
    for (const [key, paths] of pathGroups.entries()) {
      if (paths.length > 1) {
        // Sort by newestBlockNumber (keep the one with highest block number)
        // If block numbers are equal, keep the one with lowest UID (oldest)
        const sorted = paths.sort((a, b) => {
          const blockDiff = (b.newestBlockNumber || 0) - (a.newestBlockNumber || 0);
          if (blockDiff !== 0) return blockDiff;
          
          // Compare UIDs (lower UID = older)
          return a.uid.localeCompare(b.uid);
        });
        
        // Keep the first one, delete the rest
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);
        
        logger.info(`Found ${toDelete.length} duplicates for ${key}`, {
          keeping: toKeep.uid,
          deleting: toDelete.map(p => p.uid)
        });
        
        for (const path of toDelete) {
          deletions.push({
            uid: path.uid,
            'dgraph.type': 'Path'
          });
        }
      }
    }
    
    spinner.succeed(`Found ${deletions.length} duplicate paths to remove`);
    
    if (deletions.length === 0) {
      console.log(chalk.green('No duplicate paths found!'));
      return;
    }
    
    // Ask for confirmation
    console.log(chalk.yellow(`\nThis will delete ${deletions.length} duplicate Path entries.`));
    console.log(chalk.yellow('The newest version of each path will be preserved.'));
    console.log(chalk.red('\nThis operation cannot be undone!'));
    
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('Do you want to proceed? (yes/no): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'yes') {
      console.log(chalk.yellow('Operation cancelled.'));
      return;
    }
    
    // Perform deletions in batches
    spinner = ora('Deleting duplicate paths...').start();
    const batchSize = 1000;
    
    for (let i = 0; i < deletions.length; i += batchSize) {
      const batch = deletions.slice(i, i + batchSize);
      const mutation = {
        delete: batch
      };
      
      const txn = dgraphClient.newTxn();
      try {
        await txn.mutate({ mutation });
        await txn.commit();
        spinner.text = `Deleted ${Math.min(i + batchSize, deletions.length)} of ${deletions.length} duplicates...`;
      } catch (error) {
        await txn.discard();
        throw error;
      }
    }
    
    spinner.succeed(`Successfully deleted ${deletions.length} duplicate paths`);
    
    // Verify the cleanup
    spinner = ora('Verifying cleanup...').start();
    const verifyResult = await dgraphClient.query(duplicateQuery);
    const newTotal = verifyResult.paths?.length || 0;
    
    spinner.succeed(`Cleanup complete! Paths reduced from ${allPaths.length} to ${newTotal}`);
    
  } catch (error) {
    spinner.fail('Cleanup failed');
    logger.error('Error during cleanup', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    if (dgraphClient.clientStub) {
      dgraphClient.clientStub.close();
    }
  }
}

// Run the cleanup
cleanupDuplicatePaths().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});