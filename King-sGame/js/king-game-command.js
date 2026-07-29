/* ==========================================================
   king-game-command.js
   画面4(命令発表) + 音声読み上げ + 後片付け
   + 初期化処理(URLパラメータ引き継ぎ・再接続)
   ※ 他のファイルの関数・変数に依存するため最後に読み込むこと
   ========================================================== */

/* ---------- 音声読み上げ ---------- */
function speakCommand(text) {
  if (!text || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.error(err);
  }
}

$("btn-speak-command").addEventListener("click", () => {
  speakCommand($("command-display").textContent);
});

/* ==========================================================
   画面4: 命令発表
   ========================================================== */
function enterCommandScreen(room) {
  showScreen("screen-command");
  $("command-display").textContent = room.currentCommand || "";
  $("command-my-number").textContent = state.myNumber != null ? state.myNumber : "?";
  $("command-host-controls").hidden = !state.isHost;
  $("command-guest-note").hidden = state.isHost;

  const weakVotes = room.weakVotes || {};
  state.lastWeakVotes = weakVotes;
  const weakCount = Object.keys(weakVotes).length;
  $("weak-vote-count").textContent = weakCount > 0 ? `😅「弱いかも」: ${weakCount}人` : "";
  $("btn-weak-vote").hidden = state.isKing;
  $("btn-weak-vote").disabled = !!weakVotes[state.uid];

  // 同じ命令に対して効果音・読み上げを何度も再生しないように、ラウンド+命令文をキーにする
  const announceKey = `${room.round}|${room.currentCommand || ""}`;
  if (state.lastAnnouncedKey !== announceKey) {
    state.lastAnnouncedKey = announceKey;
    playCommandRevealEffect();
    if (soundEnabled) speakCommand(room.currentCommand || "");
  }
}

$("btn-weak-vote").addEventListener("click", async () => {
  if (!state.roomId || !state.uid) return;
  $("btn-weak-vote").disabled = true;
  try {
    await db.collection("rooms").doc(state.roomId).update({
      [`weakVotes.${state.uid}`]: true
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
    $("btn-weak-vote").disabled = false;
  }
});

$("btn-next-round").addEventListener("click", async () => {
  $("btn-next-round").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const weakCount = Object.keys(state.lastWeakVotes || {}).length;

    if (state.lastHistoryDocRef) {
      try {
        await state.lastHistoryDocRef.update({ weakCount });
      } catch (err) {
        console.error("履歴への弱票数の記録に失敗しました", err);
      }
    }

    const batch = db.batch();
    playersSnap.forEach((doc) => batch.update(doc.ref, { number: null }));
    batch.update(roomRef, {
      status: "waiting",
      kingUid: null,
      currentCommand: null,
      round: firebase.firestore.FieldValue.increment(1),
      weakVotes: {},
      lastWeakVoteCount: weakCount,
      votingOpen: false,
      voteOptions: [],
      votes: {},
      voteResolvedIndex: null
    });
    await batch.commit();
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-next-round").disabled = false;
  }
});

/* ---------- 後片付け ---------- */
function cleanupListeners() {
  if (state.unsubRoom) state.unsubRoom();
  if (state.unsubPlayers) state.unsubPlayers();
  if (state.unsubMe) state.unsubMe();
  if (state.unsubHistory) state.unsubHistory();
  if (state.unsubCustomTemplates) state.unsubCustomTemplates();
  stopExpiryWatch();
  stopPresenceHeartbeat();
}

/* ==========================================================
   初期化: URLパラメータでの部屋コード引き継ぎ / 再接続
   ========================================================== */
(function init() {
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    joinCodeBoxes.setValue(roomFromUrl);
  }

  const savedRoomId = sessionStorage.getItem("kg_roomId");
  if (savedRoomId) {
    ensureSignedIn().then(() => {
      state.roomId = savedRoomId;
      state.isHost = sessionStorage.getItem("kg_isHost") === "1";
      state.myName = sessionStorage.getItem("kg_myName") || "";
      db.collection("rooms").doc(savedRoomId).get().then((doc) => {
        if (doc.exists && !isRoomExpired(doc.data())) {
          enterLobby();
        } else {
          if (doc.exists) {
            showErrorBanner("この部屋は作成から2時間以上経過したため終了しました", true);
            cleanupExpiredRoom(savedRoomId);
          }
          resetToHome();
        }
      }).catch((err) => {
        console.error(err);
        showErrorBanner(friendlyErrorMessage(err));
      });
    });
  }
})();