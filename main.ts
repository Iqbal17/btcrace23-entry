// Breakout Rider — BTC trading bot for agent-fun/bars-replay/v1.
//
// Strategy: ride the one big breakout and ignore the chop. The dev window
// rose +364 bps overall, but the whole move came in a single 2-hour jump;
// the other 22 hours are flat chop where every round trip pays ~26 bps in
// fees, slippage and impact. So this bot trades at most once: it waits for a
// genuine breakout and then holds until the move gives back a quarter of it.
//
//   Entry (flat, at least 120 closes seen): buy 100% of cash when the close
//   is a NEW 120-bar high (close >= max of the previous 120 closes).
//   One buy, max_slippage_bps 100.
//   Exit (holding): sell the whole position when the close falls 250 bps
//   below the highest close since entry (trailing stop), OR the position
//   value falls 250 bps below its fill cost (hard stop). No mean-reversion
//   exit, no SMA exit, no time exit.
//
// State comes from each batch's authoritative account (cash, positions with
// qty and cost); fills are never tracked locally. A batch with no CBBTC bar
// sends no orders. Deterministic: no clock, no randomness, no environment —
// the same bars always give the same orders. All value math that touches
// money uses BigInt; closes are plain numbers used only for comparisons
// (integer closes at price_scale 5 stay exact in float64).
//
// Run: node /bot/main.ts (Node 22, type stripping; erasable syntax only).

import { createInterface } from 'node:readline';

const SYMBOL = 'CBBTC';
const LOOKBACK = 120;
const TRAIL_BPS = 250;
const STOP_BPS = 250;
const MAX_SLIPPAGE_BPS = 100;
const BPS = 10000;

// ---------------------------------------------------------------- wire types

interface HelloSymbol {
  symbol: string;
  mint: string;
  price_scale: number;
  qty_scale: number;
}

interface Hello {
  type: string;
  protocol: string;
  seed: string;
  symbols: HelloSymbol[];
  capital: { quote: string; quote_scale: number; quote_units: string };
  bar_interval: string;
  first_close_ms: number;
  caps: {
    max_open_positions: number;
    max_orders_per_bar: number;
    max_weight_bps: number;
    shorts: boolean;
    leverage: boolean;
  };
  fees: { fee_bps: number; slippage_bps: number; min_notional_quote_units: string };
  latency_bars: number;
  warmup_bars?: number;
}

interface Bar {
  symbol: string;
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string | null;
  o_depth: string[];
  c_depth: string[];
}

interface Position {
  symbol: string;
  qty: string;
  cost_quote_units: string;
}

interface Account {
  cash_quote_units: string;
  positions: Position[];
  equity_quote_units: string;
}

interface Batch {
  type: string;
  seq: number;
  t: number;
  bars: Bar[];
  fills: unknown[];
  account: Account;
}

interface BuyOrder {
  side: 'buy';
  client_id: string;
  symbol: string;
  notional_quote_units: string;
  max_slippage_bps: number;
}

interface SellOrder {
  side: 'sell';
  client_id: string;
  symbol: string;
  qty: string;
  max_slippage_bps: number;
}

type Order = BuyOrder | SellOrder;

interface Held {
  qty: bigint;
  cost: bigint;
}

// ---------------------------------------------------------------- the bot

class BreakoutRider {
  private quoteScale = 6;
  private priceScale = 5;
  private qtyScale = 8;
  private minNotional = 0n;
  private warmupBars = 0;
  private cash = 0n;
  private positions = new Map<string, Held>();
  private closes: number[] = [];
  private peak: number | null = null;
  private nextId = 1;

  onHello(hello: Hello): void {
    this.quoteScale = hello.capital.quote_scale;
    this.minNotional = BigInt(hello.fees.min_notional_quote_units);
    this.warmupBars = hello.warmup_bars ?? 0;
    this.cash = BigInt(hello.capital.quote_units);
    for (const s of hello.symbols) {
      if (s.symbol === SYMBOL) {
        this.priceScale = s.price_scale;
        this.qtyScale = s.qty_scale;
      }
    }
  }

