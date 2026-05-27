/**
 * Polymarket CLOB order executor.
 *
 * Credentials stored per user:
 *   login    = API key address (hex string, 0x…)
 *   password = API private key (hex string, 0x… — the key Polymarket generates for
 *              the API key pair, NOT your main wallet private key)
 *
 * How to obtain:
 *   1. Go to polymarket.com → Settings → API Keys → Create Key
 *   2. Copy the generated address (API Key) and private key (API Secret)
 *   3. Save address as "login" and private key as "password" in ArbiX credentials
 */

import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '../logger';

const CLOB = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

// CTF Exchange EIP-712 domain (Polygon mainnet)
const DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: 137,
} as const;

const ORDER_TYPES = {
  Order: [
    { name: 'salt',           type: 'uint256' },
    { name: 'maker',          type: 'address' },
    { name: 'signer',         type: 'address' },
    { name: 'taker',          type: 'address' },
    { name: 'tokenId',        type: 'uint256' },
    { name: 'makerAmount',    type: 'uint256' },
    { name: 'takerAmount',    type: 'uint256' },
    { name: 'expiration',     type: 'uint256' },
    { name: 'nonce',          type: 'uint256' },
    { name: 'feeRateBps',     type: 'uint256' },
    { name: 'side',           type: 'uint8'   },
    { name: 'signatureType',  type: 'uint8'   },
  ],
};

// Exchange contract on Polygon
const EXCHANGE_DOMAIN = {
  name: 'Polymarket CTF Exchange',
  version: '1',
  chainId: 137,
  verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
} as const;

function buildL1Headers(apiKey: string, secret: string, method: string, path: string, body = '') {
  const ts = Math.floor(Date.now() / 1000).toString();
  const msg = ts + method.toUpperCase() + path + body;
  // L1 auth uses HMAC-SHA256 with base64-decoded secret
  const { createHmac } = require('crypto');
  const sig = createHmac('sha256', Buffer.from(secret.replace(/^0x/, ''), 'hex'))
    .update(msg).digest('base64');
  return {
    'POLY_ADDRESS':   apiKey,
    'POLY_SIGNATURE': sig,
    'POLY_TIMESTAMP': ts,
    'POLY_NONCE':     '0',
    'Content-Type':   'application/json',
  };
}

interface TokenInfo { tokenId: string; outcome: string }

async function resolveTokenId(eventSlug: string, targetOutcome: string): Promise<TokenInfo | null> {
  try {
    // Gamma API: search markets by event slug or keyword
    const res = await axios.get(`${GAMMA}/markets`, {
      params: { slug: eventSlug, limit: 5 },
      timeout: 10_000,
    });
    const markets: any[] = res.data ?? [];
    for (const m of markets) {
      const tokens: any[] = m.tokens ?? [];
      for (const t of tokens) {
        if (t.outcome?.toLowerCase() === targetOutcome.toLowerCase()) {
          return { tokenId: t.token_id, outcome: t.outcome };
        }
      }
    }
    // Fallback: keyword search
    const res2 = await axios.get(`${GAMMA}/markets`, {
      params: { search: eventSlug, limit: 10 },
      timeout: 10_000,
    });
    const markets2: any[] = res2.data ?? [];
    for (const m of markets2) {
      const tokens: any[] = m.tokens ?? [];
      for (const t of tokens) {
        if (t.outcome?.toLowerCase() === targetOutcome.toLowerCase()) {
          return { tokenId: t.token_id, outcome: t.outcome };
        }
      }
    }
    return null;
  } catch (err: any) {
    logger.warn('[polymarket] Token lookup failed', { error: err.message });
    return null;
  }
}

async function getBestPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await axios.get(`${CLOB}/price`, {
      params: { token_id: tokenId, side: 'BUY' },
      timeout: 8_000,
    });
    return parseFloat(res.data?.price ?? '0') || null;
  } catch { return null; }
}

