/* Chess pure logic — full FIDE-style rules. No DOM. Node-requireable.
 * Board: array of 64, index = rank*8+file, rank 0 = white's back rank.
 * Piece: {t:"p"|"n"|"b"|"r"|"q"|"k", c:"w"|"b"} or null.
 * State: {board:[64], turn:"w"|"b", castling:{wk,wq,bk,bq}, ep:-1|squareIndex,
 *          half: halfmove clock, full: fullmove number, hist:[position keys]}
 * Move: {from, to, promo:null|"q"|"r"|"b"|"n"}
 */
(function (root) {
"use strict";

function opp(c) { return c === "w" ? "b" : "w"; }

var KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
var KING_D   = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
var ROOK_D   = [[1, 0], [-1, 0], [0, 1], [0, -1]];
var BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function newGame() {
  var b = new Array(64);
  for (var i = 0; i < 64; i++) b[i] = null;
  var back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (var f = 0; f < 8; f++) {
    b[f] = { t: back[f], c: "w" };
    b[8 + f] = { t: "p", c: "w" };
    b[48 + f] = { t: "p", c: "b" };
    b[56 + f] = { t: back[f], c: "b" };
  }
  var s = {
    board: b, turn: "w",
    castling: { wk: true, wq: true, bk: true, bq: true },
    ep: -1, half: 0, full: 1, hist: []
  };
  s.hist.push(posKey(s));
  return s;
}

function clone(s) {
  return {
    board: s.board.slice(),
    turn: s.turn,
    castling: { wk: s.castling.wk, wq: s.castling.wq, bk: s.castling.bk, bq: s.castling.bq },
    ep: s.ep, half: s.half, full: s.full,
    hist: s.hist.slice()
  };
}

/* The en-passant square only counts toward the position key when a pawn of
 * the side to move could actually capture there (FIDE: positions are the
 * same only if the same moves are possible). */
function epForKey(st) {
  if (st.ep < 0) return -1;
  var r = st.ep >> 3, f = st.ep & 7;
  var pr = st.turn === "w" ? r - 1 : r + 1;
  if (pr < 0 || pr > 7) return -1;
  for (var df = -1; df <= 1; df += 2) {
    var nf = f + df;
    if (nf < 0 || nf > 7) continue;
    var p = st.board[pr * 8 + nf];
    if (p && p.t === "p" && p.c === st.turn) return st.ep;
  }
  return -1;
}

function posKey(st) {
  var k = "";
  for (var i = 0; i < 64; i++) {
    var p = st.board[i];
    k += p ? p.c + p.t : "..";
  }
  k += "|" + st.turn + "|";
  k += (st.castling.wk ? "K" : "") + (st.castling.wq ? "Q" : "") +
       (st.castling.bk ? "k" : "") + (st.castling.bq ? "q" : "");
  k += "|" + epForKey(st);
  return k;
}

function isAttacked(b, sq, by) {
  var r = sq >> 3, f = sq & 7, i, p;
  // pawns: a white pawn on X attacks X+7/X+9; black on X attacks X-7/X-9
  if (by === "w") {
    if (r > 0) {
      if (f > 0) { p = b[sq - 9]; if (p && p.c === "w" && p.t === "p") return true; }
      if (f < 7) { p = b[sq - 7]; if (p && p.c === "w" && p.t === "p") return true; }
    }
  } else {
    if (r < 7) {
      if (f > 0) { p = b[sq + 7]; if (p && p.c === "b" && p.t === "p") return true; }
      if (f < 7) { p = b[sq + 9]; if (p && p.c === "b" && p.t === "p") return true; }
    }
  }
  // knights
  for (i = 0; i < 8; i++) {
    var nf = f + KNIGHT_D[i][0], nr = r + KNIGHT_D[i][1];
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    p = b[nr * 8 + nf];
    if (p && p.c === by && p.t === "n") return true;
  }
  // king
  for (i = 0; i < 8; i++) {
    var kf = f + KING_D[i][0], kr = r + KING_D[i][1];
    if (kf < 0 || kf > 7 || kr < 0 || kr > 7) continue;
    p = b[kr * 8 + kf];
    if (p && p.c === by && p.t === "k") return true;
  }
  // sliders
  var d, s2, step;
  for (d = 0; d < 4; d++) {
    var df = ROOK_D[d][0], dr = ROOK_D[d][1];
    s2 = sq + dr * 8 + df;
    step = 1;
    while ((f + df * step) >= 0 && (f + df * step) <= 7 && (r + dr * step) >= 0 && (r + dr * step) <= 7) {
      p = b[s2];
      if (p) {
        if (p.c === by && (p.t === "r" || p.t === "q")) return true;
        break;
      }
      step++;
      s2 += dr * 8 + df;
    }
  }
  for (d = 0; d < 4; d++) {
    var bf = BISHOP_D[d][0], br = BISHOP_D[d][1];
    s2 = sq + br * 8 + bf;
    step = 1;
    while ((f + bf * step) >= 0 && (f + bf * step) <= 7 && (r + br * step) >= 0 && (r + br * step) <= 7) {
      p = b[s2];
      if (p) {
        if (p.c === by && (p.t === "b" || p.t === "q")) return true;
        break;
      }
      step++;
      s2 += br * 8 + bf;
    }
  }
  return false;
}

function kingSq(b, color) {
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (p && p.t === "k" && p.c === color) return i;
  }
  return -1;
}

function inCheck(st, color) {
  var k = kingSq(st.board, color);
  return k >= 0 && isAttacked(st.board, k, opp(color));
}

function pushPawnMove(moves, from, to, isPromo) {
  if (!isPromo) { moves.push({ from: from, to: to, promo: null }); return; }
  moves.push({ from: from, to: to, promo: "q" });
  moves.push({ from: from, to: to, promo: "r" });
  moves.push({ from: from, to: to, promo: "b" });
  moves.push({ from: from, to: to, promo: "n" });
}

function isHome(b, sq, t, c) {
  var p = b[sq];
  return !!p && p.t === t && p.c === c;
}

function addCastling(st, moves) {
  var b = st.board;
  if (st.turn === "w") {
    if (!isHome(b, 4, "k", "w")) return;
    if (st.castling.wk && isHome(b, 7, "r", "w") && !b[5] && !b[6] &&
        !isAttacked(b, 4, "b") && !isAttacked(b, 5, "b") && !isAttacked(b, 6, "b")) {
      moves.push({ from: 4, to: 6, promo: null });
    }
    if (st.castling.wq && isHome(b, 0, "r", "w") && !b[1] && !b[2] && !b[3] &&
        !isAttacked(b, 4, "b") && !isAttacked(b, 3, "b") && !isAttacked(b, 2, "b")) {
      moves.push({ from: 4, to: 2, promo: null });
    }
  } else {
    if (!isHome(b, 60, "k", "b")) return;
    if (st.castling.bk && isHome(b, 63, "r", "b") && !b[61] && !b[62] &&
        !isAttacked(b, 60, "w") && !isAttacked(b, 61, "w") && !isAttacked(b, 62, "w")) {
      moves.push({ from: 60, to: 62, promo: null });
    }
    if (st.castling.bq && isHome(b, 56, "r", "b") && !b[57] && !b[58] && !b[59] &&
        !isAttacked(b, 60, "w") && !isAttacked(b, 59, "w") && !isAttacked(b, 58, "w")) {
      moves.push({ from: 60, to: 58, promo: null });
    }
  }
}

/* Pseudo-legal moves (king may be left in check; castling already verified
 * for squares the king crosses). */
function pseudoMoves(st) {
  var moves = [];
  var b = st.board, turn = st.turn;
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (!p || p.c !== turn) continue;
    var r = i >> 3, f = i & 7, d, t, nf, nr;
    if (p.t === "p") {
      var dir = turn === "w" ? 8 : -8;
      var startR = turn === "w" ? 1 : 6;
      var promoR = turn === "w" ? 7 : 0;
      var one = i + dir;
      if (!b[one]) {
        pushPawnMove(moves, i, one, (one >> 3) === promoR);
        if (r === startR) {
          var two = i + 2 * dir;
          if (!b[two]) moves.push({ from: i, to: two, promo: null });
        }
      }
      for (d = 0; d < 2; d++) {
        nf = f + (d === 0 ? -1 : 1);
        if (nf < 0 || nf > 7) continue;
        nr = r + (turn === "w" ? 1 : -1);
        t = nr * 8 + nf;
        if (b[t] && b[t].c !== turn) pushPawnMove(moves, i, t, nr === promoR);
        else if (t === st.ep) moves.push({ from: i, to: t, promo: null });
      }
    } else if (p.t === "n" || p.t === "k") {
      var jumps = p.t === "n" ? KNIGHT_D : KING_D;
      for (d = 0; d < jumps.length; d++) {
        nf = f + jumps[d][0]; nr = r + jumps[d][1];
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        t = nr * 8 + nf;
        if (!b[t] || b[t].c !== turn) moves.push({ from: i, to: t, promo: null });
      }
    } else {
      var dirs = p.t === "r" ? ROOK_D : p.t === "b" ? BISHOP_D : KING_D;
      for (d = 0; d < dirs.length; d++) {
        nf = f + dirs[d][0]; nr = r + dirs[d][1];
        while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
          t = nr * 8 + nf;
          if (!b[t]) moves.push({ from: i, to: t, promo: null });
          else {
            if (b[t].c !== turn) moves.push({ from: i, to: t, promo: null });
            break;
          }
          nf += dirs[d][0]; nr += dirs[d][1];
        }
      }
    }
  }
  addCastling(st, moves);
  return moves;
}

