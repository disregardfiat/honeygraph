#!/usr/bin/env node

// Test the normalization logic
const testData = {
  contracts: [
    {
      id: "test1",
      storageNodes: { username: "dlux-io" } // Single object
    },
    {
      id: "test2", 
      storageNodes: [{ username: "node1" }, { username: "node2" }] // Array
    },
    {
      id: "test3",
      storageNodes: null // No nodes
    },
    {
      id: "test4"
      // Missing storageNodes
    }
  ]
};

// Normalize storageNodes to always be an array
const contracts = (testData.contracts || []).map(contract => ({
  ...contract,
  storageNodes: Array.isArray(contract.storageNodes) 
    ? contract.storageNodes 
    : contract.storageNodes 
      ? [contract.storageNodes] 
      : []
}));

console.log('Original data:');
testData.contracts.forEach(c => {
  console.log(`  ${c.id}: storageNodes =`, c.storageNodes);
});

console.log('\nNormalized data:');
contracts.forEach(c => {
  console.log(`  ${c.id}: storageNodes =`, c.storageNodes);
});