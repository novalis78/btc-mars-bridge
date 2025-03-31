/**
 * MarsCoin HTLC Implementation
 * This module provides functionality to create and interact with HTLCs on the MarsCoin blockchain
 */

const crypto = require('crypto');

// Marscoin module will be loaded dynamically or mocked
let marscoin;
try {
  marscoin = require('./marscoin-lib-wrapper');
} catch (error) {
  console.warn('MarsCoin library not available, using mock implementation');
  marscoin = {
    networks: { marscoin: {} },
    address: {
      fromBase58Check: () => ({ hash: Buffer.alloc(0) }),
      toOutputScript: () => Buffer.alloc(0)
    },
    script: {
      compile: () => Buffer.alloc(0),
      number: { encode: () => Buffer.alloc(0) }
    },
    opcodes: {
      OP_IF: 0, OP_ELSE: 0, OP_ENDIF: 0,
      OP_SHA256: 0, OP_EQUALVERIFY: 0, OP_CHECKSIG: 0,
      OP_CHECKLOCKTIMEVERIFY: 0, OP_DROP: 0, OP_TRUE: 0, OP_FALSE: 0,
      OP_DUP: 0, OP_HASH160: 0
    },
    payments: { p2sh: () => ({ address: 'dummy_address', output: Buffer.alloc(0) }) },
    Transaction: class { constructor() {} }
  };
}

/**
 * Create a MarsCoin HTLC transaction
 * @param {Object} params
 * @param {Buffer} params.hashLock - The SHA256 hash to use as hashlock
 * @param {number} params.timelock - Absolute timelock (Unix timestamp)
 * @param {string} params.recipientPubKey - Recipient's public key
 * @param {string} params.refundPubKey - Refund public key
 * @param {Object} params.network - MarsCoin network object
 * @returns {Object} HTLC details including address
 */
async function createHtlc(params) {
  const { hashLock, timelock, recipientPubKey, refundPubKey, network } = params;
  
  // Convert public keys to Buffer if they're strings
  const recipientPubKeyBuffer = Buffer.isBuffer(recipientPubKey) 
    ? recipientPubKey 
    : Buffer.from(recipientPubKey, 'hex');
    
  const refundPubKeyBuffer = Buffer.isBuffer(refundPubKey)
    ? refundPubKey
    : Buffer.from(refundPubKey, 'hex');
  
  // Create the redeem script for HTLC
  // MarsCoin uses similar script to Bitcoin
  const redeemScript = marscoin.script.compile([
    marscoin.opcodes.OP_IF,
    marscoin.opcodes.OP_SHA256,
    hashLock,
    marscoin.opcodes.OP_EQUALVERIFY,
    marscoin.opcodes.OP_DUP,
    marscoin.opcodes.OP_HASH160,
    crypto.createHash('ripemd160').update(recipientPubKeyBuffer).digest(),
    marscoin.opcodes.OP_EQUALVERIFY,
    marscoin.opcodes.OP_CHECKSIG,
    marscoin.opcodes.OP_ELSE,
    marscoin.script.number.encode(timelock),
    marscoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    marscoin.opcodes.OP_DROP,
    marscoin.opcodes.OP_DUP,
    marscoin.opcodes.OP_HASH160,
    crypto.createHash('ripemd160').update(refundPubKeyBuffer).digest(),
    marscoin.opcodes.OP_EQUALVERIFY,
    marscoin.opcodes.OP_CHECKSIG,
    marscoin.opcodes.OP_ENDIF
  ]);

  // Create P2SH address from redeem script
  const p2sh = marscoin.payments.p2sh({
    redeem: { output: redeemScript, network },
    network
  });

  return {
    address: p2sh.address,
    redeemScript: redeemScript.toString('hex'),
    p2shOutput: p2sh.output.toString('hex'),
    locktime: timelock
  };
}