/* Low-level make/unmake on a mutable state. Returns an undo token. */
function doMove(st, m, track) {
  var b = st.board;
  var piece = b[m.from];
  var u = {
    piece: piece, captured: null, capSq: -1,
    rookFrom: -1, rookTo: -1,
    wk: st.castling.wk, wq: st.castling.wq,
    bk: st.castling.bk, bq: st.castling.bq,
    ep: st.ep, half: st.half
  };
  if (piece.t === "p" && m.to === st.ep) {
    u.capSq = m.to + (piece.c === "w" ? -8 : 8);
    u.captured = b[u.capSq];
    b[u.capSq] = null;
  } else if (b[m.to]) {
    u.captured = b[m.to];
    u.capSq = m.to;
  }
  b[m.from] = null;
  b[m.to] = m.promo ? { t: m.promo, c: piece.c } : piece;
  if (piece.t === "k" && Math.abs(m.to - m.from) === 2) {
    if (m.to > m.from) { u.rookFrom = m.from + 3; u.rookTo = m.from + 1; }
    else { u.rookFrom = m.from - 4; u.rookTo = m.from - 1; }
    b[u.rookTo] = b[u.rookFrom];
    b[u.rookFrom] = null;
  }
  if (piece.t === "k") {
    if (piece.c === "w") { st.castling.wk = false; st.castling.wq = false; }
    else { st.castling.bk = false; st.castling.bq = false; }
  }
  if (piece.t === "r") {
    if (m.from === 0) st.castling.wq = false;
    else if (m.from === 7) st.castling.wk = false;
    else if (m.from === 56) st.castling.bq = false;
    else if (m.from === 63) st.castling.bk = false;
  }
  if (u.captured && u.captured.t === "r") {
    if (u.capSq === 0) st.castling.wq = false;
    else if (u.capSq === 7) st.castling.wk = false;
    else if (u.capSq === 56) st.castling.bq = false;
    else if (u.capSq === 63) st.castling.bk = false;
  }
  st.ep = (piece.t === "p" && Math.abs(m.to - m.from) === 16) ? (m.from + m.to) / 2 : -1;
  st.half = (piece.t === "p" || u.captured) ? 0 : st.half + 1;
  if (st.turn === "b") st.full++;
  st.turn = opp(st.turn);
  if (track) st.hist.push(posKey(st));
  return u;
}

