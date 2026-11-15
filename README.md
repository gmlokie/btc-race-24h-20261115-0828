# btc-race-24h-20261115-0828

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/gmlokie/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/gmlokie/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A patient dip-buying BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty ($250 in USDC). It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, long only, with $1,000 of paper money — no real money is traded.

## What it does

`main.ts` (Node 22, standard library only, plus the kit's vendored SDK shim in `vendor/`) reads one JSON line per minute — a 1-minute bar of cbBTC priced in USD from its Orca Whirlpool — and answers with buy/sell orders. Orders fill at the next minute's open with a 4 bps fee, 2 bps slippage, and constant-product price impact against the pool's depth.

The bot sits in cash and waits for a sharp drop, then buys the reversal:

- **Dip leg**: at an hour close, if the last 60 minutes fell 1.75% or more, buy with all cash. Exit at +4% take-profit, a 1% trailing stop, a 3% stop-loss, or after 360 minutes. A stricter 30-minute trigger (2% plunge in 30 minutes, hour down 1.5%+) catches sharp mid-hour drops.
- **Trend leg**: at an hour close, if the last 60 minutes rose 2% or more, buy 70% of cash and ride it (1.5% trailing stop / stop-loss, 3% take-profit), so a rallying race window is not missed while flat.
- **Guards**: after a losing dip exit, no new dip entry for 120 bars; if equity ever falls 8% under its peak, flatten and stop; no new entries in the last 10 bars.

## Why this shape

The dev window falls 4% in a choppy grind and every house baseline loses on it (buy-and-hold -$44.01, momentum -$40.92, ema-cross -$134.95). One-minute moves are mostly noise (12 bps std) while a full-size round trip costs ~40 bps, so fast EMA/RSI signals whipsaw to death (backtested -$70..-$150). The only tradeable move in the window is the big reversal in hours 16–18: a -2.04% hour, then +2.84% and +1.05%.

## Local grade

Kit `grade-local` on the frozen dev window (process driver):

- **Net PnL +$40.99** (return +4.10%), 1 round trip, win rate 100%
- Max drawdown 1.05%, fees $0.82, 0 rejected orders
- Deterministic: two executions reproduce byte for byte

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout (see `protocol.schema.json` in the competition kit). It is deterministic: decisions use only the closes the harness sends — no clock, no randomness, no network, no files outside the repo.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9ex4h6rb&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
