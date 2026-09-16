/* Gomoku (five in a row, freestyle) pure logic. No DOM. Node-requireable.
 * State: { board: [225] of "B"|"W"|null (index r*15+c), turn: "B"|"W" }
 * Freestyle rules: five OR MORE in a row (horizontal, vertical, either
 * diagonal) wins. No forbidden-move rules. Black moves first.
 */
(function (root) {
  "use strict";

  var SIZE = 15;
  var N = SIZE * SIZE;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  var WIN_SCORE = 10000000; // pattern score of a move that makes 5+ in a row
  var INF = 1e15;

  function other(t) { return t === "B" ? "W" : "B"; }
  function idx(r, c) { return r * SIZE + c; }
  function inB(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function newGame() {
    var b = new Array(N);
    for (var i = 0; i < N; i++) b[i] = null;
    return { board: b, turn: "B" };
  }

  function clone(s) {
    return { board: s.board.slice(), turn: s.turn };
  }

  /** All empty cells as [r,c] pairs. */
  function legalMoves(s) {
    var out = [];
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (!s.board[idx(r, c)]) out.push([r, c]);
    return out;
  }

  /** Returns new state, or null if illegal (out of bounds, occupied, game over). */
  function applyMove(s, r, c) {
    if (!inB(r, c) || s.board[idx(r, c)] || winner(s)) return null;
    var n = clone(s);
    n.board[idx(r, c)] = s.turn;
    n.turn = other(s.turn);
    return n;
  }

  /** Finds a run of 5+; returns {color, cells} or null. */
  function findWin(board) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var col = board[idx(r, c)];
        if (!col) continue;
        for (var d = 0; d < 4; d++) {
          var dr = DIRS[d][0], dc = DIRS[d][1];
          var pr = r - dr, pc = c - dc;
          // only start counting at the beginning of a run
          if (inB(pr, pc) && board[idx(pr, pc)] === col) continue;
          var cells = [[r, c]], rr = r, cc = c;
          for (;;) {
            rr += dr; cc += dc;
            if (!inB(rr, cc) || board[idx(rr, cc)] !== col) break;
            cells.push([rr, cc]);
          }
          if (cells.length >= 5) return { color: col, cells: cells };
        }
      }
    }
    return null;
  }

  /** "B" | "W" | "draw" | null (game ongoing) */
  function winner(s) {
    var w = findWin(s.board);
    if (w) return w.color;
    for (var i = 0; i < N; i++) if (!s.board[i]) return null;
    return "draw";
  }

  /** The winning run as [[r,c],...], or null if nobody has won. */
  function winLine(s) {
    var w = findWin(s.board);
    return w ? w.cells : null;
  }

  // ---------------------------------------------------------------- AI ----

  /**
   * Pattern score for `color` placing a stone at (r,c) on `board`
   * (the stone is NOT on the board yet). Considers, per direction, the
   * number of consecutive own stones the new stone joins and how many
   * ends of that line stay open.
   */
  function dirScore(board, r, c, color, dr, dc) {
    var count = 1, open = 0;
    for (var side = 0; side < 2; side++) {
      var step = side === 0 ? 1 : -1, rr = r, cc = c;
      for (;;) {
        rr += dr * step; cc += dc * step;
        if (!inB(rr, cc) || board[idx(rr, cc)] !== color) break;
        count++;
      }
      if (inB(rr, cc) && !board[idx(rr, cc)]) open++;
    }
    if (count >= 5) return WIN_SCORE;
    if (count === 4) return open === 2 ? 1000000 : open === 1 ? 100000 : 10;
    if (count === 3) return open === 2 ? 10000 : open === 1 ? 1000 : 5;
    if (count === 2) return open === 2 ? 400 : open === 1 ? 80 : 3;
    return open === 2 ? 8 : 2;
  }

  function patternScore(board, r, c, color) {
    var d0 = dirScore(board, r, c, color, 0, 1);
    if (d0 >= WIN_SCORE) return WIN_SCORE;
    var d1 = dirScore(board, r, c, color, 1, 0);
    var d2 = dirScore(board, r, c, color, 1, 1);
    var d3 = dirScore(board, r, c, color, 1, -1);
    // strongest line dominates; second line adds double-threat value
    var a = d0, b = d1;
    if (b > a) { var t = a; a = b; b = t; }
    if (d2 > a) { b = a; a = d2; } else if (d2 > b) { b = d2; }
    if (d3 > a) { b = a; a = d3; } else if (d3 > b) { b = d3; }
    return a + 0.15 * b;
  }

  /** Attack value plus (slightly discounted) denial value of occupying (r,c). */
  function combined(board, r, c, me) {
    var opp = other(me);
    return patternScore(board, r, c, me) + 0.92 * patternScore(board, r, c, opp);
  }

  /** Empty cells within Chebyshev distance 2 of any stone. Center if board empty. */
  function candidates(s) {
    var seen = {}, out = [], anyStone = false;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!s.board[idx(r, c)]) continue;
        anyStone = true;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var rr = r + dr, cc = c + dc;
            if (!inB(rr, cc)) continue;
            var k = idx(rr, cc);
            if (s.board[k] || seen[k]) continue;
            seen[k] = 1;
            out.push([rr, cc]);
          }
        }
      }
    }
    if (!anyStone) return [[7, 7]];
    return out;
  }

  function scoreMoves(board, cands, color) {
    var out = new Array(cands.length);
    for (var i = 0; i < cands.length; i++) {
      out[i] = { m: cands[i], s: combined(board, cands[i][0], cands[i][1], color) };
    }
    return out;
  }

  function topN(scored, n) {
    var a = scored.slice().sort(function (x, y) { return y.s - x.s; });
    return a.slice(0, Math.min(n, a.length));
  }

  function pick(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /** Static evaluation of a position from `me`'s perspective. */
  function staticEval(board, me) {
    var opp = other(me);
    var cands = candidates({ board: board });
    var maxMe = 0, maxOpp = 0, sumMe = 0, sumOpp = 0;
    for (var i = 0; i < cands.length; i++) {
      var r = cands[i][0], c = cands[i][1];
      var a = patternScore(board, r, c, me);
      var b = patternScore(board, r, c, opp);
      if (a > maxMe) maxMe = a;
      if (b > maxOpp) maxOpp = b;
      sumMe += a; sumOpp += b;
    }
    return (maxMe - maxOpp) + 0.02 * (sumMe - sumOpp);
  }

  /** Level 4: 2-ply minimax over the top ~10 1-ply candidates. */
  function aiMoveDeep(s, scored, rng) {
    var me = s.turn, opp = other(me);
    var tops = topN(scored, 10);
    // take an immediate win without searching
    for (var i = 0; i < tops.length; i++) {
      if (tops[i].s >= WIN_SCORE) return tops[i].m;
    }
    var bestMove = tops[0].m, bestVal = -INF, bestTie = -INF;
    for (var k = 0; k < tops.length; k++) {
      var m = tops[k].m;
      var b2 = s.board.slice();
      b2[idx(m[0], m[1])] = me;
      var w2 = winner({ board: b2, turn: opp });
      var val;
      if (w2 === me) { val = INF; }
      else if (w2 === "draw") { val = 0; }
      else {
        var reps = topN(scoreMoves(b2, candidates({ board: b2 }), opp), 8);
        var worst = INF;
        for (var j = 0; j < reps.length; j++) {
          var rm = reps[j].m;
          var b3 = b2.slice();
          b3[idx(rm[0], rm[1])] = opp;
          var w3 = winner({ board: b3, turn: me });
          var v = (w3 === opp) ? -INF : staticEval(b3, me);
          if (v < worst) worst = v;
          if (worst === -INF) break;
        }
        val = worst + rng() * 50; // tiny jitter breaks exact ties
      }
      var tie = tops[k].s;
      if (val > bestVal || (val === bestVal && tie > bestTie)) {
        bestVal = val; bestTie = tie; bestMove = m;
      }
    }
    return bestMove;
  }

  /**
   * AI move. level 0=Beginner .. 4=Impossible. Returns [r,c] or null if no move.
   * rng defaults to Math.random; pass a seeded function for deterministic tests.
   */
  function aiMove(s, level, rng) {
    rng = rng || Math.random;
    level = Math.max(0, Math.min(4, level | 0));
    var me = s.turn;
    if (winner(s)) return null;
    var cands = candidates(s);
    if (!cands.length) return null;
    if (level === 0) return pick(cands, rng); // Beginner: random near stones
    var sc = scoreMoves(s.board, cands, me);
    if (level === 1) { // Easy: top-8 pick, often random
      if (rng() < 0.5) return pick(cands, rng);
      return pick(topN(sc, 8), rng).m;
    }
    if (level === 2) { // Medium: top-5 pick, sometimes random
      if (rng() < 0.25) return pick(cands, rng);
      return pick(topN(sc, 5), rng).m;
    }
    if (level === 3) { // Hard: 1-ply pattern search with small noise
      var best = null, bs = -Infinity;
      for (var i = 0; i < sc.length; i++) {
        var v = sc[i].s * (1 + (rng() * 0.10 - 0.05));
        if (v > bs) { bs = v; best = sc[i].m; }
      }
      return best;
    }
    return aiMoveDeep(s, sc, rng); // Impossible: 2-ply + tactics
  }

  var api = {
    SIZE: SIZE,
    newGame: newGame,
    clone: clone,
    legalMoves: legalMoves,
    applyMove: applyMove,
    winner: winner,
    winLine: winLine,
    aiMove: aiMove
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Gomoku = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
