// ============================================================
// 🌐 複数端末オンライン対戦モード（Firebase Firestore）
// ------------------------------------------------------------
// ・script.js の cardValuesPool / rewards / penalties /
//   getRecommendedPairCount / playSound / speak / vibrate を
//   そのまま再利用しています（script.js が先に読み込まれている前提）。
// ・「今の手番のプレイヤーの端末」だけが盤面をFirestoreに書き込み、
//   他の端末は読み取り専用でミラー表示する設計です。
//   これにより複数端末が同時に書き込んでぶつかる事故をほぼ防いでいます。
// ・値（絵文字）はFirestoreドキュメントにそのまま入っているため、
//   ブラウザの開発者ツールを見れば裏側の値が分かってしまいます。
//   身内の飲み会用ゲームとして割り切った実装です。
// ============================================================

const ROOM_COLLECTION = "shinkei_rooms";
const ALL_SCREENS = ["modeSelectScreen", "setupScreen", "gameScreen", "onlineEntryScreen", "waitingRoomScreen", "onlineGameScreen"];

let roomCode = null;
let myPlayerId = null;
let myName = "";
let isHost = false;
let roomUnsubscribe = null;
let latestRoomState = null;
let onlineTurnDuration = 10;
let onlineCountdownInterval = null;
let handlingTimeout = false;

// ---------- 画面切り替え ----------
function showScreen(id) {
    ALL_SCREENS.forEach(s => {
        document.getElementById(s).style.display = (s === id) ? "block" : "none";
    });
}

function goToOfflineSetup() {
    showScreen("setupScreen");
}

function goToOnlineEntry() {
    document.getElementById("onlineEntryError").innerText = "";
    showScreen("onlineEntryScreen");
}

function backToModeSelect() {
    leaveRoomCleanup();
    showScreen("modeSelectScreen");
}

function switchOnlineTab(tab) {
    const createBtn = document.getElementById("createTabBtn");
    const joinBtn = document.getElementById("joinTabBtn");
    const createPanel = document.getElementById("createTabPanel");
    const joinPanel = document.getElementById("joinTabPanel");
    if (tab === "create") {
        createBtn.classList.add("active");
        joinBtn.classList.remove("active");
        createPanel.style.display = "block";
        joinPanel.style.display = "none";
    } else {
        joinBtn.classList.add("active");
        createBtn.classList.remove("active");
        joinPanel.style.display = "block";
        createPanel.style.display = "none";
    }
    document.getElementById("onlineEntryError").innerText = "";
}

function showOnlineError(msg) {
    const el = document.getElementById("onlineEntryError");
    const entryScreen = document.getElementById("onlineEntryScreen");
    if (el && entryScreen.style.display !== "none") {
        el.innerText = msg;
    } else {
        alert(msg);
    }
}

