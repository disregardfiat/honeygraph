import { createLogger } from './logger.js';

const logger = createLogger('feed-parser');

/**
 * Feed Parser for SPK Network Transaction History
 * Parses feed entries into structured transaction data
 */
export class FeedParser {
  constructor() {
    // Define regex patterns for each operation type
    this.patterns = {
      // Token Operations
      send: /^@(\w+)\| Sent @(\w+) ([\d,\.]+) (\w+)$/,
      promotion: /^@(\w+)\| Promoted @(\S+) with ([\d,\.]+) (\w+)$/,
      claim: /^@(\w+)\| Claimed ([\d,\.]+) (\w+) - Half (locked in gov|powered up)$/,
      
      // DEX Operations
      dexBuyOrder: /^@(\w+)\| Placed a buy order for ([\d,\.]+) (\w+)$/,
      dexSellOrder: /^@(\w+)\| Placed a sell order for ([\d,\.]+) (\w+)$/,
      dexMarketBuy: /^@(\w+)\| Bought ([\d,\.]+) (\w+) for ([\d,\.]+) (HIVE|HBD)$/,
      dexMarketSell: /^@(\w+)\| Sold ([\d,\.]+) (\w+) for ([\d,\.]+) (HIVE|HBD)$/,
      dexCancel: /^@(\w+)\| canceled a (hive|hbd) (dex_sell|dex_buy)$/,
      
      // NFT Operations
      nftMint: /^(\w+) minted (\S+) from the (.+) set\.$/,
      nftTransfer: /^@(\w+)\| sent (\S+) to (\w+)$/,
      nftAuctionEnd: /^Auction of (\w+)'s (\S+) has ended for ([\d,\.]+) (\w+) to (\w+)$/,
      nftAuctionNoBid: /^Auction of (\w+)'s (\S+) has ended with no bidders$/,
      nftSale: /^(\w+) has sold (\S+) to (\w+) for ([\d,\.]+) (\w+)$/,
      
      // Power Operations
      powerUp: /^@(\w+)\| Powered up ([\d,\.]+) (SPK|BROCA|LARYNX)$/,
      powerDown: /^@(\w+)\| powered down ([\d,\.]+) (\w+)$/,
      govWithdraw: /^@(\w+)\| ([\d,\.]+) (\w+) withdrawn from governance\.$/,
      
      // Delegation Operations
      delegateAdd: /^@(\w+)\| has delegated ([\d,\.]+) vests to @(\w+)$/,
      delegateRemove: /^@(\w+)\| has removed delegation to @(\w+)$/,
      
      // Certificate Operations
      certSign: /^@(\w+)\| Signed a certificate on (\w+)\/(\w+)$/,
      
      // SCP (Proposal) Operations
      scpPropose: /^@(\w+)\| Proposed (\w+) update for (.+)$/,
      scpDelete: /^@(\w+)\| Deleted SCP (\S+)$/,
      scpVote: /^@(\w+)\| Voted (Approve|Reject) SCP (\S+)$/,
      scpApprove: /^@(\w+)\| Approved SCP (\S+)$/,
      
      // Governance Operations
      govLock: /^@(\w+)\| Locked ([\d,\.]+) (\w+) for (\d+) weeks$/,
      govExtend: /^@(\w+)\| Extended governance lock to (\d+) weeks$/,
      govUnlock: /^@(\w+)\| Unlocked ([\d,\.]+) (\w+) from governance$/,
      
      // Storage Contract Operations
      storageUpload: /^(\S+) direct upload completed$/,
      storageBundle: /^(\S+) bundled$/,
      storageCancel: /^(\S+) canceled by (file owner|channel owner)$/,
      storageMetaUpdate: /^Updated metadata for contracts: (.+)$/,
      storageFileDelete: /^Deleted files: (.+)$/,
      storageError: /^Errors: (.+)$/,
      
      // Voting Operations
      vote: /^@(\w+)\| voted for @(\w+)\/(\w+)$/,
      voteExpired: /^@(\w+)\| Post:(\w+) voting expired\.$/,
      
      // Error patterns
      invalidOperation: /^@(\w+)\| Invalid (\w+) operation$/,
      error: /^@(\w+)\| (.+)$/  // Catch-all for other user errors
    };
  }

