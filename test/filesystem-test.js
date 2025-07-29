#!/usr/bin/env node

/**
 * Test script for filesystem API functionality
 * Ensures that:
 * 1. Directory listings work with and without trailing slashes
 * 2. Multiple files in a directory are accessible
 * 3. File redirects work with and without extensions
 * 4. Both dlux.nft and hf.txt are accessible in /NFTs
 */

import fetch from 'node-fetch';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('filesystem-test');
const API_BASE = process.env.API_URL || 'http://localhost:3030';

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

async function runTest(name, testFn) {
  try {
    console.log(`\n🔍 Running: ${name}`);
    await testFn();
    results.passed++;
    results.tests.push({ name, status: 'PASSED' });
    console.log(`✅ PASSED: ${name}`);
  } catch (error) {
    results.failed++;
    results.tests.push({ name, status: 'FAILED', error: error.message });
    console.error(`❌ FAILED: ${name}`);
    console.error(`   Error: ${error.message}`);
  }
}

async function testDirectoryListing() {
  // Test without trailing slash
  const resp1 = await fetch(`${API_BASE}/fs/disregardfiat/NFTs`);
  const data1 = await resp1.json();
  
  if (!data1.contents || !Array.isArray(data1.contents)) {
    throw new Error('Directory listing should return contents array');
  }
  
  // Test with trailing slash
  const resp2 = await fetch(`${API_BASE}/fs/disregardfiat/NFTs/`);
  const data2 = await resp2.json();
  
  if (!data2.contents || !Array.isArray(data2.contents)) {
    throw new Error('Directory listing with trailing slash should return contents array');
  }
  
  // Should have same content
  if (data1.contents.length !== data2.contents.length) {
    throw new Error(`Trailing slash changes results: ${data1.contents.length} vs ${data2.contents.length}`);
  }
  
  console.log(`   Found ${data1.contents.length} items in /NFTs`);
  
  // List all files found
  const files = data1.contents.filter(item => item.type === 'file');
  console.log(`   Files in /NFTs:`);
  files.forEach(file => {
    console.log(`     - ${file.name}.${file.extension || ''} (${file.cid})`);
  });
}

async function testMultipleFilesInDirectory() {
  const resp = await fetch(`${API_BASE}/fs/disregardfiat/NFTs`);
  const data = await resp.json();
  
  const files = data.contents.filter(item => item.type === 'file');
  
  if (files.length < 2) {
    throw new Error(`Expected at least 2 files in /NFTs, found ${files.length}`);
  }
  
  // Check for specific files
  const dluxFile = files.find(f => f.name === 'dlux');
  const hfFile = files.find(f => f.name === 'hf');
  
  if (!dluxFile) {
    throw new Error('dlux file not found in directory listing');
  }
  
  if (!hfFile) {
    throw new Error('hf file not found in directory listing');
  }
  
  console.log(`   Found ${files.length} files including dlux and hf`);
}

async function testFileRedirect(filename, expectedCid) {
  const resp = await fetch(`${API_BASE}/fs/disregardfiat/NFTs/${filename}`, {
    redirect: 'manual',
    follow: 0
  });
  
  if (resp.status !== 302) {
    throw new Error(`Expected 302 redirect, got ${resp.status}`);
  }
  
  const location = resp.headers.get('location');
  if (!location) {
    throw new Error('No Location header in redirect');
  }
  
  const cid = resp.headers.get('x-ipfs-cid');
  if (!cid) {
    throw new Error('No X-IPFS-CID header');
  }
  
  if (expectedCid && cid !== expectedCid) {
    throw new Error(`CID mismatch: expected ${expectedCid}, got ${cid}`);
  }
  
  console.log(`   ${filename} -> ${cid}`);
  console.log(`   Redirects to: ${location}`);
}

async function testDluxNftAccess() {
  // Test with extension
  await testFileRedirect('dlux.nft', 'QmYSRLiGaEmucSXoNiq9RqazmDuEZmCELRDg4wyE7Fo8kX');
  
  // Test without extension (should also work since file name is "dlux")
  await testFileRedirect('dlux', 'QmYSRLiGaEmucSXoNiq9RqazmDuEZmCELRDg4wyE7Fo8kX');
}

async function testHfTxtAccess() {
  // Test with extension
  await testFileRedirect('hf.txt', 'QmSPm13knazJsN4C8b7mWqT8tG2CeFCRvbW1PifYZV9dVN');
  
  // Test without extension (should also work since file name is "hf")
  await testFileRedirect('hf', 'QmSPm13knazJsN4C8b7mWqT8tG2CeFCRvbW1PifYZV9dVN');
}

async function testRootDirectory() {
  const resp = await fetch(`${API_BASE}/fs/disregardfiat/`);
  const data = await resp.json();
  
  if (!data.contents || !Array.isArray(data.contents)) {
    throw new Error('Root directory should return contents array');
  }
  
  // Should contain NFTs directory
  const nftsDir = data.contents.find(item => item.name === 'NFTs' && item.type === 'directory');
  if (!nftsDir) {
    throw new Error('NFTs directory not found in root');
  }
  
  console.log(`   Root directory contains ${data.contents.length} items`);
}

async function main() {
  console.log('🧪 Honeygraph Filesystem API Test Suite');
  console.log('=====================================\n');
  
  try {
    // Basic connectivity test
    await runTest('API connectivity', async () => {
      const resp = await fetch(`${API_BASE}/health`);
      if (!resp.ok) {
        throw new Error(`API health check failed: ${resp.status}`);
      }
    });
    
    // Directory tests
    await runTest('Root directory listing', testRootDirectory);
    await runTest('Directory listing (with and without trailing slash)', testDirectoryListing);
    await runTest('Multiple files in /NFTs directory', testMultipleFilesInDirectory);
    
    // File access tests
    await runTest('dlux.nft file access', testDluxNftAccess);
    await runTest('hf.txt file access', testHfTxtAccess);
    
  } catch (error) {
    console.error('\n🚨 Test suite error:', error.message);
  }
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('===============');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📝 Total:  ${results.passed + results.failed}`);
  
  if (results.failed > 0) {
    console.log('\nFailed tests:');
    results.tests
      .filter(t => t.status === 'FAILED')
      .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});