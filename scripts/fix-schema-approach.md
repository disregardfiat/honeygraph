# Schema Fix Approach

## Current Problems

1. **SPKValidator.account** has conflicting definitions:
   - `custom/spk.dgraph`: `string @index(hash)` - treats account as a string identifier
   - `networks/spkccT.dgraph`: `uid @reverse` - treats account as a reference to Account node

2. **Multiple schema files defining SPK types:**
   - `custom/spk.dgraph` - Generic SPK schema
   - `networks/spkccT.dgraph` - SPK testnet specific schema
   - These have overlapping but different predicates

3. **Network Manager combines schemas:**
   - Loads `base-schema.dgraph`
   - Loads network-specific schema (e.g., `networks/spkccT.dgraph`)
   - Combines them, causing duplicates when predicates are defined in multiple places

## Recommended Solution

### Option 1: Network-Specific Schema Only (Recommended)
- Keep all SPK-related predicates ONLY in `networks/spkccT.dgraph`
- Remove SPK predicates from `custom/spk.dgraph`
- Each network gets its own complete schema file
- Cleaner separation, no conflicts

### Option 2: Base + Extensions
- Keep generic SPK predicates in `custom/spk.dgraph`
- Only put network-specific overrides in `networks/spkccT.dgraph`
- Requires careful management to avoid conflicts
- More complex but allows sharing common predicates

## Decision: Option 1

Reasons:
1. Simpler to manage
2. No predicate conflicts
3. Each network can evolve independently
4. Clear ownership of schema definitions

## Implementation Steps

1. Remove all SPK-specific content from `custom/spk.dgraph`
2. Ensure `networks/spkccT.dgraph` has all needed SPK predicates
3. Fix the conflicting type (SPKValidator.account should be `uid @reverse`)
4. Update network manager to only load base + network-specific schemas