function undoMove(st, m, u, track) {
  if (track) st.hist.pop();
  st.turn = opp(st.turn);
  if (st.turn === "b") st.full--;
  var b = st.board;
  if (u.rookFrom >= 0) {
    b[u.rookFrom] = b[u.rookTo];
    b[u.rookTo] = null;
  }
  b[m.from] = u.piece;
  b[m.to] = null;
  if (u.captured) b[u.capSq] = u.captured;
  st.castling.wk = u.wk; st.castling.wq = u.wq;
  st.castling.bk = u.bk; st.castling.bq = u.bq;
  st.ep = u.ep;
  st.half = u.half;
}

/* Fully legal moves. Does not mutate st. */
function legalMoves(st) {
  var out = [];
  var pm = pseudoMoves(st);
  var us = st.turn;
  for (var i = 0; i < pm.length; i++) {
    var m = pm[i];
    var u = doMove(st, m, false);
    if (!inCheck(st, us)) out.push({ from: m.from, to: m.to, promo: m.promo });
    undoMove(st, m, u, false);
  }
  return out;
}

/* Returns a NEW state with the move applied, or null if illegal.
 * Does not mutate the input. */
function applyMove(s, m) {
  if (!m || m.from === undefined || m.to === undefined) return null;
  var legal = legalMoves(s);
  var found = null;
  for (var i = 0; i < legal.length; i++) {
    var x = legal[i];
    if (x.from === m.from && x.to === m.to && (x.promo || null) === (m.promo || null)) {
      found = x;
      break;
    }
  }
  if (!found) return null;
  var n = clone(s);
  doMove(n, found, true);
  return n;
}

