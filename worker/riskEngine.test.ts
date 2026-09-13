import { computeRiskScore, PledgeSummary } from './riskEngine';

// Status enum: 0 = Active, 1 = Released, 2 = Liquidated

// On-chain USD values use 8-decimal fixed point (Chainlink-style).
// $1 = 1_0000_0000 = 100_000_000
const SCALE = 10n ** 8n;

function usd(dollars: number): bigint {
  return BigInt(dollars) * SCALE;
}

function active(category: number, chainKey: number = 1, pledgedAtBlock: number = 0): PledgeSummary {
  return { category, sourceChainKey: chainKey, status: 0, pledgedAtBlock };
}

function released(category: number, chainKey: number = 1, pledgedAtBlock: number = 0): PledgeSummary {
  return { category, sourceChainKey: chainKey, status: 1, pledgedAtBlock };
}

let passed = 0;
let failed = 0;

function assertEqual(actual: number, expected: number, name: string) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.error(`  FAIL: ${name} (got ${actual}, expected ${expected})`);
  }
}

console.log('--- computeRiskScore tests ---\n');

// Base score (no currentBlock → no duration bonus)
console.log('Base score:');
assertEqual(computeRiskScore(0n, [], 0), 400, 'zero everything → base 400');

// Collateral bonus: +1 per $5k, max 200
console.log('\nCollateral bonus:');
assertEqual(computeRiskScore(usd(4999), [active(0)], 0), 400 + 0 + 50 + 50, '<$5k → +0 collateral bonus');
assertEqual(computeRiskScore(usd(5000), [active(0)], 0), 400 + 1 + 50 + 50, '$5k → +1');
assertEqual(computeRiskScore(usd(25000), [active(0)], 0), 400 + 5 + 50 + 50, '$25k → +5');
assertEqual(computeRiskScore(usd(2000000), [active(0)], 0), 400 + 200 + 50 + 50, '$2M → capped at +200');

// Diversity bonus: +50/category +50/chain, max 200
console.log('\nDiversity bonus:');
assertEqual(
  computeRiskScore(usd(10000), [active(0, 1), active(1, 1)], 0),
  400 + 2 + 100 + 50, // 2 categories, 1 chain
  '2 categories, 1 chain → +150'
);
assertEqual(
  computeRiskScore(usd(10000), [active(0, 1), active(0, 2)], 0),
  400 + 2 + 50 + 100, // 1 category, 2 chains
  '1 category, 2 chains → +150'
);
assertEqual(
  computeRiskScore(usd(10000), [active(0, 1), active(1, 2)], 0),
  400 + 2 + 200, // 2 categories + 2 chains = 200, capped
  '2 categories, 2 chains → capped at +200'
);

// Only active pledges count for diversity
console.log('\nReleased pledges excluded from diversity:');
assertEqual(
  computeRiskScore(usd(10000), [active(0, 1), released(1, 2)], 0),
  400 + 2 + 50 + 50, // only 1 active category, 1 active chain
  'released pledge ignored'
);

// Liquidation penalty
console.log('\nLiquidation penalty:');
assertEqual(computeRiskScore(0n, [], 1), 250, '1 liquidation → 400-150 = 250');
assertEqual(computeRiskScore(0n, [], 2), 100, '2 liquidations → 400-300 = 100');
assertEqual(computeRiskScore(0n, [], 3), 0, '3 liquidations → 400-450 = -50, clamped to 0');
assertEqual(computeRiskScore(0n, [], 5), 0, '5 liquidations → still 0');

// Duration bonus: +10 per 1000-block avg age, max 100
console.log('\nDuration bonus:');
assertEqual(
  computeRiskScore(0n, [active(0, 1, 1000)], 0, 2000),
  400 + 0 + 50 + 50 + 10, // avg age = 1000 blocks → +10
  '1 pledge aged 1000 blocks → +10 duration'
);
assertEqual(
  computeRiskScore(0n, [active(0, 1, 0)], 0, 5000),
  400 + 0 + 50 + 50 + 50, // avg age = 5000 blocks → +50
  '1 pledge aged 5000 blocks → +50 duration'
);
assertEqual(
  computeRiskScore(0n, [active(0, 1, 0)], 0, 15000),
  400 + 0 + 50 + 50 + 100, // avg age = 15000 → capped at 100
  '1 pledge aged 15000 blocks → capped at +100 duration'
);
assertEqual(
  computeRiskScore(0n, [active(0, 1, 0), active(1, 1, 4000)], 0, 5000),
  400 + 0 + 100 + 50 + 30, // avg age = (5000+1000)/2 = 3000 → +30
  '2 pledges avg age 3000 blocks → +30 duration'
);
// No currentBlock → no duration bonus (backwards compat)
assertEqual(
  computeRiskScore(0n, [active(0, 1, 0)], 0),
  400 + 0 + 50 + 50, // no duration
  'no currentBlock → no duration bonus'
);

// Clamping
console.log('\nClamping:');
assertEqual(
  computeRiskScore(usd(5000000), [active(0, 1, 0), active(1, 2, 0), active(2, 3, 0), active(3, 4, 0)], 0, 50000),
  900, // 400 + 200 + 200 + 100 = 900
  'max achievable score is 900 with duration'
);
assertEqual(
  computeRiskScore(usd(5000000), [active(0, 1), active(1, 2), active(2, 3), active(3, 4)], 0),
  800, // 400 + 200 + 200 + 0 = 800 (no currentBlock)
  'max without duration is 800'
);

// Combined
console.log('\nCombined scenario:');
assertEqual(
  computeRiskScore(usd(100000), [active(0, 1, 0), active(1, 1, 0), active(2, 2, 0)], 1, 3000),
  500, // 400 + min(200,20) + min(200,150+100=250→200) + min(100,30) - min(450,150) = 400+20+200+30-150
  '$100k, 3 cats, 2 chains, 1 liq, 3000 blocks → 500'
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
