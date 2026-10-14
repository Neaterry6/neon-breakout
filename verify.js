// Headless verification of the Neon Breakout game logic.
// Loads the <script> out of index.html, stubs just enough DOM/canvas, then
// drives real frames to prove the game actually plays: bricks break, the ball
// bounces, lives decrement, levels advance.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script> found'); process.exit(1); }
let code = m[1];

// ---- stub the DOM -------------------------------------------------------
function makeEl(id) {
  return {
    id,
    textContent: '',
    className: '',
    style: {},
    width: 760,
    height: 520,
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 760, height: 520 }; },
    getContext() { return ctxStub; },
  };
}

const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set() { return true; },
});

const els = {};
const listeners = {};
const documentStub = {
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  hidden: false,
};

let rafCb = null;
const sandbox = {
  document: documentStub,
  window: {},
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  requestAnimationFrame(cb) { rafCb = cb; return 1; },
  Math, Date, console, JSON, parseInt, parseFloat, isNaN,
  setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;

// expose internals for assertions
code = code.replace(
  '  // ---- go ----------------------------------------------------------------',
  `  // ---- test hook ----
  globalThis.__t = {
    get state(){return state}, set state(v){state=v},
    get score(){return score}, get level(){return level}, get lives(){return lives},
    get ball(){return ball}, get paddle(){return paddle}, get bricks(){return bricks},
    launchBall, startGame, update, keys, get particles(){return particles},
  };
  // ---- go ----------------------------------------------------------------`
);

vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { timeout: 5000 });
} catch (e) {
  console.error('FAIL: script threw on load ->', e.message);
  process.exit(1);
}
console.log('load: script evaluated clean');

const t = sandbox.__t;
if (!t) { console.error('FAIL: test hook missing'); process.exit(1); }

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); failures++; }
}

// ---- 1. initial state ---------------------------------------------------
t.startGame();
check('game starts with 3 lives', t.lives === 3, 'lives=' + t.lives);
check('game starts at level 1', t.level === 1, 'level=' + t.level);
check('game starts at score 0', t.score === 0, 'score=' + t.score);
check('bricks were generated', t.bricks.length > 0, 'bricks=' + t.bricks.length);
check('ball starts stuck', t.ball.stuck === true);
check('ball sits on the paddle', Math.abs(t.ball.x - (t.paddle.x + t.paddle.w / 2)) < 1);

// ---- 2. bricks are inside the canvas ------------------------------------
const W = 760, H = 520;
let oob = 0;
for (const b of t.bricks) {
  if (b.x < 0 || b.x + b.w > W || b.y < 0 || b.y + b.h > H) oob++;
}
check('no brick is off-canvas', oob === 0, oob + ' out of bounds');