// ---------- ID・ルームコード生成 ----------
function generateId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function generateRoomCode() {
    // 紛らわしい文字（0/O, 1/I）を除いた文字セット
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// ---------- ルーム作成・参加 ----------
function createRoom() {
    myName = document.getElementById("onlineMyName").value.trim() || "ホスト";
    myPlayerId = generateId();
    roomCode = generateRoomCode();
    isHost = true;
    onlineTurnDuration = 10;

    const roomData = {
        hostId: myPlayerId,
        status: "waiting",
        players: [{ id: myPlayerId, name: myName, score: 0, combo: 0 }],
        pairCount: 4,
        turnDuration: 10,
        currentTurnIndex: 0,
        cards: [],
        flippedIndices: [],
        matchedCount: 0,
        eventMessage: "参加者を待っています…",
        eventColor: "#aaa",
        turnEndsAt: null,
        createdAt: Date.now()
    };

    db.collection(ROOM_COLLECTION).doc(roomCode).set(roomData).then(() => {
        subscribeToRoom();
        document.getElementById("roomCodeDisplay").innerText = roomCode;
        showScreen("waitingRoomScreen");
    }).catch(() => {
        showOnlineError("ルーム作成に失敗しました。firebase-config.js の設定を確認してください。");
    });
}

function joinRoom() {
    myName = document.getElementById("onlineMyName").value.trim() || "ゲスト";
    const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();

    if (!/^[A-Z0-9]{5}$/.test(code)) {
        showOnlineError("ルームコードは5文字の英数字で入力してください。");
        return;
    }

    myPlayerId = generateId();
    roomCode = code;
    isHost = false;

    const roomRef = db.collection(ROOM_COLLECTION).doc(roomCode);
    db.runTransaction(tx => {
        return tx.get(roomRef).then(doc => {
            if (!doc.exists) throw new Error("NOT_FOUND");
            const data = doc.data();
            if (data.status !== "waiting") throw new Error("ALREADY_STARTED");
            if (data.players.length >= 6) throw new Error("ROOM_FULL");
            const updatedPlayers = [...data.players, { id: myPlayerId, name: myName, score: 0, combo: 0 }];
            tx.update(roomRef, { players: updatedPlayers });
        });
    }).then(() => {
        subscribeToRoom();
        document.getElementById("roomCodeDisplay").innerText = roomCode;
        showScreen("waitingRoomScreen");
    }).catch(err => {
        let msg = "参加に失敗しました。もう一度お試しください。";
        if (err.message === "NOT_FOUND") msg = "そのルームコードは見つかりませんでした。";
        else if (err.message === "ALREADY_STARTED") msg = "そのルームはすでにゲームが始まっています。";
        else if (err.message === "ROOM_FULL") msg = "そのルームは満員です（最大6人）。";
        showOnlineError(msg);
    });
}

function leaveRoom() {
    leaveRoomCleanup();
    showScreen("modeSelectScreen");
}

function leaveRoomCleanup() {
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }
    if (onlineCountdownInterval) {
        clearInterval(onlineCountdownInterval);
        onlineCountdownInterval = null;
    }
    window.speechSynthesis.cancel();
    roomCode = null;
    latestRoomState = null;
    isHost = false;
}

// ---------- リアルタイム購読 ----------
function subscribeToRoom() {
    if (roomUnsubscribe) roomUnsubscribe();
    roomUnsubscribe = db.collection(ROOM_COLLECTION).doc(roomCode)
        .onSnapshot(handleRoomSnapshot, () => {
            showOnlineError("通信エラーが発生しました。電波状況を確認してください。");
        });
}

function handleRoomSnapshot(doc) {
    if (!doc.exists) {
        showOnlineError("ルームが見つかりませんでした（解散された可能性があります）。");
        backToModeSelect();
        return;
    }
    const data = doc.data();
    const previousState = latestRoomState;
    latestRoomState = data;

    if (data.status === "waiting") {
        renderWaitingRoom(data);
    } else if (data.status === "playing") {
        if (document.getElementById("onlineGameScreen").style.display === "none") {
            showScreen("onlineGameScreen");
            document.getElementById("onlineRoomCodeDisplay").innerText = roomCode;
            document.getElementById("onlineResultActions").style.display = "none";
        }
        renderOnlineGame(data, previousState);
    } else if (data.status === "finished") {
        renderOnlineGame(data, previousState);
        showOnlineResult(data);
    }
}

// ---------- 待機ルーム ----------
function renderWaitingRoom(data) {
    const list = document.getElementById("waitingPlayerList");
    list.innerHTML = "";
    data.players.forEach((p, idx) => {
        let li = document.createElement("li");
        li.className = "player-list-item";
        li.innerText = (idx === 0 ? "👑 " : "") + p.name;
        list.appendChild(li);
    });

    isHost = !!(data.players[0] && data.players[0].id === myPlayerId);
    document.getElementById("startOnlineGameBtn").style.display = isHost ? "block" : "none";
    document.getElementById("waitingForHostText").style.display = isHost ? "none" : "block";
    document.getElementById("hostSettingsGroup").style.display = isHost ? "block" : "none";
}

