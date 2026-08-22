// Hand-written to match contracts/sol/CollateralManager.sol + AssetTypes.sol exactly. Kept
// independent of Foundry's `out/` artifacts so the frontend can be built before `forge build` has
// ever been run.
const PORTFOLIO_TUPLE = {
  name: 'portfolio',
  type: 'tuple',
  components: [
    { name: 'borrower', type: 'address' },
    { name: 'pledgeIds', type: 'bytes32[]' },
    { name: 'totalCollateralValueUSD', type: 'uint256' },
    { name: 'borrowedAmountUSD', type: 'uint256' },
    { name: 'riskScore', type: 'uint16' },
    { name: 'active', type: 'bool' },
  ],
} as const;

export const COLLATERAL_MANAGER_ABI = [
  {
    type: 'function',
    name: 'portfolioOf',
    stateMutability: 'view',
    inputs: [{ name: 'borrower', type: 'address' }],
    outputs: [PORTFOLIO_TUPLE],
  },
  {
    type: 'function',
    name: 'pledges',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'globalId', type: 'bytes32' },
      { name: 'owner', type: 'address' },
      { name: 'category', type: 'uint8' },
      { name: 'sourceChainKey', type: 'uint64' },
      { name: 'valueUSD', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'pledgedAtBlock', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'requiredRatioBps',
    stateMutability: 'pure',
    inputs: [{ name: 'riskScore', type: 'uint16' }],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'sourceVaults',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'BASE_COLLATERAL_RATIO_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'BEST_COLLATERAL_RATIO_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'LIQUIDATION_RATIO_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amountUSD', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amountUSD', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'PledgeRecorded',
    inputs: [
      { name: 'globalId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'chainKey', type: 'uint64', indexed: false },
      { name: 'valueUSD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PortfolioValueChanged',
    inputs: [
      { name: 'borrower', type: 'address', indexed: true },
      { name: 'totalCollateralValueUSD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Borrowed',
    inputs: [
      { name: 'borrower', type: 'address', indexed: true },
      { name: 'amountUSD', type: 'uint256', indexed: false },
      { name: 'collateralRatioBps', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Repaid',
    inputs: [
      { name: 'borrower', type: 'address', indexed: true },
      { name: 'amountUSD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Liquidated',
    inputs: [
      { name: 'borrower', type: 'address', indexed: true },
      { name: 'globalId', type: 'bytes32', indexed: true },
      { name: 'valueUSD', type: 'uint256', indexed: false },
    ],
  },
] as const;
