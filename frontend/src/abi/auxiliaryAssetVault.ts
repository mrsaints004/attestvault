// Hand-written to match contracts/sol/AuxiliaryAssetVault.sol exactly — see that file for the
// source of truth. Kept independent of Foundry's `out/` artifacts so the frontend can be built
// before `forge build` has ever been run.
export const AUXILIARY_ASSET_VAULT_ABI = [
  {
    type: 'function',
    name: 'pledgeAsset',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'category', type: 'uint8' },
      { name: 'valueUSD', type: 'uint256' },
    ],
    outputs: [{ name: 'pledgeId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'updateAssetValue',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pledgeId', type: 'uint256' },
      { name: 'newValueUSD', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'releaseAsset',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pledgeId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'assets',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'category', type: 'uint8' },
      { name: 'valueUSD', type: 'uint256' },
      { name: 'released', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'pledgeAssetFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'category', type: 'uint8' },
      { name: 'valueUSD', type: 'uint256' },
    ],
    outputs: [{ name: 'pledgeId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'issuers',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'nextPledgeId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'AssetPledged',
    inputs: [
      { name: 'pledgeId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'category', type: 'uint8', indexed: false },
      { name: 'valueUSD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AssetValueUpdated',
    inputs: [
      { name: 'pledgeId', type: 'uint256', indexed: true },
      { name: 'newValueUSD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AssetReleased',
    inputs: [{ name: 'pledgeId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'IssuerAdded',
    inputs: [{ name: 'issuer', type: 'address', indexed: true }],
  },
  {
    type: 'event',
    name: 'IssuerRemoved',
    inputs: [{ name: 'issuer', type: 'address', indexed: true }],
  },
] as const;