  /**
   * Parse a feed entry into structured transaction data
   * @param {string} feedId - The feed ID (format: "blocknum:txid")
   * @param {string} message - The feed message
   * @returns {Object|null} Parsed transaction object or null if not recognized
   */
  parseFeedEntry(feedId, message) {
    if (!message || typeof message !== 'string') {
      return null;
    }

    // Extract block number and transaction ID
    const [blockNum, txId] = feedId.split(':');
    const baseTransaction = {
      feedId,
      blockNum: parseInt(blockNum) || 0,
      txId,
      isVirtualOp: txId && txId.startsWith('vop_'),
      timestamp: new Date().toISOString() // Should be replaced with actual block time
    };

    // Try each pattern
    for (const [operationType, pattern] of Object.entries(this.patterns)) {
      const match = message.match(pattern);
      if (match) {
        try {
          const parsed = this.parseMatch(operationType, match, message);
          return {
            ...baseTransaction,
            operationType,
            ...parsed
          };
        } catch (error) {
          logger.warn('Failed to parse feed entry', { 
            feedId, 
            operationType, 
            error: error.message 
          });
        }
      }
    }

    // If no pattern matched, return basic transaction with raw message
    return {
      ...baseTransaction,
      operationType: 'UNKNOWN',
      rawMessage: message
    };
  }

