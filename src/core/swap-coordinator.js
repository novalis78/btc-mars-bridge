/**
 * Atomic Swap Coordination Module
 * This module handles the coordination between Bitcoin and MarsCoin HTLCs for atomic swaps
 */

const crypto = require('crypto');
const bitcoinHtlc = require('./bitcoin-htlc');
const marscoinHtlc = require('./marscoin-htlc');

/**
 * Generate a secure random preimage and its corresponding hash
 * @returns {Object} Object containing preimage and hash
 */
function generateHashLock() {
  // Generate a random 32-byte preimage
  const preimage = crypto.randomBytes(32);
  
  // Hash the preimage with SHA256
  const hash = crypto.createHash('sha256').update(preimage).digest();
  
  return {
    preimage: preimage.toString('hex'),
    hash: hash
  };
}

/**
 * Initialize a new swap between Bitcoin and MarsCoin
 * @param {Object} params - Swap parameters
 * @param {string} params.initiatorBtcAddress - Initiator's Bitcoin address
 * @param {string} params.initiatorMarscoinAddress - Initiator's MarsCoin address
 * @param {string} params.participantBtcAddress - Participant's Bitcoin address
 * @param {string} params.participantMarscoinAddress - Participant's MarsCoin address
 * @param {number} params.btcAmount - Bitcoin amount in satoshis
 * @param {number} params.marscoinAmount - MarsCoin amount
 * @param {number} params.timeoutDuration - Duration in seconds for timelock
 * @param {Object} params.bitcoinNetwork - Bitcoin network object
 * @param {Object} params.marscoinNetwork - MarsCoin network object
 * @returns {Object} Swap details
 */
async function initiateSwap(params) {
  const {
    initiatorBtcAddress,
    initiatorMarscoinAddress,
    participantBtcAddress,
    participantMarscoinAddress,
    btcAmount,
    marscoinAmount,
    timeoutDuration,
    bitcoinNetwork,
    marscoinNetwork
  } = params;

  // Generate a random preimage and its hash
  const { preimage, hash } = generateHashLock();
  
  // Calculate timeouts - MarsCoin timelock is shorter than Bitcoin timelock
  const now = Math.floor(Date.now() / 1000);
  const marscoinTimelock = now + timeoutDuration;
  const bitcoinTimelock = now + (timeoutDuration * 2); // Bitcoin timelock is double
  
  // Create Bitcoin HTLC
  // Participant locks BTC, Initiator can claim with preimage
  const btcHtlc = await bitcoinHtlc.createHtlc({
    hashLock: Buffer.from(hash.hash), // The hash from generateHashLock
    timelock: bitcoinTimelock,
    recipientPubKey: initiatorBtcAddress, // Initiator can claim BTC with preimage
    refundPubKey: participantBtcAddress, // Participant can refund after timeout
    network: bitcoinNetwork
  });
  
  // Create MarsCoin HTLC
  // Initiator locks MarsCoin, Participant can claim with preimage
  const mrsHtlc = await marscoinHtlc.createHtlc({
    hashLock: Buffer.from(hash.hash), // The hash from generateHashLock
    timelock: marscoinTimelock,
    recipientPubKey: participantMarscoinAddress, // Participant can claim MRS with preimage
    refundPubKey: initiatorMarscoinAddress, // Initiator can refund after timeout
    network: marscoinNetwork
  });
  
  // Create and return swap record
  return {
    id: crypto.randomBytes(16).toString('hex'),
    preimage: preimage,
    hash: hash.hash.toString('hex'),
    addresses: {
      initiatorBtc: initiatorBtcAddress,
      initiatorMarscoin: initiatorMarscoinAddress,
      participantBtc: participantBtcAddress,
      participantMarscoin: participantMarscoinAddress
    },
    btcHtlc: btcHtlc,
    marscoinHtlc: mrsHtlc,
    timeouts: { 
      marscoin: marscoinTimelock, 
      bitcoin: bitcoinTimelock 
    },
    amounts: { 
      btc: btcAmount, 
      marscoin: marscoinAmount 
    },
    status: 'initialized',
    createdAt: now
  };
}

/**
 * Verify that both sides of a swap are properly funded
 * @param {Object} swap - Swap object
 * @param {Object} btcClient - Bitcoin RPC client
 * @param {Object} marscoinClient - MarsCoin RPC client
 * @param {number} requiredBtcConfirmations - Required confirmations for Bitcoin
 * @param {number} requiredMarscoinConfirmations - Required confirmations for MarsCoin
 * @returns {Object} Funding status
 */
