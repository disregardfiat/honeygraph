#!/usr/bin/env node

import fetch from 'node-fetch';

async function checkContracts() {
  console.log('Checking for contracts via API...\n');
  
  try {
    // Test 1: Direct user query with contracts
    const userResponse = await fetch('http://localhost:3030/api/spk/user/disregardfiat?include=contracts');
    const userData = await userResponse.json();
    console.log('User data:', JSON.stringify(userData, null, 2));
    
    // Test 2: Try filesystem API
    console.log('\nChecking filesystem API...');
    const fsResponse = await fetch('http://localhost:3030/api/spk/fs/disregardfiat/');
    const fsData = await fsResponse.json();
    console.log('Filesystem data:', JSON.stringify(fsData, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkContracts();