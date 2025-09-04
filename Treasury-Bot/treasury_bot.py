#!/usr/bin/env python3
import os, time, json, math, base64, logging, requests, ast, sqlite3, statistics
from dataclasses import dataclass
from decimal import Decimal
from base58 import b58decode
from dotenv import load_dotenv
from typing import Optional

from prometheus_client import start_http_server, Gauge, Counter

from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

# ────────────────────────────────────────────────────────────────────────────
# Env & Logging
# ────────────────────────────────────────────────────────────────────────────
load_dotenv()
LOG = logging.getLogger("treasury_bot")
logging.basicConfig(
    level=(logging.DEBUG if os.getenv("DEBUG") else logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s"
)

def dbg(msg, **kw): LOG.debug(json.dumps({"dbg": msg, **kw}))
def info(msg, **kw): LOG.info(json.dumps({"info": msg, **kw}))
def warn(msg, **kw): LOG.warning(json.dumps({"warn": msg, **kw}))
def err(msg, **kw): LOG.error(json.dumps({"err": msg, **kw}))

# ────────────────────────────────────────────────────────────────────────────
# Config (env-driven)
# ────────────────────────────────────────────────────────────────────────────
RPC_URL            = os.getenv("RPC_URL")
SWAP_HOST          = os.getenv("RAY_SWAP_HOST", "https://transaction-v1.raydium.io")
API_V3             = os.getenv("RAY_API_V3", "https://api-v3.raydium.io")
TOKENS_URL         = os.getenv("RAY_TOKENS_V2", "https://api.raydium.io/v2/sdk/token/solana.mainnet.json")

GC_MINT            = os.getenv("GC_MINT")                  # REQUIRED
USDC_MINT          = os.getenv("USDC_MINT")
USDT_MINT          = os.getenv("USDT_MINT")
SOL_MINT           = os.getenv("SOL_MINT")

BAND_USD_LOWER     = Decimal(os.getenv("BAND_USD_LOWER", "0.14"))
BAND_USD_UPPER     = Decimal(os.getenv("BAND_USD_UPPER", "0.20"))
CAP_BPS            = int(os.getenv("CAP_BPS", "100"))     # 1%
CHECK_INTERVAL     = int(os.getenv("CHECK_INTERVAL_SEC", str(6*60*60)))
SLIPPAGE_BPS       = int(os.getenv("SLIPPAGE_BPS", "500"))  # 5%
DAILY_MAX_BPS      = int(os.getenv("DAILY_MAX_BPS", "400"))
TREASURY_GC_MIN    = Decimal(os.getenv("TREASURY_GC_MIN", "0"))
VAULT_STABLE_MIN   = Decimal(os.getenv("VAULT_STABLE_MIN", "0"))
PREFERRED_STABLE   = os.getenv("PREFERRED_STABLE", "USDC").upper()

MAX_PRICE_IMPACT_BPS = int(os.getenv("MAX_PRICE_IMPACT_BPS", "200"))
MAX_SPOT_VS_TWAP_BPS = int(os.getenv("MAX_SPOT_VS_TWAP_BPS", "150"))
TWAP_SAMPLES          = int(os.getenv("TWAP_SAMPLES", "7"))
TWAP_PAUSE_SEC        = float(os.getenv("TWAP_PAUSE_SEC", "1"))

JITO_URL          = os.getenv("JITO_URL")  # e.g., https://ny.mainnet.block-engine.jito.wtf
JITO_AUTH         = os.getenv("JITO_AUTH")

METRICS_PORT      = int(os.getenv("METRICS_PORT", "9108"))

assert all([RPC_URL, GC_MINT, USDC_MINT, USDT_MINT, SOL_MINT]), "Missing required env"
client = Client(RPC_URL)

def _load_wallet():
    raw = os.getenv("WALLET_SECRET")
    assert raw, "WALLET_SECRET missing"
    if raw.strip().startswith("["):
        arr = ast.literal_eval(raw); return Keypair.from_bytes(bytes(arr))
    return Keypair.from_bytes(b58decode(raw))
OWNER = _load_wallet()
OWNER_PUB = OWNER.pubkey()

# ────────────────────────────────────────────────────────────────────────────
# Prometheus metrics
# ────────────────────────────────────────────────────────────────────────────
G_PRICE_SOL_PER_GC = Gauge("price_sol_per_gc", "SOL per GC (spot)")
G_SOL_PER_USDC     = Gauge("sol_usdc", "USDC per SOL (spot)")
G_BAND_LOWER_SOL   = Gauge("band_lower_sol", "Lower band in SOL per GC")
G_BAND_UPPER_SOL   = Gauge("band_upper_sol", "Upper band in SOL per GC")
G_TREASURY_GC      = Gauge("treasury_gc", "Treasury GC balance")
G_VAULT_USDC       = Gauge("vault_usdc", "Vault USDC balance")
G_VAULT_USDT       = Gauge("vault_usdt", "Vault USDT balance")
C_EXEC_BUY         = Counter("exec_buy_count", "Number of BUY executions")
C_EXEC_SELL        = Counter("exec_sell_count", "Number of SELL executions")

start_http_server(METRICS_PORT)  # scrape with Prometheus; chart in Grafana. (client_python) 

# ────────────────────────────────────────────────────────────────────────────
# Telegram (push debug)
# ────────────────────────────────────────────────────────────────────────────
TG_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TG_CHAT  = os.getenv("TELEGRAM_CHAT_ID")
def tg_send(text: str):
    if not (TG_TOKEN and TG_CHAT): return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT, "text": text},
            timeout=5
        )
    except Exception as e:
        warn("telegram_send_failed", error=str(e))