export interface PolymarketOrderResult {
  success: boolean;
  orderId?: string;
  tokenId?: string;
  price?: number;
  error?: string;
}

// ── Fetch wallet USDC balance on Polygon ─────────────────────────────────────
// Accepts either a wallet address (0x + 40 hex chars) or a private key (0x + 64 hex chars).
// If a private key is supplied, derives the wallet address automatically.
export async function getPolymarketBalance(walletAddressOrPrivKey: string): Promise<number | null> {
  try {
    let walletAddress = walletAddressOrPrivKey;

    // If input is a private key (64-byte hex), derive the wallet address
    if (/^0x[0-9a-fA-F]{64}$/.test(walletAddressOrPrivKey)) {
      walletAddress = new ethers.Wallet(walletAddressOrPrivKey).address;
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddressOrPrivKey)) {
      // Not a valid address or private key — skip
      return null;
    }

    // Query Polygon USDC contract via public RPCs with fallback
    const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const callData = '0x70a08231000000000000000000000000' + walletAddress.replace(/^0x/, '').toLowerCase();
    const POLYGON_RPCS = [
      'https://1rpc.io/matic',
      'https://polygon.drpc.org',
      'https://rpc.ankr.com/polygon',
    ];
    for (const rpcUrl of POLYGON_RPCS) {
      try {
        const rpc = await axios.post(rpcUrl, {
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: USDC_POLYGON, data: callData }, 'latest'],
        }, { timeout: 8_000 });
        const hex = rpc.data?.result;
        if (hex && !rpc.data?.error) {
          return parseInt(hex, 16) / 1_000_000;
        }
      } catch { continue; }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Sell / hedge an open Polymarket position ──────────────────────────────────
// Used when the opposing leg (e.g. Pinnacle) voids — we sell our Polymarket
// position at market to close out the one-sided exposure.
export async function closePolymarketPosition(params: {
  apiKey: string;
  apiPrivateKey: string;
  tokenId: string;
  sizeShares: number; // number of shares to sell (≈ stake / entry price)
}): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const wallet = new ethers.Wallet(params.apiPrivateKey);
    const signerAddress = await wallet.getAddress();

    // Current best BID price — we SELL at best bid
    const priceRes = await axios.get(`${CLOB}/price`, {
      params: { token_id: params.tokenId, side: 'SELL' },
      timeout: 8_000,
    });
    const bidPrice = parseFloat(priceRes.data?.price ?? '0');
    if (!bidPrice) return { success: false, error: 'No bid price — market may be closed' };

    const sharesUnits   = BigInt(Math.round(params.sizeShares * 1_000_000));
    const proceedsUnits = BigInt(Math.round(params.sizeShares * bidPrice * 1_000_000));
    const salt = BigInt(Math.floor(Math.random() * 1_000_000_000));

    const orderStruct = {
      salt, maker: signerAddress, signer: signerAddress,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: BigInt(params.tokenId),
      makerAmount: sharesUnits,
      takerAmount: proceedsUnits,
      expiration: 0n, nonce: 0n, feeRateBps: 0n,
      side: 1,           // SELL
      signatureType: 0,  // EOA
    };

    const signature = await wallet.signTypedData(EXCHANGE_DOMAIN, ORDER_TYPES, orderStruct);

    const body = JSON.stringify({
      order: {
        salt: salt.toString(), maker: signerAddress, signer: signerAddress,
        taker: '0x0000000000000000000000000000000000000000',
        tokenId: params.tokenId,
        makerAmount: sharesUnits.toString(),
        takerAmount: proceedsUnits.toString(),
        expiration: '0', nonce: '0', feeRateBps: '0',
        side: 1, signatureType: 0, signature,
      },
      owner: signerAddress,
      orderType: 'FOK', // Fill-or-Kill — either closes fully or doesn't execute
    });

    const headers = buildL1Headers(params.apiKey, params.apiPrivateKey, 'POST', '/order', body);
    const res = await axios.post(`${CLOB}/order`, body, { headers, timeout: 15_000 });
    logger.info('[polymarket] Position closed (hedge)', { orderId: res.data?.orderID, tokenId: params.tokenId, bidPrice });
    return { success: true, orderId: res.data?.orderID };
  } catch (err: any) {
    const detail = err.response?.data ?? err.message;
    logger.error('[polymarket] Hedge/close failed', { error: detail });
    return { success: false, error: JSON.stringify(detail) };
  }
}

