/* Monopoly engine — pure logic, no DOM. Node-requireable.
 *
 * API OVERVIEW (step-based; the UI drives the game one atomic action at a time):
 *
 *   newGame(numAI, rng, aiLevel) -> state
 *       Human is player 0 (isAI:false). AI opponents get `aiLevel` (0-4, default 1).
 *       `rng` may be a function returning [0,1) or a numeric seed.
 *
 *   simulate(numAI, levels, seed, maxTurns) -> {winner, turns, log, gameOver}
 *       Headless AI-vs-AI game. players = numAI+1, all AI, levels[i] = difficulty
 *       of player i. Always terminates (maxTurns cap, default 2000).
 *
 *   Turn flow (UI calls these for the human; aiStep() does the equivalent for AI):
 *     rollDice(state)        roll + move + resolve landing (may set pendingBuy/debt/...)
 *     buyProperty(state)     human buys state.pendingBuy
 *     declineBuy(state)      human declines -> auction starts
 *     startAuction(state,sq) / placeBid(state,p,amt) / auctionPass(state,p)
 *                            auctionBidder(state) -> player idx whose bid turn it is
 *     jailPayFine(state) / jailUseCard(state) / jailRoll(state)
 *     buildHouse(state,p,sq) / sellHouse(state,p,sq)   (canBuild/canSellBuilding check first)
 *     mortgage(state,p,sq) / unmortgage(state,p,sq)
 *     proposeTrade(state,from,to,offer,request)  offer/request = {cash, props:[sqIdx]}
 *                            human->AI resolves immediately; AI->human leaves pendingTrade
 *     respondTrade(state, acceptBool)   human answers an AI trade offer
 *     payDebt(state)         pay state.debt in full (when cash suffices)
 *     declareBankruptcy(state)
 *     endTurn(state)
 *
 *   aiStep(state) -> [event strings]
 *     Performs exactly ONE atomic AI action (roll, buy, bid, build, jail choice,
 *     debt fund-raising, trade propose/respond, end turn). Call repeatedly (with a
 *     small delay for animation) until the game needs a human decision or ends.
 *     Returns [] when it is a human's decision point.
 *
 *   Info helpers: rentFor(state,sq,dice), ownsGroup(state,p,sq), BOARD, GROUPS,
 *     mortgageValue(sq), unmortgageCost(sq), evaluateTrade(state,trade),
 *     playerNetWorth(state,p)
 *
 * State notes:
 *   players[i] = {name,color,initial,isAI,level,cash,pos,inJail,jailTurns,
 *                 doubles,bankrupt,goojfChance,goojfCC,lastTradeProp}
 *   sqState[i] = {owner:-1, mortgaged:false, bld:0}   bld: 0-4 houses, 5 = hotel
 *   debt = {player, amount, creditor}  creditor: player idx or -1 = bank
 *   pendingBuy: sq idx or -1. auction: null | {sq,leader,bid,active[],order[],cursor}
 *   pendingTrade: null | {from,to,offer,request}. jailChoice: bool (turn player in jail)
 *   housesLeft (32), hotelsLeft (12). chance/cc: draw decks (arrays, shift to draw).
 */
