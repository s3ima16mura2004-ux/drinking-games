/***********************************************
  宴会ブラックジャック - プレイヤー用ロジック
  自分の手札だけを表示し、操作は rooms/{code}/actions への
  リクエスト送信という形でホストに伝える(自分では状態を書き換えない)
************************************************/

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, addDoc, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const el = (id) => document.getElementById(id);

let roomCode = null;
let roomRef = null;
let myId = null;
let myName = "";

let roomState = null;      // rooms/{code} の最新データ
let playersData = {};      // { playerId: {name, cards, status, ...} }
let eventTickHandle = null;
let lastKnownStatus = null;
let omikujiTapped = false;

/***********************************************
  1.初期化
************************************************/

window.addEventListener("load", () => {
  el("btnJoin").addEventListener("click", joinRoom);
  el("btnHit").addEventListener("click", () => sendAction("hit"));
  el("btnStand").addEventListener("click", () => sendAction("stand"));
  el("btnJoker").addEventListener("click", () => sendAction("joker"));
  el("btnSwap").addEventListener("click", openSwapModal);
  el("btnSwapCancel").addEventListener("click", closeSwapModal);
  el("btnEventSuccess").addEventListener("click", () => sendAction("eventResult", { success: true }));
  el("btnEventFail").addEventListener("click", () => sendAction("eventResult", { success: false }));
  el("omikujiBox").addEventListener("click", tapOmikuji);

  //入力補助:ルームコードは自動で大文字に
  el("inputRoomCode").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("screen--active"));
  el(id).classList.add("screen--active");
}

function showJoinError(message) {
  const errEl = el("joinError");
  errEl.textContent = message;
  errEl.classList.remove("hidden");
}

/***********************************************
  2.参加処理
************************************************/

async function joinRoom() {
  const code = el("inputRoomCode").value.trim().toUpperCase();
  const name = el("inputName").value.trim();
  el("joinError").classList.add("hidden");

  if (code.length !== 4) { showJoinError("ルームコードは4文字です。"); return; }
  if (!name) { showJoinError("名前を入力してください。"); return; }

  const ref = doc(db, "rooms", code);
  const snap = await getDoc(ref);
  if (!snap.exists()) { showJoinError("そのルームは見つかりませんでした。コードを確認してください。"); return; }
  if (snap.data().status !== "lobby") { showJoinError("このルームはすでにゲームが始まっています。"); return; }

  roomCode = code;
  roomRef = ref;
  myName = name;

  //同じ端末での再参加を許容するため、ルームごとにIDを保持しておく
  const storageKey = `bj_party_playerId_${roomCode}`;
  myId = localStorage.getItem(storageKey);
  if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem(storageKey, myId);
  }

  await setDoc(doc(roomRef, "players", myId), {
    name: myName,
    joinedAt: Date.now(),
    cards: [], status: "waiting", joker: false, immunity: false,
    swapToken: false, outcome: null, penaltyText: null,
  }, { merge: true });

  subscribeRoom();
  subscribePlayers();
  showScreen("screen-waiting");
}

/***********************************************
  3.購読
************************************************/

function subscribeRoom() {
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    roomState = snap.data();
    render();
  });
}

function subscribePlayers() {
  onSnapshot(collection(roomRef, "players"), (snap) => {
    playersData = {};
    snap.forEach((d) => { playersData[d.id] = d.data(); });
    render();
  });
}

/***********************************************
  4.アクション送信
************************************************/

async function sendAction(type, payload) {
  await addDoc(collection(roomRef, "actions"), {
    type, playerId: myId, payload: payload || {}, ts: Date.now(),
  });
}

/***********************************************
  5.交換チケットモーダル
************************************************/

function openSwapModal() {
  const me = playersData[myId];
  if (!me || !me.swapToken) return;
  const wrap = el("swapTargets");
  wrap.innerHTML = "";
  Object.keys(playersData).forEach((pid) => {
    if (pid === myId) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = `${playersData[pid].name} と交換する`;
    btn.addEventListener("click", () => {
      sendAction("swap", { targetId: pid });
      closeSwapModal();
    });
    wrap.appendChild(btn);
  });
  el("modalSwap").classList.remove("hidden");
}

function closeSwapModal() {
  el("modalSwap").classList.add("hidden");
}

/***********************************************
  6.罰ゲームみくじ
************************************************/

function tapOmikuji() {
  if (omikujiTapped) return;
  omikujiTapped = true;
  const box = el("omikujiBox");
  box.classList.add("is-shaking");
  sendAction("penaltyDraw");
  setTimeout(() => {
    box.classList.add("hidden");
    renderPenaltyResult();
  }, 600);
}

function renderPenaltyResult() {
  const me = playersData[myId];
  if (me && me.penaltyText) {
    const resultEl = el("penaltyResult");
    resultEl.textContent = me.penaltyText;
    resultEl.classList.remove("hidden");
  } else {
    //まだホストが処理中の場合は少し待って再表示
    setTimeout(renderPenaltyResult, 400);
  }
}

/***********************************************
  7.描画
************************************************/

function getTotal(cardsArr) {
  let total = 0;
  let hasAce = false;
  for (const card of cardsArr) {
    const number = card % 13;
    if (number === 11 || number === 12 || number === 0) total += 10;
    else if (number === 1) { total += 1; hasAce = true; }
    else total += number;
  }
  if (hasAce && total + 10 <= 21) total += 10;
  return total;
}

