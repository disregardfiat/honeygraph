#!/usr/bin/env node

import { createDataTransformer } from '../lib/data-transformer.js';

// Test the metadata parser
const transformer = new createDataTransformer(null, null);

// Test metadata from contract disregardfiat:0:94945034
const metadataString = '1|NFTs|1/Resources,dlux-monogram-banner,png.A,QmZmcpcekTtU8BMA1F7jUcAKoQ6WtM8djvtPnYUD19JjNQ,0--,thumbdlux-monogram-featured (1),png,,2--,thumbdlux-set-wrapped,png,,2--,thumbbees-set-featured,png,,2--,thumbdlux-set-logo,png,,2--,thumbbees-set-wrapped,png,,2--,bees-set-wrapped,png.A,QmUn5H5irRuyo93sqmvkLLepsKPGs53S26T8tvFLZNmmcS,0--,dlux-set-logo,png.A,QmTD2WtBXynWxNzeXyfWaUfH1qJRxknAHu4ngstVU3ZLQi,0--,bees-set-featured,png.A,QmStrJsX4dvscLGqpnRHKPFiRAbN9vV33bb8rRT8qgbGcF,0--';

// CIDs from .df
const cids = [
  "QmP37myULd1dfJj2JJq42RkffsKbjmTy71QpKHGoVSTiVu",
  "QmQ9q9SYBQ96yHwsqvu58EWnB2UkC3JaDygVvgSVdATshk",
  "QmRbEt6u9kkD941tKUAkrHAvURJMLqbqS9AYGYNWPLQyFc",
  "QmStrJsX4dvscLGqpnRHKPFiRAbN9vV33bb8rRT8qgbGcF",
  "QmTD2WtBXynWxNzeXyfWaUfH1qJRxknAHu4ngstVU3ZLQi",
  "QmUn5H5irRuyo93sqmvkLLepsKPGs53S26T8tvFLZNmmcS",
  "QmZmcpcekTtU8BMA1F7jUcAKoQ6WtM8djvtPnYUD19JjNQ"
];

console.log('\n=== Testing Metadata Parser ===\n');

const result = transformer.parseMetadataString(metadataString, cids);

console.log('Folder Map:');
for (const [index, folder] of result.folderMap) {
  console.log(`  ${index}: ${folder.name} (parent: ${folder.parent}, path: ${folder.fullPath})`);
}

console.log('\nFile Mappings:');
const sortedCids = [...cids].sort();
for (const cid of sortedCids) {
  if (result.files.has(cid)) {
    const file = result.files.get(cid);
    console.log(`  ${cid.substring(0, 10)}... -> ${file.name}.${file.ext} (pathIndex: ${file.pathIndex}, path: ${file.folder || '/'})`);
  }
}