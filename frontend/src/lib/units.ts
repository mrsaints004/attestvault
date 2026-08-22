import { USD_DECIMALS } from '../config';

const SCALE = 10n ** BigInt(USD_DECIMALS);

/** Converts a human-entered dollar amount (e.g. 25000 or "25000.5") to the on-chain fixed-point uint256. */
export function toUsdFixed(amount: number | string): bigint {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid USD amount');
  return BigInt(Math.round(n * Number(SCALE)));
}

/** Converts an on-chain fixed-point uint256 back to a display dollar string. */
export function fromUsdFixed(value: bigint): string {
  const whole = value / SCALE;
  const frac = value % SCALE;
  const fracStr = frac === 0n ? '' : '.' + frac.toString().padStart(USD_DECIMALS, '0').replace(/0+$/, '');
  return whole.toLocaleString('en-US') + fracStr;
}

export function fmtUsd(value: bigint): string {
  return '$' + fromUsdFixed(value);
}

export function truncAddress(addr: string): string {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

export function truncHash(hash: string): string {
  return hash.slice(0, 10) + '…' + hash.slice(-6);
}