(function (root) {
  "use strict";

  /* ================= utilities ================= */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toRng(rng) {
    if (typeof rng === "function") return rng;
    if (typeof rng === "number") return mulberry32(rng);
    return Math.random;
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function clampInt(v, lo, hi) { v = parseInt(v, 10); if (isNaN(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }

  /* ================= board data ================= */
  // rent arrays: [0 houses,1,2,3,4 houses, hotel]
  var BOARD = [
    { t: "go", name: "GO" },
    { t: "street", name: "Mediterranean Ave", group: "brown", price: 60, rent: [2, 10, 30, 90, 160, 250], house: 50 },
    { t: "chest", name: "Community Chest" },
    { t: "street", name: "Baltic Ave", group: "brown", price: 60, rent: [4, 20, 60, 180, 320, 450], house: 50 },
    { t: "tax", name: "Income Tax", amount: 200 },
    { t: "rail", name: "Reading Railroad", price: 200 },
    { t: "street", name: "Oriental Ave", group: "lblue", price: 100, rent: [6, 30, 90, 270, 400, 550], house: 50 },
    { t: "chance", name: "Chance" },
    { t: "street", name: "Vermont Ave", group: "lblue", price: 100, rent: [6, 30, 90, 270, 400, 550], house: 50 },
    { t: "street", name: "Connecticut Ave", group: "lblue", price: 120, rent: [8, 40, 100, 300, 450, 600], house: 50 },
    { t: "jail", name: "Jail (Just Visiting)" },
    { t: "street", name: "St. Charles Place", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], house: 100 },
    { t: "util", name: "Electric Company", price: 150 },
    { t: "street", name: "States Ave", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], house: 100 },
    { t: "street", name: "Virginia Ave", group: "pink", price: 160, rent: [12, 60, 180, 500, 700, 900], house: 100 },
    { t: "rail", name: "Pennsylvania Railroad", price: 200 },
    { t: "street", name: "St. James Place", group: "orange", price: 180, rent: [14, 70, 200, 550, 750, 950], house: 100 },
    { t: "chest", name: "Community Chest" },
    { t: "street", name: "Tennessee Ave", group: "orange", price: 180, rent: [14, 70, 200, 550, 750, 950], house: 100 },
    { t: "street", name: "New York Ave", group: "orange", price: 200, rent: [16, 80, 220, 600, 800, 1000], house: 100 },
    { t: "free", name: "Free Parking" },
    { t: "street", name: "Kentucky Ave", group: "red", price: 220, rent: [18, 90, 250, 700, 875, 1050], house: 150 },
    { t: "chance", name: "Chance" },
    { t: "street", name: "Indiana Ave", group: "red", price: 220, rent: [18, 90, 250, 700, 875, 1050], house: 150 },
    { t: "street", name: "Illinois Ave", group: "red", price: 240, rent: [20, 100, 300, 750, 925, 1100], house: 150 },
    { t: "rail", name: "B&O Railroad", price: 200 },
    { t: "street", name: "Atlantic Ave", group: "yellow", price: 260, rent: [22, 110, 330, 800, 975, 1150], house: 150 },
    { t: "street", name: "Ventnor Ave", group: "yellow", price: 260, rent: [22, 110, 330, 800, 975, 1150], house: 150 },
    { t: "util", name: "Water Works", price: 150 },
    { t: "street", name: "Marvin Gardens", group: "yellow", price: 280, rent: [24, 120, 360, 850, 1025, 1200], house: 150 },
    { t: "gotojail", name: "Go To Jail" },
    { t: "street", name: "Pacific Ave", group: "green", price: 300, rent: [26, 130, 390, 900, 1100, 1275], house: 200 },
    { t: "street", name: "North Carolina Ave", group: "green", price: 300, rent: [26, 130, 390, 900, 1100, 1275], house: 200 },
    { t: "chest", name: "Community Chest" },
    { t: "street", name: "Pennsylvania Ave", group: "green", price: 320, rent: [28, 150, 450, 1000, 1200, 1400], house: 200 },
    { t: "rail", name: "Short Line", price: 200 },
    { t: "chance", name: "Chance" },
    { t: "street", name: "Park Place", group: "blue", price: 350, rent: [35, 175, 500, 1100, 1300, 1500], house: 200 },
    { t: "tax", name: "Luxury Tax", amount: 100 },
    { t: "street", name: "Boardwalk", group: "blue", price: 400, rent: [50, 200, 600, 1400, 1700, 2000], house: 200 }
  ];

  var GROUPS = {
    brown: [1, 3], lblue: [6, 8, 9], pink: [11, 13, 14], orange: [16, 18, 19],
    red: [21, 23, 24], yellow: [26, 27, 29], green: [31, 32, 34], blue: [37, 39],
    rail: [5, 15, 25, 35], util: [12, 28]
  };

  var RAIL_RENT = [0, 25, 50, 100, 200];
  var BUYABLE = { street: 1, rail: 1, util: 1 };

  /* ================= cards ================= */
  // ids are stable; text mirrors classic cards.
  var CHANCE = [
    { id: "adv-boardwalk", text: "Advance to Boardwalk." },
    { id: "adv-go", text: "Advance to Go (Collect $200)." },
    { id: "adv-illinois", text: "Advance to Illinois Ave. If you pass Go, collect $200." },
    { id: "adv-stcharles", text: "Advance to St. Charles Place. If you pass Go, collect $200." },
    { id: "adv-rail1", text: "Advance token to nearest Railroad and pay owner twice the rent. If unowned, you may buy it." },
    { id: "adv-rail2", text: "Advance token to nearest Railroad and pay owner twice the rent. If unowned, you may buy it." },
    { id: "adv-util", text: "Advance token to nearest Utility. If owned, roll dice and pay owner 10x the roll." },
    { id: "dividend", text: "Bank pays you dividend of $50." },
    { id: "goojf", text: "Get Out of Jail Free. Keep until used." },
    { id: "back3", text: "Go Back 3 Spaces." },
    { id: "go-jail", text: "Go to Jail. Go directly to Jail." },
    { id: "repairs", text: "General repairs: pay $25 per house, $100 per hotel." },
    { id: "speeding", text: "Speeding fine: pay $15." },
    { id: "adv-reading", text: "Take a trip to Reading Railroad. If you pass Go, collect $200." },
    { id: "chairman", text: "You have been elected Chairman of the Board. Pay each player $50." },
    { id: "loan", text: "Your building loan matures. Collect $150." }
  ];
  var CHEST = [
    { id: "adv-go", text: "Advance to Go (Collect $200)." },
    { id: "bank-error", text: "Bank error in your favor. Collect $200." },
    { id: "doctor", text: "Doctor's fee. Pay $50." },
    { id: "stock", text: "From sale of stock you get $50." },
    { id: "goojf", text: "Get Out of Jail Free. Keep until used." },
    { id: "go-jail", text: "Go to Jail. Go directly to Jail." },
    { id: "opera", text: "Grand Opera Night. Collect $50 from every player." },
    { id: "holiday", text: "Holiday Fund matures. Receive $100." },
    { id: "tax-refund", text: "Income tax refund. Collect $20." },
    { id: "birthday", text: "It is your birthday. Collect $10 from every player." },
    { id: "insurance", text: "Life insurance matures. Collect $100." },
    { id: "hospital", text: "Hospital fees. Pay $50." },
    { id: "school", text: "Pay school fees of $50." },
    { id: "consult", text: "Receive $25 consultancy fee." },
    { id: "street-repairs", text: "Street repairs: pay $40 per house, $115 per hotel." },
    { id: "beauty", text: "You have won second prize in a beauty contest. Collect $10." }
  ];
  function chanceGoojfIdx() { for (var i = 0; i < CHANCE.length; i++) if (CHANCE[i].id === "goojf") return i; return -1; }
  function chestGoojfIdx() { for (var i = 0; i < CHEST.length; i++) if (CHEST[i].id === "goojf") return i; return -1; }

  /* ================= state ================= */
  var AI_NAMES = ["Ada", "Grace", "Alan"];
  var AI_COLORS = ["#ff2fd6", "#ffd32f", "#7dff5e"];
  var AI_INITIALS = ["A", "G", "L"];

  function baseNewGame(numPlayers, rng, aiLevels) {
    rng = toRng(rng);
    var players = [];
    for (var i = 0; i < numPlayers; i++) {
      var isAI = aiLevels ? true : i !== 0;
      players.push({
        name: isAI ? AI_NAMES[(i - (aiLevels ? 0 : 1)) % AI_NAMES.length] : "You",
        color: isAI ? AI_COLORS[(i - (aiLevels ? 0 : 1)) % AI_COLORS.length] : "#00f0ff",
        initial: isAI ? AI_INITIALS[(i - (aiLevels ? 0 : 1)) % AI_INITIALS.length] : "Y",
        isAI: isAI,
        level: isAI ? clampInt(aiLevels ? aiLevels[i] : 1, 0, 4) : 0,
        cash: 1500, pos: 0, inJail: false, jailTurns: 0, doubles: 0,
        bankrupt: false, goojfChance: 0, goojfCC: 0, lastTradeProp: -999
      });
    }
    var sqState = [];
    for (var s = 0; s < 40; s++) sqState.push({ owner: -1, mortgaged: false, bld: 0 });
    var chance = [], cc = [];
    for (var c = 0; c < 16; c++) { chance.push(c); cc.push(c); }
    shuffle(chance, rng); shuffle(cc, rng);
    return {
      rng: rng,
      players: players,
      turn: 0,
      turnCount: 0,
      rolled: false, lastDoubles: false, lastRoll: null,
      sqState: sqState,
      housesLeft: 32, hotelsLeft: 12,
      chance: chance, cc: cc,
      pendingBuy: -1, auction: null, auctionQueue: [],
      debt: null, debtCont: null,
      jailChoice: false, pendingTrade: null,
      gameOver: false, winner: -1
    };
  }

  function newGame(numAI, rng, aiLevel) {
    numAI = clampInt(numAI === undefined ? 2 : numAI, 1, 3);
    var lv = aiLevel === undefined ? 1 : clampInt(aiLevel, 0, 4);
    var lvls = [];
    for (var i = 0; i < numAI; i++) lvls.push(lv);
    // player 0 = human; aiLevels param of baseNewGame expects per-player levels when all-AI
    var st = baseNewGame(numAI + 1, rng, null);
    for (var j = 1; j < st.players.length; j++) st.players[j].level = lv;
    return st;
  }

  /* ================= helpers ================= */
  function pname(state, i) { return state.players[i].name; }
  function solventPlayers(state) {
    var out = [];
    for (var i = 0; i < state.players.length; i++) if (!state.players[i].bankrupt) out.push(i);
    return out;
  }
  function ownedSquares(state, pi) {
    var out = [];
    for (var s = 0; s < 40; s++) if (state.sqState[s].owner === pi) out.push(s);
    return out;
  }
  function groupOf(sqIdx) { return BOARD[sqIdx].group; }
  function ownsGroup(state, pi, sqIdx) {
    var g = GROUPS[groupOf(sqIdx)];
    if (!g) return false;
    for (var i = 0; i < g.length; i++) if (state.sqState[g[i]].owner !== pi) return false;
    return true;
  }
  function countOwnedType(state, pi, type) {
    var n = 0;
    for (var s = 0; s < 40; s++)
      if (BOARD[s].t === type && state.sqState[s].owner === pi) n++;
    return n;
  }
  function mortgageValue(sqIdx) { return Math.floor(BOARD[sqIdx].price / 2); }
  function unmortgageCost(sqIdx) { return Math.ceil(mortgageValue(sqIdx) * 1.1); }

  function rentFor(state, sqIdx, dice) {
    var sq = BOARD[sqIdx], st = state.sqState[sqIdx];
    if (st.owner < 0 || st.mortgaged) return 0;
    if (sq.t === "street") {
      if (st.bld > 0) return sq.rent[st.bld]; // 1-4 houses, 5 = hotel
      if (ownsGroup(state, st.owner, sqIdx)) return sq.rent[0] * 2;
      return sq.rent[0];
    }
    if (sq.t === "rail") return RAIL_RENT[countOwnedType(state, st.owner, "rail")];
    if (sq.t === "util") return dice * (countOwnedType(state, st.owner, "util") >= 2 ? 10 : 4);
    return 0;
  }

  function countBuildings(state, pi) {
    var houses = 0, hotels = 0;
    for (var s = 0; s < 40; s++) {
      if (state.sqState[s].owner !== pi) continue;
      var b = state.sqState[s].bld;
      if (b === 5) hotels++;
      else houses += b;
    }
    return { houses: houses, hotels: hotels };
  }

  function playerNetWorth(state, pi) {
    var p = state.players[pi], v = p.cash;
    var sqs = ownedSquares(state, pi);
    for (var i = 0; i < sqs.length; i++) {
      var sq = sqs[i], b = BOARD[sq];
      v += b.price;
      var bld = state.sqState[sq].bld;
      if (b.house) v += (bld === 5 ? 5 : bld) * b.house / 2;
    }
    return Math.round(v);
  }

  function checkGameOver(state, ev) {
    var s = solventPlayers(state);
    if (s.length === 1 && !state.gameOver) {
      state.gameOver = true;
      state.winner = s[0];
      if (ev) ev.push("🏆 " + pname(state, s[0]) + " wins the game!");
    }
    return state.gameOver;
  }

  /* ================= money / debt ================= */
  // creditor: player idx, or -1 = bank. desc labels the payment in the log.
  function chargePlayer(state, pi, amount, creditor, desc) {
    var p = state.players[pi], ev = [];
    var label = desc ? " (" + desc + ")" : "";
    if (p.cash >= amount) {
      p.cash -= amount;
      if (creditor >= 0) state.players[creditor].cash += amount;
      ev.push(pname(state, pi) + " pays $" + amount + label + ".");
    } else {
      state.debt = { player: pi, amount: amount, creditor: creditor };
      ev.push(pname(state, pi) + " owes $" + amount + label + " but only has $" + p.cash + " — must raise funds!");
    }
    return ev;
  }

  function payDebt(state) {
    var d = state.debt, ev = [];
    if (!d) return ["No debt to pay."];
    var p = state.players[d.player];
    if (p.bankrupt) { state.debt = null; return ["Debt cleared (bankrupt)."]; }
    if (p.cash < d.amount) return [pname(state, d.player) + " still can't cover $" + d.amount + " (has $" + p.cash + ")."];
    p.cash -= d.amount;
    if (d.creditor >= 0) state.players[d.creditor].cash += d.amount;
    state.debt = null;
    ev.push(pname(state, d.player) + " pays $" + d.amount + " debt in full.");
    var cont = state.debtCont; state.debtCont = null;
    if (cont) ev = ev.concat(resumeCardCont(state, cont, d.player));
    return ev;
  }

  function declareBankruptcy(state) {
    var d = state.debt, ev = [];
    if (!d) return ["No debt to declare bankruptcy on."];
    var pi = d.player, p = state.players[pi], cred = d.creditor;
    ev.push("💥 " + pname(state, pi) + " declares BANKRUPTCY!");
    // sell all buildings back at half price
    var sqs = ownedSquares(state, pi);
    for (var i = 0; i < sqs.length; i++) {
      var sq = sqs[i], st = state.sqState[sq], b = st.bld;
      if (b > 0) {
        var cost = BOARD[sq].house, refund = Math.floor((b === 5 ? 5 : b) * cost / 2);
        p.cash += refund;
        if (b === 5) {
          state.hotelsLeft++;
          state.housesLeft = Math.max(0, state.housesLeft - 4);
        } else state.housesLeft += b;
        st.bld = 0;
        ev.push(BOARD[sq].name + " buildings sold back for $" + refund + ".");
      }
    }
    for (var j = 0; j < sqs.length; j++) state.sqState[sqs[j]].owner = -1;
    if (cred >= 0) {
      var c = state.players[cred];
      for (var k = 0; k < sqs.length; k++) state.sqState[sqs[k]].owner = cred;
      c.goojfChance += p.goojfChance; c.goojfCC += p.goojfCC;
      c.cash += p.cash;
      ev.push("All properties, $" + p.cash + " cash and Get-Out-of-Jail cards go to " + pname(state, cred) + ".");
      p.cash = 0; p.goojfChance = 0; p.goojfCC = 0;
    } else {
      for (var g = 0; g < p.goojfChance; g++) state.chance.push(chanceGoojfIdx());
      for (var h = 0; h < p.goojfCC; h++) state.cc.push(chestGoojfIdx());
      p.goojfChance = 0; p.goojfCC = 0; p.cash = 0;
      state.auctionQueue = sqs.slice();
      ev.push(sqs.length + " properties will be auctioned off one by one.");
    }
    p.bankrupt = true;
    state.debt = null;
    // clean up any state referencing the bankrupt player
    if (state.pendingBuy >= 0 && state.sqState[state.pendingBuy].owner === -1) {
      // pendingBuy square stays unowned; decision dies with the player
      if (state.turn === pi) state.pendingBuy = -1;
    }
    if (state.auction) {
      for (var a = 0; a < state.auction.order.length; a++)
        if (state.auction.order[a] === pi) state.auction.active[a] = false;
    }
    if (state.pendingTrade && (state.pendingTrade.from === pi || state.pendingTrade.to === pi))
      state.pendingTrade = null;
    var cont = state.debtCont; state.debtCont = null;
    checkGameOver(state, ev);
    if (!state.gameOver) {
      if (state.auctionQueue.length) {
        ev = ev.concat(startAuction(state, state.auctionQueue.shift()));
      } else if (cont) {
        ev = ev.concat(resumeCardCont(state, cont, pi));
      }
      if (state.players[state.turn].bankrupt && !state.auction && !state.debt && state.pendingBuy < 0)
        ev = ev.concat(endTurn(state));
    }
    return ev;
  }

  /* ================= movement ================= */
  function sendToJail(state, pi) {
    var p = state.players[pi], ev = [];
    p.pos = 10; p.inJail = true; p.jailTurns = 0; p.doubles = 0;
    state.rolled = true; state.lastDoubles = false; state.pendingBuy = -1;
    ev.push("🚔 " + pname(state, pi) + " is sent to Jail!");
    return ev;
  }

  function moveAndResolve(state, pi, steps, diceForRent) {
    var p = state.players[pi], ev = [];
    var old = p.pos, np = (old + steps) % 40;
    if (np < old) { p.cash += 200; ev.push(pname(state, pi) + " passes GO, collects $200."); }
    p.pos = np;
    ev.push(pname(state, pi) + " lands on " + BOARD[np].name + ".");
    return ev.concat(resolveLanding(state, pi, diceForRent === undefined ? steps : diceForRent));
  }

  // Card "advance to X" movement (collects $200 only if passing GO).
  function advanceTo(state, pi, target) {
    var p = state.players[pi], ev = [];
    if (target < p.pos) { p.cash += 200; ev.push(pname(state, pi) + " passes GO, collects $200."); }
    p.pos = target;
    ev.push(pname(state, pi) + " advances to " + BOARD[target].name + ".");
    return ev.concat(resolveLanding(state, pi, 0));
  }

  function nearestOf(pos, list) {
    for (var i = 0; i < list.length; i++) if (list[i] > pos) return list[i];
    return list[0];
  }

  /* ================= landing ================= */
  function resolveLanding(state, pi, dice) {
    var p = state.players[pi], pos = p.pos;
    var sq = BOARD[pos], st = state.sqState[pos], ev = [];
    switch (sq.t) {
      case "go": case "free": case "jail": break;
      case "tax":
        ev = ev.concat(chargePlayer(state, pi, sq.amount, -1, sq.name));
        break;
      case "gotojail":
        ev = ev.concat(sendToJail(state, pi));
        break;
      case "chance":
        ev = ev.concat(drawCard(state, pi, "chance"));
        break;
      case "chest":
        ev = ev.concat(drawCard(state, pi, "cc"));
        break;
      case "street": case "rail": case "util":
        if (st.owner === -1) {
          if (p.isAI) ev = ev.concat(aiBuyDecision(state, pi, pos));
          else {
            state.pendingBuy = pos;
            ev.push("💰 " + sq.name + " is unowned — buy for $" + sq.price + " or put it up for auction.");
          }
        } else if (st.owner !== pi) {
          var o = state.players[st.owner];
          if (o.bankrupt) break;
          var rent = rentFor(state, pos, dice);
          if (rent > 0) ev = ev.concat(chargePlayer(state, pi, rent, st.owner, sq.name + " rent"));
          else ev.push(sq.name + " is mortgaged — no rent due.");
        }
        break;
    }
    return ev;
  }

  /* ================= cards ================= */
  function drawCard(state, pi, deckName) {
    var deck = deckName === "chance" ? state.chance : state.cc;
    var defs = deckName === "chance" ? CHANCE : CHEST;
    if (!deck.length) { for (var i = 0; i < 16; i++) deck.push(i); shuffle(deck, state.rng); }
    var idx = deck.shift(), card = defs[idx], ev = [];
    ev.push((deckName === "chance" ? "🎲 Chance: " : "📦 Community Chest: ") + card.text);
    var keep = (card.id === "goojf");
    ev = ev.concat(applyCard(state, pi, deckName, card.id));
    if (!keep) deck.push(idx); // drawn card goes to the back of the deck
    else {
      if (deckName === "chance") state.players[pi].goojfChance++;
      else state.players[pi].goojfCC++;
      ev.push(pname(state, pi) + " keeps the Get Out of Jail Free card.");
    }
    return ev;
  }

  function applyCard(state, pi, deckName, id) {
    var p = state.players[pi], ev = [];
    function payBank(n, why) { return chargePlayer(state, pi, n, -1, why); }
    function gain(n, why) { p.cash += n; return [pname(state, pi) + " collects $" + n + (why ? " (" + why + ")" : "") + "."]; }
    switch (id) {
      case "adv-boardwalk": return advanceTo(state, pi, 39);
      case "adv-go": p.cash += 200; p.pos = 0; return [pname(state, pi) + " advances to GO, collects $200."];
      case "adv-illinois": return advanceTo(state, pi, 24);
      case "adv-stcharles": return advanceTo(state, pi, 11);
      case "adv-reading": return advanceTo(state, pi, 5);
      case "adv-rail1": case "adv-rail2": {
        var target = nearestOf(p.pos, GROUPS.rail);
        if (target < p.pos) { p.cash += 200; ev.push(pname(state, pi) + " passes GO, collects $200."); }
        p.pos = target;
        ev.push(pname(state, pi) + " advances to " + BOARD[target].name + ".");
        var st = state.sqState[target];
        if (st.owner === -1) {
          if (p.isAI) ev = ev.concat(aiBuyDecision(state, pi, target));
          else { state.pendingBuy = target; ev.push("💰 " + BOARD[target].name + " is unowned — buy for $200 or auction it."); }
        } else if (st.owner !== pi && !state.players[st.owner].bankrupt) {
          var rent = rentFor(state, target, 0) * 2;
          ev = ev.concat(chargePlayer(state, pi, rent, st.owner, BOARD[target].name + " rent x2 (Chance)"));
        }
        return ev;
      }
      case "adv-util": {
        var t2 = nearestOf(p.pos, GROUPS.util);
        var d1 = 1 + Math.floor(state.rng() * 6), d2 = 1 + Math.floor(state.rng() * 6);
        if (t2 < p.pos) { p.cash += 200; ev.push(pname(state, pi) + " passes GO, collects $200."); }
        p.pos = t2;
        ev.push(pname(state, pi) + " advances to " + BOARD[t2].name + ".");
        var st2 = state.sqState[t2];
        if (st2.owner === -1) {
          if (p.isAI) ev = ev.concat(aiBuyDecision(state, pi, t2));
          else { state.pendingBuy = t2; ev.push("💰 " + BOARD[t2].name + " is unowned — buy for $150 or auction it."); }
        } else if (st2.owner !== pi && !state.players[st2.owner].bankrupt && !st2.mortgaged) {
          ev.push("Dice roll: " + d1 + " + " + d2 + " = " + (d1 + d2) + ".");
          ev = ev.concat(chargePlayer(state, pi, (d1 + d2) * 10, st2.owner, BOARD[t2].name + " 10x roll (Chance)"));
        } else if (st2.mortgaged) ev.push(BOARD[t2].name + " is mortgaged — no payment.");
        return ev;
      }
      case "dividend": return gain(50, "dividend");
      case "goojf": return [];
      case "back3": {
        p.pos = (p.pos - 3 + 40) % 40;
        ev.push(pname(state, pi) + " goes back 3 spaces to " + BOARD[p.pos].name + ".");
        return ev.concat(resolveLanding(state, pi, 0));
      }
      case "go-jail": return sendToJail(state, pi);
      case "repairs": {
        var b = countBuildings(state, pi);
        return payBank(b.houses * 25 + b.hotels * 100, "general repairs");
      }
      case "street-repairs": {
        var b2 = countBuildings(state, pi);
        return payBank(b2.houses * 40 + b2.hotels * 115, "street repairs");
      }
      case "speeding": return payBank(15, "speeding fine");
      case "loan": return gain(150, "building loan matures");
      case "chairman": return cardChairman(state, pi);
      case "bank-error": return gain(200, "bank error");
      case "doctor": return payBank(50, "doctor's fee");
      case "stock": return gain(50, "sale of stock");
      case "opera": return cardCollect(state, pi, 50, "Grand Opera Night");
      case "holiday": return gain(100, "holiday fund");
      case "tax-refund": return gain(20, "income tax refund");
      case "birthday": return cardCollect(state, pi, 10, "birthday");
      case "insurance": return gain(100, "life insurance matures");
      case "hospital": return payBank(50, "hospital fees");
      case "school": return payBank(50, "school fees");
      case "consult": return gain(25, "consultancy fee");
      case "beauty": return gain(10, "beauty contest");
    }
    return ev;
  }

  // Collect $per from every other solvent player (opera / birthday).
  function cardCollect(state, pi, per, why) {
    var others = [];
    for (var i = 0; i < state.players.length; i++)
      if (i !== pi && !state.players[i].bankrupt) others.push(i);
    return continueCollect(state, pi, others, per, [pname(state, pi) + " collects $" + per + " from every player (" + why + ")."]);
  }
  function continueCollect(state, to, remaining, per, ev) {
    ev = ev || [];
    while (remaining.length) {
      var q = remaining[0];
      if (state.players[q].bankrupt) { remaining.shift(); continue; }
      if (state.players[q].cash >= per) {
        state.players[q].cash -= per; state.players[to].cash += per;
        ev.push(pname(state, q) + " pays $" + per + " to " + pname(state, to) + ".");
        remaining.shift();
      } else {
        state.debt = { player: q, amount: per, creditor: to };
        state.debtCont = { kind: "collect", to: to, remaining: remaining.slice(1), per: per };
        ev.push(pname(state, q) + " can't pay $" + per + " — must raise funds!");
        return ev;
      }
    }
    return ev;
  }

  // Chairman: pay $50 to each other solvent player, in order.
  function cardChairman(state, pi) {
    var others = [];
    for (var i = 0; i < state.players.length; i++)
      if (i !== pi && !state.players[i].bankrupt) others.push(i);
    return continueChairman(state, pi, others, ["🎩 Chairman of the Board: pay each player $50."]);
  }
  function continueChairman(state, pi, remaining, ev) {
    ev = ev || [];
    while (remaining.length) {
      var q = remaining[0];
      if (state.players[q].bankrupt) { remaining.shift(); continue; }
      if (state.players[pi].cash >= 50) {
        state.players[pi].cash -= 50; state.players[q].cash += 50;
        ev.push(pname(state, pi) + " pays $50 to " + pname(state, q) + ".");
        remaining.shift();
      } else {
        state.debt = { player: pi, amount: 50, creditor: q };
        state.debtCont = { kind: "chairman", remaining: remaining.slice(1) };
        ev.push(pname(state, pi) + " can't pay $50 to " + pname(state, q) + " — must raise funds!");
        return ev;
      }
    }
    return ev;
  }

  // Resume a card interrupted by a debt, after the debt is resolved.
  function resumeCardCont(state, cont, debtorIdx) {
    if (!cont) return [];
    if (cont.kind === "collect") {
      return continueCollect(state, cont.to, cont.remaining, cont.per, ["Debt settled — collection continues."]);
    }
    if (cont.kind === "chairman") {
      if (state.players[debtorIdx].bankrupt) return []; // payer went bust: nothing left to distribute
      return continueChairman(state, debtorIdx, cont.remaining, ["Debt settled — Chairman payments continue."]);
    }
    if (cont.kind === "jailExit") {
      if (state.players[debtorIdx].bankrupt) return [];
      return completeJailExit(state, debtorIdx);
    }
    return [];
  }

  /* ================= turn flow ================= */
  function rollDice(state) {
    var pi = state.turn, p = state.players[pi], ev = [];
    if (state.gameOver) return ["Game is over."];
    if (p.bankrupt) return [pname(state, pi) + " is bankrupt."];
    if (p.inJail) return [pname(state, pi) + " is in jail — choose an option first."];
    if (state.rolled && !state.lastDoubles) return ["Already rolled this turn."];
    if (state.pendingBuy >= 0 || state.auction || state.debt) return ["Resolve the pending decision first."];
    var d1 = 1 + Math.floor(state.rng() * 6), d2 = 1 + Math.floor(state.rng() * 6);
    state.lastRoll = [d1, d2]; state.rolled = true; state.lastDoubles = (d1 === d2);
    ev.push(pname(state, pi) + " rolls " + d1 + " + " + d2 + (d1 === d2 ? " — DOUBLES!" : "") + ".");
    if (d1 === d2) {
      p.doubles++;
      if (p.doubles >= 3) {
        ev.push("Three doubles in a row!");
        return ev.concat(sendToJail(state, pi));
      }
    } else p.doubles = 0;
    ev = ev.concat(moveAndResolve(state, pi, d1 + d2));
    if (state.lastDoubles && state.pendingBuy < 0 && !state.auction && !state.debt && !state.gameOver && !p.inJail)
      ev.push(pname(state, pi) + " rolled doubles — rolls again!");
    return ev;
  }

  // Roll + move after leaving jail (no doubles bonus, turn ends).
  function rollMoveNoDoubles(state, pi) {
    var p = state.players[pi], ev = [];
    var d1 = 1 + Math.floor(state.rng() * 6), d2 = 1 + Math.floor(state.rng() * 6);
    state.lastRoll = [d1, d2]; state.rolled = true; state.lastDoubles = false;
    ev.push(pname(state, pi) + " rolls " + d1 + " + " + d2 + ".");
    p.doubles = 0;
    ev = ev.concat(moveAndResolve(state, pi, d1 + d2));
    return ev;
  }

  function buyPropertyAt(state, pi, sq) {
    var st = state.sqState[sq], q = BOARD[sq], p = state.players[pi], ev = [];
    if (!BUYABLE[q.t]) return ["Can't buy " + q.name + "."];
    if (st.owner !== -1) return [q.name + " is already owned."];
    if (p.cash < q.price) return [pname(state, pi) + " can't afford " + q.name + " ($" + q.price + ")."];
    p.cash -= q.price;
    st.owner = pi;
    ev.push(pname(state, pi) + " buys " + q.name + " for $" + q.price + ".");
    return ev;
  }

  function buyProperty(state) {
    var sq = state.pendingBuy;
    if (sq < 0) return ["Nothing to buy."];
    state.pendingBuy = -1;
    return buyPropertyAt(state, state.turn, sq);
  }

  function declineBuy(state) {
    var sq = state.pendingBuy;
    if (sq < 0) return ["Nothing to decline."];
    state.pendingBuy = -1;
    return startAuction(state, sq);
  }

  function endTurn(state) {
    var ev = [];
    if (state.gameOver) return ["Game is over."];
    if (state.debt || state.auction || state.pendingBuy >= 0 || state.pendingTrade) return ["Resolve pending decisions before ending the turn."];
    var out = state.players[state.turn];
    out.doubles = 0;
    var n = state.players.length, next = state.turn;
    for (var i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (!state.players[next].bankrupt) break;
    }
    state.turn = next;
    state.turnCount++;
    state.rolled = false; state.lastDoubles = false; state.lastRoll = null;
    state.jailChoice = false; state.pendingBuy = -1;
    var p = state.players[next];
    p.doubles = 0;
    if (p.inJail) state.jailChoice = true;
    checkGameOver(state, ev);
    if (!state.gameOver) ev.push("— " + pname(state, next) + "'s turn" + (p.inJail ? " (in jail)" : "") + " —");
    return ev;
  }

  /* ================= auctions ================= */
  function startAuction(state, sq) {
    var order = [], n = state.players.length;
    for (var i = 1; i <= n; i++) {
      var idx = (state.turn + i) % n;
      if (!state.players[idx].bankrupt) order.push(idx);
    }
    state.auction = { sq: sq, leader: -1, bid: 0, active: order.map(function () { return true; }), order: order, cursor: 0 };
    return ["🔨 Auction begins for " + BOARD[sq].name + " (min bid $10)."];
  }

  function auctionBidder(state) {
    var a = state.auction;
    if (!a) return -1;
    return a.order[a.cursor];
  }
  function auctionActiveCount(state) {
    var c = 0, a = state.auction;
    for (var i = 0; i < a.active.length; i++) if (a.active[i]) c++;
    return c;
  }
  function auctionAdvance(state) {
    var a = state.auction;
    for (var i = 0; i < a.order.length; i++) {
      a.cursor = (a.cursor + 1) % a.order.length;
      if (a.active[a.cursor]) break;
    }
  }
  function auctionMinBid(state) { return state.auction.bid > 0 ? state.auction.bid + 10 : 10; }

  function placeBid(state, pi, amt) {
    var a = state.auction, ev = [];
    if (!a) return ["No auction in progress."];
    amt = Math.floor(amt);
    if (a.order[a.cursor] !== pi) return ["It's not " + pname(state, pi) + "'s bid."];
    var min = auctionMinBid(state);
    if (amt < min) return ["Bid must be at least $" + min + "."];
    if (amt > state.players[pi].cash) return [pname(state, pi) + " doesn't have $" + amt + "."];
    a.bid = amt; a.leader = pi;
    ev.push(pname(state, pi) + " bids $" + amt + " for " + BOARD[a.sq].name + ".");
    auctionAdvance(state);
    if (auctionActiveCount(state) <= 1) ev = ev.concat(finishAuction(state));
    return ev;
  }

  function auctionPass(state, pi) {
    var a = state.auction, ev = [];
    if (!a) return ["No auction in progress."];
    if (a.order[a.cursor] !== pi) return ["It's not " + pname(state, pi) + "'s bid."];
    if (a.leader === pi) { ev.push(pname(state, pi) + " passes while leading — auction ends."); return ev.concat(finishAuction(state)); }
    a.active[a.cursor] = false;
    ev.push(pname(state, pi) + " passes.");
    auctionAdvance(state);
    if (auctionActiveCount(state) <= 1) ev = ev.concat(finishAuction(state));
    return ev;
  }

  function finishAuction(state) {
    var a = state.auction; state.auction = null;
    var ev = [];
    if (a.leader >= 0 && a.bid > 0) {
      var L = state.players[a.leader];
      L.cash -= a.bid;
      state.sqState[a.sq].owner = a.leader;
      ev.push("🔨 " + pname(state, a.leader) + " wins " + BOARD[a.sq].name + " for $" + a.bid + "!");
    } else ev.push("No bids — " + BOARD[a.sq].name + " remains unowned.");
    if (!state.gameOver && state.auctionQueue.length) ev = ev.concat(startAuction(state, state.auctionQueue.shift()));
    return ev;
  }

  function aiAuctionAct(state, pi) {
    var a = state.auction, p = state.players[pi], lv = p.level;
    var price = BOARD[a.sq].price;
    var valFactor = [0.6, 0.8, 1.0, 1.1, 1.2][lv];
    var completes = wouldCompleteGroup(state, pi, a.sq);
    var valuation = price * valFactor * (completes ? 1.5 : 1) * (0.95 + state.rng() * 0.1);
    var next = auctionMinBid(state);
    var maxPay = Math.max(0, p.cash - 20);
    if (next <= Math.min(valuation, maxPay)) return placeBid(state, pi, next);
    return auctionPass(state, pi);
  }

  /* ================= jail ================= */
  function completeJailExit(state, pi) {
    var p = state.players[pi];
    p.inJail = false; p.jailTurns = 0;
    state.jailChoice = false;
    var ev = [pname(state, pi) + " gets out of jail."];
    return ev.concat(rollMoveNoDoubles(state, pi));
  }

  function jailPayFine(state) {
    var pi = state.turn, p = state.players[pi], ev = [];
    if (!p.inJail) return ["Not in jail."];
    ev = ev.concat(chargePlayer(state, pi, 50, -1, "bail"));
    if (state.debt) { state.debtCont = { kind: "jailExit" }; return ev; }
    ev.push(pname(state, pi) + " pays $50 bail.");
    return ev.concat(completeJailExit(state, pi));
  }

  function jailUseCard(state) {
    var pi = state.turn, p = state.players[pi], ev = [];
    if (!p.inJail) return ["Not in jail."];
    var deckName = p.goojfChance > 0 ? "chance" : (p.goojfCC > 0 ? "cc" : null);
    if (!deckName) return ["No Get Out of Jail Free card."];
    if (deckName === "chance") { p.goojfChance--; state.chance.push(chanceGoojfIdx()); }
    else { p.goojfCC--; state.cc.push(chestGoojfIdx()); }
    ev.push(pname(state, pi) + " uses a Get Out of Jail Free card.");
    return ev.concat(completeJailExit(state, pi));
  }

  function jailRoll(state) {
    var pi = state.turn, p = state.players[pi], ev = [];
    if (!p.inJail) return ["Not in jail."];
    var d1 = 1 + Math.floor(state.rng() * 6), d2 = 1 + Math.floor(state.rng() * 6);
    state.lastRoll = [d1, d2]; state.rolled = true; state.lastDoubles = false;
    ev.push(pname(state, pi) + " rolls " + d1 + " + " + d2 + " for doubles.");
    if (d1 === d2) {
      ev.push("Doubles! " + pname(state, pi) + " gets out of jail.");
      p.inJail = false; p.jailTurns = 0; state.jailChoice = false;
      p.doubles = 0;
      return ev.concat(moveAndResolve(state, pi, d1 + d2));
    }
    p.jailTurns++;
    if (p.jailTurns >= 3) {
      ev.push("Third failed attempt — " + pname(state, pi) + " must pay $50 and move.");
      ev = ev.concat(chargePlayer(state, pi, 50, -1, "bail"));
      if (state.debt) { state.debtCont = { kind: "jailExit" }; return ev; }
      return ev.concat(completeJailExit(state, pi));
    }
    ev.push(pname(state, pi) + " stays in jail (" + p.jailTurns + "/3 attempts).");
    state.jailChoice = false;
    return ev;
  }

  function aiJailDecision(state) {
    var pi = state.turn, p = state.players[pi];
    var cards = p.goojfChance + p.goojfCC;
    if (cards > 0 && (p.jailTurns >= 1 || p.cash < 120)) return jailUseCard(state);
    if (p.cash >= 450 || (p.level >= 3 && p.cash >= 150)) return jailPayFine(state);
    return jailRoll(state);
  }

  /* ================= buildings ================= */
  function groupBuildings(state, sqIdx) {
    var g = GROUPS[groupOf(sqIdx)], out = [];
    for (var i = 0; i < g.length; i++) out.push(state.sqState[g[i]].bld);
    return out;
  }
  function groupHasMortgage(state, sqIdx) {
    var g = GROUPS[groupOf(sqIdx)];
    for (var i = 0; i < g.length; i++) if (state.sqState[g[i]].mortgaged) return true;
    return false;
  }
  function groupHasBuildings(state, sqIdx) {
    var g = GROUPS[groupOf(sqIdx)];
    for (var i = 0; i < g.length; i++) if (state.sqState[g[i]].bld > 0) return true;
    return false;
  }

  function canBuild(state, pi, sq) {
    var q = BOARD[sq], st = state.sqState[sq], p = state.players[pi];
    if (q.t !== "street") return { ok: false, reason: "Can only build on color streets." };
    if (st.owner !== pi) return { ok: false, reason: "You don't own it." };
    if (!ownsGroup(state, pi, sq)) return { ok: false, reason: "Need the full color group." };
    if (st.mortgaged || groupHasMortgage(state, sq)) return { ok: false, reason: "Group has a mortgaged property." };
    if (st.bld >= 5) return { ok: false, reason: "Already has a hotel." };
    var blds = groupBuildings(state, sq), mn = Math.min.apply(null, blds);
    if (st.bld > mn) return { ok: false, reason: "Must build evenly across the group." };
    var cost = q.house;
    if (p.cash < cost) return { ok: false, reason: "Need $" + cost + "." };
    if (st.bld === 4 && state.hotelsLeft <= 0) return { ok: false, reason: "No hotels left in supply." };
    if (st.bld < 4 && state.housesLeft <= 0) return { ok: false, reason: "No houses left in supply." };
    return { ok: true, cost: cost, hotel: st.bld === 4 };
  }

  function buildHouse(state, pi, sq) {
    var c = canBuild(state, pi, sq);
    if (!c.ok) return ["Can't build: " + c.reason];
    var st = state.sqState[sq], p = state.players[pi];
    p.cash -= c.cost;
    if (c.hotel) { st.bld = 5; state.hotelsLeft--; state.housesLeft += 4; }
    else { st.bld++; state.housesLeft--; }
    return [pname(state, pi) + " builds a " + (c.hotel ? "🏨 HOTEL" : "🏠 house") + " on " + BOARD[sq].name + " ($" + c.cost + ")."];
  }

  function canSellBuilding(state, pi, sq) {
    var q = BOARD[sq], st = state.sqState[sq];
    if (q.t !== "street") return { ok: false, reason: "No buildings here." };
    if (st.owner !== pi) return { ok: false, reason: "You don't own it." };
    if (st.bld <= 0) return { ok: false, reason: "No buildings to sell." };
    var blds = groupBuildings(state, sq), mx = Math.max.apply(null, blds);
    if (st.bld < mx) return { ok: false, reason: "Must sell evenly (from the most developed first)." };
    if (st.bld === 5 && state.housesLeft < 4) return { ok: false, reason: "Not enough houses in supply to break the hotel." };
    return { ok: true, refund: Math.floor((st.bld === 5 ? 5 : 1) * q.house / 2), hotel: st.bld === 5 };
  }

  function sellHouse(state, pi, sq) {
    var c = canSellBuilding(state, pi, sq);
    if (!c.ok) return ["Can't sell: " + c.reason];
    var st = state.sqState[sq], p = state.players[pi];
    p.cash += c.refund;
    if (c.hotel) { st.bld = 4; state.hotelsLeft++; state.housesLeft -= 4; }
    else { st.bld--; state.housesLeft++; }
    return [pname(state, pi) + " sells a " + (c.hotel ? "hotel" : "house") + " on " + BOARD[sq].name + " for $" + c.refund + "."];
  }

  /* ================= mortgages ================= */
  function canMortgage(state, pi, sq) {
    var st = state.sqState[sq], q = BOARD[sq];
    if (!BUYABLE[q.t]) return { ok: false, reason: "Can't mortgage this." };
    if (st.owner !== pi) return { ok: false, reason: "You don't own it." };
    if (st.mortgaged) return { ok: false, reason: "Already mortgaged." };
    if (q.t === "street" && groupHasBuildings(state, sq)) return { ok: false, reason: "Sell the group's buildings first." };
    return { ok: true, value: mortgageValue(sq) };
  }
  function mortgage(state, pi, sq) {
    var c = canMortgage(state, pi, sq);
    if (!c.ok) return ["Can't mortgage: " + c.reason];
    state.sqState[sq].mortgaged = true;
    state.players[pi].cash += c.value;
    return [pname(state, pi) + " mortgages " + BOARD[sq].name + " for $" + c.value + "."];
  }
  function canUnmortgage(state, pi, sq) {
    var st = state.sqState[sq];
    if (st.owner !== pi) return { ok: false, reason: "You don't own it." };
    if (!st.mortgaged) return { ok: false, reason: "Not mortgaged." };
    var cost = unmortgageCost(sq);
    if (state.players[pi].cash < cost) return { ok: false, reason: "Need $" + cost + "." };
    return { ok: true, cost: cost };
  }
  function unmortgage(state, pi, sq) {
    var c = canUnmortgage(state, pi, sq);
    if (!c.ok) return ["Can't unmortgage: " + c.reason];
    state.sqState[sq].mortgaged = false;
    state.players[pi].cash -= c.cost;
    return [pname(state, pi) + " unmortgages " + BOARD[sq].name + " for $" + c.cost + "."];
  }

  /* ================= trading ================= */
  function wouldCompleteGroup(state, pi, sq) {
    var q = BOARD[sq];
    if (q.t !== "street") return false;
    var g = GROUPS[q.group];
    for (var i = 0; i < g.length; i++) {
      if (g[i] === sq) continue;
      if (state.sqState[g[i]].owner !== pi) return false;
    }
    return true;
  }
  // Does `pi` currently hold a monopoly that includes sq (i.e. trading sq away breaks it)?
  function breaksOwnMonopoly(state, pi, sq) {
    var q = BOARD[sq];
    if (q.t !== "street") return false;
    return ownsGroup(state, pi, sq);
  }
  function tradeValueFor(state, props, cash, receiver) {
    var v = cash;
    for (var i = 0; i < props.length; i++) {
      var sq = props[i], b = BOARD[sq], st = state.sqState[sq];
      var mult = st.mortgaged ? 0.9 : 1;
      if (b.t === "street" && wouldCompleteGroup(state, receiver, sq)) mult *= 1.25;
      v += Math.round(b.price * mult);
    }
    return v;
  }

  var TRADE_MARGIN = [0.85, 0.95, 1.05, 1.15, 1.25];

  // trade = {from, to, offer:{cash,props}, request:{cash,props}}. Evaluated for `to`.
  function evaluateTrade(state, trade) {
    var to = trade.to, p = state.players[to], lv = p.level;
    var vReceive = tradeValueFor(state, trade.offer.props, trade.offer.cash, to);
    var vGive = tradeValueFor(state, trade.request.props, trade.request.cash, trade.from);
    // value of what `to` gives up, from its own perspective (no completion bonus on the way out)
    var vGiveOwn = trade.request.cash;
    for (var i = 0; i < trade.request.props.length; i++) {
      var sq = trade.request.props[i], st = state.sqState[sq];
      vGiveOwn += Math.round(BOARD[sq].price * (st.mortgaged ? 0.9 : 1));
    }
    var breaks = false;
    for (var j = 0; j < trade.request.props.length; j++)
      if (breaksOwnMonopoly(state, to, trade.request.props[j])) { breaks = true; break; }
    var margin = TRADE_MARGIN[clampInt(lv, 0, 4)] * (0.95 + state.rng() * 0.1);
    if (breaks) {
      if (vReceive >= vGiveOwn * 2) return { accept: true, reason: "huge overpay for a monopoly piece" };
      return { accept: false, reason: "won't break up a monopoly for that" };
    }
    if (vReceive >= vGiveOwn * margin) return { accept: true, reason: "fair deal" };
    return { accept: false, reason: "not enough value ($" + vReceive + " vs $" + Math.round(vGiveOwn * margin) + " wanted)" };
  }

  function validateTrade(state, trade) {
    var from = state.players[trade.from], to = state.players[trade.to];
    if (!from || !to) return "Unknown player.";
    if (trade.from === trade.to) return "Can't trade with yourself.";
    if (from.bankrupt || to.bankrupt) return "Can't trade with a bankrupt player.";
    var seen = {};
    function checkProps(props, owner, who) {
      for (var i = 0; i < props.length; i++) {
        var sq = props[i];
        if (seen[sq]) return "Duplicate property.";
        seen[sq] = 1;
        if (!BUYABLE[BOARD[sq].t]) return BOARD[sq].name + " isn't tradable.";
        if (state.sqState[sq].owner !== owner) return who + " doesn't own " + BOARD[sq].name + ".";
        if (state.sqState[sq].bld > 0) return BOARD[sq].name + " has buildings — sell them first.";
      }
      return null;
    }
    var e = checkProps(trade.offer.props, trade.from, pname(state, trade.from)) ||
            checkProps(trade.request.props, trade.to, pname(state, trade.to));
    if (e) return e;
    if (trade.offer.cash < 0 || trade.request.cash < 0) return "Cash can't be negative.";
    if (trade.offer.cash > from.cash) return pname(state, trade.from) + " doesn't have $" + trade.offer.cash + ".";
    if (trade.request.cash > to.cash) return pname(state, trade.to) + " doesn't have $" + trade.request.cash + ".";
    if (!trade.offer.props.length && !trade.offer.cash && !trade.request.props.length && !trade.request.cash)
      return "Empty trade.";
    // mortgaged properties changing hands: receiver pays 10% interest to the bank immediately
    function interestDue(props, receiverCashAfter) {
      var due = 0;
      for (var i = 0; i < props.length; i++)
        if (state.sqState[props[i]].mortgaged) due += Math.ceil(mortgageValue(props[i]) * 0.1);
      return due;
    }
    var toCashAfter = to.cash + trade.offer.cash - trade.request.cash;
    var fromCashAfter = from.cash + trade.request.cash - trade.offer.cash;
    if (toCashAfter < interestDue(trade.offer.props)) return pname(state, trade.to) + " couldn't cover the mortgage interest.";
    if (fromCashAfter < interestDue(trade.request.props)) return pname(state, trade.from) + " couldn't cover the mortgage interest.";
    return null;
  }

  function applyTrade(state) {
    var tr = state.pendingTrade, ev = [];
    if (!tr) return ["No trade pending."];
    var err = validateTrade(state, tr);
    if (err) { state.pendingTrade = null; return ["Trade invalid: " + err]; }
    var from = state.players[tr.from], to = state.players[tr.to];
    function moveProps(props, destIdx, destName) {
      for (var i = 0; i < props.length; i++) {
        var sq = props[i];
        state.sqState[sq].owner = destIdx;
        if (state.sqState[sq].mortgaged) {
          var interest = Math.ceil(mortgageValue(sq) * 0.1);
          state.players[destIdx].cash -= interest;
          ev.push(destName + " pays $" + interest + " mortgage interest on " + BOARD[sq].name + ".");
        }
      }
    }
    from.cash -= tr.offer.cash; to.cash += tr.offer.cash;
    to.cash -= tr.request.cash; from.cash += tr.request.cash;
    moveProps(tr.offer.props, tr.to, pname(state, tr.to));
    moveProps(tr.request.props, tr.from, pname(state, tr.from));
    function list(props) { return props.map(function (s) { return BOARD[s].name; }).join(", "); }
    ev.unshift("🤝 Trade: " + pname(state, tr.from) + " gives " + (tr.offer.cash ? "$" + tr.offer.cash + " " : "") + list(tr.offer.props) +
      " to " + pname(state, tr.to) + " for " + (tr.request.cash ? "$" + tr.request.cash + " " : "") + list(tr.request.props) + ".");
    state.pendingTrade = null;
    return ev;
  }

  // Human (or engine) proposes. If the target is AI it answers immediately.
  function proposeTrade(state, from, to, offer, request) {
    var trade = { from: from, to: to, offer: offer, request: request };
    var err = validateTrade(state, trade);
    if (err) return ["Trade invalid: " + err];
    var ev = [pname(state, from) + " proposes a trade to " + pname(state, to) + "."];
    state.pendingTrade = trade;
    if (state.players[to].isAI) {
      var r = evaluateTrade(state, trade);
      if (r.accept) ev = ev.concat(applyTrade(state));
      else { state.pendingTrade = null; ev.push(pname(state, to) + " declines (" + r.reason + ")."); }
    }
    return ev;
  }

  function respondTrade(state, accept) {
    var tr = state.pendingTrade;
    if (!tr) return ["No trade pending."];
    if (accept) return applyTrade(state);
    state.pendingTrade = null;
    return [pname(state, tr.to) + " declines the trade."];
  }

  /* ================= AI ================= */
  var AI_RESERVE = [0, 80, 200, 300, 400];

  function aiWantsBuy(state, pi, sq) {
    var p = state.players[pi], lv = p.level, price = BOARD[sq].price;
    if (p.cash < price) return false;
    if (wouldCompleteGroup(state, pi, sq)) return p.cash - price >= 50; // always grab monopoly pieces
    if (lv === 0) return state.rng() < 0.5; // Beginner: ~50% random
    return p.cash - price >= AI_RESERVE[lv];
  }

  function aiBuyDecision(state, pi, sq) {
    if (aiWantsBuy(state, pi, sq)) {
      state.pendingBuy = -1;
      return buyPropertyAt(state, pi, sq);
    }
    return startAuction(state, sq);
  }

  function aiBuildChoice(state, pi) {
    var p = state.players[pi], lv = p.level;
    if (lv === 0) return -1; // Beginner never builds
    var reserve = AI_RESERVE[lv];
    var cands = [];
    var sqs = ownedSquares(state, pi);
    for (var i = 0; i < sqs.length; i++) {
      var sq = sqs[i];
      if (BOARD[sq].t !== "street") continue;
      var c = canBuild(state, pi, sq);
      if (!c.ok) continue;
      if (p.cash - c.cost < reserve) continue;
      var st = state.sqState[sq];
      var gain = BOARD[sq].rent[st.bld >= 4 ? 5 : st.bld + 1] - BOARD[sq].rent[st.bld];
      cands.push({ sq: sq, cost: c.cost, score: gain / c.cost });
    }
    if (!cands.length) return -1;
    cands.sort(function (a, b) { return b.score - a.score; });
    if (lv === 1) { // Easy: rarely builds
      if (state.rng() < 0.25 && p.cash - cands[0].cost > 150) return cands[0].sq;
      return -1;
    }
    if (lv === 2 && p.cash < cands[0].cost * 2 + reserve) return -1; // Medium wants 2+ houses affordable
    return cands[0].sq;
  }

  function aiUnmortgageChoice(state, pi) {
    var p = state.players[pi], reserve = AI_RESERVE[p.level] * 1.5, best = -1, bestScore = -1;
    var sqs = ownedSquares(state, pi);
    for (var i = 0; i < sqs.length; i++) {
      var sq = sqs[i];
      if (!state.sqState[sq].mortgaged) continue;
      var cost = unmortgageCost(sq);
      if (p.cash - cost < reserve) continue;
      var score = BOARD[sq].price + (ownsGroup(state, pi, sq) ? 500 : 0);
      if (score > bestScore) { bestScore = score; best = sq; }
    }
    return best;
  }

  function aiSellChoice(state, pi) {
    // sell one building from the most-developed property (keeps building even)
    var best = -1, bestBld = 0, bestPrice = -1;
    var sqs = ownedSquares(state, pi);
    for (var i = 0; i < sqs.length; i++) {
      var sq = sqs[i];
      var c = canSellBuilding(state, pi, sq);
      if (!c.ok) continue;
      var b = state.sqState[sq].bld;
      if (b > bestBld || (b === bestBld && BOARD[sq].price > bestPrice)) { bestBld = b; bestPrice = BOARD[sq].price; best = sq; }
    }
    return best;
  }

  function aiMortgageChoice(state, pi) {
    // mortgage the least valuable eligible property
    var best = -1, bestPrice = Infinity;
    var sqs = ownedSquares(state, pi);
    for (var i = 0; i < sqs.length; i++) {
      var sq = sqs[i];
      if (!canMortgage(state, pi, sq).ok) continue;
      if (BOARD[sq].price < bestPrice) { bestPrice = BOARD[sq].price; best = sq; }
    }
    return best;
  }

  function aiRaiseFundsStep(state) {
    var d = state.debt;
    if (!d) return [];
    var pi = d.player, p = state.players[pi];
    if (p.cash >= d.amount) { state.debt = null; p.cash -= d.amount; if (d.creditor >= 0) state.players[d.creditor].cash += d.amount;
      var ev0 = [pname(state, pi) + " pays $" + d.amount + " debt in full."];
      var cont = state.debtCont; state.debtCont = null;
      if (cont) ev0 = ev0.concat(resumeCardCont(state, cont, pi));
      return ev0; }
    var s = aiSellChoice(state, pi);
    if (s >= 0) return sellHouse(state, pi, s);
    var m = aiMortgageChoice(state, pi);
    if (m >= 0) return mortgage(state, pi, m);
    return declareBankruptcy(state);
  }

  function aiFindTradeProposal(state, pi) {
    var p = state.players[pi], lv = p.level, reserve = AI_RESERVE[lv];
    var groups = ["brown", "lblue", "pink", "orange", "red", "yellow", "green", "blue"];
    for (var gi = 0; gi < groups.length; gi++) {
      var g = GROUPS[groups[gi]], missing = -1, mine = 0;
      for (var i = 0; i < g.length; i++) {
        var o = state.sqState[g[i]].owner;
        if (o === pi) mine++;
        else if (missing === -1) missing = g[i];
        else { missing = -2; break; } // more than one missing
      }
      if (missing < 0 || mine !== g.length - 1) continue;
      var q = state.sqState[missing].owner;
      if (q < 0 || q === pi || state.players[q].bankrupt) continue;
      if (state.sqState[missing].bld > 0) continue;
      var offer = Math.ceil(BOARD[missing].price * (1.2 + 0.15 * lv));
      if (p.cash - offer >= reserve) return { to: q, sq: missing, offer: offer };
    }
    return null;
  }

  function aiManageStep(state, pi) {
    var p = state.players[pi], lv = p.level;
    // 1) propose a trade completing a monopoly (Medium+)
    if (lv >= 2 && !state.pendingTrade && (state.turnCount - p.lastTradeProp) >= 3) {
      var prop = aiFindTradeProposal(state, pi);
      if (prop) {
        p.lastTradeProp = state.turnCount;
        return proposeTrade(state, pi, prop.to, { cash: prop.offer, props: [] }, { cash: 0, props: [prop.sq] });
      }
    }
    // 2) build
    var b = aiBuildChoice(state, pi);
    if (b >= 0) return buildHouse(state, pi, b);
    // 3) unmortgage when flush
    var um = aiUnmortgageChoice(state, pi);
    if (um >= 0) return unmortgage(state, pi, um);
    return null;
  }

  /**
   * One atomic AI action. Returns event strings (possibly empty when it is a
   * human's decision point). Never blocks: safe to call in a loop.
   */
  function aiStep(state) {
    if (state.gameOver) return [];
    // 1) AI debt resolution (whoever's debt it is)
    if (state.debt) {
      if (state.players[state.debt.player].isAI) return aiRaiseFundsStep(state);
      return [];
    }
    // 2) auction: AI bidder acts
    if (state.auction) {
      var b = auctionBidder(state);
      if (b >= 0 && state.players[b].isAI) return aiAuctionAct(state, b);
      return [];
    }
    // 3) pending trade aimed at an AI
    if (state.pendingTrade) {
      var tt = state.pendingTrade.to;
      if (state.players[tt].isAI) {
        var r = evaluateTrade(state, state.pendingTrade);
        if (r.accept) return applyTrade(state);
        state.pendingTrade = null;
        return [pname(state, tt) + " declines the trade (" + r.reason + ")."];
      }
      return [];
    }
    var pi = state.turn, p = state.players[pi];
    if (p.bankrupt) return endTurn(state);
    // 4) jail choice
    if (state.jailChoice && p.inJail) {
      if (p.isAI) return aiJailDecision(state);
      return [];
    }
    // 5) buy decision on unowned landing
    if (state.pendingBuy >= 0) {
      if (p.isAI) return aiBuyDecision(state, pi, state.pendingBuy);
      return [];
    }
    if (!p.isAI) return [];
    // 6) AI turn proper
    if (!state.rolled) {
      var m = aiManageStep(state, pi);
      if (m) return m;
      return rollDice(state);
    }
    if (state.lastDoubles && !state.debt && !state.gameOver && state.pendingBuy < 0 && !state.auction && !state.jailChoice && !p.inJail)
      return rollDice(state);
    return endTurn(state);
  }

  /* ================= headless simulation ================= */
  function simulate(numAI, levels, seed, maxTurns) {
    maxTurns = maxTurns || 2000;
    var rng = mulberry32((seed >>> 0) || 1);
    var n = clampInt(numAI === undefined ? 1 : numAI, 0, 3) + 1;
    var lvls = [];
    var fallback = (levels && levels.length) ? clampInt(levels[levels.length - 1], 0, 4) : 2;
    for (var i = 0; i < n; i++)
      lvls.push(levels && levels[i] !== undefined ? clampInt(levels[i], 0, 4) : fallback);
    var state = baseNewGame(n, rng, lvls);
    var log = [], guard = 0, maxSteps = maxTurns * 60;
    while (!state.gameOver && state.turnCount < maxTurns && guard < maxSteps) {
      guard++;
      var ev = aiStep(state);
      for (var i = 0; i < ev.length; i++) { if (log.length < 500) log.push(ev[i]); }
    }
    var winner = -1;
    if (state.gameOver) winner = state.winner;
    else {
      var best = -1, bv = -1;
      for (var p = 0; p < state.players.length; p++) {
        if (state.players[p].bankrupt) continue;
        var v = playerNetWorth(state, p);
        if (v > bv) { bv = v; best = p; }
      }
      winner = best;
    }
    return { winner: winner, turns: state.turnCount, log: log, gameOver: state.gameOver };
  }

  /* ================= export ================= */
  var api = {
    BOARD: BOARD, GROUPS: GROUPS, CHANCE: CHANCE, CHEST: CHEST,
    RAIL_RENT: RAIL_RENT, TRADE_MARGIN: TRADE_MARGIN, AI_RESERVE: AI_RESERVE,
    newGame: newGame, simulate: simulate, aiStep: aiStep,
    rollDice: rollDice, buyProperty: buyProperty, declineBuy: declineBuy,
    buyPropertyAt: buyPropertyAt, endTurn: endTurn,
    startAuction: startAuction, placeBid: placeBid, auctionPass: auctionPass,
    auctionBidder: auctionBidder, auctionMinBid: auctionMinBid, finishAuction: finishAuction,
    jailPayFine: jailPayFine, jailUseCard: jailUseCard, jailRoll: jailRoll,
    sendToJail: sendToJail,
    canBuild: canBuild, buildHouse: buildHouse,
    canSellBuilding: canSellBuilding, sellHouse: sellHouse,
    canMortgage: canMortgage, mortgage: mortgage,
    canUnmortgage: canUnmortgage, unmortgage: unmortgage,
    chargePlayer: chargePlayer, payDebt: payDebt, declareBankruptcy: declareBankruptcy,
    proposeTrade: proposeTrade, respondTrade: respondTrade,
    evaluateTrade: evaluateTrade, applyTrade: applyTrade,
    rentFor: rentFor, ownsGroup: ownsGroup, ownedSquares: ownedSquares,
    wouldCompleteGroup: wouldCompleteGroup, breaksOwnMonopoly: breaksOwnMonopoly,
    mortgageValue: mortgageValue, unmortgageCost: unmortgageCost,
    countBuildings: countBuildings, playerNetWorth: playerNetWorth,
    solventPlayers: solventPlayers, checkGameOver: checkGameOver
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Monopoly = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