function setOnlineTimerDuration(seconds, btnElement) {
    if (!isHost) return;
    onlineTurnDuration = seconds;
    document.querySelectorAll("#waitingRoomScreen .timer-btn").forEach(btn => btn.classList.remove("active"));
    btnElement.classList.add("active");
    db.collection(ROOM_COLLECTION).doc(roomCode).update({ turnDuration: seconds }).catch(() => {});
}

function startOnlineGame() {
    if (!latestRoomState || !isHost) return;
    const players = latestRoomState.players;
    const pairCount = getRecommendedPairCount(players.length);
    const cards = buildOnlineDeck(pairCount);
    const turnDuration = latestRoomState.turnDuration || 10;

    db.collection(ROOM_COLLECTION).doc(roomCode).update({
        status: "playing",
        pairCount: pairCount,
        cards: cards,
        currentTurnIndex: 0,
        flippedIndices: [],
        matchedCount: 0,
        players: players.map(p => ({ ...p, score: 0, combo: 0 })),
        eventMessage: "カードをめくってね",
        eventColor: "#aaa",
        turnEndsAt: Date.now() + turnDuration * 1000
    }).catch(() => showOnlineError("ゲーム開始に失敗しました。"));
}

// ---------- デッキ作成（script.js の cardValuesPool を再利用） ----------
function buildOnlineDeck(pairCount) {
    let specialPairs = ['💣', '👀'];
    if (pairCount >= 6) specialPairs.push('👑');
    if (pairCount >= 8) specialPairs.push('🔄');
    let normalCount = pairCount - specialPairs.length;
    let selectedIcons = cardValuesPool.slice(0, normalCount);
    let values = [...selectedIcons, ...selectedIcons, ...specialPairs, ...specialPairs];
    values.sort(() => Math.random() - 0.5);
    return values.map(v => ({ value: v, flipped: false, matched: false }));
}

function shuffleUnmatchedOnline(cardsCopy) {
    const idxs = cardsCopy.map((c, i) => i).filter(i => !cardsCopy[i].matched);
    const values = idxs.map(i => cardsCopy[i].value);
    for (let a = values.length - 1; a > 0; a--) {
        const b = Math.floor(Math.random() * (a + 1));
        [values[a], values[b]] = [values[b], values[a]];
    }
    idxs.forEach((i, k) => { cardsCopy[i] = { ...cardsCopy[i], value: values[k] }; });
}

// ---------- ゲーム画面の描画（Firestoreのデータをそのまま反映するだけ） ----------
function renderOnlineGame(data, previousState) {
    const currentPlayer = data.players[data.currentTurnIndex];
    const myTurn = !!(currentPlayer && currentPlayer.id === myPlayerId);
    const currentName = currentPlayer ? currentPlayer.name : "";

    document.getElementById("onlineTurnIndicator").innerText = `👉 ${currentName} の番`;
    document.getElementById("onlineScoreBoard").innerText =
        data.players.map(p => `${p.name}: ${p.score || 0}pt`).join(" | ");

    const turnHint = document.getElementById("onlineTurnHint");
    turnHint.innerText = myTurn ? "🎯 あなたの番です！カードをタップしてください" : `${currentName} さんの番です…`;

    const eventMsg = document.getElementById("onlineEventMessage");
    eventMsg.style.color = data.eventColor || "#aaa";
    eventMsg.innerText = data.eventMessage || "";

    renderOnlineBoard(data.cards || [], myTurn);

    // 前回のスナップショットからメッセージが変わった時だけ読み上げる
    if (previousState && data.eventMessage && data.eventMessage !== previousState.eventMessage) {
        speak(data.eventMessage);
    }

    updateOnlineCountdown(data.turnEndsAt, myTurn);

    document.getElementById("hostRescueBtn").style.display = (isHost && data.status === "playing") ? "block" : "none";
}