function insufficientMaterial(b) {
  var ps = [];
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (p && p.t !== "k") ps.push({ t: p.t, c: p.c, sq: i });
  }
  if (ps.length === 0) return true;                    // K vs K
  if (ps.length === 1) return ps[0].t === "b" || ps[0].t === "n"; // K+B / K+N vs K
  if (ps.length === 2 && ps[0].t === "b" && ps[1].t === "b" && ps[0].c !== ps[1].c) {
    var c0 = ((ps[0].sq >> 3) + (ps[0].sq & 7)) & 1;
    var c1 = ((ps[1].sq >> 3) + (ps[1].sq & 7)) & 1;
    return c0 === c1;                                  // K+B vs K+B, same-colored bishops
  }
  return false;
}

/* null while the game is ongoing, else {over:true, winner:"w"|"b"|null, reason} */
function result(st) {
  var moves = legalMoves(st);
  if (moves.length === 0) {
    if (inCheck(st, st.turn)) return { over: true, winner: opp(st.turn), reason: "checkmate" };
    return { over: true, winner: null, reason: "stalemate" };
  }
  if (st.half >= 100) return { over: true, winner: null, reason: "fifty-move" };
  if (insufficientMaterial(st.board)) return { over: true, winner: null, reason: "insufficient material" };
  var key = posKey(st), n = 0;
  for (var i = 0; i < st.hist.length; i++) {
    if (st.hist[i] === key && ++n >= 3) return { over: true, winner: null, reason: "threefold" };
  }
  return null;
}

function sqName(i) {
  return "abcdefgh".charAt(i & 7) + ((i >> 3) + 1);
}

function disambig(s, m, piece) {
  var others = [];
  var legal = legalMoves(s);
  for (var i = 0; i < legal.length; i++) {
    var x = legal[i];
    if (x.to === m.to && x.from !== m.from) {
      var p = s.board[x.from];
      if (p && p.t === piece.t && p.c === piece.c) others.push(x.from);
    }
  }
  if (!others.length) return "";
  var f = m.from & 7, r = m.from >> 3;
  var sameF = false, sameR = false;
  for (var j = 0; j < others.length; j++) {
    if ((others[j] & 7) === f) sameF = true;
    if ((others[j] >> 3) === r) sameR = true;
  }
  var files = "abcdefgh";
  if (!sameF) return files.charAt(f);
  if (!sameR) return String(r + 1);
  return files.charAt(f) + (r + 1);
}