# ────────────────────────────────────────────────────────────────────────────
# Token metadata
# ────────────────────────────────────────────────────────────────────────────
def get_token_decimals(mint: str) -> int:
    try:
        j = requests.get(TOKENS_URL, timeout=10).json()
        all_tokens = (j.get("official", []) or []) + (j.get("unOfficial", []) or [])
        for t in all_tokens:
            if t.get("mint") == mint:
                return int(t.get("decimals"))
    except Exception:
        pass
    return 9 if mint == SOL_MINT else 6

DECIMALS = {
    "GC":  get_token_decimals(GC_MINT),
    "USDC":get_token_decimals(USDC_MINT),
    "USDT":get_token_decimals(USDT_MINT),
    "SOL": get_token_decimals(SOL_MINT),
}
def to_base(amount: Decimal, decimals: int) -> int:
    return int((amount * (10 ** decimals)).quantize(Decimal(1)))
def from_base(ui: int, decimals: int) -> Decimal:
    return Decimal(ui) / Decimal(10 ** decimals)

# ────────────────────────────────────────────────────────────────────────────
# Raydium Trade API (quote & build)
# ────────────────────────────────────────────────────────────────────────────
def ray_compute_swap_base_in(input_mint: str, output_mint: str, ui_amount: Decimal):
    amt = to_base(ui_amount, get_token_decimals(input_mint))
    url = f"{SWAP_HOST}/compute/swap-base-in"
    params = {
        "inputMint": input_mint,
        "outputMint": output_mint,
        "amount": str(amt),
        "slippageBps": str(SLIPPAGE_BPS),
        "txVersion": "V0",
    }
    r = requests.get(url, params=params, timeout=15); r.raise_for_status()
    return r.json()

def priority_fee_high() -> int:
    try:
        r = requests.get(f"{API_V3}/fee/prioritization", timeout=5).json()
        return int(r["data"]["default"]["h"])
    except Exception:
        return 5_000  # micro-lamports per CU fallback

def ray_build_transactions(swap_resp, input_is_sol: bool, output_is_sol: bool,
                           input_account: Optional[str]=None, output_account: Optional[str]=None):
    payload = {
        "computeUnitPriceMicroLamports": str(priority_fee_high()),
        "swapResponse": swap_resp,
        "txVersion": "V0",
        "wallet": str(OWNER_PUB),
        "wrapSol": bool(input_is_sol),
        "unwrapSol": bool(output_is_sol),
    }
    if input_account:  payload["inputAccount"]  = input_account
    if output_account: payload["outputAccount"] = output_account
    r = requests.post(f"{SWAP_HOST}/transaction/swap-base-in", json=payload, timeout=20)
    r.raise_for_status()
    data = r.json()["data"]
    return [d["transaction"] for d in data]  # base64 strings  (Raydium Trade API)

def _extract_out_amount(swap_resp) -> int:
    # Try common fields; otherwise scan for a big int
    for path in [("data","outAmount"), ("outAmount",), ("otherAmountThreshold",), ("data","amountOut")]:
        cur = swap_resp
        ok = True
        for k in path:
            if isinstance(cur, dict) and k in cur: cur = cur[k]
            else: ok=False; break
        if ok and isinstance(cur,(int,str)):
            return int(cur)
    ints = []
    def walk(o):
        if isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
        else:
            if isinstance(o,int) or (isinstance(o,str) and o.isdigit()): ints.append(int(o))
    walk(swap_resp)
    return max(ints) if ints else 0

# ────────────────────────────────────────────────────────────────────────────
# Prices (Raydium quotes) + micro-TWAP
# ────────────────────────────────────────────────────────────────────────────
def sol_per_usdc() -> Decimal:
    swap = ray_compute_swap_base_in(SOL_MINT, USDC_MINT, Decimal("1"))
    out = _extract_out_amount(swap)
    return from_base(out, DECIMALS["USDC"])  # USDC per SOL

def gc_per_sol_once() -> Decimal:
    swap = ray_compute_swap_base_in(SOL_MINT, GC_MINT, Decimal("1"))
    out = _extract_out_amount(swap)
    return from_base(out, DECIMALS["GC"])    # GC per SOL

def sol_per_gc_spot() -> Decimal:
    g_per_sol = gc_per_sol_once()
    return Decimal("0") if g_per_sol == 0 else (Decimal(1) / g_per_sol)

def sol_per_gc_twap(samples=TWAP_SAMPLES, pause=TWAP_PAUSE_SEC) -> Decimal:
    vals = []
    for _ in range(max(1, samples)):
        vals.append(sol_per_gc_spot())
        time.sleep(pause)
    # median as robust TWAP approximation (upgradeable to on-chain oracle later)
    return Decimal(str(statistics.median([float(v) for v in vals])))

# ────────────────────────────────────────────────────────────────────────────
# Balances
# ────────────────────────────────────────────────────────────────────────────
def get_spl_balance(owner: Pubkey, mint: str) -> Decimal:
    from solana.rpc.types import TokenAccountOpts
    res = client.get_token_accounts_by_owner(owner, TokenAccountOpts(mint=Pubkey.from_string(mint)))
    value = res.value
    if not value: return Decimal(0)
    tot = Decimal(0)
    for acc in value:
        ui = acc.account.data.parsed["info"]["tokenAmount"]["uiAmountString"]
        tot += Decimal(ui)
    return tot

@dataclass
class Balances:
    treasury_gc: Decimal
    vault_usdc: Decimal
    vault_usdt: Decimal

def get_balances() -> Balances:
    b = Balances(
        treasury_gc=get_spl_balance(OWNER_PUB, GC_MINT),
        vault_usdc =get_spl_balance(OWNER_PUB, USDC_MINT),
        vault_usdt =get_spl_balance(OWNER_PUB, USDT_MINT),
    )
    G_TREASURY_GC.set(float(b.treasury_gc)); G_VAULT_USDC.set(float(b.vault_usdc)); G_VAULT_USDT.set(float(b.vault_usdt))
    return b

# ────────────────────────────────────────────────────────────────────────────
# Governor: per-check caps + daily flow cap
# ────────────────────────────────────────────────────────────────────────────
STATE_DB = "treasury_state.sqlite"
def _db():
    con = sqlite3.connect(STATE_DB)
    con.execute("""CREATE TABLE IF NOT EXISTS daily (
        day TEXT PRIMARY KEY,
        base_treasury_gc REAL,
        base_vault_usdc  REAL,
        base_vault_usdt  REAL,
        sold_gc REAL DEFAULT 0,
        spent_usdc REAL DEFAULT 0,
        spent_usdt REAL DEFAULT 0
    )""")
    return con

def today():
    return time.strftime("%Y-%m-%d", time.gmtime())

def load_day_state(bals: Balances):
    d = today()
    con = _db()
    row = con.execute("SELECT * FROM daily WHERE day=?", (d,)).fetchone()
    if not row:
        con.execute("INSERT INTO daily(day, base_treasury_gc, base_vault_usdc, base_vault_usdt) VALUES (?,?,?,?)",
                    (d, float(bals.treasury_gc), float(bals.vault_usdc), float(bals.vault_usdt)))
        con.commit()
        row = con.execute("SELECT * FROM daily WHERE day=?", (d,)).fetchone()
    con.close()
    return {
        "day": row[0],
        "base_treasury_gc": Decimal(str(row[1])),
        "base_vault_usdc":  Decimal(str(row[2])),
        "base_vault_usdt":  Decimal(str(row[3])),
        "sold_gc":          Decimal(str(row[4])),
        "spent_usdc":       Decimal(str(row[5])),
        "spent_usdt":       Decimal(str(row[6])),
    }