/**
 * Create a transaction to claim funds from an HTLC using the preimage
 * @param {Object} params
 * @param {string} params.htlcTxId - Transaction ID of the HTLC funding transaction
 * @param {number} params.htlcVout - Output index of the HTLC in the funding transaction
 * @param {string} params.redeemScript - Hex-encoded redeem script
 * @param {string} params.preimage - Hex-encoded preimage that hashes to the hashlock
 * @param {string} params.privateKey - WIF private key to sign the transaction
 * @param {string} params.destinationAddress - Address to send the claimed funds to
 * @param {number} params.amount - Amount to claim (minus fee)
 * @param {number} params.fee - Transaction fee
 * @param {Object} params.network - MarsCoin network object
 * @returns {Object} Transaction details
 */
async function claimHtlcWithPreimage(params) {
  const {
    htlcTxId,
    htlcVout,
    redeemScript,
    preimage,
    privateKey,
    destinationAddress,
    amount,
    fee,
    network
  } = params;

  // Create transaction
  const tx = new marscoin.Transaction();
  
  // Add input from HTLC
  tx.addInput(Buffer.from(htlcTxId, 'hex').reverse(), htlcVout);
  
  // Add output to destination address
  const outputScript = marscoin.address.toOutputScript(destinationAddress, network);
  tx.addOutput(outputScript, amount - fee);

  // Sign the transaction
  const keyPair = marscoin.ECPair.fromWIF(privateKey, network);
  const redeemScriptBuffer = Buffer.from(redeemScript, 'hex');
  const preimageBuffer = Buffer.from(preimage, 'hex');
  
  // Create the witness stack for spending the HTLC
  const hashType = 0x01; // SIGHASH_ALL
  const signatureHash = tx.hashForSignature(0, redeemScriptBuffer, hashType);
  const signature = keyPair.sign(signatureHash);
  
  // Set the input script with the preimage and signature
  const inputScript = marscoin.script.compile([
    Buffer.concat([signature.toDER(), Buffer.from([hashType])]),
    keyPair.publicKey,
    preimageBuffer,
    marscoin.opcodes.OP_TRUE,
    redeemScriptBuffer
  ]);
  
  tx.setInputScript(0, inputScript);
  
  return {
    txHex: tx.toHex(),
    txId: tx.getId()
  };
}

/**
 * Create a transaction to refund funds from an HTLC after timeout
 * @param {Object} params
 * @param {string} params.htlcTxId - Transaction ID of the HTLC funding transaction
 * @param {number} params.htlcVout - Output index of the HTLC in the funding transaction
 * @param {string} params.redeemScript - Hex-encoded redeem script
 * @param {string} params.privateKey - WIF private key to sign the transaction
 * @param {string} params.refundAddress - Address to refund the funds to
 * @param {number} params.amount - Amount to refund (minus fee)
 * @param {number} params.fee - Transaction fee
 * @param {number} params.locktime - Timelock value (must be expired)
 * @param {Object} params.network - MarsCoin network object
 * @returns {Object} Transaction details
 */
async function refundHtlcAfterTimeout(params) {
  const {
    htlcTxId,
    htlcVout,
    redeemScript,
    privateKey,
    refundAddress,
    amount,
    fee,
    locktime,
    network
  } = params;

  // Create transaction with locktime set
  const tx = new marscoin.Transaction();
  tx.locktime = locktime;
  
  // Add input from HTLC with sequence set to enable locktime
  tx.addInput(Buffer.from(htlcTxId, 'hex').reverse(), htlcVout, 0xfffffffe);
  
  // Add output to refund address
  const outputScript = marscoin.address.toOutputScript(refundAddress, network);
  tx.addOutput(outputScript, amount - fee);

  // Sign the transaction
  const keyPair = marscoin.ECPair.fromWIF(privateKey, network);
  const redeemScriptBuffer = Buffer.from(redeemScript, 'hex');
  
  // Create the witness stack for spending the HTLC after timeout
  const hashType = 0x01; // SIGHASH_ALL
  const signatureHash = tx.hashForSignature(0, redeemScriptBuffer, hashType);
  const signature = keyPair.sign(signatureHash);
  
  // Set the input script for refund path
  const inputScript = marscoin.script.compile([
    Buffer.concat([signature.toDER(), Buffer.from([hashType])]),
    keyPair.publicKey,
    marscoin.opcodes.OP_FALSE,
    redeemScriptBuffer
  ]);
  
  tx.setInputScript(0, inputScript);
  
  return {
    txHex: tx.toHex(),
    txId: tx.getId()
  };
}

