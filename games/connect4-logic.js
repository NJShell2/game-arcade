/* Connect 4 pure logic. No DOM. Node-requireable.
 * State: { grid: [42] of "R"|"Y"|null (index = row*7+col, row 0 = top), turn: "R"|"Y" }
 * Human is Red ("R") and moves first; AI is Yellow ("Y").
 */
(function (root) {
  "use strict";

  var ROWS = 6, COLS = 7;
  var ORDER = [3, 2, 4, 1, 5, 0, 6]; // center-first move ordering

  function newGame() {
    var g = new Array(ROWS * COLS);
    for (var i = 0; i < g.length; i++) g[i] = null;
    return { grid: g, turn: "R" };
  }

  function clone(s) {
    return { grid: s.grid.slice(), turn: s.turn };
  }

  function idx(r, c) { return r * COLS + c; }

  function legalMoves(s) {
    var out = [];
    for (var k = 0; k < COLS; k++) {
      var c = ORDER[k];
      if (!s.grid[idx(0, c)]) out.push(c);
    }
    return out;
  }

  /** Drop a disc; returns {state, row} or null if illegal. */
  function applyMove(s, col) {
    if (col < 0 || col >= COLS || s.grid[idx(0, col)] || winner(s)) return null;
    var n = clone(s);
    for (var r = ROWS - 1; r >= 0; r--) {
      if (!n.grid[idx(r, col)]) {
        n.grid[idx(r, col)] = s.turn;
        n.turn = s.turn === "R" ? "Y" : "R";
        return { state: n, row: r };
      }
    }
    return null;
  }

  function lineWinner(grid) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = grid[idx(r, c)];
        if (!v) continue;
        if (c + 3 < COLS && v === grid[idx(r, c + 1)] && v === grid[idx(r, c + 2)] && v === grid[idx(r, c + 3)]) return v;
        if (r + 3 < ROWS && v === grid[idx(r + 1, c)] && v === grid[idx(r + 2, c)] && v === grid[idx(r + 3, c)]) return v;
        if (c + 3 < COLS && r + 3 < ROWS && v === grid[idx(r + 1, c + 1)] && v === grid[idx(r + 2, c + 2)] && v === grid[idx(r + 3, c + 3)]) return v;
        if (c - 3 >= 0 && r + 3 < ROWS && v === grid[idx(r + 1, c - 1)] && v === grid[idx(r + 2, c - 2)] && v === grid[idx(r + 3, c - 3)]) return v;
      }
    }
    return null;
  }

  /** "R" | "Y" | "draw" | null */
  function winner(s) {
    var w = lineWinner(s.grid);
    if (w) return w;
    for (var i = 0; i < s.grid.length; i++) if (!s.grid[i]) return null;
    return "draw";
  }

  // ---- AI: negamax with alpha-beta, center-first ordering ----
  function scoreWindow(countR, countY, countEmpty) {
    if (countR === 4) return 100000;
    if (countY === 4) return -100000;
    if (countR === 3 && countEmpty === 1) return 120;
    if (countY === 3 && countEmpty === 1) return -120;
    if (countR === 2 && countEmpty === 2) return 12;
    if (countY === 2 && countEmpty === 2) return -12;
    if (countR === 1 && countEmpty === 3) return 1;
    if (countY === 1 && countEmpty === 3) return -1;
    return 0;
  }

  function evaluate(grid) {
    var score = 0;
    // center column preference
    for (var r = 0; r < ROWS; r++) {
      if (grid[idx(r, 3)] === "R") score += 6;
      else if (grid[idx(r, 3)] === "Y") score -= 6;
    }
    var r2, c2, k, cr, cy, ce;
    // horizontal
    for (r2 = 0; r2 < ROWS; r2++) for (c2 = 0; c2 + 3 < COLS; c2++) {
      cr = 0; cy = 0; ce = 0;
      for (k = 0; k < 4; k++) { var v = grid[idx(r2, c2 + k)]; if (v === "R") cr++; else if (v === "Y") cy++; else ce++; }
      score += scoreWindow(cr, cy, ce);
    }
    // vertical
    for (c2 = 0; c2 < COLS; c2++) for (r2 = 0; r2 + 3 < ROWS; r2++) {
      cr = 0; cy = 0; ce = 0;
      for (k = 0; k < 4; k++) { var v2 = grid[idx(r2 + k, c2)]; if (v2 === "R") cr++; else if (v2 === "Y") cy++; else ce++; }
      score += scoreWindow(cr, cy, ce);
    }
    // diag down-right
    for (r2 = 0; r2 + 3 < ROWS; r2++) for (c2 = 0; c2 + 3 < COLS; c2++) {
      cr = 0; cy = 0; ce = 0;
      for (k = 0; k < 4; k++) { var v3 = grid[idx(r2 + k, c2 + k)]; if (v3 === "R") cr++; else if (v3 === "Y") cy++; else ce++; }
      score += scoreWindow(cr, cy, ce);
    }
    // diag up-right
    for (r2 = 3; r2 < ROWS; r2++) for (c2 = 0; c2 + 3 < COLS; c2++) {
      cr = 0; cy = 0; ce = 0;
      for (k = 0; k < 4; k++) { var v4 = grid[idx(r2 - k, c2 + k)]; if (v4 === "R") cr++; else if (v4 === "Y") cy++; else ce++; }
      score += scoreWindow(cr, cy, ce);
    }
    return score;
  }

  function dropRow(grid, col) {
    for (var r = ROWS - 1; r >= 0; r--) if (!grid[idx(r, col)]) return r;
    return -1;
  }

  function negamax(grid, depth, alpha, beta, turn) {
    var w = lineWinner(grid);
    if (w === "R") return turn === "R" ? 1000000 + depth : -(1000000 + depth);
    if (w === "Y") return turn === "Y" ? 1000000 + depth : -(1000000 + depth);
    if (depth === 0) {
      var e = evaluate(grid);
      return turn === "R" ? e : -e;
    }
    var full = true;
    for (var k = 0; k < COLS; k++) {
      var c = ORDER[k];
      var r = dropRow(grid, c);
      if (r < 0) continue;
      full = false;
      grid[idx(r, c)] = turn;
      var v = -negamax(grid, depth - 1, -beta, -alpha, turn === "R" ? "Y" : "R");
      grid[idx(r, c)] = null;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    if (full) return 0;
    return alpha;
  }

  function bestMoveFor(s, depth) {
    var moves = legalMoves(s);
    if (!moves.length) return -1;
    var best = moves[0], bestV = -Infinity;
    var scored = [];
    for (var i = 0; i < moves.length; i++) {
      var c = moves[i];
      var r = dropRow(s.grid, c);
      s.grid[idx(r, c)] = s.turn;
      var v = -negamax(s.grid, depth - 1, -Infinity, Infinity, s.turn === "R" ? "Y" : "R");
      s.grid[idx(r, c)] = null;
      scored.push({ move: c, v: v });
      if (v > bestV) { bestV = v; best = c; }
    }
    // random among near-best for variety
    var near = scored.filter(function (x) { return x.v >= bestV - 4; }).map(function (x) { return x.move; });
    return { move: best, near: near };
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  var DEPTHS = [0, 2, 3, 5, 6];
  var BLUNDER = [1, 0.35, 0.12, 0.03, 0];

  function aiMove(s, level, rng) {
    rng = rng || Math.random;
    level = Math.max(0, Math.min(4, level | 0));
    var moves = legalMoves(s);
    if (!moves.length) return -1;
    if (level === 0 || rng() < BLUNDER[level]) return pick(moves, rng);
    var res = bestMoveFor(s, DEPTHS[level]);
    // lower levels sometimes pick a "near best" move instead of the best
    if (level <= 2 && rng() < 0.35) return pick(res.near, rng);
    return res.move;
  }

  var api = {
    ROWS: ROWS, COLS: COLS,
    newGame: newGame,
    clone: clone,
    legalMoves: legalMoves,
    applyMove: applyMove,
    winner: winner,
    aiMove: aiMove
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Connect4 = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
