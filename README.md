# Coldproof

Check a cold email draft against the law of the recipient's country. An open-weight model runs in your browser through WebGPU, reads the draft and reports what it contains, quoting the exact words. The page compares that with checked rules for 29 countries and returns the missing pieces and a fixed version. The draft never leaves your machine.

Live: https://phazww.github.io/coldproof/

## How it is built

- `rules.js`: per-country rules for the first unsolicited marketing email to a business recipient, each with its source. The research comes from my earlier project [can-i-cold-email](https://github.com/phazww/can-i-cold-email), checked against the law or the regulator on 10 and 11 October 2026.
- `app.js`: loads the model with [WebLLM](https://github.com/mlc-ai/web-llm), asks it for a JSON report with quotes, verifies that every quote is really in the draft, and assembles the fixed version from hand-written wording in 13 languages.
- Two open-weight models to choose from: Gemma 4 E2B (default) and Qwen 3.5 2B. On the [30-draft test set](TESTS.md) Gemma got 30 of 30 right and Qwen 26.
- No server, no API key, no build step.

The model reads. It does not decide what the law requires and it does not write the legal lines.

Research tool, not legal advice.