function renderOnlineBoard(cards, myTurn) {
    const board = document.getElementById("onlineBoard");

    // カード枚数が変わった（新しいゲームが始まった）時だけ作り直す
    if (board.children.length !== cards.length) {
        board.innerHTML = "";
        cards.forEach((c, idx) => {
            let cardEl = document.createElement("div");
            cardEl.classList.add("card");
            cardEl.dataset.index = idx;
            cardEl.addEventListener("click", () => attemptFlip(idx));
            board.appendChild(cardEl);
        });
    }

    Array.from(board.children).forEach((cardEl, idx) => {
        const c = cards[idx];
        if (!c) return;
        if (c.matched) {
            cardEl.classList.add("matched");
            cardEl.classList.remove("flipped");
            cardEl.innerText = c.value;
        } else if (c.flipped) {
            cardEl.classList.add("flipped");
            cardEl.classList.remove("matched");
            cardEl.innerText = c.value;
        } else {
            cardEl.classList.remove("flipped", "matched");
            cardEl.innerText = "❓";
        }
        cardEl.classList.toggle("not-my-turn", !myTurn);
    });
}

// ---------- カードタップ（自分の手番の時だけ有効） ----------
function attemptFlip(index) {
    if (!latestRoomState || latestRoomState.status !== "playing") return;
    const data = latestRoomState;
    const currentPlayer = data.players[data.currentTurnIndex];
    const myTurn = !!(currentPlayer && currentPlayer.id === myPlayerId);
    if (!myTurn) return;

    const card = data.cards[index];
    if (!card || card.flipped || card.matched) return;
    if ((data.flippedIndices || []).length >= 2) return;

    playSound("flip");
    vibrate([15]);

    const roomRef = db.collection(ROOM_COLLECTION).doc(roomCode);

    db.runTransaction(tx => {
        return tx.get(roomRef).then(doc => {
            const d = doc.data();
            if (!d || d.status !== "playing") throw new Error("NOT_PLAYING");
            if (!d.players[d.currentTurnIndex] || d.players[d.currentTurnIndex].id !== myPlayerId) throw new Error("NOT_YOUR_TURN");
            const flippedIdx = d.flippedIndices || [];
            if (flippedIdx.length >= 2) throw new Error("ALREADY_TWO");
            const cardsCopy = d.cards.slice();
            if (!cardsCopy[index] || cardsCopy[index].flipped || cardsCopy[index].matched) throw new Error("ALREADY_FLIPPED");

            cardsCopy[index] = { ...cardsCopy[index], flipped: true };
            const newFlipped = [...flippedIdx, index];

            if (newFlipped.length < 2) {
                tx.update(roomRef, { cards: cardsCopy, flippedIndices: newFlipped });
                return;
            }

            resolveMatchInTransaction(tx, roomRef, d, cardsCopy, newFlipped);
        });
    }).catch(() => {
        // 競合・タイミングのズレは静かに無視。次のスナップショットで正しい状態に戻る
    });
}