function getCardPath(card) {
  return card <= 9 ? `0${card}.png` : `${card}.png`;
}

function renderCardRow(elId, cardsArr) {
  const wrap = el(elId);
  wrap.innerHTML = "";
  (cardsArr || []).forEach((c) => {
    const img = document.createElement("img");
    img.src = getCardPath(c);
    img.alt = "";
    wrap.appendChild(img);
  });
}

function render() {
  if (!roomState) return;

  if (roomState.status === "lobby") {
    showScreen("screen-waiting");
    const list = el("waitingPlayerList");
    list.innerHTML = "";
    Object.values(playersData).forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "player-chip";
      chip.textContent = p.name;
      list.appendChild(chip);
    });
    lastKnownStatus = "lobby";
    return;
  }

  //ラウンドが切り替わったらみくじの状態をリセットする
  if (lastKnownStatus === "result" && roomState.status === "playing") {
    omikujiTapped = false;
    el("omikujiBox").classList.remove("hidden");
    el("penaltyResult").classList.add("hidden");
  }
  lastKnownStatus = roomState.status;

  if (roomState.status === "result") {
    renderResult();
    return;
  }

  //ゲーム進行画面
  showScreen("screen-game");
  el("roundLabel").textContent = `ラウンド ${roomState.round}`;

  const activePid = roomState.order[roomState.currentIndex];
  const isMyTurn = activePid === myId;
  el("turnLabel").textContent = isMyTurn ? "あなたの番です!" : (activePid ? `手番: ${playersData[activePid]?.name || ""} さん` : "ディーラーの番です…");

  el("dealerTotal").textContent = getTotal(roomState.dealer.cards);
  renderCardRow("dealerCards", roomState.dealer.cards);

  const me = playersData[myId] || { cards: [], status: "waiting", joker: false, immunity: false, swapToken: false };
  renderCardRow("myCards", me.cards);
  el("myTotal").textContent = getTotal(me.cards);
  el("myName").textContent = isMyTurn ? "あなたの手札(あなたの番です)" : "あなたの手札";

  const badges = el("myBadges");
  badges.innerHTML = "";
  if (me.joker) badges.innerHTML += `<span class="badge" title="ジョーカー">🎭</span>`;
  if (me.immunity) badges.innerHTML += `<span class="badge" title="御守り">🛡</span>`;
  if (me.swapToken) badges.innerHTML += `<span class="badge" title="交換チケット">🔄</span>`;

  const canAct = me.status === "active";
  el("btnHit").disabled = !canAct || me.cards.length >= 5;
  el("btnStand").disabled = !canAct;
  el("btnJoker").classList.toggle("hidden", !(canAct && me.joker));
  el("btnSwap").classList.toggle("hidden", !(canAct && me.swapToken));

  renderEventBanner();
  renderOtherPlayers(activePid);
}

function renderEventBanner() {
  const banner = el("eventBanner");
  const ownActions = el("eventOwnActions");
  if (!roomState.activeEvent) {
    banner.classList.add("hidden");
    clearInterval(eventTickHandle);
    return;
  }
  banner.classList.remove("hidden");
  const isMine = roomState.activeEvent.playerId === myId;
  const targetName = playersData[roomState.activeEvent.playerId]?.name || "";
  el("eventBannerTarget").textContent = isMine ? "あなたの挑戦タイム!" : `${targetName} さんの挑戦タイム`;
  el("eventBannerText").textContent = roomState.activeEvent.text;
  ownActions.classList.toggle("hidden", !isMine);

  clearInterval(eventTickHandle);
  const tick = () => {
    const elapsed = Math.floor((Date.now() - roomState.activeEvent.startedAt) / 1000);
    const remaining = Math.max(0, roomState.activeEvent.durationSec - elapsed);
    el("eventBannerTimer").textContent = remaining;
  };
  tick();
  eventTickHandle = setInterval(tick, 1000);
}

function renderOtherPlayers(activePid) {
  const list = el("otherPlayersList");
  list.innerHTML = "";
  roomState.order.forEach((pid) => {
    if (pid === myId) return;
    const p = playersData[pid];
    if (!p) return;
    const statusText = {
      waiting: "順番待ち", active: "手番中", stand: "勝負済み", bust: "バースト", skip: "1回休み予定",
    }[p.status] || p.status;
    const li = document.createElement("li");
    if (pid === activePid) li.classList.add("is-active");
    li.innerHTML = `<span>${p.name}</span><span>${statusText} ・ 合計 ${getTotal(p.cards)}</span>`;
    list.appendChild(li);
  });
}

function renderResult() {
  showScreen("screen-result");
  el("resultDealerTotal").textContent = getTotal(roomState.dealer.cards);

  const me = playersData[myId];
  const outcomeLabel = { win: "🎉 あなたの勝ちです!", lose: "😢 あなたの負けです…", draw: "🤝 引き分けです" }[me?.outcome] || "";
  el("myOutcome").textContent = `${outcomeLabel}(あなたの合計: ${getTotal(me?.cards)})`;

  const penaltyArea = el("penaltyArea");
  if (me?.outcome === "lose") {
    penaltyArea.classList.remove("hidden");
    if (me.penaltyText) {
      el("omikujiBox").classList.add("hidden");
      el("penaltyResult").textContent = me.penaltyText;
      el("penaltyResult").classList.remove("hidden");
    }
  } else {
    penaltyArea.classList.add("hidden");
  }
}