/**
 * Verify a MarsCoin transaction has enough confirmations
 * @param {string} txId - Transaction ID to check
 * @param {number} requiredConfirmations - Required number of confirmations
 * @param {Object} rpcClient - MarsCoin RPC client
 * @returns {boolean} Whether the transaction has enough confirmations
 */
async function verifyMarscoinConfirmations(txId, requiredConfirmations, rpcClient) {
  try {
    const txDetails = await rpcClient.getTransaction(txId);
    return txDetails.confirmations >= requiredConfirmations;
  } catch (error) {
    console.error(`Error verifying MarsCoin confirmations: ${error.message}`);
    return false;
  }
}

/**
 * Extract and validate preimage from a MarsCoin transaction
 * @param {string} txId - Transaction ID to extract preimage from
 * @param {Buffer} expectedHash - Expected SHA256 hash that the preimage should match
 * @param {Object} rpcClient - MarsCoin RPC client
 * @returns {string|null} Hex-encoded preimage if found and valid, null otherwise
 */
async function extractPreimageFromMarscoinTx(txId, expectedHash, rpcClient) {
  try {
    // Get raw transaction
    const txHex = await rpcClient.getRawTransaction(txId);
    const tx = marscoin.Transaction.fromHex(txHex);
    
    // Examine each input for a potential preimage
    for (const input of tx.ins) {
      // Parse the input script
      const inputScript = marscoin.script.decompile(input.script);
      
      // Look for a 32-byte value that could be the preimage
      for (const item of inputScript) {
        if (Buffer.isBuffer(item) && item.length === 32) {
          // Hash the potential preimage
          const hash = crypto.createHash('sha256').update(item).digest();
          
          // Compare to expected hash
          if (hash.equals(expectedHash)) {
            return item.toString('hex');
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error extracting preimage from MarsCoin tx: ${error.message}`);
    return null;
  }
}

/**
 * Redeem MarsCoin using a preimage
 * @param {string} txId - Transaction ID containing the HTLC
 * @param {string} preimage - The preimage to reveal
 * @param {Object} params - Additional parameters for redemption
 * @param {Object} rpcClient - MarsCoin RPC client
 * @returns {Object} Result of the redemption
 */
async function redeemMarscoinWithPreimage(txId, preimage, params, rpcClient) {
  const { privateKey, destinationAddress, amount, fee, redeemScript, vout, network } = params;
  
  // Create claim transaction using the preimage
  const claimResult = await claimHtlcWithPreimage({
    htlcTxId: txId,
    htlcVout: vout || 0,
    redeemScript,
    preimage,
    privateKey,
    destinationAddress,
    amount,
    fee,
    network
  });
  
  // Submit the transaction to the network
  try {
    const txId = await rpcClient.sendRawTransaction(claimResult.txHex);
    return {
      txId,
      preimage,
      success: true
    };
  } catch (error) {
    console.error(`Error redeeming MarsCoin with preimage: ${error.message}`);
    return {
      error: error.message,
      success: false
    };
  }
}

module.exports = {
  createHtlc,
  claimHtlcWithPreimage,
  refundHtlcAfterTimeout,
  verifyMarscoinConfirmations,
  redeemMarscoinWithPreimage,
  extractPreimageFromMarscoinTx
};