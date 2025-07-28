#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function validateSchemas() {
  console.log('Validating schema files...\n');
  
  // Read base schema
  const baseSchema = readFileSync(join(__dirname, 'schema/schema.dgraph'), 'utf8');
  const spkSchema = readFileSync(join(__dirname, 'schema/networks/spkccT.dgraph'), 'utf8');
  
  // Extract type definitions
  const baseTypes = new Set();
  const spkTypes = new Set();
  
  const typeRegex = /^type\s+(\w+)\s*{/gm;
  
  let match;
  while ((match = typeRegex.exec(baseSchema)) !== null) {
    baseTypes.add(match[1]);
  }
  
  while ((match = typeRegex.exec(spkSchema)) !== null) {
    spkTypes.add(match[1]);
  }
  
  console.log('Base schema types:', Array.from(baseTypes).join(', '));
  console.log('SPK schema types:', Array.from(spkTypes).join(', '));
  
  // Check for duplicates
  const duplicates = [];
  for (const type of spkTypes) {
    if (baseTypes.has(type)) {
      duplicates.push(type);
    }
  }
  
  if (duplicates.length > 0) {
    console.error('\n❌ Found duplicate type definitions:', duplicates.join(', '));
    return false;
  }
  
  // Extract predicate definitions
  const basePredicates = new Map();
  const spkPredicates = new Map();
  
  const predicateRegex = /^(\w+):\s*(.+)$/gm;
  
  while ((match = predicateRegex.exec(baseSchema)) !== null) {
    if (!match[1].includes('.')) { // Skip type definitions
      basePredicates.set(match[1], match[2]);
    }
  }
  
  while ((match = predicateRegex.exec(spkSchema)) !== null) {
    if (!match[1].includes('.')) { // Skip type definitions
      spkPredicates.set(match[1], match[2]);
    }
  }
  
  // Check for conflicting predicates
  const conflicts = [];
  for (const [predicate, definition] of spkPredicates) {
    if (basePredicates.has(predicate)) {
      const baseDefinition = basePredicates.get(predicate);
      if (baseDefinition !== definition) {
        conflicts.push({
          predicate,
          base: baseDefinition,
          spk: definition
        });
      }
    }
  }
  
  if (conflicts.length > 0) {
    console.error('\n⚠️  Found conflicting predicate definitions:');
    conflicts.forEach(c => {
      console.error(`  ${c.predicate}:`);
      console.error(`    Base: ${c.base}`);
      console.error(`    SPK:  ${c.spk}`);
    });
  }
  
  // Combined schema validation
  const combinedSchema = baseSchema + '\n\n' + spkSchema;
  
  // Check for duplicate type definitions in combined schema
  const allTypes = new Map();
  const typeDefRegex = /^type\s+(\w+)\s*{/gm;
  let lineNum = 0;
  const lines = combinedSchema.split('\n');
  
  for (const line of lines) {
    lineNum++;
    const match = line.match(/^type\s+(\w+)\s*{/);
    if (match) {
      const typeName = match[1];
      if (allTypes.has(typeName)) {
        console.error(`\n❌ Duplicate type '${typeName}' at line ${lineNum} (first defined at line ${allTypes.get(typeName)})`);
      } else {
        allTypes.set(typeName, lineNum);
      }
    }
  }
  
  console.log('\n✅ Schema validation complete');
  console.log(`Total types: ${allTypes.size}`);
  console.log(`Total predicates: ${basePredicates.size + spkPredicates.size}`);
  
  return duplicates.length === 0;
}

validateSchemas();