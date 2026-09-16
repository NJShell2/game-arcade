/* Checkers (English draughts) pure logic. No DOM. Node-requireable.
 *
 * Board: [64], index r*8+c. Piece: {c:"r"|"w", k:bool} | null.
 * State: { board, turn:"r"|"w", halfSince:number, hist:{posKey:count} }
 * Red ("r") moves first, starts at the bottom (rows 5-7), moves "up" (decreasing row).
 * White ("w") starts at the top (rows 0-2), moves "down" (increasing row).
 *
 * Move: { from:[r,c], path:[[r,c],...], captures:[[r,c],...], promotes:bool }
 *   path    - each landing square in order (length >= 1)
 *   captures- enemy squares jumped, aligned 1:1 with path steps
 *   promotes- a man reaching the far row is crowned; turn ends immediately
 */
(function (root) {
  "use strict";

  var DIRS4 = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function idx(r, c) { return r * 8 + c; }
  function isDark(r, c) { return ((r + c) & 1) === 1; }
  function lastRow(color) { return color === "r" ? 0 : 7; }
  function opp(color) { return color === "r" ? "w" : "r"; }

  function newGame() {
    var board = new Array(64);
    for (var i = 0; i < 64; i++) board[i] = null;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if (!isDark(r, c)) continue;
        if (r < 3) board[idx(r, c)] = { c: "w", k: false };
        else if (r > 4) board[idx(r, c)] = { c: "r", k: false };
      }
    }
    var s = { board: board, turn: "r", halfSince: 0, hist: {} };
    s.hist[posKey(s)] = 1;
    return s;
  }

  function clone(s) {
    var b = new Array(64);
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      b[i] = p ? { c: p.c, k: p.k } : null;
    }
    var h = {};
    for (var k in s.hist) {
      if (Object.prototype.hasOwnProperty.call(s.hist, k)) h[k] = s.hist[k];
    }
    return { board: b, turn: s.turn, halfSince: s.halfSince, hist: h };
  }

  /** Position key: board contents + side to move (for threefold repetition). */
  function posKey(s) {
    var chars = new Array(64);
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      chars[i] = !p ? "." : (p.c === "r" ? (p.k ? "R" : "r") : (p.k ? "W" : "w"));
    }
    return chars.join("") + "|" + s.turn;
  }

  /** Diagonal directions a piece may move/capture along. Men: forward only. */
  function pieceDirs(p) {
    if (p.k) return DIRS4;
    return p.c === "r" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  }

  /**
   * All capture sequences for the piece at (r,c), via DFS.
   * A man landing on the far row is promoted and the sequence ENDS there
   * (English draughts: it does not continue jumping as a king in the same turn).
   */
  function genCapturesFrom(board, r, c, p) {
    var out = [];
    var dirs = pieceDirs(p);
    var captured = {}; // board index -> true (removed mid-sequence)

    function dfs(cr, cc, path, caps) {
      var any = false;
      for (var d = 0; d < dirs.length; d++) {
        var dr = dirs[d][0], dc = dirs[d][1];
        var mr = cr + dr, mc = cc + dc;
        var lr = cr + 2 * dr, lc = cc + 2 * dc;
        if (!inB(lr, lc)) continue;
        var mi = idx(mr, mc), li = idx(lr, lc);
        var mid = board[mi];
        if (!mid || mid.c === p.c || captured[mi]) continue;
        var land = captured[li] ? null : board[li];
        if (land) continue;
        any = true;
        var promotes = !p.k && lr === lastRow(p.c);
        var npath = path.concat([[lr, lc]]);
        var ncaps = caps.concat([[mr, mc]]);
        captured[mi] = true;
        if (promotes) {
          out.push({ from: [r, c], path: npath, captures: ncaps, promotes: true });
        } else {
          dfs(lr, lc, npath, ncaps);
        }
        delete captured[mi];
      }
      if (!any && path.length > 0) {
        out.push({ from: [r, c], path: path, captures: caps, promotes: false });
      }
    }

    dfs(r, c, [], []);
    return out;
  }

  function genQuietsFrom(board, r, c, p) {
    var out = [];
    var dirs = pieceDirs(p);
    for (var d = 0; d < dirs.length; d++) {
      var tr = r + dirs[d][0], tc = c + dirs[d][1];
      if (!inB(tr, tc)) continue;
      if (board[idx(tr, tc)]) continue;
      out.push({
        from: [r, c],
        path: [[tr, tc]],
        captures: [],
        promotes: !p.k && tr === lastRow(p.c)
      });
    }
    return out;
  }

  /**
   * All legal moves for color. If ANY capture exists for the side, ONLY
   * capturing moves are returned (captures are mandatory).
   */
  function genMoves(s, color) {
    var caps = [];
    var quiets = [];
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      if (!p || p.c !== color) continue;
      var r = (i / 8) | 0, c = i % 8;
      var cs = genCapturesFrom(s.board, r, c, p);
      if (cs.length) {
        for (var a = 0; a < cs.length; a++) caps.push(cs[a]);
      } else {
        var qs = genQuietsFrom(s.board, r, c, p);
        for (var b = 0; b < qs.length; b++) quiets.push(qs[b]);
      }
    }
    return caps.length > 0 ? caps : quiets;
  }

  /** Board/piece/turn update only — no draw bookkeeping (used by the search). */
  function rawApply(s, move) {
    var n = clone(s);
    var b = n.board;
    var p = b[idx(move.from[0], move.from[1])];
    b[idx(move.from[0], move.from[1])] = null;
    for (var i = 0; i < move.captures.length; i++) {
      b[idx(move.captures[i][0], move.captures[i][1])] = null;
    }
    var last = move.path[move.path.length - 1];
    if (move.promotes) p = { c: p.c, k: true };
    b[idx(last[0], last[1])] = p;
    n.turn = opp(s.turn);
    return n;
  }

  /** Full move application: captures removed, promotion, turn switch,
   *  80-halfmove clock, and repetition history. Returns a NEW state. */
  function applyMove(s, move) {
    var n = rawApply(s, move);
    var wasMan = false;
    var fp = s.board[idx(move.from[0], move.from[1])];
    if (fp) wasMan = !fp.k;
    n.halfSince = (move.captures.length > 0 || wasMan) ? 0 : n.halfSince + 1;
    var key = posKey(n);
    n.hist[key] = (n.hist[key] || 0) + 1;
    return n;
  }

  /**
   * "r" | "w" | "draw" | null (game ongoing).
   * Draws: 80 half-moves with no capture and no man movement; threefold repetition.
   * Otherwise: side to move with no legal moves loses.
   */
  function winner(s) {
    if (s.halfSince >= 80) return "draw";
    for (var k in s.hist) {
      if (Object.prototype.hasOwnProperty.call(s.hist, k) && s.hist[k] >= 3) return "draw";
    }
    if (genMoves(s, s.turn).length === 0) return opp(s.turn);
    return null;
  }

  // ---------------------------------------------------------------- AI ---

  /** Static evaluation, red perspective, centipawn-ish. */
  function evaluate(s) {
    var score = 0;
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      if (!p) continue;
      var sign = p.c === "r" ? 1 : -1;
      score += sign * (p.k ? 140 : 100);
      if (!p.k) {
        var r = (i / 8) | 0, c = i % 8;
        if (r >= 2 && r <= 5 && c >= 2 && c <= 5) score += sign * 6;   // central men
        if ((p.c === "r" && r === 7) || (p.c === "w" && r === 0)) score += sign * 4; // back-rank guard
      }
    }
    return score;
  }

  /** Mobility bonus, computed from a move list already in hand (cheap). */
  function mobilityBonus(ownMoves, s, color) {
    return 2 * (ownMoves - genMoves(s, opp(color)).length);
  }

  /** Order moves: captures first, most-valuable-victim first. */
  function orderMoves(s, moves) {
    var scored = new Array(moves.length);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var sc = 0;
      if (m.captures.length) {
        sc += 10000 + m.captures.length * 400;
        for (var j = 0; j < m.captures.length; j++) {
          var v = s.board[idx(m.captures[j][0], m.captures[j][1])];
          sc += v ? (v.k ? 140 : 100) : 0; // MVV
        }
      }
      if (m.promotes) sc += 500;
      scored[i] = { m: m, sc: sc };
    }
    scored.sort(function (a, b) { return b.sc - a.sc; });
    for (var k = 0; k < scored.length; k++) moves[k] = scored[k].m;
    return moves;
  }

  var NODE_CAP = 300000;
  var QMAX_PLY = 24;
  var MATE = 100000;
  var nodes = 0;

  function nodeCheck() {
    // amortized cap check (every 1024 nodes)
    if ((nodes & 1023) === 0 && nodes > NODE_CAP) throw { stop: true };
  }

  /**
   * Quiescence: at depth 0, extend through capture sequences only
   * (captures are forcing). Returns score from the side-to-move's perspective.
   */
  function quiesce(s, alpha, beta, ply) {
    nodes++;
    nodeCheck();
    var moves = genMoves(s, s.turn);
    if (moves.length === 0) return -(MATE - ply); // no moves: side to move loses
    var colorSign = s.turn === "r" ? 1 : -1;
    var stand = colorSign * (evaluate(s) + mobilityBonus(moves.length, s, s.turn));
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (ply >= QMAX_PLY) return alpha;
    if (moves[0].captures.length === 0) return alpha; // quiet position: stand pat
    orderMoves(s, moves);
    for (var i = 0; i < moves.length; i++) {
      var v = -quiesce(rawApply(s, moves[i]), -beta, -alpha, ply + 1);
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return alpha;
  }

  /** Negamax with alpha-beta. Score from the side-to-move's perspective. */
  function negamax(s, depth, alpha, beta, ply) {
    nodes++;
    nodeCheck();
    var moves = genMoves(s, s.turn);
    if (moves.length === 0) return -(MATE - ply);
    if (depth <= 0) return quiesce(s, alpha, beta, ply);
    orderMoves(s, moves);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var v = -negamax(rawApply(s, moves[i]), depth - 1, -beta, -alpha, ply + 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  var RAND_P = [1, 0.40, 0.15, 0.03, 0]; // probability of a pure random move
  var DEPTHS = [0, 1, 2, 4, 6];

  /**
   * AI move for the side to move. level 0=Beginner .. 4=Impossible.
   * Returns a move object from genMoves, or null if no legal moves.
   */
  function aiMove(s, level, rng) {
    rng = rng || Math.random;
    level = Math.max(0, Math.min(4, level | 0));
    var moves = genMoves(s, s.turn);
    if (moves.length === 0) return null;
    if (rng() < RAND_P[level]) {
      return moves[(rng() * moves.length) | 0];
    }
    orderMoves(s, moves);
    nodes = 0;
    var depth = DEPTHS[level];
    var bestMove = moves[0];
    var bestVal = -Infinity;
    var alpha = -Infinity;
    try {
      for (var i = 0; i < moves.length; i++) {
        var v;
        if (depth <= 0) {
          v = -quiesce(rawApply(s, moves[i]), -Infinity, Infinity, 1);
        } else {
          v = -negamax(rawApply(s, moves[i]), depth - 1, -Infinity, -alpha, 1);
        }
        if (level === 1) v += rng() * 40 - 20; // noise keeps Easy human
        if (v > bestVal) { bestVal = v; bestMove = moves[i]; }
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      /* node cap hit: keep the best move found so far */
    }
    return bestMove;
  }

  var api = {
    newGame: newGame,
    clone: clone,
    genMoves: genMoves,
    applyMove: applyMove,
    winner: winner,
    aiMove: aiMove,
    posKey: posKey
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Checkers = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
