/* Tic-Tac-Toe pure logic. No DOM. Node-requireable.
 * State: { board: [9] of "X"|"O"|null, turn: "X"|"O" }
 */
(function (root) {
  "use strict";

  var LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  function newGame() {
    return { board: [null, null, null, null, null, null, null, null, null], turn: "X" };
  }

  function clone(s) {
    return { board: s.board.slice(), turn: s.turn };
  }

  function legalMoves(s) {
    var out = [];
    for (var i = 0; i < 9; i++) if (!s.board[i]) out.push(i);
    return out;
  }

  /** Returns new state, or null if illegal. */
  function applyMove(s, idx) {
    if (idx < 0 || idx > 8 || s.board[idx] || winner(s)) return null;
    var n = clone(s);
    n.board[idx] = s.turn;
    n.turn = s.turn === "X" ? "O" : "X";
    return n;
  }

  /** "X" | "O" | "draw" | null (game ongoing) */
  function winner(s) {
    for (var i = 0; i < LINES.length; i++) {
      var L = LINES[i];
      var a = s.board[L[0]];
      if (a && a === s.board[L[1]] && a === s.board[L[2]]) return a;
    }
    for (var j = 0; j < 9; j++) if (!s.board[j]) return null;
    return "draw";
  }

  function other(t) { return t === "X" ? "O" : "X"; }

  // Minimax from X's perspective: +10 X wins, -10 O wins, 0 draw (depth-adjusted).
  function minimax(board, turn, depth) {
    var w = winner({ board: board, turn: turn });
    if (w === "X") return 10 - depth;
    if (w === "O") return depth - 10;
    if (w === "draw") return 0;
    var best = turn === "X" ? -Infinity : Infinity;
    for (var i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = turn;
      var v = minimax(board, other(turn), depth + 1);
      board[i] = null;
      if (turn === "X") { if (v > best) best = v; }
      else { if (v < best) best = v; }
    }
    return best;
  }

  function bestMoves(s) {
    var scored = [];
    for (var i = 0; i < 9; i++) {
      if (s.board[i]) continue;
      s.board[i] = s.turn;
      var v = minimax(s.board, other(s.turn), 0);
      s.board[i] = null;
      scored.push({ move: i, score: s.turn === "X" ? v : -v });
    }
    var top = -Infinity;
    scored.forEach(function (x) { if (x.score > top) top = x.score; });
    return scored.filter(function (x) { return x.score === top; }).map(function (x) { return x.move; });
  }

  function pick(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /**
   * AI move. level 0=Beginner .. 4=Impossible.
   * Impossible plays perfectly (never loses). Lower levels mix best moves with random ones.
   */
  function aiMove(s, level, rng) {
    rng = rng || Math.random;
    var moves = legalMoves(s);
    if (!moves.length) return -1;
    if (level <= 0) return pick(moves, rng);
    var best = bestMoves(s);
    var pBest = [0, 0.2, 0.5, 0.85, 1.0][Math.max(0, Math.min(4, level | 0))];
    if (rng() < pBest) return pick(best, rng);
    return pick(moves, rng);
  }

  var api = {
    newGame: newGame,
    clone: clone,
    legalMoves: legalMoves,
    applyMove: applyMove,
    winner: winner,
    aiMove: aiMove,
    LINES: LINES
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TicTacToe = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
