let playerCount = 3;
let players = [];
let currentTurnIndex = 0;
let totalChambers = 6;
let bulletPosition = Math.floor(Math.random() * totalChambers);
let currentAttempt = 0;
let isAnimating = false;
let consecutiveSafe = 0;
let survivalCount = [];
let hitPlayerIndex = null;

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

// 選択中の罰ゲームジャンル（初期状態は全部ON）
let selectedCategories = { drink: true, talk: true, dare: true };

// 罰ゲームの決め方：ランダム or 次の人が決める
let penaltyMode = "random";

// ユーザーが追加したオリジナル罰ゲーム
let customPenalties = [];

// 「次の人が決める」モードで提示する候補（インデックス参照用）
let currentPenaltyCandidates = [];

// 初期化：名前入力欄を作る
function updateNameInputs() {
    const container = document.getElementById("nameInputsContainer");

    // 既に入力されている名前は変更後も保持する（人数ボタンで消えてしまう問題への対処）
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
}

// 弾数選択
function selectChamberCount(count) {
    totalChambers = count;
    document.querySelectorAll(".chamber-select .chamber-btn[data-count]").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.count) === count);
    });
}

// 罰ゲームジャンルの選択切り替え（最低1つは選択された状態を保つ）
function toggleCategory(cat) {
    const activeCount = Object.values(selectedCategories).filter(Boolean).length;
    if (selectedCategories[cat] && activeCount <= 1) {
        return; // 最後の1つはOFFにできない
    }
    selectedCategories[cat] = !selectedCategories[cat];
    document.querySelector(`.chamber-btn[data-cat="${cat}"]`).classList.toggle("active", selectedCategories[cat]);
}

// 罰ゲームの決め方を選択
function selectPenaltyMode(mode) {
    penaltyMode = mode;
    document.querySelectorAll(".chamber-btn[data-mode]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });
}

// 選択中のジャンル＋オリジナル罰ゲームから罰ゲームの候補プールを作る
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

// オリジナル罰ゲーム追加
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

function startGame() {
    const inputs = document.querySelectorAll(".name-input");
    players = [];
    inputs.forEach(input => {
        players.push(input.value.trim() || input.placeholder);
    });

    currentTurnIndex = 0;
    currentAttempt = 0;
    consecutiveSafe = 0;
    hitPlayerIndex = null;
    survivalCount = new Array(players.length).fill(0);
    bulletPosition = Math.floor(Math.random() * totalChambers);

    document.getElementById("setupScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    document.getElementById("resultSummary").style.display = "none";
    document.getElementById("comboBanner").classList.remove("show");
    document.getElementById("penaltyPicker").style.display = "none";
    document.getElementById("penaltyPicker").innerHTML = "";

    // 下部固定バーのボタンを「引き金を引く」に切り替え
    document.getElementById("startBtn").style.display = "none";
    document.getElementById("shootBtn").style.display = "block";
    document.getElementById("restartBtn").style.display = "none";

    initCylinderDrum();
    updateTurnDisplay();
}

// 設定画面に戻る（対戦中でも人数・弾数・罰ゲーム設定をやり直せるように）
function backToSetup() {
    if (!confirm("現在の対戦をやめて設定画面に戻りますか？")) return;
    document.getElementById("gameScreen").style.display = "none";
    document.getElementById("setupScreen").style.display = "block";
    document.getElementById("startBtn").style.display = "block";
    document.getElementById("shootBtn").style.display = "none";
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
    const chamberRadius = 17;
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

    // 初期状態は回転無しで一瞬置いてから、演出として1回転させる（弾込めの儀式感）
    const group = document.getElementById("cylinderGroup");
    group.style.transition = "none";
    group.style.transform = "rotate(0deg)";
    void group.offsetWidth;
    group.style.transition = "";
    spinCylinderTo(0);
}

// 弾倉を回転させて、指定したチャンバーが真上(ポインター位置)に来るようにする
function spinCylinderTo(index) {
    const group = document.getElementById("cylinderGroup");
    if (!group) return;
    const stepDeg = 360 / totalChambers;
    // 毎回+2回転ぶん多く回すことで、同じ方向にどんどん回っていく演出にする
    const targetDeg = -(stepDeg * index) - 720 * (index + 1);
    group.style.transform = `rotate(${targetDeg}deg)`;
}

function markChamberState(index, stateClass) {
    const el = document.querySelector(`.chamber[data-index="${index}"]`);
    if (!el) return;
    el.classList.remove("chamber-pending");
    el.classList.add(stateClass);
}

// iPhoneは振動非対応なので、画面フラッシュで「当たった」実感を補完する
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

    // 弾倉を実際に回すビジュアル演出（カウントダウンと同じ尺で回り切る）
    spinCylinderTo(currentAttempt);

    // カウントダウン演出：3→2→1→結果
    let count = 3;
    status.classList.add("count-pulse");
    status.innerText = count;

    const countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            status.classList.remove("count-pulse");
            void status.offsetWidth; // リフローを強制してアニメーションを再生
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

        if (currentAttempt === bulletPosition) {
            // 当たり！
            status.innerText = "💥";
            markChamberState(currentAttempt, "chamber-hit");
            if (navigator.vibrate) navigator.vibrate([120, 60, 220]);
            triggerHitFlash();

            hitPlayerIndex = currentTurnIndex;
            consecutiveSafe = 0;

            // 決着がつくまで、引き金ボタンは押せないようにしておく
            document.getElementById("shootBtn").style.display = "none";

            if (penaltyMode === "neighbor" && players.length > 1) {
                showPenaltyPicker();
            } else {
                const pool = getActivePenaltyPool();
                const randomPenalty = pool[Math.floor(Math.random() * pool.length)];
                finalizeHitMessage(randomPenalty);
            }
        } else {
            // セーフ
            status.innerText = "💨";
            message.innerText = `${players[currentTurnIndex]} はセーフ！生き残った！`;
            markChamberState(currentAttempt, "chamber-safe");
            survivalCount[currentTurnIndex]++;
            consecutiveSafe++;
            showComboIfNeeded();
            currentAttempt++;

            if (currentAttempt >= totalChambers) {
                message.innerText = "全員生き残った……奇跡のセーフ！";
                endGame();
                return;
            } else {
                // 次の人へ
                currentTurnIndex = (currentTurnIndex + 1) % players.length;
                setTimeout(() => {
                    updateTurnDisplay();
                    document.getElementById("shootBtn").disabled = false;
                    isAnimating = false;
                }, 1500);
                return;
            }
        }
        isAnimating = false;
    }, 600);
}