export async function placePolymarketOrder(params: {
  apiKey: string;       // 0x… API key address
  apiPrivateKey: string; // 0x… private key for this API key pair
  marketSlug: string;   // e.g. "will-lakers-beat-celtics-game-3"
  outcome: string;      // "YES" or "NO" or team name
  stakeUsdc: number;    // USD stake amount
}): Promise<PolymarketOrderResult> {
  try {
    const wallet = new ethers.Wallet(params.apiPrivateKey);
    const signerAddress = await wallet.getAddress();

    // 1. Resolve token
    const tokenInfo = await resolveTokenId(params.marketSlug, params.outcome);
    if (!tokenInfo) {
      return { success: false, error: `Could not resolve token for market="${params.marketSlug}" outcome="${params.outcome}"` };
    }

    // 2. Get current best price
    const price = await getBestPrice(tokenInfo.tokenId);
    if (!price || price <= 0 || price >= 1) {
      return { success: false, error: `Invalid market price: ${price}` };
    }

    // 3. Build order (USDC has 6 decimals on Polygon)
    const makerAmountBig = BigInt(Math.round(params.stakeUsdc * 1_000_000));
    const takerAmountBig = BigInt(Math.round((params.stakeUsdc / price) * 1_000_000));
    const salt = BigInt(Math.floor(Math.random() * 1_000_000_000));

    const orderStruct = {
      salt:          salt,
      maker:         signerAddress,
      signer:        signerAddress,
      taker:         '0x0000000000000000000000000000000000000000',
      tokenId:       BigInt(tokenInfo.tokenId),
      makerAmount:   makerAmountBig,
      takerAmount:   takerAmountBig,
      expiration:    0n,
      nonce:         0n,
      feeRateBps:    0n,
      side:          0,  // BUY
      signatureType: 0,  // EOA
    };

    // 4. EIP-712 sign
    const signature = await wallet.signTypedData(EXCHANGE_DOMAIN, ORDER_TYPES, orderStruct);

    const body = JSON.stringify({
      order: {
        salt:          salt.toString(),
        maker:         signerAddress,
        signer:        signerAddress,
        taker:         '0x0000000000000000000000000000000000000000',
        tokenId:       tokenInfo.tokenId,
        makerAmount:   makerAmountBig.toString(),
        takerAmount:   takerAmountBig.toString(),
        expiration:    '0',
        nonce:         '0',
        feeRateBps:    '0',
        side:          0,
        signatureType: 0,
        signature,
      },
      owner:     signerAddress,
      orderType: 'GTC',
    });

    const headers = buildL1Headers(params.apiKey, params.apiPrivateKey, 'POST', '/order', body);
    const res = await axios.post(`${CLOB}/order`, body, { headers, timeout: 15_000 });

    logger.info('[polymarket] Order placed', {
      orderId: res.data?.orderID,
      tokenId: tokenInfo.tokenId,
      outcome: tokenInfo.outcome,
      price,
      stakeUsdc: params.stakeUsdc,
    });

    return {
      success: true,
      orderId: res.data?.orderID,
      tokenId: tokenInfo.tokenId,
      price,
    };
  } catch (err: any) {
    const detail = err.response?.data ?? err.message;
    logger.error('[polymarket] Order failed', { error: detail, params: { ...params, apiPrivateKey: '***' } });
    return { success: false, error: JSON.stringify(detail) };
  }
}