function moveToSAN(s, m) {
  var b = s.board;
  var piece = b[m.from];
  if (!piece) return "";
  var san;
  if (piece.t === "k" && Math.abs(m.to - m.from) === 2) {
    san = m.to > m.from ? "O-O" : "O-O-O";
  } else {
    var cap = !!b[m.to] || (piece.t === "p" && m.to === s.ep);
    var dest = sqName(m.to);
    if (piece.t === "p") {
      san = (cap ? "abcdefgh".charAt(m.from & 7) + "x" : "") + dest;
      if (m.promo) san += "=" + m.promo.toUpperCase();
    } else {
      var L = piece.t === "n" ? "N" : piece.t.toUpperCase();
      san = L + disambig(s, m, piece) + (cap ? "x" : "") + dest;
    }
  }
  var n = applyMove(s, m);
  if (n && inCheck(n, n.turn)) san += legalMoves(n).length ? "+" : "#";
  return san;
}

function perft(st, depth) {
  if (depth === 0) return 1;
  var moves = legalMoves(st);
  if (depth === 1) return moves.length;
  var nodes = 0;
  for (var i = 0; i < moves.length; i++) {
    var u = doMove(st, moves[i], false);
    nodes += perft(st, depth - 1);
    undoMove(st, moves[i], u, false);
  }
  return nodes;
}

/* ---------------- AI: negamax + alpha-beta + quiescence ---------------- */

var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/* Simple well-known piece-square tables, written from White's perspective
 * with rank 8 first. */
var PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20]
};

function pstVal(t, i, c) {
  var tab = PST[t], idx;
  if (c === "w") {
    idx = (7 - (i >> 3)) * 8 + (i & 7);
  } else {
    var m = i ^ 56; // mirror rank for Black
    idx = (7 - (m >> 3)) * 8 + (m & 7);
  }
  return tab[idx];
}

/* Static eval from the side-to-move's perspective. */
function evaluate(st) {
  var b = st.board, score = 0;
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (!p) continue;
    var v = VAL[p.t] + pstVal(p.t, i, p.c);
    score += p.c === "w" ? v : -v;
  }
  score += st.turn === "w" ? 10 : -10; // tempo
  return st.turn === "w" ? score : -score;
}

function isCapture(st, m) {
  if (st.board[m.to]) return true;
  var p = st.board[m.from];
  return !!p && p.t === "p" && m.to === st.ep;
}

/* Captures (MVV-LVA) first, then promotions, then the rest. */
function orderScore(st, m) {
  var b = st.board, att = b[m.from];
  var vic = b[m.to];
  if (!vic && att.t === "p" && m.to === st.ep) vic = b[m.to + (st.turn === "w" ? -8 : 8)];
  if (vic) return 100000 + 10 * VAL[vic.t] - VAL[att.t];
  if (m.promo) return 50000 + (m.promo === "q" ? 900 : m.promo === "r" ? 500 : m.promo === "b" ? 330 : 320);
  return 0;
}

function orderMoves(st, moves) {
  var scores = new Array(moves.length);
  for (var i = 0; i < moves.length; i++) scores[i] = orderScore(st, moves[i]);
  var idx = [];
  for (var j = 0; j < moves.length; j++) idx.push(j);
  idx.sort(function (a, b2) { return scores[b2] - scores[a]; });
  var sorted = new Array(moves.length);
  for (var k = 0; k < idx.length; k++) sorted[k] = moves[idx[k]];
  for (var q = 0; q < moves.length; q++) moves[q] = sorted[q];
}

function isRepetition(st) {
  var key = st.hist[st.hist.length - 1], n = 0;
  for (var i = 0; i < st.hist.length; i++) {
    if (st.hist[i] === key && ++n >= 3) return true;
  }
  return false;
}

var MATE = 100000;
var NODE_CAP = 250000;
var nodes = 0;
var abort = false;

function nodeCheck() {
  nodes++;
  if ((nodes & 2047) === 0 && nodes > NODE_CAP) abort = true;
}

