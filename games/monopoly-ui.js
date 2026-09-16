/* Monopoly UI. Requires monopoly-logic.js + js/difficulty.js */
(function () {
  "use strict";
  var GAME_ID = "monopoly";
  var D = window.ArcadeDifficulty;
  var M = window.Monopoly;

  var state = null, levelAtStart = 1, numAI = 2;
  var gameActive = false, recorded = false, aiTimer = null;
  var logLines = [], modalMode = null, aiChoice = 2;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var DICE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  var GROUP_CSS = {
    brown: "#8B5A2B", lblue: "#7ec8e3", pink: "#ff7ac8", orange: "#ffa500",
    red: "#ff5252", yellow: "#ffe14d", green: "#39ff6a", blue: "#4d7cff"
  };

  function log(msg) {
    logLines.push(msg);
    if (logLines.length > 60) logLines.shift();
    var el = $("log");
    if (el) {
      el.innerHTML = logLines.slice(-30).map(function (l) {
        return '<div class="log-line">' + esc(l) + "</div>";
      }).join("");
      el.scrollTop = el.scrollHeight;
    }
  }

  /* ---------- board geometry: 40 squares around an 11x11 grid ---------- */
  function posToGrid(i) {
    if (i === 0) return [11, 11];
    if (i < 10) return [11, 11 - i];
    if (i === 10) return [11, 1];
    if (i < 20) return [11 - (i - 10), 1];
    if (i === 20) return [1, 1];
    if (i < 30) return [1, 1 + (i - 20)];
    if (i === 30) return [1, 11];
    return [1 + (i - 30), 11];
  }

  function sqKindLabel(sq) {
    switch (sq.t) {
      case "go": return "GO →";
      case "chest": return "📦";
      case "chance": return "?";
      case "tax": return "💸";
      case "rail": return "🚂";
      case "util": return sq.name.indexOf("Electric") >= 0 ? "💡" : "🚰";
      case "jail": return "🔒";
      case "gotojail": return "🚔";
      case "free": return "🅿️";
      default: return "";
    }
  }

  function buildBoard() {
    var b = $("board");
    b.innerHTML = "";
    for (var i = 0; i < 40; i++) {
      (function (i) {
        var sq = M.BOARD[i], g = posToGrid(i);
        var d = document.createElement("div");
        d.className = "sq sq-" + sq.t;
        d.id = "sq" + i;
        d.style.gridRow = g[0];
        d.style.gridColumn = g[1];
        var bar = sq.t === "street"
          ? '<div class="cbar" style="background:' + GROUP_CSS[sq.group] + '"></div>'
          : '<div class="cbar cbar-' + sq.t + '">' + sqKindLabel(sq) + "</div>";
        var sub = sq.price ? "$" + sq.price : (sq.amount ? "$" + sq.amount : "");
        d.innerHTML = bar +
          '<div class="sq-name">' + esc(sq.name) + "</div>" +
          (sub ? '<div class="sq-price">' + sub + "</div>" : "") +
          '<div class="sq-bld" id="bld' + i + '"></div>' +
          '<div class="sq-own" id="own' + i + '"></div>' +
          '<div class="sq-tokens" id="tok' + i + '"></div>';
        b.appendChild(d);
      })(i);
    }
    var c = document.createElement("div");
    c.id = "center-box";
    c.innerHTML =
      '<div id="turn-banner"></div>' +
      '<div id="dice"></div>' +
      '<div id="center-msg"></div>' +
      '<div class="btn-row" style="justify-content:center"><button class="btn" id="new-game2" type="button">🏳 New game</button></div>';
    b.appendChild(c);
    $("new-game2").addEventListener("click", function () {
      if (!gameActive || confirm("Quit this game and start over?")) backToStart();
    });
  }

  function renderSquares() {
    for (var i = 0; i < 40; i++) {
      var st = state.sqState[i], sqEl = $("sq" + i);
      if (!sqEl) continue;
      var bldEl = $("bld" + i), ownEl = $("own" + i);
      if (st.bld === 5) bldEl.textContent = "🏨";
      else if (st.bld > 0) bldEl.textContent = "🏠" + st.bld;
      else bldEl.textContent = "";
      if (st.owner >= 0) {
        var p = state.players[st.owner];
        ownEl.innerHTML = '<span class="own-chip" style="border-color:' + p.color + ";color:" + p.color + '">' +
          esc(p.initial) + (st.mortgaged ? " Ⓜ" : "") + "</span>";
      } else ownEl.innerHTML = "";
      sqEl.classList.toggle("mortgaged", st.mortgaged);
      var tokEl = $("tok" + i);
      tokEl.innerHTML = "";
      for (var pi = 0; pi < state.players.length; pi++) {
        var pl = state.players[pi];
        if (pl.bankrupt || pl.pos !== i) continue;
        var t = document.createElement("span");
        t.className = "token";
        t.style.background = pl.color;
        t.textContent = pl.initial;
        t.title = pl.name;
        tokEl.appendChild(t);
      }
    }
  }

  function renderPlayers() {
    var el = $("players");
    el.innerHTML = "";
    state.players.forEach(function (p, i) {
      var d = document.createElement("div");
      d.className = "player-card" + (p.bankrupt ? " bankrupt" : "") + (state.turn === i && !state.gameOver ? " active" : "");
      var props = M.ownedSquares(state, i).length;
      var goojf = p.goojfChance + p.goojfCC;
      d.innerHTML =
        '<span class="token" style="background:' + p.color + '">' + esc(p.initial) + "</span> " +
        "<b>" + esc(p.name) + "</b>" +
        (i === 0 ? ' <span class="you-tag">YOU</span>' : "") +
        '<div class="pcash">$' + p.cash + "</div>" +
        '<div class="pmeta">' + props + " properties" +
        (p.inJail ? ' · <span class="jail-tag">IN JAIL</span>' : "") +
        (goojf ? " · 🎫×" + goojf : "") +
        (p.isAI ? ' · <span class="lvl-tag">' + esc(D.LEVELS[p.level]) + "</span>" : "") +
        "</div>";
      el.appendChild(d);
    });
  }

  function renderCenter() {
    var p = state.players[state.turn];
    var tb = $("turn-banner");
    tb.innerHTML = state.gameOver
      ? "🏁 Game over"
      : '<span class="token" style="background:' + p.color + '">' + esc(p.initial) + "</span> " +
        "<b>" + esc(p.name) + "</b>'s turn" + (p.inJail ? " (in jail 🔒)" : "");
    var dice = $("dice");
    if (state.lastRoll) {
      dice.textContent = DICE_FACE[state.lastRoll[0]] + " " + DICE_FACE[state.lastRoll[1]] +
        (state.lastDoubles ? "  🎲 doubles!" : "");
    } else dice.textContent = "🎲";
    var msg = $("center-msg");
    if (state.debt) {
      var dp = state.players[state.debt.player];
      msg.innerHTML = "⚠️ <b>" + esc(dp.name) + "</b> owes <b>$" + state.debt.amount + "</b>";
    } else if (state.auction) {
      var a = state.auction;
      msg.innerHTML = "🔨 Auction: <b>" + esc(M.BOARD[a.sq].name) + "</b>" +
        (a.bid > 0 ? " — $" + a.bid + " by " + esc(state.players[a.leader].name) : " — no bids yet");
    } else if (state.pendingBuy >= 0) {
      var sq = M.BOARD[state.pendingBuy];
      msg.innerHTML = "💰 <b>" + esc(sq.name) + "</b> — $" + sq.price;
    } else msg.innerHTML = "";
  }

  /* ---------- human decision detection ---------- */
  function humanDecision() {
    if (!state || state.gameOver || state.players[0].bankrupt) return null;
    // auction/debt/trade are decided by the bidder/debtor/target, not the turn player
    if (state.debt) return state.debt.player === 0 ? "debt" : null;
    if (state.auction) return M.auctionBidder(state) === 0 ? "auction" : null;
    if (state.pendingTrade) return state.pendingTrade.to === 0 ? "trade" : null;
    if (state.jailChoice && state.turn === 0) return "jail";
    if (state.pendingBuy >= 0 && state.turn === 0) return "buy";
    if (state.turn === 0) return "turn";
    return null;
  }

  function addBtn(parent, label, fn, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (cls ? " " + cls : "");
    b.innerHTML = label;
    b.addEventListener("click", fn);
    parent.appendChild(b);
    return b;
  }

  function afterAction(ev) {
    closeModal();
    (ev || []).forEach(log);
    renderAll();
    if (state.gameOver || state.players[0].bankrupt) { endGameUI(); return; }
    runAI();
  }

  /* ---------- controls ---------- */
  function updateControls() {
    var el = $("actions");
    el.innerHTML = "";
    if (!gameActive || !state || state.gameOver || state.players[0].bankrupt) return;
    var need = humanDecision();
    if (!need) {
      var p = state.players[state.turn];
      el.innerHTML = '<div class="waiting">🤖 <b>' + esc(p.name) + "</b> is thinking…</div>";
      return;
    }
    if (need === "debt") return debtControls(el);
    if (need === "auction") return auctionControls(el);
    if (need === "buy") return buyControls(el);
    if (need === "jail") {
      el.innerHTML = '<div class="waiting">🔒 You are in jail — choose an option.</div>';
      openJailModal();
      return;
    }
    if (need === "trade") { openTradeOfferModal(); return; }
    if (need === "turn") return turnControls(el);
  }

  function turnControls(el) {
    var p = state.players[0];
    var row = document.createElement("div");
    row.className = "btn-row";
    if (!state.rolled) {
      addBtn(row, "🎲 Roll Dice", function () { afterAction(M.rollDice(state)); });
    } else if (state.lastDoubles && !p.inJail && state.pendingBuy < 0 && !state.auction) {
      addBtn(row, "🎲 Roll Again (doubles!)", function () { afterAction(M.rollDice(state)); });
      addBtn(row, "End Turn", function () { afterAction(M.endTurn(state)); });
    } else {
      addBtn(row, "End Turn", function () { afterAction(M.endTurn(state)); });
    }
    el.appendChild(row);
    var m = document.createElement("div");
    m.className = "btn-row manage-row";
    var lbl = document.createElement("span");
    lbl.className = "manage-label";
    lbl.textContent = "Manage:";
    m.appendChild(lbl);
    addBtn(m, "🏠 Build", function () { buildPicker(); });
    addBtn(m, "🏚️ Sell bldg", function () { sellPicker(); });
    addBtn(m, "💸 Mortgage", function () { mortgagePicker(); });
    addBtn(m, "💰 Unmortgage", function () { unmortgagePicker(); });
    addBtn(m, "🤝 Trade", function () { tradeProposerModal(); });
    el.appendChild(m);
  }

  function buyControls(el) {
    var sq = M.BOARD[state.pendingBuy], p = state.players[0];
    var row = document.createElement("div");
    row.className = "btn-row";
    var b = addBtn(row, "💰 Buy " + esc(sq.name) + " ($" + sq.price + ")", function () { afterAction(M.buyProperty(state)); });
    if (p.cash < sq.price) b.disabled = true;
    addBtn(row, "🔨 Auction it", function () { afterAction(M.declineBuy(state)); });
    el.appendChild(row);
  }

  function auctionControls(el) {
    var a = state.auction, sq = M.BOARD[a.sq];
    var info = document.createElement("div");
    info.className = "auction-info";
    info.innerHTML = "🔨 <b>" + esc(sq.name) + "</b> — current bid: <b>" +
      (a.bid > 0 ? "$" + a.bid + " by " + esc(state.players[a.leader].name) : "none") +
      "</b> (min $" + M.auctionMinBid(state) + ")";
    el.appendChild(info);
    var row = document.createElement("div");
    row.className = "btn-row";
    var inp = document.createElement("input");
    inp.type = "number"; inp.min = M.auctionMinBid(state); inp.value = M.auctionMinBid(state);
    inp.id = "bid-input"; inp.style.width = "90px";
    row.appendChild(inp);
    addBtn(row, "Bid", function () {
      var amt = parseInt($("bid-input").value, 10);
      var ev = M.placeBid(state, 0, amt);
      if (state.auction) { ev.forEach(log); renderAll(); updateControls(); } // still our bid turn (invalid bid)
      else afterAction(ev);
    });
    addBtn(row, "Pass", function () { afterAction(M.auctionPass(state, 0)); });
    el.appendChild(row);
  }

  function debtControls(el) {
    var d = state.debt, p = state.players[0];
    var info = document.createElement("div");
    info.className = "debt-info";
    info.innerHTML = "⚠️ You owe <b>$" + d.amount + "</b>" +
      (d.creditor >= 0 ? " to <b>" + esc(state.players[d.creditor].name) + "</b>" : " to the <b>bank</b>") +
      ". You have <b>$" + p.cash + "</b>. Raise funds or declare bankruptcy.";
    el.appendChild(info);
    var row = document.createElement("div");
    row.className = "btn-row";
    addBtn(row, "💸 Mortgage…", function () { mortgagePicker(); });
    addBtn(row, "🏚️ Sell building…", function () { sellPicker(); });
    addBtn(row, "🤝 Trade…", function () { tradeProposerModal(); });
    var pay = addBtn(row, "✅ Pay $" + d.amount, function () { afterAction(M.payDebt(state)); });
    if (p.cash < d.amount) pay.disabled = true;
    addBtn(row, "💥 Declare Bankruptcy", function () {
      if (confirm("Declare bankruptcy? Your properties go to " + (d.creditor >= 0 ? state.players[d.creditor].name : "auction") + " and you lose the game.")) {
        afterAction(M.declareBankruptcy(state));
      }
    }, "danger");
    el.appendChild(row);
  }

  /* ---------- modal helpers ---------- */
  function openModal(html) {
    $("modal").innerHTML = html;
    $("modal-backdrop").classList.add("show");
  }
  function closeModal() {
    $("modal-backdrop").classList.remove("show");
    modalMode = null;
  }

  function openJailModal() {
    if (modalMode === "jail") return;
    modalMode = "jail";
    var p = state.players[0];
    var cards = p.goojfChance + p.goojfCC;
    openModal(
      "<h3>🔒 You're in Jail</h3>" +
      "<p>Failed doubles attempts: <b>" + p.jailTurns + "/3</b> · Cash: <b>$" + p.cash + "</b></p>" +
      '<div class="btn-row" style="flex-direction:column;align-items:stretch">' +
      '<button class="btn" id="j-pay" type="button">💵 Pay $50 bail, then roll &amp; move</button>' +
      '<button class="btn" id="j-card" type="button" ' + (cards ? "" : "disabled") + ">🎫 Use Get Out of Jail Free card (" + cards + ")</button>" +
      '<button class="btn" id="j-roll" type="button">🎲 Roll for doubles (stay in jail if you miss)</button>' +
      "</div>"
    );
    $("j-pay").addEventListener("click", function () { afterAction(M.jailPayFine(state)); });
    var jc = $("j-card");
    if (cards) jc.addEventListener("click", function () { afterAction(M.jailUseCard(state)); });
    $("j-roll").addEventListener("click", function () { afterAction(M.jailRoll(state)); });
  }

  /* ---------- property pickers ---------- */
  function pickProperty(title, items, actionLabel, doAction) {
    // items: [{sq, label, sub, can, reason}]
    var html = "<h3>" + esc(title) + "</h3>";
    if (!items.length) html += "<p>No properties available.</p>";
    else html += items.map(function (it, i) {
      return '<div class="prop-row">' +
        "<div><b>" + esc(it.label) + "</b><br><span class='muted'>" + esc(it.sub) + "</span></div>" +
        '<button class="btn" data-i="' + i + '" type="button" ' + (it.can ? "" : "disabled") + ">" +
        esc(actionLabel) + "</button>" +
        (it.can ? "" : '<div class="muted reason">' + esc(it.reason) + "</div>") +
        "</div>";
    }).join("");
    html += '<div class="btn-row"><button class="btn" id="m-close" type="button">Close</button></div>';
    openModal(html);
    $("m-close").addEventListener("click", closeModal);
    var btns = $("modal").querySelectorAll("button[data-i]");
    for (var k = 0; k < btns.length; k++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var it = items[parseInt(btn.getAttribute("data-i"), 10)];
          afterAction(doAction(it.sq));
        });
      })(btns[k]);
    }
  }

  function propLabel(sq) {
    var st = state.sqState[sq], q = M.BOARD[sq];
    var extra = st.mortgaged ? " (mortgaged)" : "";
    if (q.t === "street" && st.bld > 0) extra = st.bld === 5 ? " (HOTEL)" : " (" + st.bld + " houses)";
    return q.name + " — $" + q.price + extra;
  }

  function buildPicker() {
    var items = M.ownedSquares(state, 0).filter(function (s) { return M.BOARD[s].t === "street"; })
      .map(function (s) {
        var c = M.canBuild(state, 0, s);
        return { sq: s, label: propLabel(s), sub: "House cost: $" + M.BOARD[s].house, can: c.ok, reason: c.reason || "" };
      });
    pickProperty("🏠 Build houses / hotels", items, "Build", function (sq) { return M.buildHouse(state, 0, sq); });
  }
  function sellPicker() {
    var items = M.ownedSquares(state, 0).filter(function (s) { return state.sqState[s].bld > 0; })
      .map(function (s) {
        var c = M.canSellBuilding(state, 0, s);
        return { sq: s, label: propLabel(s), sub: "Sell back for $" + (c.refund || 0), can: c.ok, reason: c.reason || "" };
      });
    pickProperty("🏚️ Sell buildings (half price)", items, "Sell", function (sq) { return M.sellHouse(state, 0, sq); });
  }
  function mortgagePicker() {
    var items = M.ownedSquares(state, 0).filter(function (s) { return !state.sqState[s].mortgaged; })
      .map(function (s) {
        var c = M.canMortgage(state, 0, s);
        return { sq: s, label: propLabel(s), sub: "Mortgage value: $" + M.mortgageValue(s), can: c.ok, reason: c.reason || "" };
      });
    pickProperty("💸 Mortgage properties", items, "Mortgage", function (sq) { return M.mortgage(state, 0, sq); });
  }
  function unmortgagePicker() {
    var items = M.ownedSquares(state, 0).filter(function (s) { return state.sqState[s].mortgaged; })
      .map(function (s) {
        var c = M.canUnmortgage(state, 0, s);
        return { sq: s, label: propLabel(s), sub: "Unmortgage cost: $" + M.unmortgageCost(s), can: c.ok, reason: c.reason || "" };
      });
    pickProperty("💰 Unmortgage properties", items, "Unmortgage", function (sq) { return M.unmortgage(state, 0, sq); });
  }

  /* ---------- trading ---------- */
  function tradableProps(pi) {
    return M.ownedSquares(state, pi).filter(function (s) { return state.sqState[s].bld === 0; });
  }

  function tradeProposerModal() {
    var opponents = [];
    for (var i = 1; i < state.players.length; i++) if (!state.players[i].bankrupt) opponents.push(i);
    if (!opponents.length) { D.toast("No opponents to trade with."); return; }
    var mine = tradableProps(0);
    function opts(list, name) {
      return list.map(function (s) {
        var st = state.sqState[s];
        return '<label class="chk"><input type="checkbox" name="' + name + '" value="' + s + '"> ' +
          esc(M.BOARD[s].name) + " ($" + M.BOARD[s].price + (st.mortgaged ? ", mortgaged" : "") + ")</label>";
      }).join("") || '<span class="muted">none</span>';
    }
    openModal(
      "<h3>🤝 Propose a trade</h3>" +
      '<label>To: <select id="tr-to">' + opponents.map(function (i) {
        return '<option value="' + i + '">' + esc(state.players[i].name) + "</option>";
      }).join("") + "</select></label>" +
      '<div class="trade-cols">' +
      '<div><h4>You give</h4>' + opts(mine, "give") +
      '<label>+$ <input type="number" id="tr-give-cash" value="0" min="0" style="width:80px"></label></div>' +
      '<div><h4>You get</h4><div id="tr-get-list"></div>' +
      '<label>+$ <input type="number" id="tr-get-cash" value="0" min="0" style="width:80px"></label></div>' +
      "</div>" +
      '<div id="tr-msg" class="muted"></div>' +
      '<div class="btn-row"><button class="btn" id="tr-send" type="button">Send offer</button>' +
      '<button class="btn" id="tr-close" type="button">Cancel</button></div>'
    );
    function refreshGet() {
      var to = parseInt($("tr-to").value, 10);
      $("tr-get-list").innerHTML = opts(tradableProps(to), "get");
    }
    $("tr-to").addEventListener("change", refreshGet);
    refreshGet();
    $("tr-close").addEventListener("click", closeModal);
    $("tr-send").addEventListener("click", function () {
      var to = parseInt($("tr-to").value, 10);
      function checked(name) {
        var out = [], boxes = $("modal").querySelectorAll('input[name="' + name + '"]:checked');
        for (var i = 0; i < boxes.length; i++) out.push(parseInt(boxes[i].value, 10));
        return out;
      }
      var offer = { cash: Math.max(0, parseInt($("tr-give-cash").value, 10) || 0), props: checked("give") };
      var request = { cash: Math.max(0, parseInt($("tr-get-cash").value, 10) || 0), props: checked("get") };
      var ev = M.proposeTrade(state, 0, to, offer, request);
      afterAction(ev);
    });
  }

  function tradeList(tr, key, pi) {
    var parts = [];
    if (tr[key].cash) parts.push("$" + tr[key].cash);
    tr[key].props.forEach(function (s) {
      parts.push(M.BOARD[s].name + (state.sqState[s].mortgaged ? " (M)" : ""));
    });
    return parts.length ? parts.join(", ") : "nothing";
  }

  function openTradeOfferModal() {
    if (modalMode === "trade") return;
    var tr = state.pendingTrade;
    if (!tr) return;
    modalMode = "trade";
    openModal(
      "<h3>🤝 Trade offer from " + esc(state.players[tr.from].name) + "</h3>" +
      "<p><b>They give you:</b> " + esc(tradeList(tr, "offer")) + "<br>" +
      "<b>They want:</b> " + esc(tradeList(tr, "request")) + "</p>" +
      '<div class="btn-row"><button class="btn" id="tr-yes" type="button">Accept</button>' +
      '<button class="btn" id="tr-no" type="button">Decline</button></div>'
    );
    $("tr-yes").addEventListener("click", function () { afterAction(M.respondTrade(state, true)); });
    $("tr-no").addEventListener("click", function () { afterAction(M.respondTrade(state, false)); });
  }

  /* ---------- render orchestration ---------- */
  function renderAll() {
    if (!state) return;
    renderSquares();
    renderPlayers();
    renderCenter();
    updateControls();
  }

  /* ---------- AI loop (non-blocking, animated via small steps) ---------- */
  function runAI() {
    clearTimeout(aiTimer);
    if (!gameActive || !state) return;
    if (state.gameOver || state.players[0].bankrupt) { endGameUI(); return; }
    var need = humanDecision();
    renderAll();
    if (need) return; // updateControls already painted the human UI
    var ev = M.aiStep(state);
    ev.forEach(log);
    renderAll();
    if (state.gameOver || state.players[0].bankrupt) { endGameUI(); return; }
    aiTimer = setTimeout(runAI, 420);
  }

  /* ---------- game over ---------- */
  function endGameUI() {
    if (!gameActive) return;
    gameActive = false;
    clearTimeout(aiTimer);
    closeModal();
    renderSquares(); renderPlayers(); renderCenter();
    var humanWon = state.winner === 0 && !state.players[0].bankrupt;
    var result = humanWon ? "win" : "loss";
    $("game").style.display = "none";
    var go = $("gameover-screen");
    go.style.display = "block";
    var winnerName = state.gameOver ? state.players[state.winner].name : "—";
    go.innerHTML =
      '<h2>' + (humanWon ? '🏆 <span class="win">You win!</span>' : '💸 <span class="lose">Game over</span>') + "</h2>" +
      "<p>" + (humanWon
        ? "You bankrupted every AI opponent. The board is yours!"
        : (state.players[0].bankrupt
          ? "You went bankrupt. " + (state.gameOver ? "<b>" + esc(winnerName) + "</b> takes the board." : "The AIs play on without you.")
          : "<b>" + esc(winnerName) + "</b> wins.")) + "</p>" +
      '<div class="btn-row"><button class="btn" id="play-again" type="button">🎲 Play again</button></div>';
    $("play-again").addEventListener("click", backToStart);
    if (!recorded) {
      recorded = true;
      var r = D.recordResult(GAME_ID, result, levelAtStart);
      D.toast(r.message);
      D.renderBar($("difficulty-bar"), GAME_ID);
    }
  }

  /* ---------- start screen ---------- */
  function backToStart() {
    clearTimeout(aiTimer);
    gameActive = false;
    state = null;
    closeModal();
    $("game").style.display = "none";
    $("gameover-screen").style.display = "none";
    $("start-screen").style.display = "block";
    D.renderBar($("difficulty-bar"), GAME_ID);
  }

  function startGame() {
    levelAtStart = D.getLevel(GAME_ID);
    state = M.newGame(numAI, Math.random, levelAtStart);
    gameActive = true;
    recorded = false;
    logLines = [];
    modalMode = null;
    aiChoice = numAI;
    $("start-screen").style.display = "none";
    $("gameover-screen").style.display = "none";
    $("game").style.display = "block";
    buildBoard();
    renderAll();
    log("🎲 New game! Difficulty: " + D.LEVELS[levelAtStart] + ". You go first — roll the dice.");
    runAI();
  }

  function init() {
    D.renderBar($("difficulty-bar"), GAME_ID);
    var btns = document.querySelectorAll(".ai-count-btn");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener("click", function () {
          for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
          b.classList.add("active");
          numAI = parseInt(b.getAttribute("data-n"), 10);
        });
      })(btns[i]);
    }
    $("start-btn").addEventListener("click", startGame);
    $("modal-backdrop").addEventListener("click", function (e) {
      if (e.target === $("modal-backdrop") && modalMode !== "jail" && modalMode !== "trade") closeModal();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
