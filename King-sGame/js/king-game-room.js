/* ==========================================================
   king-game-room.js
   部屋全体の状態監視(画面切り替えの司令塔) + ラウンド履歴の購読
   ========================================================== */

/* ==========================================================
   部屋全体の状態を監視して画面を切り替える
   ========================================================== */
function listenToRoom() {
  if (state.unsubRoom) state.unsubRoom();
  const roomRef = db.collection("rooms").doc(state.roomId);

  state.unsubRoom = roomRef.onSnapshot(
    (doc) => {
      if (!doc.exists) {
        setStatus("部屋が解散されました");
        resetToHome();
        return;
      }
      const room = doc.data();
      state.isKing = room.kingUid === state.uid;
      state.playerCount = room.playerCount || state.playerCount;
      state.currentRound = room.round || 1;
      state.bannedKeywords = room.bannedKeywords || [];
      state.localRulesNote = room.localRulesNote || "";
      state.excludedCategories = room.excludedCategories || [];
      renderLocalRules();
      updateRoundIndicator();
      startExpiryWatch(room);

      // 🍻 乾杯・役割ルーレットの結果が出た瞬間、全員にトースト通知する
      const toast = room.toastRoulette;
      if (toast && toast.at && state.lastToastAt !== toast.at) {
        state.lastToastAt = toast.at;
        showErrorBanner(`🍻 ${toast.winnerName}さんが「${toast.role}」に選ばれました!`, true);
      }

      // 🛡️ 免除カードが使われたら、全員に通知する(ラウンドが変わったら通知済みリストをリセット)
      const exemptedUids = Object.keys(room.exemptedThisRound || {});
      if (exemptedUids.length === 0) {
        state.notifiedExemptionUids = [];
      } else {
        const newlyExempted = exemptedUids.filter((uid) => !state.notifiedExemptionUids.includes(uid));
        if (newlyExempted.length) {
          const names = newlyExempted.map((uid) => {
            const p = (state.players || []).find((pl) => pl.id === uid);
            return p ? p.name : "誰か";
          });
          showErrorBanner(`🛡️ ${names.join("・")}さんが免除カードを使いました`, true);
          state.notifiedExemptionUids = exemptedUids;
        }
      }

      // ラウンドの切り替わりを検知して、全員に一瞬の通知を出す
      if (state.lastRoomStatus === "command" && room.status === "waiting") {
        showErrorBanner("次のラウンドが始まります", true);
      } else if (state.lastRoomStatus === "waiting" && room.status === "drawn") {
        showErrorBanner("くじ引きが始まりました!", true);
      }
      state.lastRoomStatus = room.status;

      if (room.status === "waiting") {
        if (!$("screen-lobby").classList.contains("is-active")) {
          enterLobby();
        }
      } else if (room.status === "drawn") {
        if (state.enteredDrawRound !== room.round) {
          state.enteredDrawRound = room.round;
          enterDrawScreen(room);
        }
        syncDrawExtras(room);
      } else if (room.status === "command") {
        enterCommandScreen(room);
      }
    },
    (err) => {
      console.error(err);
      showErrorBanner(friendlyErrorMessage(err));
    }
  );
}

/* ==========================================================
   ラウンド履歴
   ========================================================== */
function listenToHistory() {
  if (state.unsubHistory) state.unsubHistory();
  const historyRef = db.collection("rooms").doc(state.roomId).collection("history");

  state.unsubHistory = historyRef.orderBy("round").onSnapshot(
    (snap) => {
      const items = [];
      snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      renderHistory(items);
      // 直近2件のテンプレート由来のお題は、ルーレットの抽選対象から一時的に外す
      state.recentTemplateIndices = items
        .slice(-2)
        .map((item) => item.templateIndex)
        .filter((v) => v != null);
    },
    (err) => console.error(err)
  );
}

function renderHistory(items) {
  state.historyItems = items;
  const html = items
    .map(
      (item) => `<li><span class="history-round-badge">第${item.round}幕</span>${escapeHtml(item.command)}
        <span class="history-king-name">王様: ${escapeHtml(item.kingName || "")}</span></li>`
    )
    .join("");

  $("lobby-history-list").innerHTML = html;
  $("command-history-list").innerHTML = html;
  $("lobby-history-panel").hidden = items.length === 0;
  $("command-history-panel").hidden = items.length === 0;
  renderDrawHistoryReuseList();
}

/* ---------- この部屋だけのオリジナルお題(自由入力から保存されたもの) ---------- */
function listenToCustomTemplates() {
  if (state.unsubCustomTemplates) state.unsubCustomTemplates();
  const ref = db.collection("rooms").doc(state.roomId).collection("customTemplates");

  state.unsubCustomTemplates = ref.orderBy("createdAt").onSnapshot(
    (snap) => {
      const items = [];
      snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      state.customTemplates = items;
      const chip = $("custom-template-chip");
      if (chip) chip.hidden = items.length === 0;
    },
    (err) => console.error(err)
  );
}