// ---------- 2枚めくった時の判定（既存の特殊カードロジックをオンライン向けに再現） ----------
function resolveMatchInTransaction(tx, roomRef, data, cardsCopy, flippedIdx) {
    const [i, j] = flippedIdx;
    const match = cardsCopy[i].value === cardsCopy[j].value;
    const players = data.players.map(p => ({ ...p }));
    const currentIdx = data.currentTurnIndex;
    const currentPlayer = players[currentIdx];
    const val = cardsCopy[i].value;
    const turnDuration = data.turnDuration || 10;

    let eventMessage = "";
    let eventColor = "#aaa";
    let matchedCount = data.matchedCount || 0;
    let scheduleRevert = false;

    if (match) {
        cardsCopy[i] = { ...cardsCopy[i], matched: true };
        cardsCopy[j] = { ...cardsCopy[j], matched: true };
        matchedCount += 2;
        currentPlayer.score = (currentPlayer.score || 0) + 1;
        currentPlayer.combo = (currentPlayer.combo || 0) + 1;

        if (val === '💣') {
            eventColor = "#ff4757";
            eventMessage = `💥 爆弾カード炸裂！！${currentPlayer.name} は今すぐコンビニにダッシュしておつまみ（または飲み物）を買ってくるパシリの刑！`;
        } else if (val === '👀') {
            eventColor = "#3498db";
            eventMessage = `👀 透視成功！もう一度あなたのターン＆ポイント2倍！`;
            currentPlayer.score += 1;
        } else if (val === '👑') {
            eventColor = "#f9d423";
            eventMessage = `👑 王様カード成立！${currentPlayer.name} は誰か1人を指名して、好きな罰ゲームを実行させることができる！`;
        } else if (val === '🔄') {
            eventColor = "#a55eea";
            eventMessage = `🔄 シャッフルカード発動！残りのカードの中身がすべて入れ替わった！記憶をリセットせよ！`;
            shuffleUnmatchedOnline(cardsCopy);
        } else {
            eventColor = "#2ecc71";
            let randomReward = rewards[Math.floor(Math.random() * rewards.length)];
            eventMessage = `${currentPlayer.name} がペア成功！\n${randomReward}`;
        }

        if (currentPlayer.combo === 3) {
            eventMessage += `\n🌟 3連続ボーナス！${currentPlayer.name} は周りの人からの質問攻めに答える刑！`;
        }
    } else {
        eventColor = "#ff6b6b";
        let randomPenalty = penalties[Math.floor(Math.random() * penalties.length)];
        eventMessage = `${currentPlayer.name} はハズレ…！\n${randomPenalty}`;
        currentPlayer.combo = 0;
        scheduleRevert = true;
    }

    let updateData = {
        cards: cardsCopy,
        players: players,
        matchedCount: matchedCount,
        eventMessage: eventMessage,
        eventColor: eventColor,
        flippedIndices: match ? [] : flippedIdx // ハズレの場合は一旦表向きのまま見せる
    };

    if (matchedCount >= cardsCopy.length) {
        updateData.status = "finished";
    } else if (match) {
        updateData.turnEndsAt = Date.now() + turnDuration * 1000;
    }

    tx.update(roomRef, updateData);

    if (scheduleRevert && matchedCount < cardsCopy.length) {
        scheduleMismatchRevert(i, j, currentIdx, turnDuration);
    }
}

// ハズレたカードを2秒後に裏返して次のターンへ（撮った本人の端末が書き込む）
function scheduleMismatchRevert(i, j, prevTurnIndex, turnDuration) {
    setTimeout(() => {
        const roomRef = db.collection(ROOM_COLLECTION).doc(roomCode);
        db.runTransaction(tx => {
            return tx.get(roomRef).then(doc => {
                const d = doc.data();
                if (!d || d.status !== "playing") return;
                const cardsCopy = d.cards.slice();
                if (cardsCopy[i]) cardsCopy[i] = { ...cardsCopy[i], flipped: false };
                if (cardsCopy[j]) cardsCopy[j] = { ...cardsCopy[j], flipped: false };
                const nextIdx = (prevTurnIndex + 1) % d.players.length;
                tx.update(roomRef, {
                    cards: cardsCopy,
                    flippedIndices: [],
                    currentTurnIndex: nextIdx,
                    eventMessage: "カードをめくってね",
                    eventColor: "#aaa",
                    turnEndsAt: Date.now() + turnDuration * 1000
                });
            });
        }).catch(() => {});
    }, 2000);
}

// ---------- タイマー（表示はローカル計算、タイムアウト処理は自分の番の時だけ発火） ----------
function updateOnlineCountdown(turnEndsAt, myTurn) {
    if (onlineCountdownInterval) clearInterval(onlineCountdownInterval);
    if (!turnEndsAt) return;

    function tick() {
        const remaining = Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000));
        document.getElementById("onlineTimerBox").innerText = `残り: ${remaining}秒`;
        if (remaining <= 0) {
            clearInterval(onlineCountdownInterval);
            if (myTurn) handleOnlineTimeOut();
        }
    }
    tick();
    onlineCountdownInterval = setInterval(tick, 250);
}

