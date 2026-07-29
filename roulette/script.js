let playerCount = 3;
let players = [];
let currentTurnIndex = 0;
let totalChambers = 3;
let bulletPositions = [];
let currentAttempt = 0;
let isAnimating = false;
let consecutiveSafe = 0;
let survivalCount = [];
let hitPlayerIndex = null;
let hitRecords = []; // 周回制モードで「誰が・何回目に・どんな罰ゲームで」当たったかを記録

// ゲームルールの設定
let gameMode = "lap";          // "classic"(一発即終了) or "lap"(周回制)
let roundsMultiplier = 1;      // 弾倉数 = 人数 × この値（切り上げ）
let riskLevel = "standard";    // "low"/"standard"/"high"（周回制モードでの弾の割合）

const RISK_RATIOS = { low: 0.10, standard: 0.20, high: 0.35 };

// 罰ゲームをジャンルごとに分類
const penaltyCategories = {
    drink: [
        "右隣の人と一気飲み！",
        "左右、隣の人と一気飲み！",
        "左隣の人と一気飲み！",
        "グラスの残りの半分を飲み干す",
        "両隣の人とアイコンタクトで「お疲れ様です」と言ってから飲む",
        "自分の好きなお酒をもう一杯おかわりして飲む"
    ],
    talk: [
        "自分のスマホの検索履歴を直近3件まで発表する",
        "今まで隠していた小さな秘密を1つカミングアウトする",
        "学生時代のちょっと恥ずかしいあだ名を発表する",
        "最近一番やらかした失敗談を1分で語る"
    ],
    dare: [
        "右隣の人からリクエストされた「かっこいいセリフ」を全力で言う",
        "次の人が当たるまで、語尾に「にゃん」をつけて喋る",
        "左隣の人に照れずに真面目な愛の告白をする",
        "今この場で一番感謝している人を発表して、その場で褒めちぎる",
        "次の1分間、一切の笑い（表情・声）を禁止される"
    ]
};

let selectedCategories = { drink: true, talk: true, dare: true };
let penaltyMode = "random";
let customPenalties = [];
let currentPenaltyCandidates = [];

// 初期化：名前入力欄を作る
function updateNameInputs() {
    const container = document.getElementById("nameInputsContainer");
    const existingValues = Array.from(container.querySelectorAll(".name-input")).map(input => input.value);

    container.innerHTML = "";
    for (let i = 0; i < playerCount; i++) {
        let input = document.createElement("input");
        input.type = "text";
        input.className = "name-input";
        input.placeholder = `プレイヤー${i + 1}`;
        input.value = existingValues[i] !== undefined ? existingValues[i] : `プレイヤー${i + 1}`;
        container.appendChild(input);
    }
}

function changeCount(amount) {
    playerCount += amount;
    if (playerCount < 2) playerCount = 2;
    if (playerCount > 8) playerCount = 8;
    document.getElementById("playerCountText").innerText = playerCount;
    updateNameInputs();
    updateSettingsSummary();
}

// ゲームモード選択（クラシックの時は危険度設定を隠す＝常に1発になるため）
function selectGameMode(mode) {
    gameMode = mode;
    document.querySelectorAll(".chamber-btn[data-gamemode]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.gamemode === mode);
    });
    document.getElementById("riskGroup").style.display = mode === "lap" ? "block" : "none";
    document.getElementById("gameModeHint").innerText = mode === "lap"
        ? "周回制：全員が一周し終わるまで続行。複数人が当たることもあります"
        : "クラシック：最初に当たった時点でゲーム終了。緊張感重視の従来ルールです";
    updateSettingsSummary();
}

// 周回数選択（弾倉数の元になる）
function selectRounds(mult) {
    roundsMultiplier = mult;
    document.querySelectorAll(".chamber-btn[data-rounds]").forEach(btn => {
        btn.classList.toggle("active", parseFloat(btn.dataset.rounds) === mult);
    });
    updateSettingsSummary();
}

