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
  renderMomentsFeed();
  renderExemptionBlock(room);

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

/* ---------- 🛡️ 免除カード ---------- */
function renderExemptionBlock(room) {
  const block = $("exemption-block");
  const targetNumbers = room.targetNumbers || [];
  const isTarget = state.myNumber != null && targetNumbers.includes(state.myNumber);

  if (!isTarget) {
    block.hidden = true;
    return;
  }

  const exempted = room.exemptedThisRound || {};
  const alreadyUsed = !!exempted[state.uid];
  const me = (state.players || []).find((p) => p.id === state.uid);
  const remaining = me && typeof me.exemptionCards === "number" ? me.exemptionCards : 0;

  block.hidden = false;
  if (alreadyUsed) {
    $("btn-use-exemption").hidden = true;
    $("exemption-used-note").hidden = false;
  } else {
    $("exemption-used-note").hidden = true;
    $("btn-use-exemption").hidden = remaining <= 0;
    $("exemption-remaining-count").textContent = remaining;
  }
}

$("btn-use-exemption").addEventListener("click", async () => {
  if (!state.roomId || !state.uid) return;
  const me = (state.players || []).find((p) => p.id === state.uid);
  if (!me || !(me.exemptionCards > 0)) return;
  if (!confirm("免除カードを1枚使って、この命令を免除します。よろしいですか?")) return;

  $("btn-use-exemption").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    await roomRef.collection("players").doc(state.uid).update({
      exemptionCards: firebase.firestore.FieldValue.increment(-1)
    });
    await roomRef.update({
      [`exemptedThisRound.${state.uid}`]: true
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-use-exemption").disabled = false;
  }
});

/* ---------- 📷 証拠写真・ひとことコメント ---------- */
const MOMENT_PHOTO_MAX_WIDTH = 480;
const MOMENT_PHOTO_QUALITY = 0.6;

$("btn-take-moment-photo").addEventListener("click", () => {
  $("moment-photo-input").click();
});

$("moment-photo-input").addEventListener("change", () => {
  const file = $("moment-photo-input").files[0];
  if (!file) return;

  const img = new Image();
  const reader = new FileReader();
  reader.onload = (e) => {
    img.onload = () => {
      const scale = Math.min(1, MOMENT_PHOTO_MAX_WIDTH / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      state.pendingMomentPhoto = canvas.toDataURL("image/jpeg", MOMENT_PHOTO_QUALITY);
      $("moment-photo-preview-img").src = state.pendingMomentPhoto;
      $("moment-photo-preview").hidden = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

$("btn-remove-moment-photo").addEventListener("click", () => {
  state.pendingMomentPhoto = null;
  $("moment-photo-input").value = "";
  $("moment-photo-preview").hidden = true;
});

$("btn-post-moment").addEventListener("click", async () => {
  const comment = $("moment-comment-input").value.trim();
  const photo = state.pendingMomentPhoto;
  if (!comment && !photo) return;

  $("btn-post-moment").disabled = true;
  try {
    const data = {
      round: state.currentRound,
      comment,
      authorName: state.myName,
      authorUid: state.uid,
      claps: {},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (photo) data.photoDataUrl = photo;

    await db.collection("rooms").doc(state.roomId).collection("moments").add(data);

    $("moment-comment-input").value = "";
    state.pendingMomentPhoto = null;
    $("moment-photo-input").value = "";
    $("moment-photo-preview").hidden = true;
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-post-moment").disabled = false;
  }
});

function listenToMoments() {
  if (state.unsubMoments) state.unsubMoments();
  const ref = db.collection("rooms").doc(state.roomId).collection("moments");

  state.unsubMoments = ref.orderBy("createdAt").onSnapshot(
    (snap) => {
      const items = [];
      snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      state.momentsItems = items;
      renderMomentsFeed();
    },
    (err) => console.error(err)
  );
}

// 現在のラウンドの記録だけを命令発表画面に表示する
function renderMomentsFeed() {
  const list = $("moments-feed");
  if (!list) return;
  const items = (state.momentsItems || []).filter((item) => item.round === state.currentRound);

  list.innerHTML = items
    .map((item) => {
      const clapCount = Object.keys(item.claps || {}).length;
      const isMine = !!(item.claps || {})[state.uid];
      const photoHtml = item.photoDataUrl ? `<img src="${item.photoDataUrl}" alt="記録された写真">` : "";
      const commentHtml = item.comment ? `<p class="moment-card-comment">${escapeHtml(item.comment)}</p>` : "";
      return `<li class="moment-card" data-id="${item.id}">
        ${photoHtml}
        ${commentHtml}
        <div class="moment-card-footer">
          <span class="moment-card-author">${escapeHtml(item.authorName || "")}</span>
          <button type="button" class="moment-clap-btn${isMine ? " is-mine" : ""}" data-id="${item.id}">👏 ${clapCount}</button>
        </div>
      </li>`;
    })
    .join("");

  list.querySelectorAll(".moment-clap-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleMomentClap(btn.dataset.id));
  });
}

async function toggleMomentClap(momentId) {
  if (!state.roomId || !state.uid) return;
  const item = (state.momentsItems || []).find((m) => m.id === momentId);
  const alreadyClapped = !!(item && item.claps && item.claps[state.uid]);
  const ref = db.collection("rooms").doc(state.roomId).collection("moments").doc(momentId);
  try {
    if (alreadyClapped) {
      await ref.update({ [`claps.${state.uid}`]: firebase.firestore.FieldValue.delete() });
    } else {
      await ref.update({ [`claps.${state.uid}`]: true });
    }
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
}

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
      targetNumbers: [],
      exemptedThisRound: {},
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
  if (state.unsubMoments) state.unsubMoments();
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