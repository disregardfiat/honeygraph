#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function parseSchemaFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const predicates = new Map();
  const types = new Map();
  
  // Parse predicates
  const predicateRegex = /^([a-zA-Z0-9._]+):\s*(.+?)$/gm;
  let match;
  while ((match = predicateRegex.exec(content)) !== null) {
    const [_, name, definition] = match;
    if (!name.startsWith('type ') && !name.startsWith('#')) {
      predicates.set(name, definition.trim());
    }
  }
  
  // Parse types
  const typeRegex = /^type\s+([a-zA-Z0-9_]+)\s*{([^}]+)}/gm;
  while ((match = typeRegex.exec(content)) !== null) {
    const [_, typeName, fields] = match;
    const fieldList = fields.trim().split('\n')
      .map(f => f.trim())
      .filter(f => f && !f.startsWith('#'));
    types.set(typeName, fieldList);
  }
  
  return { predicates, types, filePath };
}

async function analyzeSchemas() {
  const schemaDir = path.join(__dirname, '../schema');
  const schemaFiles = [
    'base-schema.dgraph',
    'schema.dgraph',
    'custom/spk.dgraph',
    'custom/dlux.dgraph',
    'custom/larynx.dgraph',
    'networks/spkccT.dgraph'
  ];
  
  console.log(chalk.bold.blue('\n🔍 Analyzing Schema Files for Duplicates\n'));
  
  // Parse all schemas
  const schemas = [];
  for (const file of schemaFiles) {
    try {
      const filePath = path.join(schemaDir, file);
      const schema = await parseSchemaFile(filePath);
      schemas.push(schema);
      console.log(chalk.green(`✓ Parsed: ${file}`));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(chalk.red(`✗ Error parsing ${file}: ${err.message}`));
      }
    }
  }
  
  console.log(chalk.bold.yellow('\n📊 Duplicate Analysis:\n'));
  
  // Find duplicate predicates
  const predicateOccurrences = new Map();
  for (const schema of schemas) {
    for (const [predicate, definition] of schema.predicates) {
      if (!predicateOccurrences.has(predicate)) {
        predicateOccurrences.set(predicate, []);
      }
      predicateOccurrences.get(predicate).push({
        file: path.relative(schemaDir, schema.filePath),
        definition
      });
    }
  }
  
  // Report duplicates
  let duplicateCount = 0;
  for (const [predicate, occurrences] of predicateOccurrences) {
    if (occurrences.length > 1) {
      duplicateCount++;
      console.log(chalk.red(`\n❌ Duplicate predicate: ${predicate}`));
      for (const occ of occurrences) {
        console.log(`   File: ${chalk.cyan(occ.file)}`);
        console.log(`   Definition: ${chalk.gray(occ.definition)}`);
      }
    }
  }
  
  if (duplicateCount === 0) {
    console.log(chalk.green('✅ No duplicate predicates found!'));
  } else {
    console.log(chalk.red(`\n⚠️  Found ${duplicateCount} duplicate predicates`));
  }
  
  // Analyze type duplicates
  console.log(chalk.bold.yellow('\n📊 Type Analysis:\n'));
  
  const typeOccurrences = new Map();
  for (const schema of schemas) {
    for (const [typeName, fields] of schema.types) {
      if (!typeOccurrences.has(typeName)) {
        typeOccurrences.set(typeName, []);
      }
      typeOccurrences.get(typeName).push({
        file: path.relative(schemaDir, schema.filePath),
        fields
      });
    }
  }
  
  let duplicateTypes = 0;
  for (const [typeName, occurrences] of typeOccurrences) {
    if (occurrences.length > 1) {
      duplicateTypes++;
      console.log(chalk.red(`\n❌ Duplicate type: ${typeName}`));
      for (const occ of occurrences) {
        console.log(`   File: ${chalk.cyan(occ.file)}`);
        console.log(`   Fields: ${chalk.gray(occ.fields.join(', '))}`);
      }
    }
  }
  
  if (duplicateTypes === 0) {
    console.log(chalk.green('✅ No duplicate types found!'));
  } else {
    console.log(chalk.red(`\n⚠️  Found ${duplicateTypes} duplicate types`));
  }
  
  // Show schema loading flow
  console.log(chalk.bold.blue('\n🔄 Schema Loading Flow:\n'));
  console.log('1. Network Manager loads base-schema.dgraph');
  console.log('2. Network Manager loads network-specific schema (e.g., networks/spkccT.dgraph)');
  console.log('3. Combines both schemas with newline separator');
  console.log('4. Applies combined schema to Dgraph');
  
  console.log(chalk.yellow('\n⚠️  Problem: schema.dgraph appears to be a duplicate of networks/spkccT.dgraph'));
  console.log(chalk.yellow('   This causes conflicts when network manager combines schemas\n'));
}

// Run analysis
analyzeSchemas().catch(console.error);