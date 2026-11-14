#!/bin/bash
# Stage 2 rehearsal on a LOCAL FORK of Robinhood Chain mainnet (runbook 09 S2-06, runbook 10).
#
# Nothing is ever sent to the real chain: every transaction goes to a local anvil node, and the real deployer
# and Safe are only impersonated there. Run it again right before the real deploy: the predicted addresses
# depend on the deployer nonce and on the exact bytecode, and the gas cost depends on the current gas price.
#
#   bash scripts/stage2-fork-rehearsal.sh
#
# Needs: foundry (forge, cast, anvil), node, curl and network access to the public RPC (read-only).
# Only ONE copy may run at a time (it uses port 8547); a second copy refuses to start.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts" || exit 1
S="$(mktemp -d)"
UP="${RPC_URL_ROBINHOOD_MAINNET_PUBLIC:-https://rpc.mainnet.chain.robinhood.com}"
FORK=http://127.0.0.1:8547
export FOUNDRY_BROADCAST="$S/fork-broadcast"   # keep fork artefacts out of contracts/broadcast

if (echo > /dev/tcp/127.0.0.1/8547) 2>/dev/null; then
  echo "Port 8547 is in use: another rehearsal (or a leftover anvil) is running. Stop it first."
  exit 4
fi

D=0x911Bf0fd05A53eC2d06952Ee2Fca8b17CBeA3Bad      # the Stage 1 deployer (public address)
SAFE=0x340B621D1BB4Be8b25D75fbBD9a628eD491030dD
REG=0x75Eb65C532207617B7b0CdC34348De376B16920B
PAY=0x70C63C0Fb54028F6F2b30c38d9f11f9696ACB1BC
FAC=0x1d312F5264202350F006789d18Ae3f21b2d00712
SWP=0x49a09d2558C4497913eAda66DB0e3ce1e7c0B579
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
TOKEN=0x415fA0f3480e7c1115EF052F9a7238827DC288cF
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032
PAIR=0x2c36a7b9dd29628a6d512dcea99eaca0205a3ba5   # the launchpad pair that holds most of the supply
DEAD=0x000000000000000000000000000000000000dEaD
P=0x00000000000000000000000000000000000BEEF1       # test payer for seeding (fork only)

log() { echo "[$(date +%H:%M:%S)] $*"; }
num() { awk '{print $1}'; }
send() { cast send "$@" --unlocked --rpc-url $FORK 2>&1 | grep -E "^(status|blockNumber|gasUsed)|Error|revert" | tr '\n' ' '; echo; }

log "checking the network (up to 2 minutes)"
UPOK=0
for i in $(seq 1 12); do
  if curl -s -m 8 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' $UP 2>/dev/null | grep -q 0x1237; then UPOK=1; break; fi
  sleep 10
done
[ "$UPOK" = 1 ] || { log "NO NETWORK: rehearsal not executed"; exit 2; }
log "network is up"

anvil --fork-url $UP --port 8547 --silent > "$S/anvil_s2.log" 2>&1 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null' EXIT
for i in $(seq 1 40); do [ "$(cast chain-id --rpc-url $FORK 2>/dev/null)" = 4663 ] && break; sleep 3; done
log "fork chain id: $(cast chain-id --rpc-url $FORK 2>&1 | head -1)  head: $(cast block-number --rpc-url $FORK 2>&1 | head -1)"

echo; echo "===== A. preconditions read from the real chain ====="
log "deployer nonce $(cast nonce $D --rpc-url $FORK)  balance $(cast balance $D --rpc-url $FORK --ether) ETH"
log "Safe threshold $(cast call $SAFE 'getThreshold()(uint256)' --rpc-url $FORK)  owners $(cast call $SAFE 'getOwners()(address[])' --rpc-url $FORK)"
log "registry owner $(cast call $REG 'owner()(address)' --rpc-url $FORK) | hook $(cast call $REG 'hook()(address)' --rpc-url $FORK) | stake $(cast call $REG 'stakeContract()(address)' --rpc-url $FORK) | burnVault $(cast call $REG 'burnVault()(address)' --rpc-url $FORK)"
REGFEE=$(cast call $REG 'registrationFee()(uint256)' --rpc-url $FORK | num)
REGTREAS=$(cast call $REG 'treasury()(address)' --rpc-url $FORK)
REGSTABLE=$(cast call $REG 'stablecoin()(address)' --rpc-url $FORK)
log "registry config now: stablecoin $REGSTABLE treasury $REGTREAS fee $REGFEE"

