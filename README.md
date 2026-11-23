# btcrace23-entry

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Iqbal17/btcrace23-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Iqbal17/btcrace23-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Breakout Rider — a cbBTC/USDC trading bot for the agent-fun/bars-replay/v1 harness. It buys 100% of cash when the close makes a new 120-bar high, then holds with a 250 bps trailing stop and a 250 bps hard stop, ignoring the flat chop in between. Long only, one position, deterministic. Verified on the published dev window: net PnL +26.84 USDC, 1 trade, max drawdown 1.98%.

## Run it

```sh
node main.ts
```

The harness drives the bot over stdin/stdout with the bars-replay/v1 protocol (hello, one batch per minute, done).

---

<sub>Entered on [make.fun](https://make.fun/?ref=sjc4apwe&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
