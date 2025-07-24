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
    // Query to find all paths grouped by owner and fullPath
    const duplicateQuery = `
      {
        var(func: type(Path)) {
          owner as owner.username
          path as fullPath
          count_by_owner_path as count(uid) @groupby(owner, path)
        }
        
        duplicates(func: uid(count_by_owner_path)) @filter(gt(val(count_by_owner_path), 1)) {
          owner: owner.username
          fullPath
          ~owner @filter(type(Path) AND eq(fullPath, val(path))) {
            uid
            fullPath
            pathType
            newestBlockNumber
            currentFile {
              uid
            }
          }
        }
      }
    `;
    
    // First, let's get a count of duplicates
    const countQuery = `
      {
        paths(func: type(Path)) {
          total: count(uid)
        }
        
        uniquePaths as var(func: type(Path)) @groupby(owner.username, fullPath) {
          count as count(uid)
        }
        
        duplicateCount() {
          totalPaths: sum(val(count))
          uniqueCount: count(uid(uniquePaths))
        }
      }
    `;
    
    spinner.text = 'Counting duplicate paths...';
    const countResult = await dgraphClient.query(countQuery);
    
    const totalPaths = countResult.paths?.[0]?.total || 0;
    const stats = countResult.duplicateCount?.[0] || {};
    
    spinner.succeed(`Found ${totalPaths} total paths`);
    console.log(chalk.yellow(`Unique path combinations: ${stats.uniqueCount || 0}`));
    console.log(chalk.yellow(`Duplicate paths to clean: ${totalPaths - (stats.uniqueCount || 0)}`));
    
    // Now find and remove duplicates
    spinner = ora('Finding duplicate paths to remove...').start();
    
    // Query to find duplicate paths
    const findDuplicatesQuery = `
      query findDuplicates {
        paths(func: type(Path)) @groupby(owner.username, fullPath) {
          owner: owner.username
          fullPath
          paths: ~owner @filter(type(Path)) {
            uid
            fullPath
            pathType
            newestBlockNumber
            currentFile {
              uid
            }
            itemCount
            created: min(uid)
          }
        }
      }
    `;
    
    const dupsResult = await dgraphClient.query(findDuplicatesQuery);
    
    // Process each group of paths
    let deleteCount = 0;
    const deletions = [];
    
    for (const group of dupsResult.paths || []) {
      if (group.paths && group.paths.length > 1) {
        // Sort by newestBlockNumber (keep the one with highest block number)
        // If block numbers are equal, keep the one with lowest UID (oldest)
        const sorted = group.paths.sort((a, b) => {
          const blockDiff = (b.newestBlockNumber || 0) - (a.newestBlockNumber || 0);
          if (blockDiff !== 0) return blockDiff;
          
          // Compare UIDs (lower UID = older)
          return a.uid.localeCompare(b.uid);
        });
        
        // Keep the first one, delete the rest
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);
        
        logger.info(`Found ${toDelete.length} duplicates for ${group.owner}:${group.fullPath}`, {
          keeping: toKeep.uid,
          deleting: toDelete.map(p => p.uid)
        });
        
        for (const path of toDelete) {
          deletions.push({
            uid: path.uid,
            'dgraph.type': 'Path'
          });
          deleteCount++;
        }
      }
    }
    
    spinner.succeed(`Found ${deleteCount} duplicate paths to remove`);
    
    if (deleteCount === 0) {
      console.log(chalk.green('No duplicate paths found!'));
      return;
    }
    
    // Ask for confirmation
    console.log(chalk.yellow(`\nThis will delete ${deleteCount} duplicate Path entries.`));
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
    
    spinner.succeed(`Successfully deleted ${deleteCount} duplicate paths`);
    
    // Verify the cleanup
    spinner = ora('Verifying cleanup...').start();
    const verifyResult = await dgraphClient.query(countQuery);
    const newTotal = verifyResult.paths?.[0]?.total || 0;
    
    spinner.succeed(`Cleanup complete! Paths reduced from ${totalPaths} to ${newTotal}`);
    
  } catch (error) {
    spinner.fail('Cleanup failed');
    logger.error('Error during cleanup', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    dgraphClient.disconnect();
  }
}

// Run the cleanup
cleanupDuplicatePaths().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});