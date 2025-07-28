#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import chalk from 'chalk';

const logger = createLogger('check-schema');

async function checkAppliedSchema() {
  console.log(chalk.bold.blue('🔍 Checking Applied Schema in Dgraph\n'));
  
  const dgraphUrl = process.env.DGRAPH_URL || 'http://dgraph-alpha:9080';
  
  // Create client without namespace to check raw schema
  const dgraphClient = new DgraphClient({
    url: dgraphUrl,
    logger
  });
  
  console.log(chalk.yellow('Fetching schema from Dgraph...'));
  
  try {
    // Get the schema using raw query
    const schemaQuery = `
      schema {}
    `;
    const result = await dgraphClient.query(schemaQuery);
    const schema = result.schema?.[0]?.schema || '';
    
    // Look for username predicate
    const lines = schema.split('\n');
    const usernameLines = lines.filter(line => line.includes('username'));
    
    console.log(chalk.cyan('\nUsername predicate definitions found:'));
    if (usernameLines.length === 0) {
      console.log(chalk.red('  NONE - username predicate is missing!'));
    } else {
      usernameLines.forEach(line => console.log('  ' + line));
    }
    
    // Check for Account type
    const typeLines = lines.filter(line => line.includes('type Account'));
    console.log(chalk.cyan('\nAccount type definitions found:'));
    if (typeLines.length === 0) {
      console.log(chalk.red('  NONE - Account type is missing!'));
    } else {
      // Find the Account type and its fields
      let inAccountType = false;
      let accountFields = [];
      for (const line of lines) {
        if (line.includes('type Account')) {
          inAccountType = true;
          console.log('  ' + line);
        } else if (inAccountType && line.includes('}')) {
          inAccountType = false;
          console.log('  }');
          break;
        } else if (inAccountType && line.trim()) {
          accountFields.push(line);
          console.log('  ' + line);
        }
      }
    }
    
    // Check for Path type
    const pathLines = lines.filter(line => line.includes('type Path'));
    console.log(chalk.cyan('\nPath type definitions found:'));
    if (pathLines.length === 0) {
      console.log(chalk.red('  NONE - Path type is missing!'));
    } else {
      // Find the Path type and its fields
      let inPathType = false;
      for (const line of lines) {
        if (line.includes('type Path')) {
          inPathType = true;
          console.log('  ' + line);
        } else if (inPathType && line.includes('}')) {
          inPathType = false;
          console.log('  }');
          break;
        } else if (inPathType && line.trim()) {
          console.log('  ' + line);
        }
      }
    }
    
    // Check for important predicates
    const importantPredicates = ['path', 'owner', 'isDirectory', 'cid', 'contractId'];
    console.log(chalk.cyan('\nImportant predicates:'));
    for (const pred of importantPredicates) {
      const predLines = lines.filter(line => line.startsWith(pred + ':'));
      if (predLines.length === 0) {
        console.log(chalk.red(`  ${pred}: MISSING`));
      } else {
        console.log(chalk.green(`  ${predLines[0]}`));
      }
    }
    
    // Save full schema for inspection
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    
    const schemaPath = path.join(__dirname, 'applied-schema.dgraph');
    await fs.writeFile(schemaPath, schema);
    console.log(chalk.yellow(`\nFull schema saved to: ${schemaPath}`));
    
  } catch (error) {
    console.error(chalk.red('Error fetching schema:'), error.message);
  }
}

// Run check
checkAppliedSchema().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});