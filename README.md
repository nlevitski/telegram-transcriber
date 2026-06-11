# transcriber

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

Environment variables:

```bash
BOT_TOKEN=...
ELEVENLABS_API_KEY=...
ELEVENLABS_API_KEY_LEVITENV=...
# Optional, defaults to 0.5 (% of monthly credits remaining).
ELEVENLABS_MIN_CREDIT_PERCENT=0.5
```

The bot uses `ELEVENLABS_API_KEY` first, switches to `ELEVENLABS_API_KEY_LEVITENV`
when the current key has less than or equal to the configured credit percentage,
and keeps checking keys in a loop before each transcription.

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