cast rpc anvil_impersonateAccount $D --rpc-url $FORK > /dev/null
REALBAL=$(cast balance $D --rpc-url $FORK)
cast rpc anvil_setBalance $D 0x8AC7230489E80000 --rpc-url $FORK > /dev/null   # 10 ETH on the FORK only, so gas is never the blocker here

echo; echo "===== B. DeployStage2 broadcast on the fork ====="
DEPLOYER_ADDRESS=$D ENTRY_POINT=$EP STABLECOIN_ADDRESS=$USDG TREASURY_ADDRESS=$SAFE POOL_MANAGER=$PM \
PINELY_TOKEN_ADDRESS=$TOKEN REGISTRY_ADDRESS=$REG PAYMASTER_ADDRESS=$PAY ACCOUNT_FACTORY_ADDRESS=$FAC SWEEPER_ADDRESS=$SWP \
ALLOW_STAGE2_MAINNET=true BUYBACK_POOL_FEE=3000 BUYBACK_POOL_TICK_SPACING=60 \
forge script script/DeployStage2.s.sol:DeployStage2 --rpc-url $FORK --broadcast --unlocked --sender $D > "$S/s2_forge.txt" 2>&1
log "forge exit: $?"
grep -E "Error|revert|Guard|guard" "$S/s2_forge.txt" | head -5
grep -E "Stage 2 complete|PinelyBuybackExecutor:|BurnVault:|PinelyHook:|PinelyRouter:|PinelyStake:|FleetSubscription:|CreatorFeeSplitter:|PoolSeeder:|Execute from|setHook|setStakeContract|setRegistrationConfig|setAuthorizedLp|Registry is not|lockRoutes|ROUTE_DELAY|ownership transferred|Total Paid|Estimated" "$S/s2_forge.txt" | sed 's/^ *//' | head -30

get() { grep -o "$1: 0x[0-9a-fA-F]*" "$S/s2_forge.txt" | head -1 | grep -o "0x.*"; }
BV=$(get "BurnVault"); EX=$(get "PinelyBuybackExecutor"); HOOK=$(get "PinelyHook"); ROUTER=$(get "PinelyRouter")
STAKE=$(get "PinelyStake"); SUB=$(get "FleetSubscription"); SPLIT=$(get "CreatorFeeSplitter"); SEED=$(get "PoolSeeder")
echo; log "addresses: BV=$BV EX=$EX HOOK=$HOOK ROUTER=$ROUTER STAKE=$STAKE SUB=$SUB SPLIT=$SPLIT SEED=$SEED"
[ -n "$BV" ] && [ -n "$EX" ] && [ -n "$HOOK" ] && [ -n "$SEED" ] || { log "DEPLOY FAILED, see $S/s2_forge.txt"; exit 3; }
log "deployer nonce after: $(cast nonce $D --rpc-url $FORK)   (real balance before the dry run was $REALBAL wei)"

echo; echo "===== C. ownership after the deploy ====="
log "BurnVault owner  $(cast call $BV 'owner()(address)' --rpc-url $FORK)  (expected Safe)"
log "PinelyStake owner $(cast call $STAKE 'owner()(address)' --rpc-url $FORK)  (expected Safe)"
log "PoolSeeder owner $(cast call $SEED 'owner()(address)' --rpc-url $FORK)  (expected Safe)"
log "executor burnVault $(cast call $EX 'burnVault()(address)' --rpc-url $FORK) | fee $(cast call $EX 'fee()(uint24)' --rpc-url $FORK) | spacing $(cast call $EX 'tickSpacing()(int24)' --rpc-url $FORK)"
SEL=$(cast sig "buyback(uint256,uint256)")
log "route proposed: activeAt $(cast call $BV 'routeActiveAt(address,bytes4)(uint64)' $EX $SEL --rpc-url $FORK), active now: $(cast call $BV 'isRouteActive(address,bytes4)(bool)' $EX $SEL --rpc-url $FORK)"
log "registry hook still unset (needs the Safe): $(cast call $REG 'hook()(address)' --rpc-url $FORK)"

