/**
 * Bitcoin HTLC Implementation
 * This module provides functionality to create and interact with HTLCs on the Bitcoin blockchain
 */

const bitcoin = require('bitcoinjs-lib');
const crypto = require('crypto');

/**
 * Create a Bitcoin HTLC transaction
 * @param {Object} params
 * @param {Buffer} params.hashLock - The SHA256 hash to use as hashlock
 * @param {number} params.timelock - Absolute timelock (block height)
 * @param {string} params.recipientPubKey - Recipient's public key
 * @param {string} params.refundPubKey - Refund public key
 * @param {Object} params.network - Bitcoin network object
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
  const redeemScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
    bitcoin.opcodes.OP_SHA256,
    hashLock,
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    bitcoin.crypto.hash160(recipientPubKeyBuffer),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
    bitcoin.script.number.encode(timelock),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    bitcoin.crypto.hash160(refundPubKeyBuffer),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF
  ]);

  // Create P2SH address from redeem script
  const p2sh = bitcoin.payments.p2sh({
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
 * @param {number} params.amount - Amount to claim in satoshis (minus fee)
 * @param {number} params.fee - Transaction fee in satoshis
 * @param {Object} params.network - Bitcoin network object
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
  const tx = new bitcoin.Transaction();
  
  // Add input from HTLC
  tx.addInput(Buffer.from(htlcTxId, 'hex').reverse(), htlcVout);
  
  // Add output to destination address
  const outputScript = bitcoin.address.toOutputScript(destinationAddress, network);
  tx.addOutput(outputScript, amount - fee);

  // Sign the transaction
  const keyPair = bitcoin.ECPair.fromWIF(privateKey, network);
  const redeemScriptBuffer = Buffer.from(redeemScript, 'hex');
  const preimageBuffer = Buffer.from(preimage, 'hex');
  
  // Create the witness stack for spending the HTLC
  const hashType = bitcoin.Transaction.SIGHASH_ALL;
  const signatureHash = tx.hashForSignature(0, redeemScriptBuffer, hashType);
  const signature = keyPair.sign(signatureHash).toDER();
  
  // Set the input script with the preimage and signature
  const inputScript = bitcoin.script.compile([
    Buffer.concat([signature, Buffer.from([hashType])]),
    keyPair.publicKey,
    preimageBuffer,
    bitcoin.opcodes.OP_TRUE,
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
 * @param {number} params.amount - Amount to refund in satoshis (minus fee)
 * @param {number} params.fee - Transaction fee in satoshis
 * @param {number} params.locktime - Timelock value (must be expired)
 * @param {Object} params.network - Bitcoin network object
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
  const tx = new bitcoin.Transaction();
  tx.locktime = locktime;
  
  // Add input from HTLC with sequence set to enable locktime
  tx.addInput(Buffer.from(htlcTxId, 'hex').reverse(), htlcVout, 0xfffffffe);
  
  // Add output to refund address
  const outputScript = bitcoin.address.toOutputScript(refundAddress, network);
  tx.addOutput(outputScript, amount - fee);

  // Sign the transaction
  const keyPair = bitcoin.ECPair.fromWIF(privateKey, network);
  const redeemScriptBuffer = Buffer.from(redeemScript, 'hex');
  
  // Create the witness stack for spending the HTLC after timeout
  const hashType = bitcoin.Transaction.SIGHASH_ALL;
  const signatureHash = tx.hashForSignature(0, redeemScriptBuffer, hashType);
  const signature = keyPair.sign(signatureHash).toDER();
  
  // Set the input script for refund path
  const inputScript = bitcoin.script.compile([
    Buffer.concat([signature, Buffer.from([hashType])]),
    keyPair.publicKey,
    bitcoin.opcodes.OP_FALSE,
    redeemScriptBuffer
  ]);
  
  tx.setInputScript(0, inputScript);
  
  return {
    txHex: tx.toHex(),
    txId: tx.getId()
  };
}

/**
 * Verify a Bitcoin transaction has enough confirmations
 * @param {string} txId - Transaction ID to check
 * @param {number} requiredConfirmations - Required number of confirmations
 * @param {Object} rpcClient - Bitcoin RPC client
 * @returns {boolean} Whether the transaction has enough confirmations
 */
async function verifyBitcoinConfirmations(txId, requiredConfirmations, rpcClient) {
  try {
    const txDetails = await rpcClient.getTransaction(txId);
    return txDetails.confirmations >= requiredConfirmations;
  } catch (error) {
    console.error(`Error verifying Bitcoin confirmations: ${error.message}`);
    return false;
  }
}

/**
 * Extract and validate preimage from a Bitcoin transaction
 * @param {string} txId - Transaction ID to extract preimage from
 * @param {Buffer} expectedHash - Expected SHA256 hash that the preimage should match
 * @param {Object} rpcClient - Bitcoin RPC client
 * @returns {string|null} Hex-encoded preimage if found and valid, null otherwise
 */
async function extractPreimageFromBitcoinTx(txId, expectedHash, rpcClient) {
  try {
    // Get raw transaction
    const txHex = await rpcClient.getRawTransaction(txId);
    const tx = bitcoin.Transaction.fromHex(txHex);
    
    // Examine each input for a potential preimage
    for (const input of tx.ins) {
      // Parse the input script
      const inputScript = bitcoin.script.decompile(input.script);
      
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
    console.error(`Error extracting preimage from Bitcoin tx: ${error.message}`);
    return null;
  }
}

module.exports = {
  createHtlc,
  claimHtlcWithPreimage,
  refundHtlcAfterTimeout,
  verifyBitcoinConfirmations,
  extractPreimageFromBitcoinTx
};