def bump_day_counters(side: str, gc_in: Decimal, usdc_in: Decimal, usdt_in: Decimal):
    con = _db()
    d = today()
    if side == "SELL":
        con.execute("UPDATE daily SET sold_gc = sold_gc + ? WHERE day=?", (float(gc_in), d))
    elif side == "BUY":
        if usdc_in > 0: con.execute("UPDATE daily SET spent_usdc = spent_usdc + ? WHERE day=?", (float(usdc_in), d))
        if usdt_in > 0: con.execute("UPDATE daily SET spent_usdt = spent_usdt + ? WHERE day=?", (float(usdt_in), d))
    con.commit(); con.close()

# ────────────────────────────────────────────────────────────────────────────
# Sizing, health checks, and decisioning
# ────────────────────────────────────────────────────────────────────────────
def cap_amounts(bals: Balances):
    cap_gc   = (bals.treasury_gc * Decimal(CAP_BPS)) / Decimal(10_000)
    cap_usdc = (bals.vault_usdc  * Decimal(CAP_BPS)) / Decimal(10_000)
    cap_usdt = (bals.vault_usdt  * Decimal(CAP_BPS)) / Decimal(10_000)
    return cap_gc, cap_usdc, cap_usdt

def choose_stable(bals: Balances) -> tuple[str, Decimal, int]:
    if PREFERRED_STABLE == "USDT" and bals.vault_usdt > VAULT_STABLE_MIN:
        return USDT_MINT, bals.vault_usdt, DECIMALS["USDT"]
    if bals.vault_usdc > VAULT_STABLE_MIN:
        return USDC_MINT, bals.vault_usdc, DECIMALS["USDC"]
    if bals.vault_usdt > 0:
        return USDT_MINT, bals.vault_usdt, DECIMALS["USDT"]
    return USDC_MINT, Decimal(0), DECIMALS["USDC"]

def decide(price_sol_per_gc: Decimal, sol_usdc: Decimal, bals: Balances):
    lower_sol = BAND_USD_LOWER / sol_usdc
    upper_sol = BAND_USD_UPPER / sol_usdc
    cap_gc, cap_usdc, cap_usdt = cap_amounts(bals)

    if price_sol_per_gc > upper_sol:
        size_gc = max(Decimal(0), min(cap_gc, bals.treasury_gc - TREASURY_GC_MIN))
        return "SELL", size_gc, Decimal(0), Decimal(0), lower_sol, upper_sol, None
    elif price_sol_per_gc < lower_sol:
        stable_mint, stable_bal, _ = choose_stable(bals)
        per_check_cap = (stable_bal * Decimal(CAP_BPS)) / Decimal(10_000)
        size_stable = max(Decimal(0), min(per_check_cap, stable_bal - VAULT_STABLE_MIN))
        return "BUY", Decimal(0), (size_stable if stable_mint==USDC_MINT else Decimal(0)), (size_stable if stable_mint==USDT_MINT else Decimal(0)), lower_sol, upper_sol, stable_mint
    else:
        return "HOLD", Decimal(0), Decimal(0), Decimal(0), lower_sol, upper_sol, None

def est_price_impact_bps(input_mint: str, output_mint: str, ui_amount: Decimal) -> int:
    if ui_amount <= 0: return 0
    # Compare per-unit out at size vs half-size; infer impact
    half = max(ui_amount/2, Decimal("0.000001"))
    q1 = ray_compute_swap_base_in(input_mint, output_mint, half);  o1 = _extract_out_amount(q1)
    q2 = ray_compute_swap_base_in(input_mint, output_mint, ui_amount); o2 = _extract_out_amount(q2)
    if o1<=0 or o2<=0: return 100_000
    per1 = Decimal(o1)/half; per2 = Decimal(o2)/ui_amount
    impact = max(0, (1 - (per2/per1)) * 10_000)  # bps
    return int(impact)