echo; echo "===== D. Safe transactions, executed as the impersonated Safe on the fork ====="
cast rpc anvil_impersonateAccount $SAFE --rpc-url $FORK > /dev/null
cast rpc anvil_setBalance $SAFE 0xDE0B6B3A7640000 --rpc-url $FORK > /dev/null
log "1 registry.setHook:                  $(send $REG 'setHook(address)' $HOOK --from $SAFE)"
log "2 registry.setStakeContract:         $(send $REG 'setStakeContract(address)' $STAKE --from $SAFE)"
log "3 registry.setRegistrationConfig:    $(send $REG 'setRegistrationConfig(address,address,address,uint256)' $REGSTABLE $REGTREAS $BV $REGFEE --from $SAFE)"
log "4 hook.setAuthorizedLp(PoolSeeder):  $(send $HOOK 'setAuthorizedLp(address,bool)' $SEED true --from $SAFE)"
log "now: hook $(cast call $REG 'hook()(address)' --rpc-url $FORK) | stake $(cast call $REG 'stakeContract()(address)' --rpc-url $FORK) | burnVault $(cast call $REG 'burnVault()(address)' --rpc-url $FORK) | PoolSeeder authorised: $(cast call $HOOK 'isAuthorizedLp(address)(bool)' $SEED --rpc-url $FORK)"

