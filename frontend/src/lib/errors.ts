/** Extracts a user-friendly error message from a wallet/contract error. */
export function friendlyError(error: Error): string {
  const msg = error.message || 'Unknown error';

  // User rejected the transaction in their wallet
  if (msg.includes('User rejected') || msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
    return 'Transaction cancelled — you rejected it in your wallet.';
  }

  // Insufficient funds for gas
  if (msg.includes('insufficient funds') || msg.includes('InsufficientFunds')) {
    return 'Insufficient funds for gas. Get testnet tokens from a faucet.';
  }

  // Contract revert reasons
  if (msg.includes('InsufficientCollateral')) {
    return 'Not enough collateral to borrow this amount. Pledge more assets first.';
  }
  if (msg.includes('NothingBorrowed')) {
    return 'No outstanding debt to repay.';
  }
  if (msg.includes('ZeroValue')) {
    return 'Value must be greater than zero.';
  }

  // Network errors
  if (msg.includes('network') || msg.includes('NETWORK_ERROR') || msg.includes('could not detect network')) {
    return 'Network error — check your wallet connection and try again.';
  }

  // Nonce errors
  if (msg.includes('nonce') || msg.includes('NONCE_EXPIRED')) {
    return 'Transaction nonce conflict. Try again.';
  }

  // Fallback: first line of the error
  return msg.split('\n')[0].slice(0, 120);
}