function handleOnlineTimeOut() {
    if (handlingTimeout) return;
    handlingTimeout = true;
    playSound("wrong");
    vibrate([300]);

    const roomRef = db.collection(ROOM_COLLECTION).doc(roomCode);
    db.runTransaction(tx => {
        return tx.get(roomRef).then(doc => {
            const d = doc.data();
            if (!d || d.status !== "playing") return;
            if (!d.players[d.currentTurnIndex] || d.players[d.currentTurnIndex].id !== myPlayerId) return;
            if (Date.now() < d.turnEndsAt - 200) return; // 直前に他の操作で状況が変わっていた場合の保険

            const players = d.players.map(p => ({ ...p }));
            players[d.currentTurnIndex].combo = 0;
            const cardsCopy = d.cards.map(c => (c.matched ? c : { ...c, flipped: false }));
            const currentName = players[d.currentTurnIndex].name;
            const nextIdx = (d.currentTurnIndex + 1) % players.length;

            tx.update(roomRef, {
                cards: cardsCopy,
                flippedIndices: [],
                players: players,
                currentTurnIndex: nextIdx,
                eventMessage: `⏰ タイムアウト！${currentName} の時間切れペナルティ（一気飲み）！`,
                eventColor: "#ff6b6b",
                turnEndsAt: Date.now() + (d.turnDuration || 10) * 1000
            });
        });
    }).catch(() => {}).finally(() => { handlingTimeout = false; });
}

// ---------- 結果表示・再戦 ----------
function showOnlineResult(data) {
    document.getElementById("onlineResultActions").style.display = "flex";
    document.getElementById("hostRescueBtn").style.display = "none";

    const maxScore = Math.max(...data.players.map(p => p.score || 0));
    const winners = data.players.filter(p => (p.score || 0) === maxScore).map(p => p.name);
    let resultText;
    if (winners.length === 1) {
        resultText = `🎉 ゲーム終了！勝者は ${winners[0]} さん！ 🎉`;
    } else {
        resultText = `🎉 ゲーム終了！${winners.join("さんと")}さんが同点優勝！ 🎉`;
    }

    const eventMsg = document.getElementById("onlineEventMessage");
    if (eventMsg.innerText !== resultText) {
        eventMsg.style.color = "#f9d423";
        eventMsg.innerText = resultText;
        speak(resultText);
    }

    document.getElementById("onlineQuickPlayBtn").style.display = isHost ? "block" : "none";
}

function onlineQuickPlayAgain() {
    if (!latestRoomState || !isHost) return;
    const players = latestRoomState.players.map(p => ({ ...p, score: 0, combo: 0 }));
    const pairCount = getRecommendedPairCount(players.length);
    const cards = buildOnlineDeck(pairCount);
    const turnDuration = latestRoomState.turnDuration || 10;

    db.collection(ROOM_COLLECTION).doc(roomCode).update({
        status: "playing",
        pairCount: pairCount,
        cards: cards,
        players: players,
        currentTurnIndex: 0,
        flippedIndices: [],
        matchedCount: 0,
        eventMessage: "カードをめくってね",
        eventColor: "#aaa",
        turnEndsAt: Date.now() + turnDuration * 1000
    }).catch(() => showOnlineError("再戦の開始に失敗しました。"));
}

// ---------- ホスト用の救済措置（誰かの端末が固まった時） ----------
function hostForceAdvanceTurn() {
    if (!isHost || !latestRoomState) return;
    const d = latestRoomState;
    if (d.status !== "playing") return;
    const cardsCopy = d.cards.map(c => (c.matched ? c : { ...c, flipped: false }));
    const nextIdx = (d.currentTurnIndex + 1) % d.players.length;
    const turnDuration = d.turnDuration || 10;

    db.collection(ROOM_COLLECTION).doc(roomCode).update({
        cards: cardsCopy,
        flippedIndices: [],
        currentTurnIndex: nextIdx,
        eventMessage: "🛠️ ホストが手番を強制的に進めました",
        eventColor: "#aaa",
        turnEndsAt: Date.now() + turnDuration * 1000
    }).catch(() => {});
}