echo; echo "===== E. reference price for the buyback pool (from the launchpad curve and the Paymaster ETH price) ====="
RES=$(cast call $PAIR 'getReserves()(uint256,uint256)' --rpc-url $FORK)
R0=$(echo "$RES" | sed -n 1p | num); R1=$(echo "$RES" | sed -n 2p | num)
ETHUSD8=$(cast call $PAY 'fixedNativePrice()(uint256)' --rpc-url $FORK | num)
LAST=$(cast call $PAY 'lastPriceUpdate()(uint256)' --rpc-url $FORK | num)
log "curve reserves: ETH side $R0 | PINELY side $R1 | Paymaster ETH price (8 dec USD) $ETHUSD8, set at $LAST (expires soon; owner-set, NOT a market oracle)"
MATH=$(node -e '
const R0=BigInt(process.argv[1]), R1=BigInt(process.argv[2]), E=BigInt(process.argv[3]);
// USDG per PINELY (human) = (R0/R1) * (E/1e8). raw price (currency1/currency0, PINELY is currency0) = human * 1e6 / 1e18.
const num = R0 * E * (1n<<192n);
const den = R1 * 10n**8n * 10n**12n;
const x = num/den;
function isqrt(n){ if(n<2n) return n; let a=n, b=(a+1n)/2n; while(b<a){ a=b; b=(a+n/a)/2n;} return a; }
const sqrt = isqrt(x);
const human = Number(R0)/Number(R1)*Number(E)/1e8;
const budget = 2000n*10n**6n;                       // seed with about 2,000 USDG on the USDG side
const L = budget * (1n<<96n) / sqrt;                 // full range: amount1 = L * sqrtP
const pinelyNeed = (L * (1n<<96n) / sqrt) * 105n / 100n;   // amount0 = L / sqrtP, plus 5% headroom
const amountIn = 20n*10n**6n;                        // a 20 USDG test buyback
const outSpot = amountIn * 10n**12n * 10n**6n / BigInt(Math.round(human*1e6)); // PINELY wei at spot
const minOut = outSpot * 90n / 100n;                 // tolerate about 10% (fee 0.30% plus impact in a 2,000 USDG pool)
console.log([sqrt.toString(), L.toString(), pinelyNeed.toString(), minOut.toString(), human.toString()].join(" "));
' "$R0" "$R1" "$ETHUSD8")
SQRT=$(echo $MATH | cut -d' ' -f1); LIQ=$(echo $MATH | cut -d' ' -f2); NEED=$(echo $MATH | cut -d' ' -f3); MINOUT=$(echo $MATH | cut -d' ' -f4); HUMAN=$(echo $MATH | cut -d' ' -f5)
log "reference price: 1 PINELY = $HUMAN USDG  (FDV about \$$(node -e "console.log((Number('$HUMAN')*1e9).toFixed(0))"))  sqrtPriceX96 $SQRT  liquidity $LIQ"

echo; echo "===== F. seed the buyback pool as the Safe, through PoolSeeder (real PoolManager, real USDG, real PINELY) ====="
KEY=$(cast call $EX 'poolKey()((address,address,uint24,int24,address))' --rpc-url $FORK)
log "poolKey: $KEY"
C0=$(echo "$KEY" | grep -o "0x[0-9a-fA-F]\{40\}" | sed -n 1p); C1=$(echo "$KEY" | grep -o "0x[0-9a-fA-F]\{40\}" | sed -n 2p)
for who in $PAIR $PM $P; do cast rpc anvil_impersonateAccount $who --rpc-url $FORK > /dev/null; cast rpc anvil_setBalance $who 0xDE0B6B3A7640000 --rpc-url $FORK > /dev/null; done
log "fund the payer with PINELY (from the launchpad pair): $(send $TOKEN 'transfer(address,uint256)' $P $NEED --from $PAIR)"
log "fund the payer with USDG (from the PoolManager's balance): $(send $USDG 'transfer(address,uint256)' $P 2100000000 --from $PM)"
log "payer approves PoolSeeder (PINELY): $(send $TOKEN 'approve(address,uint256)' $SEED $NEED --from $P)"
log "payer approves PoolSeeder (USDG):   $(send $USDG 'approve(address,uint256)' $SEED 2100000000 --from $P)"
TUPLE="($C0,$C1,3000,60,0x0000000000000000000000000000000000000000)"
log "initializePool: $(send $SEED 'initializePool((address,address,uint24,int24,address),uint160)' "$TUPLE" $SQRT --from $SAFE)"
log "seed:           $(send $SEED 'seed((address,address,uint24,int24,address),int24,int24,int256,address,address)' "$TUPLE" -887220 887220 $LIQ $P $SAFE --from $SAFE)"

echo; echo "===== G. wait out the public delay, fund the vault, run a small buyback as the Safe ====="
log "vault gets 1,000 USDG (stand-in for protocol fees): $(send $USDG 'transfer(address,uint256)' $BV 1000000000 --from $PM)"
cast rpc evm_increaseTime 172801 --rpc-url $FORK > /dev/null; cast rpc evm_mine --rpc-url $FORK > /dev/null
log "route active after 2 days: $(cast call $BV 'isRouteActive(address,bytes4)(bool)' $EX $SEL --rpc-url $FORK)"
BURN0=$(cast call $TOKEN 'balanceOf(address)(uint256)' $DEAD --rpc-url $FORK | num)
VAULT0=$(cast call $USDG 'balanceOf(address)(uint256)' $BV --rpc-url $FORK | num)
AMT=20000000
DATA=$(cast calldata 'buyback(uint256,uint256)' $AMT $MINOUT)
log "buybackAndBurn: $(send $BV 'buybackAndBurn(address,address,uint256,uint256,bytes)' $EX $USDG $AMT $MINOUT $DATA --from $SAFE)"
BURN1=$(cast call $TOKEN 'balanceOf(address)(uint256)' $DEAD --rpc-url $FORK | num)
VAULT1=$(cast call $USDG 'balanceOf(address)(uint256)' $BV --rpc-url $FORK | num)
log "burned this call: $(node -e "console.log((Number(BigInt('$BURN1')-BigInt('$BURN0'))/1e18).toLocaleString('en-US',{maximumFractionDigits:2}))") PINELY | vault USDG spent: $(node -e "console.log(Number(BigInt('$VAULT0')-BigInt('$VAULT1'))/1e6)") | totalBurned $(cast call $BV 'totalBurned()(uint256)' --rpc-url $FORK | num)"
log "executor holds: PINELY $(cast call $TOKEN 'balanceOf(address)(uint256)' $EX --rpc-url $FORK | num)  USDG $(cast call $USDG 'balanceOf(address)(uint256)' $EX --rpc-url $FORK | num)  (expected 0 and 0)"
log "allowance vault->executor (expected 0): $(cast call $USDG 'allowance(address,address)(uint256)' $BV $EX --rpc-url $FORK | num)"

echo; echo "===== H. lock the route list, then try to add another route ====="
log "lockRoutes: $(send $BV 'lockRoutes()' --from $SAFE)"
log "routesLocked: $(cast call $BV 'routesLocked()(bool)' --rpc-url $FORK)"
log "proposeRoute after lock (expected to revert): $(cast call $BV 'proposeRoute(address,bytes4)' 0x00000000000000000000000000000000000A77AC 0xa9059cbb --from $SAFE --rpc-url $FORK 2>&1 | head -2 | tr '\n' ' ')"
log "buyback still works after the lock: $(send $BV 'buybackAndBurn(address,address,uint256,uint256,bytes)' $EX $USDG 5000000 1 $(cast calldata 'buyback(uint256,uint256)' 5000000 1) --from $SAFE)"

echo; log "REHEARSAL FINISHED (artefacts in $S)"