  // What `qty` of CBBTC is worth at `price`, in quote units, exactly like
  // the harness: qty * price * 10^quote_scale / 10^(qty_scale +
  // price_scale), integer division truncating toward zero. BigInt is
  // required here: qty * price * 1e6 overflows float64 precision.
  private value(qty: bigint, price: bigint): bigint {
    return (
      (qty * price * 10n ** BigInt(this.quoteScale)) /
      10n ** BigInt(this.qtyScale + this.priceScale)
    );
  }

  private clientId(): string {
    const id = `o${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  onBatch(batch: Batch): Order[] {
    this.cash = BigInt(batch.account.cash_quote_units);
    this.positions.clear();
    for (const p of batch.account.positions) {
      this.positions.set(p.symbol, { qty: BigInt(p.qty), cost: BigInt(p.cost_quote_units) });
    }
    let bar: Bar | null = null;
    for (const b of batch.bars) {
      if (b.symbol === SYMBOL) {
        bar = b;
        break;
      }
    }
    if (bar === null) return [];
    const close = Number(bar.c);
    this.closes.push(close);
    if (batch.seq < this.warmupBars) return [];
    const held = this.positions.get(SYMBOL);
    if (held !== undefined) return this.maybeExit(close, held);
    return this.maybeEnter(close);
  }

  // Flat: buy 100% of cash on a new 120-bar high.
  private maybeEnter(close: number): Order[] {
    // Need the current close plus the 120 closes before it.
    if (this.closes.length < LOOKBACK + 1) return [];
    let prevHigh = -Infinity;
    for (let i = this.closes.length - LOOKBACK - 1; i < this.closes.length - 1; i++) {
      if (this.closes[i] > prevHigh) prevHigh = this.closes[i];
    }
    if (close < prevHigh) return [];
    const notional = this.cash;
    if (notional <= 0n || notional < this.minNotional) return [];
    this.peak = close;
    return [
      {
        side: 'buy',
        client_id: this.clientId(),
        symbol: SYMBOL,
        notional_quote_units: notional.toString(),
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  }

  // Holding: sell everything when the close gives back 250 bps from the
  // highest close since entry (trailing stop), or when the position is
  // worth 250 bps less than its fill cost (hard stop). Integer
  // cross-multiplication keeps the comparisons exact (closes are integers,
  // close * 10000 < 2^53; the value check is exact BigInt).
  private maybeExit(close: number, held: Held): Order[] {
    if (this.peak === null || close > this.peak) this.peak = close;
    const value = this.value(held.qty, BigInt(Math.trunc(close)));
    const hardStop = value * BigInt(BPS) <= held.cost * BigInt(BPS - STOP_BPS);
    const trailing = close * BPS <= this.peak * (BPS - TRAIL_BPS);
    if (!hardStop && !trailing) return [];
    this.peak = null;
    return [
      {
        side: 'sell',
        client_id: this.clientId(),
        symbol: SYMBOL,
        qty: held.qty.toString(),
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  }
}

// ---------------------------------------------------------------- the line loop

async function main(): Promise<void> {
  const bot = new BreakoutRider();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    const msg = JSON.parse(line) as { type: string; seq?: number };
    if (msg.type === 'hello') {
      const hello = msg as unknown as Hello;
      if (hello.protocol !== 'agent-fun/bars-replay/v1') {
        throw new Error(`unsupported protocol ${hello.protocol}`);
      }
      bot.onHello(hello);
    } else if (msg.type === 'batch') {
      const batch = msg as unknown as Batch;
      const orders = bot.onBatch(batch);
      process.stdout.write(
        `${JSON.stringify({ type: 'reply', seq: batch.seq, orders })}\n`,
      );
    } else if (msg.type === 'done') {
      rl.close();
      process.stdin.destroy();
      return;
    } else {
      throw new Error(`unknown message type ${msg.type}`);
    }
  }
  throw new Error('input ended before done');
}

main();