// 危険度選択（周回制モードでの弾の割合）
function selectRisk(level) {
    riskLevel = level;
    document.querySelectorAll(".chamber-btn[data-risk]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.risk === level);
    });
    updateSettingsSummary();
}

// 現在の設定から「弾倉数・弾の数」をリアルタイムに計算して表示
function updateSettingsSummary() {
    const chambers = Math.max(playerCount, Math.ceil(playerCount * roundsMultiplier));
    let bulletsText;
    if (gameMode === "classic") {
        bulletsText = "1発（最初に当たった時点で終了）";
    } else {
        const bulletCount = Math.min(chambers, Math.max(1, Math.round(chambers * RISK_RATIOS[riskLevel])));
        bulletsText = `${bulletCount}発`;
    }
    document.getElementById("settingsSummary").innerText =
        `👥 ${playerCount}人 → 弾倉 ${chambers}発 / 弾 ${bulletsText}`;
}

// 罰ゲームジャンルの選択切り替え（最低1つは選択された状態を保つ）
function toggleCategory(cat) {
    const activeCount = Object.values(selectedCategories).filter(Boolean).length;
    if (selectedCategories[cat] && activeCount <= 1) return;
    selectedCategories[cat] = !selectedCategories[cat];
    document.querySelector(`.chamber-btn[data-cat="${cat}"]`).classList.toggle("active", selectedCategories[cat]);
}