  /**
   * Parse matched regex groups based on operation type
   */
  parseMatch(operationType, match, rawMessage) {
    switch (operationType) {
      // Token Operations
      case 'send':
        return {
          category: 'TOKEN_TRANSFER',
          from: match[1],
          to: match[2],
          amount: this.parseAmount(match[3]),
          token: match[4],
          memo: rawMessage
        };

      case 'promotion':
        return {
          category: 'PROMOTION',
          from: match[1],
          content: match[2],
          amount: this.parseAmount(match[3]),
          token: match[4],
          memo: rawMessage
        };

      case 'claim':
        return {
          category: 'TOKEN_CLAIM',
          account: match[1],
          amount: this.parseAmount(match[2]),
          token: match[3],
          destination: match[4] === 'powered up' ? 'POWER' : 'GOVERNANCE',
          memo: rawMessage
        };

      // DEX Operations
      case 'dexBuyOrder':
      case 'dexSellOrder':
        return {
          category: 'DEX_ORDER',
          account: match[1],
          orderType: operationType === 'dexBuyOrder' ? 'BUY' : 'SELL',
          amount: this.parseAmount(match[2]),
          token: match[3],
          memo: rawMessage
        };

      case 'dexMarketBuy':
      case 'dexMarketSell':
        return {
          category: 'DEX_TRADE',
          account: match[1],
          tradeType: operationType === 'dexMarketBuy' ? 'BUY' : 'SELL',
          tokenAmount: this.parseAmount(match[2]),
          token: match[3],
          quoteAmount: this.parseAmount(match[4]),
          quoteCurrency: match[5],
          memo: rawMessage
        };

      case 'dexCancel':
        return {
          category: 'DEX_CANCEL',
          account: match[1],
          market: match[2].toUpperCase(),
          orderType: match[3],
          memo: rawMessage
        };

      // NFT Operations
      case 'nftMint':
        return {
          category: 'NFT_MINT',
          recipient: match[1],
          nftId: match[2],
          setName: match[3],
          memo: rawMessage
        };

      case 'nftTransfer':
        return {
          category: 'NFT_TRANSFER',
          from: match[1],
          nftId: match[2],
          to: match[3],
          memo: rawMessage
        };

      case 'nftAuctionEnd':
        return {
          category: 'NFT_AUCTION_END',
          seller: match[1],
          nftId: match[2],
          amount: this.parseAmount(match[3]),
          token: match[4],
          winner: match[5],
          memo: rawMessage
        };

      case 'nftAuctionNoBid':
        return {
          category: 'NFT_AUCTION_END',
          seller: match[1],
          nftId: match[2],
          winner: null,
          amount: 0,
          memo: rawMessage
        };

      case 'nftSale':
        return {
          category: 'NFT_SALE',
          seller: match[1],
          nftId: match[2],
          buyer: match[3],
          amount: this.parseAmount(match[4]),
          token: match[5],
          memo: rawMessage
        };

      // Power Operations
      case 'powerUp':
        return {
          category: 'POWER_UP',
          account: match[1],
          amount: this.parseAmount(match[2]),
          token: match[3],
          memo: rawMessage
        };

      case 'powerDown':
        return {
          category: 'POWER_DOWN',
          account: match[1],
          amount: this.parseAmount(match[2]),
          token: match[3],
          memo: rawMessage
        };

      case 'govWithdraw':
        return {
          category: 'GOV_WITHDRAW',
          account: match[1],
          amount: this.parseAmount(match[2]),
          token: match[3],
          memo: rawMessage
        };

      // Delegation Operations
      case 'delegateAdd':
        return {
          category: 'DELEGATION_ADD',
          delegator: match[1],
          vests: this.parseAmount(match[2]),
          delegatee: match[3],
          memo: rawMessage
        };

      case 'delegateRemove':
        return {
          category: 'DELEGATION_REMOVE',
          delegator: match[1],
          delegatee: match[2],
          memo: rawMessage
        };

      // Governance Operations
      case 'govLock':
        return {
          category: 'GOV_LOCK',
          account: match[1],
          amount: this.parseAmount(match[2]),
          token: match[3],
          weeks: parseInt(match[4]),
          memo: rawMessage
        };

      case 'govExtend':
        return {
          category: 'GOV_EXTEND',
          account: match[1],
          weeks: parseInt(match[2]),
          memo: rawMessage
        };

      case 'govUnlock':
        return {
          category: 'GOV_UNLOCK',
          account: match[1],
          amount: this.parseAmount(match[2]),
          token: match[3],
          memo: rawMessage
        };

      // Storage Operations
      case 'storageUpload':
        return {
          category: 'STORAGE_UPLOAD',
          contractId: match[1],
          uploadType: 'DIRECT',
          memo: rawMessage
        };

      case 'storageBundle':
        return {
          category: 'STORAGE_UPLOAD',
          contractId: match[1],
          uploadType: 'BUNDLE',
          memo: rawMessage
        };

      case 'storageCancel':
        return {
          category: 'STORAGE_CANCEL',
          contractId: match[1],
          cancelledBy: match[2],
          memo: rawMessage
        };

      case 'storageMetaUpdate':
        return {
          category: 'STORAGE_META_UPDATE',
          contractIds: match[1].split(',').map(id => id.trim()),
          memo: rawMessage
        };

      case 'storageFileDelete':
        return {
          category: 'STORAGE_FILE_DELETE',
          cids: match[1].split(',').map(cid => cid.trim()),
          memo: rawMessage
        };

      // Default cases
      case 'invalidOperation':
        return {
          category: 'ERROR',
          errorType: 'INVALID_OPERATION',
          account: match[1],
          operation: match[2],
          memo: rawMessage
        };

      default:
        return {
          category: 'OTHER',
          rawMessage: rawMessage
        };
    }
  }

  /**
   * Parse amount strings (handles comma-separated thousands)
   */
  parseAmount(amountStr) {
    return parseFloat(amountStr.replace(/,/g, '')) || 0;
  }

  /**
   * Extract operation category from parsed transaction
   */
  getCategoryFromTransaction(transaction) {
    return transaction.category || 'UNKNOWN';
  }

  /**
   * Get human-readable description of transaction
   */
  getTransactionDescription(transaction) {
    switch (transaction.category) {
      case 'TOKEN_TRANSFER':
        return `${transaction.from} sent ${transaction.amount} ${transaction.token} to ${transaction.to}`;
      case 'DEX_TRADE':
        return `${transaction.account} ${transaction.tradeType === 'BUY' ? 'bought' : 'sold'} ${transaction.tokenAmount} ${transaction.token} for ${transaction.quoteAmount} ${transaction.quoteCurrency}`;
      case 'NFT_TRANSFER':
        return `${transaction.from} sent NFT ${transaction.nftId} to ${transaction.to}`;
      case 'POWER_UP':
        return `${transaction.account} powered up ${transaction.amount} ${transaction.token}`;
      default:
        return transaction.memo || transaction.rawMessage || 'Unknown transaction';
    }
  }
}

// Export singleton instance
export const feedParser = new FeedParser();