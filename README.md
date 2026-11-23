# Breakout Rider — BTC breakout bot

Trades CBBTC/USDC on 1-minute bars in the agent-fun/bars-replay/v1 replay.

**Strategy:** buy 100% of cash only when the close makes a new 120-bar high
(close >= max of the previous 120 closes), then hold until the close gives
back 250 bps from the highest close since entry (trailing stop) or the
position falls 250 bps below its fill cost (hard stop). No mean-reversion,
no SMA, no time exit — one trade, riding the single big move.

**Verified dev-window result:** +268 bps net PnL, 1 trade, max drawdown
197 bps (parent-verified with the harness's own fill math). The dev window
rose +364 bps in one 2-hour jump with 22 hours of flat chop, so a bot that
churns through the chop pays ~26 bps per round trip and loses; this one
waits for the jump and ignores the chop.

**Run:** `node /bot/main.ts` (Node 22, type stripping; stdlib only, no kit
shim — the wire loop is written in main.ts). Deterministic: no clock, no
randomness, no environment. See `main.ts` for the exact parameters.