function selectPenaltyMode(mode) {
    penaltyMode = mode;
    document.querySelectorAll(".chamber-btn[data-mode]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });
}

function getActivePenaltyPool() {
    let pool = [];
    for (const cat in selectedCategories) {
        if (selectedCategories[cat]) pool = pool.concat(penaltyCategories[cat]);
    }
    pool = pool.concat(customPenalties);
    return pool.length > 0 ? pool : ["罰ゲームなし（ジャンルを選び直してね）"];
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function addCustomPenalty() {
    const input = document.getElementById("customPenaltyInput");
    const text = input.value.trim();
    if (!text) return;
    customPenalties.push(text);
    input.value = "";
    renderCustomPenaltyList();
}

function removeCustomPenalty(index) {
    customPenalties.splice(index, 1);
    renderCustomPenaltyList();
}

function renderCustomPenaltyList() {
    const list = document.getElementById("customPenaltyList");
    list.innerHTML = "";
    customPenalties.forEach((text, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${text}</span><button onclick="removeCustomPenalty(${i})" aria-label="削除">×</button>`;
        list.appendChild(li);
    });
}

// 弾倉数と、その中に仕込む弾の位置(複数可)を決める
function computeBulletPositions() {
    if (gameMode === "classic") {
        return [Math.floor(Math.random() * totalChambers)];
    }
    let bulletCount = Math.max(1, Math.round(totalChambers * RISK_RATIOS[riskLevel]));
    bulletCount = Math.min(bulletCount, totalChambers);
    const indices = shuffleArray([...Array(totalChambers).keys()]);
    return indices.slice(0, bulletCount).sort((a, b) => a - b);
}

function startGame() {
    const inputs = document.querySelectorAll(".name-input");
    players = [];
    inputs.forEach(input => {
        players.push(input.value.trim() || input.placeholder);
    });

    // 弾数を人数に連動させる（人数 × 周回数、最低でも人数分は確保）
    totalChambers = Math.max(players.length, Math.ceil(players.length * roundsMultiplier));
    bulletPositions = computeBulletPositions();

    currentTurnIndex = 0;
    currentAttempt = 0;
    consecutiveSafe = 0;
    hitPlayerIndex = null;
    hitRecords = [];
    survivalCount = new Array(players.length).fill(0);

    document.getElementById("setupScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    document.getElementById("resultSummary").style.display = "none";
    document.getElementById("comboBanner").classList.remove("show");
    document.getElementById("penaltyPicker").style.display = "none";
    document.getElementById("penaltyPicker").innerHTML = "";

    document.getElementById("startBtn").style.display = "none";
    document.getElementById("shootBtn").style.display = "block";
    document.getElementById("nextTurnBtn").style.display = "none";
    document.getElementById("restartBtn").style.display = "none";

    initCylinderDrum();
    updateTurnDisplay();
}

function backToSetup() {
    if (!confirm("現在の対戦をやめて設定画面に戻りますか？")) return;
    document.getElementById("gameScreen").style.display = "none";
    document.getElementById("setupScreen").style.display = "block";
    document.getElementById("startBtn").style.display = "block";
    document.getElementById("shootBtn").style.display = "none";
    document.getElementById("nextTurnBtn").style.display = "none";
    document.getElementById("restartBtn").style.display = "none";
}

function updateTurnDisplay() {
    document.getElementById("turnIndicator").innerText = `👉 ${players[currentTurnIndex]} の番`;
    document.getElementById("message").innerText = "引き金を引いて運だめし…！";
    document.getElementById("status").innerText = "🥃";
}

// ===== 弾倉のSVGビジュアル =====

function initCylinderDrum() {
    const container = document.getElementById("cylinderSvgContainer");
    const size = 220;
    const center = size / 2;
    const chamberRadius = totalChambers > 8 ? 13 : 17;
    const ringRadius = 80;

    let chambersHtml = "";
    for (let i = 0; i < totalChambers; i++) {
        const angle = (360 / totalChambers) * i - 90;
        const rad = angle * Math.PI / 180;
        const cx = (center + ringRadius * Math.cos(rad)).toFixed(1);
        const cy = (center + ringRadius * Math.sin(rad)).toFixed(1);
        chambersHtml += `<circle class="chamber chamber-pending" data-index="${i}" cx="${cx}" cy="${cy}" r="${chamberRadius}"></circle>`;
    }

    container.innerHTML = `
        <svg viewBox="0 0 ${size} ${size}" class="cylinder-svg">
            <g id="cylinderGroup">
                <circle class="cylinder-body" cx="${center}" cy="${center}" r="${ringRadius + chamberRadius + 8}"></circle>
                ${chambersHtml}
            </g>
            <polygon class="cylinder-pointer" points="${center - 9},10 ${center + 9},10 ${center},28"></polygon>
        </svg>
    `;

    const group = document.getElementById("cylinderGroup");
    group.style.transition = "none";
    group.style.transform = "rotate(0deg)";
    void group.offsetWidth;
    group.style.transition = "";
    spinCylinderTo(0);
}

function spinCylinderTo(index) {
    const group = document.getElementById("cylinderGroup");
    if (!group) return;
    const stepDeg = 360 / totalChambers;
    const targetDeg = -(stepDeg * index) - 720 * (index + 1);
    group.style.transform = `rotate(${targetDeg}deg)`;
}

function markChamberState(index, stateClass) {
    const el = document.querySelector(`.chamber[data-index="${index}"]`);
    if (!el) return;
    el.classList.remove("chamber-pending");
    el.classList.add(stateClass);
}

function triggerHitFlash() {
    const el = document.getElementById("hitFlash");
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
}

// ===== ゲーム進行 =====

function pullTrigger() {
    if (isAnimating) return;
    isAnimating = true;

    const status = document.getElementById("status");
    const message = document.getElementById("message");
    const btn = document.getElementById("shootBtn");

    btn.disabled = true;
    message.innerText = "";
    status.classList.remove("spinning");

    spinCylinderTo(currentAttempt);

    let count = 3;
    status.classList.add("count-pulse");
    status.innerText = count;

    const countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            status.classList.remove("count-pulse");
            void status.offsetWidth;
            status.classList.add("count-pulse");
            status.innerText = count;
        } else {
            clearInterval(countdownTimer);
            status.classList.remove("count-pulse");
            revealResult();
        }
    }, 500);
}

function revealResult() {
    const status = document.getElementById("status");
    const message = document.getElementById("message");

    status.classList.add("spinning");
    status.innerText = "🔄";

    setTimeout(() => {
        status.classList.remove("spinning");

        const isHit = bulletPositions.includes(currentAttempt);

        if (isHit) {
            status.innerText = "💥";
            markChamberState(currentAttempt, "chamber-hit");
            if (navigator.vibrate) navigator.vibrate([120, 60, 220]);
            triggerHitFlash();

            hitPlayerIndex = currentTurnIndex;
            hitRecords.push({ index: currentTurnIndex, penalty: null });
            consecutiveSafe = 0;

            document.getElementById("shootBtn").style.display = "none"; // 決着がつくまで押せないように

            if (penaltyMode === "neighbor" && players.length > 1) {
                showPenaltyPicker();
            } else {
                const pool = getActivePenaltyPool();
                const randomPenalty = pool[Math.floor(Math.random() * pool.length)];
                proceedAfterHit(randomPenalty);
            }
            return; // 続き（次のターン or 終了）はproceedAfterHit側で処理
        } else {
            status.innerText = "💨";
            message.innerText = `${players[currentTurnIndex]} はセーフ！生き残った！`;
            markChamberState(currentAttempt, "chamber-safe");
            survivalCount[currentTurnIndex]++;
            consecutiveSafe++;
            showComboIfNeeded();
            currentAttempt++;

            if (currentAttempt >= totalChambers) {
                message.innerText = hitRecords.length > 0
                    ? "全弾撃ち終わった……お疲れ様！"
                    : "全員生き残った……奇跡のセーフ！";
                endGame();
                return;
            } else {
                currentTurnIndex = (currentTurnIndex + 1) % players.length;
                setTimeout(() => {
                    updateTurnDisplay();
                    document.getElementById("shootBtn").disabled = false;
                    isAnimating = false;
                }, 1500);
                return;
            }
        }
    }, 600);
}

// 連続セーフのコンボ演出
function showComboIfNeeded() {
    if (consecutiveSafe < 2) return;

    const banner = document.getElementById("comboBanner");
    const messages = {
        2: "🔥 2連続セーフ！空気が張り詰めてきた…",
        3: "😱 3連続セーフ！誰の心臓ももたない…！",
        4: "🌪️ 4連続セーフ！伝説の回になるか…！？"
    };
    const text = messages[consecutiveSafe] || `⚡ ${consecutiveSafe}連続セーフ！！奇跡が続いている…！`;

    banner.innerText = text;
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
}

// ===== 「次の人が決める」罰ゲームモード =====

function showPenaltyPicker() {
    const message = document.getElementById("message");
    const neighborIndex = (currentTurnIndex + 1) % players.length;
    const neighborName = players[neighborIndex];

    message.innerHTML = `<span style="color:#ff6b6b;">${players[hitPlayerIndex]} が当たり！</span><br>罰ゲームは <strong>${neighborName}</strong> が決めるよ！`;

    const pool = getActivePenaltyPool();
    currentPenaltyCandidates = shuffleArray(pool).slice(0, 4);

    const picker = document.getElementById("penaltyPicker");
    let html = currentPenaltyCandidates
        .map((text, i) => `<button class="penalty-choice-btn" onclick="choosePenaltyByIndex(${i})">${text}</button>`)
        .join("");
    html += `
        <div class="penalty-custom-row">
            <input type="text" id="penaltyCustomInput" class="name-input" placeholder="自由に決めてもOK" style="margin-bottom:0;">
            <button class="add-btn" onclick="chooseCustomPenalty()">決定</button>
        </div>
    `;
    picker.innerHTML = html;
    picker.style.display = "block";
}

function choosePenaltyByIndex(i) {
    finalizePenaltyChoice(currentPenaltyCandidates[i]);
}

function chooseCustomPenalty() {
    const input = document.getElementById("penaltyCustomInput");
    const text = input.value.trim();
    if (!text) return;
    finalizePenaltyChoice(text);
}

function finalizePenaltyChoice(text) {
    const picker = document.getElementById("penaltyPicker");
    picker.style.display = "none";
    picker.innerHTML = "";
    proceedAfterHit(text);
}

// 当たりが確定した後の共通処理：クラシックは即終了、周回制は次のターンへ継続
function proceedAfterHit(penaltyText) {
    const message = document.getElementById("message");
    hitRecords[hitRecords.length - 1].penalty = penaltyText;
    message.innerHTML = `<span style="color:#ff6b6b;">${players[hitPlayerIndex]} が当たり！</span><br>罰ゲーム：${penaltyText}`;

    if (gameMode === "classic") {
        endGame();
        return;
    }

    currentAttempt++;
    if (currentAttempt >= totalChambers) {
        endGame();
    } else {
        // 自動では進めず、「次の人へ進む」ボタンが押されるまで待つ
        // (罰ゲームの実行中に画面が勝手に切り替わらないように)
        document.getElementById("shootBtn").style.display = "none";
        document.getElementById("nextTurnBtn").style.display = "block";
    }
}

// 「次の人へ進む」ボタンが押された時の処理
function advanceToNextTurn() {
    currentTurnIndex = (currentTurnIndex + 1) % players.length;
    document.getElementById("nextTurnBtn").style.display = "none";
    document.getElementById("shootBtn").style.display = "block";
    document.getElementById("shootBtn").disabled = false;
    updateTurnDisplay();
    isAnimating = false;
}

// ゲーム終了時のMVP・記録表示
function endGame() {
    document.getElementById("shootBtn").style.display = "none";
    document.getElementById("nextTurnBtn").style.display = "none";
    document.getElementById("restartBtn").style.display = "block";

    const summary = document.getElementById("resultSummary");
    let maxSurvive = Math.max(...survivalCount);
    let mvpNames = players.filter((_, i) => survivalCount[i] === maxSurvive && maxSurvive > 0);

    let html = `<h3>🏆 今回の記録</h3>`;

    if (hitRecords.length === 1) {
        html += `<p>💥 散った者：<strong>${players[hitRecords[0].index]}</strong></p>`;
    } else if (hitRecords.length > 1) {
        html += `<p>💥 散った者たち：</p><ul class="hit-record-list">`;
        hitRecords.forEach(r => {
            html += `<li><strong>${players[r.index]}</strong>：${r.penalty}</li>`;
        });
        html += `</ul>`;
    }

    if (mvpNames.length > 0) {
        html += `<p>🍀 最も強運だったのは：<strong>${mvpNames.join("、")}</strong>（${maxSurvive}回セーフ）</p>`;
    }

    summary.innerHTML = html;
    summary.style.display = "block";
}

// 「もう一度遊ぶ」ボタンが押されたときの処理
function resetGame() {
    bulletPositions = computeBulletPositions(); // 弾倉数は維持したまま、弾の位置を引き直す

    currentTurnIndex = 0;
    currentAttempt = 0;
    consecutiveSafe = 0;
    hitPlayerIndex = null;
    hitRecords = [];
    survivalCount = new Array(players.length).fill(0);

    document.getElementById("shootBtn").disabled = false;
    document.getElementById("shootBtn").style.display = "block";
    document.getElementById("nextTurnBtn").style.display = "none";
    document.getElementById("restartBtn").style.display = "none";
    document.getElementById("resultSummary").style.display = "none";
    document.getElementById("comboBanner").classList.remove("show");
    document.getElementById("penaltyPicker").style.display = "none";
    document.getElementById("penaltyPicker").innerHTML = "";

    initCylinderDrum();
    updateTurnDisplay();
}

// 最初に画面を開いたときの初期化実行
updateNameInputs();
updateSettingsSummary();