async function verifySwapFunding(swap, btcClient, marscoinClient, requiredBtcConfirmations = 1, requiredMarscoinConfirmations = 1) {
  // Check Bitcoin HTLC funding
  let btcFunded = false;
  let btcConfirmations = 0;
  let btcFundingTxId = null;
  
  try {
    // In a real implementation, we would query the Bitcoin blockchain
    // to find transactions that pay to the HTLC address and check confirmations
    const btcUtxos = await btcClient.getAddressUtxos(swap.btcHtlc.address);
    
    // Check if there are UTXOs with sufficient value
    for (const utxo of btcUtxos) {
      if (utxo.amount >= swap.amounts.btc) {
        btcFunded = true;
        btcConfirmations = utxo.confirmations;
        btcFundingTxId = utxo.txid;
        break;
      }
    }
  } catch (error) {
    console.error(`Error checking Bitcoin funding: ${error.message}`);
  }
  
  // Check MarsCoin HTLC funding
  let marscoinFunded = false;
  let marscoinConfirmations = 0;
  let marscoinFundingTxId = null;
  
  try {
    // Similar to Bitcoin, query the MarsCoin blockchain
    const mrsUtxos = await marscoinClient.getAddressUtxos(swap.marscoinHtlc.address);
    
    // Check if there are UTXOs with sufficient value
    for (const utxo of mrsUtxos) {
      if (utxo.amount >= swap.amounts.marscoin) {
        marscoinFunded = true;
        marscoinConfirmations = utxo.confirmations;
        marscoinFundingTxId = utxo.txid;
        break;
      }
    }
  } catch (error) {
    console.error(`Error checking MarsCoin funding: ${error.message}`);
  }
  
  const btcConfirmed = btcConfirmations >= requiredBtcConfirmations;
  const marscoinConfirmed = marscoinConfirmations >= requiredMarscoinConfirmations;
  
  // Update swap status if both sides are confirmed
  if (btcFunded && marscoinFunded && btcConfirmed && marscoinConfirmed) {
    swap.status = 'funded';
    swap.fundingTxIds = {
      bitcoin: btcFundingTxId,
      marscoin: marscoinFundingTxId
    };
  }
  
  return {
    funded: btcFunded && marscoinFunded && btcConfirmed && marscoinConfirmed,
    btcFunded: btcFunded && btcConfirmed,
    marscoinFunded: marscoinFunded && marscoinConfirmed,
    btcConfirmations,
    marscoinConfirmations,
    btcFundingTxId,
    marscoinFundingTxId
  };
}

/**
 * Complete a swap by revealing the preimage
 * @param {Object} swap - Swap object
 * @param {Object} btcClient - Bitcoin RPC client
 * @param {Object} marscoinClient - MarsCoin RPC client
 * @param {Object} claimParams - Parameters for claiming
 * @returns {Object} Claim result
 */
async function completeSwap(swap, btcClient, marscoinClient, claimParams) {
  const {
    initiatorBtcPrivateKey,
    participantMarscoinPrivateKey,
    btcFee,
    marscoinFee
  } = claimParams;
  
  // Verify the swap is funded first
  const fundingStatus = await verifySwapFunding(swap, btcClient, marscoinClient);
  
  if (!fundingStatus.funded) {
    return {
      success: false,
      error: 'Swap is not fully funded and confirmed',
      fundingStatus
    };
  }
  
  let bitcoinClaimTxId = null;
  let marscoinClaimTxId = null;
  
  // As the initiator, claim Bitcoin using the preimage
  if (initiatorBtcPrivateKey) {
    try {
      const btcClaimResult = await bitcoinHtlc.claimHtlcWithPreimage({
        htlcTxId: swap.fundingTxIds.bitcoin,
        htlcVout: 0, // Assume the first output is the HTLC
        redeemScript: swap.btcHtlc.redeemScript,
        preimage: swap.preimage,
        privateKey: initiatorBtcPrivateKey,
        destinationAddress: swap.addresses.initiatorBtc,
        amount: swap.amounts.btc,
        fee: btcFee || 1000, // Default fee in satoshis
        network: swap.bitcoinNetwork
      });
      
      // Broadcast the transaction
      bitcoinClaimTxId = await btcClient.sendRawTransaction(btcClaimResult.txHex);
    } catch (error) {
      console.error(`Error claiming Bitcoin: ${error.message}`);
    }
  }
  
  // As the participant, claim MarsCoin using the preimage (which is now public)
  if (participantMarscoinPrivateKey) {
    try {
      const mrsClaimResult = await marscoinHtlc.claimHtlcWithPreimage({
        htlcTxId: swap.fundingTxIds.marscoin,
        htlcVout: 0, // Assume the first output is the HTLC
        redeemScript: swap.marscoinHtlc.redeemScript,
        preimage: swap.preimage,
        privateKey: participantMarscoinPrivateKey,
        destinationAddress: swap.addresses.participantMarscoin,
        amount: swap.amounts.marscoin,
        fee: marscoinFee || 0.001, // Default fee in MarsCoin
        network: swap.marscoinNetwork
      });
      
      // Broadcast the transaction
      marscoinClaimTxId = await marscoinClient.sendRawTransaction(mrsClaimResult.txHex);
    } catch (error) {
      console.error(`Error claiming MarsCoin: ${error.message}`);
    }
  }
  
  // Update swap status
  const completedAt = Math.floor(Date.now() / 1000);
  swap.status = (bitcoinClaimTxId || marscoinClaimTxId) ? 'completed' : swap.status;
  swap.completedAt = completedAt;
  
  if (bitcoinClaimTxId) swap.bitcoinClaimTxId = bitcoinClaimTxId;
  if (marscoinClaimTxId) swap.marscoinClaimTxId = marscoinClaimTxId;
  
  return {
    success: !!(bitcoinClaimTxId || marscoinClaimTxId),
    marscoinClaimTxId,
    bitcoinClaimTxId,
    preimage: swap.preimage,
    completedAt
  };
}