def health_checks(decision: str, size_gc: Decimal, usdc_in: Decimal, usdt_in: Decimal,
                  spot_sol_per_gc: Decimal, twap_sol_per_gc: Decimal) -> tuple[bool,str]:
    # 1) Spot vs TWAP divergence
    if twap_sol_per_gc > 0:
        dev = abs(spot_sol_per_gc - twap_sol_per_gc) / twap_sol_per_gc * Decimal(10_000)
        if dev > MAX_SPOT_VS_TWAP_BPS:
            return False, f"spot_vs_twap_divergence_bps={int(dev)}"

    # 2) Price impact at intended size (Raydium compute)
    if decision == "SELL" and size_gc > 0:
        imp = est_price_impact_bps(GC_MINT, USDC_MINT, size_gc)
        if imp > MAX_PRICE_IMPACT_BPS:
            return False, f"price_impact_bps={imp}"
    elif decision == "BUY" and (usdc_in>0 or usdt_in>0):
        mint_in = USDC_MINT if usdc_in>0 else USDT_MINT
        amt_in  = usdc_in if usdc_in>0 else usdt_in
        imp = est_price_impact_bps(mint_in, GC_MINT, amt_in)
        if imp > MAX_PRICE_IMPACT_BPS:
            return False, f"price_impact_bps={imp}"

    return True, "ok"

def check_daily_governor(decision: str, size_gc: Decimal, usdc_in: Decimal, usdt_in: Decimal, day_state: dict):
    # Compute day caps vs base balances
    if decision == "SELL":
        base = day_state["base_treasury_gc"]
        used = day_state["sold_gc"]
        cap  = (base * Decimal(DAILY_MAX_BPS)) / Decimal(10_000)
        if used + size_gc > cap:
            return False, f"daily_gc_cap_exceeded used={str(used)} add={str(size_gc)} cap={str(cap)}"
    elif decision == "BUY":
        base = (day_state["base_vault_usdc"] if usdc_in>0 else day_state["base_vault_usdt"])
        used = (day_state["spent_usdc"] if usdc_in>0 else day_state["spent_usdt"])
        add  = (usdc_in if usdc_in>0 else usdt_in)
        cap  = (base * Decimal(DAILY_MAX_BPS)) / Decimal(10_000)
        if used + add > cap:
            return False, f"daily_stable_cap_exceeded used={str(used)} add={str(add)} cap={str(cap)}"
    return True, "ok"

# ────────────────────────────────────────────────────────────────────────────
# Execution: Raydium swap → sign → send (Jito if configured)
# ────────────────────────────────────────────────────────────────────────────
def send_tx_base64_via_rpc(tx_b64: str) -> str:
    tx_bytes = base64.b64decode(tx_b64)
    vtx = VersionedTransaction.from_bytes(tx_bytes)
    vtx_signed = vtx.sign([OWNER])
    sig = client.send_raw_transaction(bytes(vtx_signed)).value
    return str(sig)

def send_tx_base64_via_jito(tx_b64: str) -> str:
    # Jito JSON-RPC sendTransaction (single txn path)
    # Docs: /api/v1/transactions method sendTransaction, base64 param
    hdrs = {"Content-Type":"application/json"}
    if JITO_AUTH: hdrs["x-jito-auth"] = JITO_AUTH
    payload = {
        "jsonrpc":"2.0",
        "id":1,
        "method":"sendTransaction",
        "params":[tx_b64, {"encoding":"base64"}]
    }
    r = requests.post(f"{JITO_URL}/api/v1/transactions", json=payload, headers=hdrs, timeout=10)
    r.raise_for_status()
    return r.json().get("result","")

def submit_signed_txs(txs_b64: list[str]) -> list[str]:
    sigs = []
    for tx in txs_b64:
        try:
            if JITO_URL:
                sigs.append(send_tx_base64_via_jito(tx))
            else:
                sigs.append(send_tx_base64_via_rpc(tx))
        except Exception as e:
            err("send_tx_failed", error=str(e))
            raise
    return sigs

def exec_sell_gc_for_stable(gc_amount_ui: Decimal):
    swap = ray_compute_swap_base_in(GC_MINT, USDC_MINT, gc_amount_ui)
    txs = ray_build_transactions(swap, input_is_sol=False, output_is_sol=False)
    sigs = submit_signed_txs(txs)
    return {"sigs": sigs, "input": "GC", "output": "USDC", "ui_in": str(gc_amount_ui)}

def exec_buy_gc_with_stable(stable_mint: str, stable_ui: Decimal):
    swap = ray_compute_swap_base_in(stable_mint, GC_MINT, stable_ui)
    txs = ray_build_transactions(swap, input_is_sol=False, output_is_sol=False)
    sigs = submit_signed_txs(txs)
    return {"sigs": sigs, "input": ("USDC" if stable_mint==USDC_MINT else "USDT"), "output": "GC", "ui_in": str(stable_ui)}

