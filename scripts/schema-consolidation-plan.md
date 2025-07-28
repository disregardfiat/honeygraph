# Schema Consolidation Plan

## Current Schema Structure Issues

1. **Two Base Schemas:**
   - `schema/base-schema.dgraph` - Multi-tenant schema with network isolation
   - `schema/schema.dgraph` - Original honeygraph schema
   - Network manager uses `schema.dgraph` as base
   - Import script references `base-schema.dgraph`

2. **Overlapping Predicates:**
   - Both define Fork, Block, Checkpoint, State types
   - Different predicate naming conventions:
     - base-schema: `fork.id`, `block.network`, etc.
     - schema: `fork.id`, `blockNum`, etc.

3. **Network-Specific Schemas:**
   - `networks/spkccT.dgraph` - SPK testnet specific
   - `custom/spk.dgraph` - Generic SPK types
   - `custom/dlux.dgraph` - DLUX specific
   - `custom/larynx.dgraph` - LARYNX specific

## Recommended Approach

### Option A: Use base-schema.dgraph as Primary (Recommended)
- **Pros:**
  - Designed for multi-tenant architecture
  - Has proper network isolation predicates
  - Better naming conventions (prefixed predicates)
- **Cons:**
  - Need to update network manager to use it
  - May break existing queries

### Option B: Merge base-schema into schema.dgraph
- **Pros:**
  - No code changes needed
  - Maintains backward compatibility
- **Cons:**
  - Need to carefully merge without conflicts
  - Less clean separation

## Implementation Plan (Option A)

1. **Update Network Manager:**
   ```javascript
   // Change line 163 in network-manager.js
   const baseSchemaPath = path.join(this.config.schemaPath, 'base-schema.dgraph');
   ```

2. **Remove Duplicates from schema.dgraph:**
   - Keep only honeygraph-specific predicates
   - Remove multi-tenant predicates that exist in base-schema

3. **Create Migration Guide:**
   - Document predicate name changes
   - Update queries to use new predicate names

4. **Test Thoroughly:**
   - Verify SPK testnet import works
   - Check filesystem API queries
   - Ensure no schema conflicts

## Immediate Fix for Production

For now, to get production working:

1. Remove all SPK-specific content from schema.dgraph
2. Ensure networks/spkccT.dgraph has all needed predicates
3. This eliminates the duplicate predicate errors