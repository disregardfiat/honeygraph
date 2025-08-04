#\!/bin/bash

# Test storage contracts in Dgraph

echo "=== Testing Storage Contracts in Dgraph ==="

# 1. Check accounts
echo -e "\n1. Checking accounts..."
curl -s -X POST http://localhost:8080/query -H "Content-Type: application/dql" -d '
{
  accounts(func: has(Account.username), first: 10) {
    uid
    username: Account.username
  }
  
  dluxAccount(func: eq(Account.username, "dlux-io")) {
    uid
    username: Account.username
    contractsStoring {
      uid
      id
    }
  }
}' | jq '.'

# 2. Check storage contracts
echo -e "\n2. Checking storage contracts..."
curl -s -X POST http://localhost:8080/query -H "Content-Type: application/dql" -d '
{
  contracts(func: type(StorageContract), first: 3) {
    uid
    id
    owner {
      username: Account.username
    }
    status
    power
    nodeTotal
    isUnderstored
    storageNodes {
      uid
      username: Account.username
    }
  }
}' | jq '.'

# 3. Check understored contracts
echo -e "\n3. Checking understored contracts..."
curl -s -X POST http://localhost:8080/query -H "Content-Type: application/dql" -d '
{
  understored(func: type(StorageContract)) @filter(eq(isUnderstored, true)) {
    count(uid)
  }
}' | jq '.'