/**
 * Check if a swap timelock has expired and handle refunds if needed
 * @param {Object} swap - Swap object
 * @param {Object} btcClient - Bitcoin RPC client
 * @param {Object} marscoinClient - MarsCoin RPC client
 * @param {Object} refundParams - Parameters for refund
 * @returns {Object} Refund result
 */
async function handleSwapTimeout(swap, btcClient, marscoinClient, refundParams) {
  const {
    participantBtcPrivateKey,
    initiatorMarscoinPrivateKey,
    btcFee,
    marscoinFee
  } = refundParams;
  
  const now = Math.floor(Date.now() / 1000);
  const marscoinExpired = now > swap.timeouts.marscoin;
  const bitcoinExpired = now > swap.timeouts.bitcoin;
  
  // If nothing has expired, return early
  if (!marscoinExpired && !bitcoinExpired) {
    return {
      refunded: false,
      message: 'Timelocks have not expired yet',
      marscoinExpiry: swap.timeouts.marscoin - now,
      bitcoinExpiry: swap.timeouts.bitcoin - now
    };
  }
  
  let bitcoinRefundTxId = null;
  let marscoinRefundTxId = null;
  
  // If Bitcoin timelock has expired, participant can refund
  if (bitcoinExpired && participantBtcPrivateKey) {
    try {
      const btcRefundResult = await bitcoinHtlc.refundHtlcAfterTimeout({
        htlcTxId: swap.fundingTxIds.bitcoin,
        htlcVout: 0, // Assume the first output is the HTLC
        redeemScript: swap.btcHtlc.redeemScript,
        privateKey: participantBtcPrivateKey,
        refundAddress: swap.addresses.participantBtc,
        amount: swap.amounts.btc,
        fee: btcFee || 1000, // Default fee in satoshis
        locktime: swap.timeouts.bitcoin,
        network: swap.bitcoinNetwork
      });
      
      // Broadcast the transaction
      bitcoinRefundTxId = await btcClient.sendRawTransaction(btcRefundResult.txHex);
    } catch (error) {
      console.error(`Error refunding Bitcoin: ${error.message}`);
    }
  }
  
  // If MarsCoin timelock has expired, initiator can refund
  if (marscoinExpired && initiatorMarscoinPrivateKey) {
    try {
      const mrsRefundResult = await marscoinHtlc.refundHtlcAfterTimeout({
        htlcTxId: swap.fundingTxIds.marscoin,
        htlcVout: 0, // Assume the first output is the HTLC
        redeemScript: swap.marscoinHtlc.redeemScript,
        privateKey: initiatorMarscoinPrivateKey,
        refundAddress: swap.addresses.initiatorMarscoin,
        amount: swap.amounts.marscoin,
        fee: marscoinFee || 0.001, // Default fee in MarsCoin
        locktime: swap.timeouts.marscoin,
        network: swap.marscoinNetwork
      });
      
      // Broadcast the transaction
      marscoinRefundTxId = await marscoinClient.sendRawTransaction(mrsRefundResult.txHex);
    } catch (error) {
      console.error(`Error refunding MarsCoin: ${error.message}`);
    }
  }
  
  // Update swap status
  const refundedAt = Math.floor(Date.now() / 1000);
  swap.status = (bitcoinRefundTxId || marscoinRefundTxId) ? 'refunded' : swap.status;
  swap.refundedAt = refundedAt;
  
  if (bitcoinRefundTxId) swap.bitcoinRefundTxId = bitcoinRefundTxId;
  if (marscoinRefundTxId) swap.marscoinRefundTxId = marscoinRefundTxId;
  
  return {
    refunded: !!(bitcoinRefundTxId || marscoinRefundTxId),
    message: (bitcoinRefundTxId || marscoinRefundTxId) 
      ? 'Refund transaction(s) submitted' 
      : 'No refund transactions were submitted',
    marscoinExpired,
    bitcoinExpired,
    marscoinRefundTxId,
    bitcoinRefundTxId,
    refundedAt
  };
}

module.exports = {
  generateHashLock,
  initiateSwap,
  verifySwapFunding,
  completeSwap,
  handleSwapTimeout
};