// 連続セーフのコンボ演出
function showComboIfNeeded() {
    if (consecutiveSafe < 2) return; // 2連続以上から演出

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
    finalizeHitMessage(text);
}

function finalizeHitMessage(penaltyText) {
    const message = document.getElementById("message");
    message.innerHTML = `<span style="color:#ff6b6b;">${players[hitPlayerIndex]} が当たり！</span><br>罰ゲーム：${penaltyText}`;
    endGame();
}

// ゲーム終了時のMVP・記録表示
function endGame() {
    document.getElementById("shootBtn").style.display = "none";
    document.getElementById("restartBtn").style.display = "block";

    const summary = document.getElementById("resultSummary");

    // 生存数が最も多いプレイヤー（＝運が良かった人）を集計
    let maxSurvive = Math.max(...survivalCount);
    let mvpNames = players.filter((_, i) => survivalCount[i] === maxSurvive && maxSurvive > 0);

    let html = `<h3>🏆 今回の記録</h3>`;
    if (hitPlayerIndex !== null) {
        html += `<p>💥 散った者：<strong>${players[hitPlayerIndex]}</strong></p>`;
    }
    if (mvpNames.length > 0) {
        html += `<p>🍀 最も強運だったのは：<strong>${mvpNames.join("、")}</strong>（${maxSurvive}回セーフ）</p>`;
    }

    summary.innerHTML = html;
    summary.style.display = "block";
}

// 「もう一度遊ぶ」ボタンが押されたときの処理
function resetGame() {
    currentTurnIndex = 0;
    currentAttempt = 0;
    consecutiveSafe = 0;
    hitPlayerIndex = null;
    survivalCount = new Array(players.length).fill(0);
    bulletPosition = Math.floor(Math.random() * totalChambers);

    // ボタンやステータスを初期状態に戻す
    document.getElementById("shootBtn").disabled = false;
    document.getElementById("shootBtn").style.display = "block";
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