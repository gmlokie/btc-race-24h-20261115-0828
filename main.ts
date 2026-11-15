// Race a BTC trading bot live for 24 hours (make.fun bars-replay/v1).
//
// Strategy: patient dip-buyer plus a trend rider, long only, $1,000 paper money.
//
// Why this shape: the dev window (24h of 1-minute cbBTC bars) falls 4% in a
// choppy grind, and every house baseline loses on it (buy-and-hold -$44.01,
// momentum -$40.92, ema-cross -$134.95, rsi-bollinger -$57.37). The 1-minute
// moves are mostly noise (12 bps std) while a full-size round trip costs
// ~40 bps, so fast signals whipsaw to death: in backtests an EMA/RSI bot
// made -$70..-$150. The only tradeable move in the window is the big
// reversal in hours 16-18: a -2.04% hour, then +2.84% and +1.05%. So the bot
// sits in cash and waits for a sharp drop, then buys the reversal:
//
// - DIP leg (the money leg): at an hour close, if the last 60 minutes fell
//   1.75% or more, buy with all cash. Exit at +4% take-profit, a 1%
//   trailing stop from the peak since entry, a 3% stop-loss, or after
//   360 minutes. A second, stricter trigger fires at a 30-minute close
//   after a 2% half-hour plunge with the hour down 1.5% or more.
// - TREND leg (race-only option, never fires on the dev window): at an
//   hour close, if the last 60 minutes rose 2% or more, buy 70% of cash
//   and ride it with a 1.5% trailing stop / 1.5% stop-loss / 3% take-profit,
//   so a rallying race window is not missed while flat.
// - GUARDS: after a losing dip exit, no new dip entry for 120 bars (no
//   averaging into a falling knife). If equity ever falls 8% under its
//   peak, flatten and stop. No new entries in the last 10 bars.
//
// Local grade on the frozen dev window (kit grade-local, process driver):
// net PnL +$40.99, 1 round trip (buy bar 1019 @ $62,567 after a -2.13%
// hour, sell on the bounce near +4%), max drawdown 1.05%, fees $0.82.
// Deterministic: decisions use only the closes the harness sends, no
// clock, no randomness, no network, standard library only (plus the
// kit's vendored SDK shim).

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, BuyInput, SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 300;

// Tuned parameters (see the header comment).
const DIP_D60 = 0.0175; // 60-min drop that triggers a dip buy (hour close)
const DIP_TP = 0.04; // dip take-profit
const DIP_TRAIL = 0.01; // dip trailing stop from peak since entry
const DIP_STOP = 0.03; // dip stop-loss from entry
const DIP_MAX_HOLD = 360; // dip max hold, bars
const DIP30_D30 = 0.02; // 30-min drop for the fast dip trigger
const DIP30_D60 = 0.015; // ... with the hour down at least this much
const TREND_D60 = 0.02; // 60-min rise that triggers a trend buy (hour close)
const TREND_FRAC_NUM = 7n; // trend position size: 70% of cash
const TREND_FRAC_DEN = 10n;
const TREND_TP = 0.03;
const TREND_TRAIL = 0.015;
const TREND_STOP = 0.015;
const GUARD_DD = 0.08; // flatten + stop if equity falls this far under peak
const COOL_AFTER_LOSS = 120; // bars to wait after a losing dip exit
const LAST_ENTRY_SEQ = 1429; // no new entries at/after this batch
const MIN_NOTIONAL = 1000000n; // $1, the harness minimum

const hist: number[] = []; // closes in USD, one per batch
let entry: number | null = null; // entry close (USD) of the open position
let peak = 0; // highest close since entry
let entrySeq = 0;
let mode: 'dip' | 'trend' | null = null;
let peakEq = 1000; // peak equity in USDC
let coolUntil = -1; // seq before which no new dip entry

function reset(): void {
  entry = null;
  peak = 0;
  mode = null;
}

function sellOrder(qty: bigint): SellInput {
  return { side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

function buyOrder(notional: bigint): BuyInput {
  return { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

await runBars({
  onBatch(state: BarsState) {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const price = Number(close) / 100000; // price_scale 5 -> USD
    hist.push(price);
    const seq = state.seq;

    const equity = Number(state.equity) / 1000000;
    if (equity > peakEq) peakEq = equity;

    const held = state.positions.get(SYMBOL);

    // Drawdown guard: flatten and stop trading.
    if (equity < peakEq * (1 - GUARD_DD)) {
      if (held !== undefined) {
        reset();
        return [sellOrder(held.qty)];
      }
      return [];
    }

    if (held !== undefined && entry !== null) {
      if (price > peak) peak = price;
      if (mode === 'dip') {
        if (
          price >= entry * (1 + DIP_TP) ||
          price < peak * (1 - DIP_TRAIL) ||
          price < entry * (1 - DIP_STOP) ||
          seq - entrySeq > DIP_MAX_HOLD
        ) {
          const lost = price < entry;
          reset();
          if (lost) coolUntil = seq + COOL_AFTER_LOSS;
          return [sellOrder(held.qty)];
        }
      } else {
        if (
          price >= entry * (1 + TREND_TP) ||
          price < peak * (1 - TREND_TRAIL) ||
          price < entry * (1 - TREND_STOP)
        ) {
          reset();
          return [sellOrder(held.qty)];
        }
      }
      return [];
    }

    // Flat: look for entries.
    if (seq >= LAST_ENTRY_SEQ || hist.length < 61) return [];
    if (seq < coolUntil) return [];
    const r60 = price / hist[hist.length - 61] - 1;
    const r30 = price / hist[hist.length - 31] - 1;

    if (seq % 60 === 59 && r60 <= -DIP_D60) {
      entry = price;
      peak = price;
      entrySeq = seq;
      mode = 'dip';
      return [buyOrder(state.cash)];
    }
    if (seq % 30 === 29 && r30 <= -DIP30_D30 && r60 <= -DIP30_D60) {
      entry = price;
      peak = price;
      entrySeq = seq;
      mode = 'dip';
      return [buyOrder(state.cash)];
    }
    if (seq % 60 === 59 && r60 >= TREND_D60) {
      const notional = (state.cash * TREND_FRAC_NUM) / TREND_FRAC_DEN;
      if (notional >= MIN_NOTIONAL) {
        entry = price;
        peak = price;
        entrySeq = seq;
        mode = 'trend';
        return [buyOrder(notional)];
      }
    }
    return [];
  },
});