# ────────────────────────────────────────────────────────────────────────────
# One cycle
# ────────────────────────────────────────────────────────────────────────────
def run_once():
    bals = get_balances()

    # Price discovery (spot + micro-TWAP)
    sol_per_gc_sp = sol_per_gc_spot()
    sol_usdc      = sol_per_usdc()
    sol_per_gc_tw = sol_per_gc_twap()

    G_PRICE_SOL_PER_GC.set(float(sol_per_gc_sp)); G_SOL_PER_USDC.set(float(sol_usdc))

    decision, size_gc, usdc_in, usdt_in, lo, hi, stable_choice = decide(sol_per_gc_sp, sol_usdc, bals)
    G_BAND_LOWER_SOL.set(float(lo)); G_BAND_UPPER_SOL.set(float(hi))

    # Daily governor
    day_state = load_day_state(bals)
    ok_day, why_day = check_daily_governor(decision, size_gc, usdc_in, usdt_in, day_state)
    if not ok_day:
        info("governor_skip", reason=why_day, decision=decision)
        tg_send(f"[TreasuryBot] SKIP (Gov): {why_day}")
        return {"status":"SKIP", "reason": why_day}

    # Pool health checks
    ok, why = health_checks(decision, size_gc, usdc_in, usdt_in, sol_per_gc_sp, sol_per_gc_tw)
    if not ok:
        warn("health_skip", reason=why, decision=decision)
        tg_send(f"[TreasuryBot] SKIP (Health): {why}")
        return {"status":"SKIP", "reason": why}

    # Debug snapshot → terminal + Telegram
    snapshot = {
        "decision": decision,
        "sizes": {"gc": str(size_gc), "usdc": str(usdc_in), "usdt": str(usdt_in)},
        "price": {"spot_sol_per_gc": str(sol_per_gc_sp), "twap_sol_per_gc": str(sol_per_gc_tw), "sol_usdc": str(sol_usdc)},
        "band_sol": {"lower": str(lo), "upper": str(hi)},
        "balances": {"gc": str(bals.treasury_gc), "usdc": str(bals.vault_usdc), "usdt": str(bals.vault_usdt)},
        "limits": {"cap_bps": CAP_BPS, "slippage_bps": SLIPPAGE_BPS, "max_price_impact_bps": MAX_PRICE_IMPACT_BPS}
    }
    info("decision", **snapshot)
    tg_send(f"[TreasuryBot] {decision} | sizes GC:{size_gc} USDC:{usdc_in} USDT:{usdt_in}\n"
            f"spot {sol_per_gc_sp:.10f} SOL/GC | twap {sol_per_gc_tw:.10f} | band [{lo:.10f},{hi:.10f}]")

    if decision == "HOLD":
        return {"status":"HOLD"}

    # Execute
    if decision == "SELL" and size_gc > 0:
        res = exec_sell_gc_for_stable(size_gc)
        C_EXEC_SELL.inc()
        bump_day_counters("SELL", size_gc, Decimal(0), Decimal(0))
        info("executed_sell", **res); tg_send(f"[TreasuryBot] SELL ok → {res['sigs'][:1]} ...")
        return {"status":"EXEC", "action":"SELL", **res}

    if decision == "BUY" and (usdc_in > 0 or usdt_in > 0) and stable_choice:
        res = exec_buy_gc_with_stable(stable_choice, (usdc_in if usdc_in>0 else usdt_in))
        C_EXEC_BUY.inc()
        bump_day_counters("BUY", Decimal(0), (usdc_in if usdc_in>0 else Decimal(0)), (usdt_in if usdt_in>0 else Decimal(0)))
        info("executed_buy", **res); tg_send(f"[TreasuryBot] BUY ok → {res['sigs'][:1]} ...")
        return {"status":"EXEC", "action":"BUY", **res}

    warn("skip_no_size_or_balance")
    return {"status":"SKIP", "reason":"no size or insufficient balance"}

if __name__ == "__main__":
    info("startup", version="1.1", jito=bool(JITO_URL), slippage_bps=SLIPPAGE_BPS)
    while True:
        try:
            res = run_once()
            info("cycle_summary", **res)
        except Exception as e:
            err("cycle_failed", error=str(e)); tg_send(f"[TreasuryBot] ERROR: {e}")
        time.sleep(CHECK_INTERVAL)
