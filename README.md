# NEON BREAKOUT

A neon arcade breakout game. **One HTML file, zero dependencies, works offline.**

### ▶ [Play it now](https://neaterry6.github.io/neon-breakout/)

---

## What it is

A single self-contained `index.html`. No build step, no npm install, no framework.
Open the file and it runs.

**Controls**

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | move the paddle |
| `Space` | launch the ball / start |
| `P` | pause |
| Touch / mouse | drag to move, tap to launch |

Works on desktop and mobile. Pauses itself if you switch tabs mid-game.

## Features

- **Endless levels** — every clear adds a row and speeds the ball up
- **Angle control** — where the ball hits the paddle steers it; edges are sharper
- **Tougher bricks** — from level 3 the top row takes two hits
- **Paddle shrinks** as you climb, so it never gets easy
- **Particles + screen shake** on every impact
- **Best score** saved to `localStorage`
- **Neon glow** aesthetic — cyan → purple → pink

## Run it locally

```bash
git clone https://github.com/Neaterry6/neon-breakout.git
cd neon-breakout
# just open index.html, or:
python3 -m http.server 8000
```

## Tests

The game logic is verified headlessly — the test harness stubs the DOM and canvas,
then drives real frames to prove the game actually plays.

```bash
node verify.js
```

24 checks, covering:

- bricks generate inside the canvas and never overlap
- the ball launches upward and actually breaks bricks
- score rises when bricks break
- clearing every brick advances the level
- dropping the ball costs a life, and running out ends the game
- the ball can never escape the side walls
- the paddle clamps to both edges
- 2000 frames of continuous play with no NaN and no escape

## Licence

MIT © Akewushola Abdulbakri Temitope (brokenvzn)
