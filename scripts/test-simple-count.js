#!/usr/bin/env node

import fetch from 'node-fetch';

async function testCount() {
  // Test a simple custom endpoint
  const response = await fetch('http://localhost:3030/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `{
        totalFiles(func: type(File)) {
          count(uid)
        }
      }`
    })
  });
  
  const result = await response.json();
  console.log('Query result:', JSON.stringify(result, null, 2));
}

testCount().catch(console.error);