function quiesce(st, alpha, beta, ply) {
  nodeCheck();
  if (abort) return 0;
  if (ply > 48) return evaluate(st);
  if (st.half >= 100 || insufficientMaterial(st.board) || isRepetition(st)) return 0;
  var check = inCheck(st, st.turn);
  var moves = legalMoves(st);
  if (!moves.length) return check ? -(MATE - ply) : 0;
  var stand = evaluate(st);
  if (!check) {
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }
  orderMoves(st, moves);
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    if (m.promo && m.promo !== "q" && m.promo !== "n") continue;
    if (!check && !isCapture(st, m) && !m.promo) continue;
    var u = doMove(st, m, true);
    var v = -quiesce(st, -beta, -alpha, ply + 1);
    undoMove(st, m, u, true);
    if (abort) return 0;
    if (v > alpha) {
      alpha = v;
      if (alpha >= beta) break;
    }
  }
  return alpha;
}

function search(st, depth, alpha, beta, ply) {
  nodeCheck();
  if (abort) return 0;
  if (st.half >= 100 || insufficientMaterial(st.board) || isRepetition(st)) return 0;
  var moves = legalMoves(st);
  if (!moves.length) return inCheck(st, st.turn) ? -(MATE - ply) : 0;
  if (depth <= 0) return quiesce(st, alpha, beta, ply);
  orderMoves(st, moves);
  var best = -Infinity;
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    if (m.promo && m.promo !== "q" && m.promo !== "n") continue;
    var u = doMove(st, m, true);
    var v = -search(st, depth - 1, -beta, -alpha, ply + 1);
    undoMove(st, m, u, true);
    if (abort) return 0;
    if (v > best) {
      best = v;
      if (v > alpha) {
        alpha = v;
        if (alpha >= beta) break;
      }
    }
  }
  return best;
}

function searchRoot(st, depth, moves) {
  var alpha = -Infinity, best = moves[0], bestScore = -Infinity;
  for (var i = 0; i < moves.length; i++) {
    var u = doMove(st, moves[i], true);
    var v = -search(st, depth - 1, -Infinity, -alpha, 1);
    undoMove(st, moves[i], u, true);
    if (abort) return null;
    if (v > bestScore) { bestScore = v; best = moves[i]; }
    if (v > alpha) alpha = v;
  }
  return { move: best, score: bestScore };
}

function shuffle(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = (rng() * (i + 1)) | 0;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

/* AI move. level 0=Beginner .. 4=Impossible. rng defaults to Math.random.
 * Returns a move object {from,to,promo}, or null when no moves exist. */
function aiMove(s, level, rng) {
  rng = rng || Math.random;
  var moves = legalMoves(s);
  if (!moves.length) return null;
  if (level === undefined || level === null) level = 1;
  level |= 0;
  if (level < 0) level = 0;
  if (level > 4) level = 4;
  if (moves.length === 1) {
    var only = moves[0];
    return { from: only.from, to: only.to, promo: only.promo };
  }
  if (level === 0) {
    var r0 = moves[(rng() * moves.length) | 0];
    return { from: r0.from, to: r0.to, promo: r0.promo };
  }
  if (level === 1 && rng() < 0.3) {
    var r1 = moves[(rng() * moves.length) | 0];
    return { from: r1.from, to: r1.to, promo: r1.promo };
  }
  var target = level === 1 ? 1 : level === 2 ? 2 : level === 3 ? 3 : 4;
  var st = clone(s);
  var root = [];
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    if (m.promo && m.promo !== "q" && m.promo !== "n") continue; // search q/n promos only
    root.push(m);
  }
  shuffle(root, rng);          // variety among equal moves (stable sort below)
  orderMoves(st, root);
  nodes = 0;
  abort = false;
  var best = root[0];
  for (var d = 1; d <= target; d++) {
    var res = searchRoot(st, d, root);
    if (abort || !res) break;  // keep best from the last completed iteration
    best = res.move;
    if (res.score > MATE - 100) break; // forced mate found
    for (var j = 0; j < root.length; j++) {
      if (root[j] === best) { root.splice(j, 1); root.unshift(best); break; }
    }
  }
  return { from: best.from, to: best.to, promo: best.promo };
}

var api = {
  newGame: newGame,
  clone: clone,
  legalMoves: legalMoves,
  applyMove: applyMove,
  moveToSAN: moveToSAN,
  result: result,
  perft: perft,
  aiMove: aiMove,
  inCheck: inCheck,
  opp: opp,
  squareName: sqName
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.Chess = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