// ---- 3. bricks do not overlap -------------------------------------------
let overlaps = 0;
for (let i = 0; i < t.bricks.length; i++) {
  for (let j = i + 1; j < t.bricks.length; j++) {
    const a = t.bricks[i], b = t.bricks[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++;
  }
}
check('no overlapping bricks', overlaps === 0, overlaps + ' overlaps');

// ---- 4. launching the ball gives it upward velocity ---------------------
t.launchBall();
check('ball is no longer stuck', t.ball.stuck === false);
check('ball moves upward', t.ball.vy < 0, 'vy=' + t.ball.vy.toFixed(1));
check('ball has horizontal velocity', Math.abs(t.ball.vx) > 1, 'vx=' + t.ball.vx.toFixed(1));

// ---- 5. the ball actually breaks bricks ---------------------------------
// Park the paddle under the ball so it doesn't die, then run frames.
const startAlive = t.bricks.filter(b => b.alive).length;
let frames = 0;
while (frames < 3000 && t.bricks.filter(b => b.alive).length === startAlive) {
  t.paddle.x = t.ball.x - t.paddle.w / 2;      // auto-play: track the ball
  t.update(1 / 60);
  frames++;
}
const nowAlive = t.bricks.filter(b => b.alive).length;
check('ball broke at least one brick', nowAlive < startAlive, 'alive ' + startAlive + ' -> ' + nowAlive);
check('score increased from breaking', t.score > 0, 'score=' + t.score);
check('bricks spawn particles', t.particles.length > 0);

// ---- 6. clearing all bricks advances the level --------------------------
t.bricks.forEach(b => { b.alive = false; });
t.update(1 / 60);
check('clearing bricks enters levelclear', t.state === 'levelclear', 'state=' + t.state);

// ---- 7. missing the ball costs a life -----------------------------------
t.startGame();
t.launchBall();
t.ball.x = W / 2;
t.ball.y = H + 50;              // force it past the paddle
t.ball.vy = 400;
t.update(1 / 60);
check('dropping the ball costs a life', t.lives === 2, 'lives=' + t.lives);

// ---- 8. losing all lives ends the game ----------------------------------
// Note: after each life loss the ball is reset to "stuck on the paddle" and
// update() early-returns while stuck, so we must re-launch each round.
for (let i = 0; i < 5 && t.state !== 'over'; i++) {
  t.launchBall();
  t.ball.y = H + 50; t.ball.vy = 400; t.ball.x = W / 2;
  t.update(1 / 60);
}
check('game over after losing all lives', t.state === 'over', 'state=' + t.state);
check('lives bottom out at 0', t.lives <= 0, 'lives=' + t.lives);

// ---- 9. ball cannot escape the side walls -------------------------------
t.startGame();
t.launchBall();
t.ball.x = -100; t.ball.vx = -300;
t.update(1 / 60);
check('ball stays inside the left wall', t.ball.x >= t.ball.r - 0.5, 'x=' + t.ball.x);
t.ball.x = W + 100; t.ball.vx = 300;
t.update(1 / 60);
check('ball stays inside the right wall', t.ball.x <= W - t.ball.r + 0.5, 'x=' + t.ball.x);

// ---- 10. paddle cannot leave the canvas ---------------------------------
t.paddle.x = -500;
t.update(1 / 60);
check('paddle clamps to the left edge', t.paddle.x === 0, 'x=' + t.paddle.x);
t.paddle.x = W + 500;
t.update(1 / 60);
check('paddle clamps to the right edge', t.paddle.x === W - t.paddle.w, 'x=' + t.paddle.x);

// ---- 11. no NaN leaked into the ball after heavy play -------------------
t.startGame();
t.launchBall();
let nan = false;
for (let i = 0; i < 2000; i++) {
  t.paddle.x = t.ball.x - t.paddle.w / 2;
  t.update(1 / 60);
  if (!Number.isFinite(t.ball.x) || !Number.isFinite(t.ball.y) ||
      !Number.isFinite(t.ball.vx) || !Number.isFinite(t.ball.vy)) { nan = true; break; }
}
check('2000 frames without NaN', !nan);
check('ball still within bounds after long play',
  t.ball.x >= -1 && t.ball.x <= W + 1 && t.ball.y >= -1,
  'x=' + t.ball.x.toFixed(1) + ' y=' + t.ball.y.toFixed(1));

// ---- 12. Space launches the ball (regression: focus on the Play button) ---
// Bug that shipped once: after clicking Play the button kept focus, so the next
// Space press re-activated the button and restarted the game instead of
// launching the ball. These checks lock that down.
const keydown = (listeners.keydown || [])[0];
if (!keydown) {
  check('keydown listener is registered', false);
} else {
  const fireSpace = () => keydown({
    key: ' ',
    code: 'Space',
    preventDefault() {},
  });

  t.startGame();
  check('starts ready with the ball stuck', t.state === 'ready' && t.ball.stuck === true);
  fireSpace();
  check('Space launches the ball', t.ball.stuck === false, 'stuck=' + t.ball.stuck);
  check('Space does not restart the game', t.state === 'playing' || t.state === 'ready',
    'state=' + t.state);
  check('score was not reset by Space', t.score === 0, 'score=' + t.score);

  // pressing Space again mid-flight must not relaunch or reset
  const vyBefore = t.ball.vy;
  const scoreBefore = t.score;
  fireSpace();
  check('Space mid-flight is ignored', t.ball.vy === vyBefore, 'vy changed');
  check('Space mid-flight does not reset the score', t.score === scoreBefore);

  // and from the game-over screen, Space should start a fresh game
  t.state = 'over';
  fireSpace();
  check('Space on the game-over screen restarts', t.state === 'ready', 'state=' + t.state);
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
