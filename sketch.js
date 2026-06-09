/* ====================================================================
  【神廚大亨：隔空抓藥料理王 v16.0 - 手勢黑市商店版】
  修改重點：
    1. 結算畫面移除滑鼠與懸浮倒數，改為全手勢驅動。
    2. 👍 比讚 (Thumbs Up) -> 開啟黑市商店。
    3. 👌 比 OK (OK Gesture) -> 關閉黑市商店。
    4. 👈 舉左手 (Left Hand) -> 購買左邊維他命 ($25)。
    5. 👉 舉右手 (Right Hand) -> 購買右邊沙漏 ($40)。
==================================================================== */

let video;
let handpose;
let predictions = [];

// 遊戲狀態機控制
let gameState = "INTRO";
let gameMode = ""; 
let isPaused = false;      

// 生存天數與跨關卡一日總計時變數
let currentDay = 1;         
let baseDayDuration = 120;  // 每天初始總時間
let dayTimer = 120;         // 今天的剩餘時間
let dayStartMillis = 0;     
let pauseStartMillis = 0;   
let totalUsedSeconds = 0;  

// 經營系統與統計變數
let totalMoney = 100;       // 初始資金 $100
let satisfaction = 100;   
let stage1CutCount = 0;    
let stage2PizzaCount = 0;  

// 歷史資產紀錄
let moneyHistory = [100];   

// 全螢幕爆炸特效
let bombFlashTimer = 0; 

// 過渡轉場畫面控制
let nextState = "";
let transitionTitle = "";
let transitionDesc = "";
let transitionGestureTimer = 0; 
let isActualDayEnd = false;     

// 商店介面控制
let isShopOpen = false;
let shopCooldownTimer = 0; // 防止手勢連續觸發的冷卻計時器

// 商店庫存與持有物
let shopInventory = {
  "VITAMIN": { name: "綜合維他命", price: 25, bought: false },
  "HOURGLASS": { name: "時間老沙漏", price: 40, bought: false },
  "COFFEE": { name: "濃縮咖啡", color: [100, 50, 0], price: 20, bought: false },
  "GLOVE": { name: "防燙手套", color: [200, 200, 200], price: 30, bought: false }
};
let myItems = []; // 右下角持有道具列表

// 第一關變數
let foodX, foodY, foodSpeedX, foodSpeedY; 
let foodType = ""; 
let foodLabel = "";
let foodColor;
let prevHandY = 0; 
let prevHandX = 0; 
let isPinching = false; 
let particles = [];

// 手勢計時與蓄能
let gestureTimer = 0;       
let lastCheckTime = 0;      
let requiredHoldTime = 2000; 

// 第二關變數
let targetBoxX, targetBoxY;
let hasItem = false;
let itemX, itemY;             
let pinchReleaseTime = 0;     
let isWaitingForDrop = false; 
let cheeseSpawnX; 

// 第三關變數
let ovenStarted = false;    
let ovenButtons = [];       
let ovenTargetCount = 3;    

// 多場景通用安全鎖
let stateEnterMillis = 0;    
let pageSafetyDuration = 1000; 
let guideSafetyDuration = 3000; 

function setup() {
  createCanvas(windowWidth, windowHeight);
  adjustCanvasSize();
  
  video = createCapture(VIDEO);
  video.size(640, 480); 
  video.hide(); 

  if (typeof ml5 !== 'undefined') {
    handpose = ml5.handpose(video, modelReady);
    handpose.on("predict", results => {
      predictions = results;
    });
  } else {
    console.error("錯誤：找不到 ml5.js 函式庫。");
  }
  
  resetFood();
  stateEnterMillis = millis(); 
}

function adjustCanvasSize() {
  let targetRatio = 4 / 3;
  let w = windowWidth;
  let h = windowHeight;
  if (w / h > targetRatio) w = h * targetRatio;
  else h = w / targetRatio;
  resizeCanvas(w, h);
  canvas.style.position = 'absolute';
  canvas.style.left = (windowWidth - width) / 2 + 'px';
  canvas.style.top = (windowHeight - height) / 2 + 'px';
}

function modelReady() {
  console.log("Handpose 模型載入成功！");
}

function windowResized() {
  adjustCanvasSize();
}

function changeGameState(newState) {
  gameState = newState;
  isPaused = false;
  isShopOpen = false;
  stateEnterMillis = millis(); 
  if (newState === "STAGE1") {
    dayStartMillis = millis();
    dayTimer = baseDayDuration;
    stage1CutCount = 0;
  }
}

function mousePressed() {
  let fs = fullscreen();
  if (!fs) fullscreen(true);

  if (gameState === "INTRO") {
    changeGameState("GUIDE");
  } else if (gameState === "GUIDE") {
    if (millis() - stateEnterMillis >= guideSafetyDuration) {
      changeGameState("START");
    }
  } else if (gameState === "START") {
    changeGameState("MODE_SELECT");
  } else if (gameState === "GAMEOVER") { 
    totalMoney = 100; currentDay = 1; satisfaction = 100; baseDayDuration = 120;
    moneyHistory = [100];
    changeGameState("INTRO");
  }
  
  checkUIInteraction(mouseX, mouseY, true);
}

function draw() {
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  // --- 狀態視覺化效果 (HUD) ---
  push();
  if (isShopOpen) {
    stroke(255, 105, 180, 150); strokeWeight(12); noFill();
    rect(0, 0, width, height); // 商店模式下邊框粉色發光
  }
  if (isPaused) {
    fill(255, 255, 255, 120); rect(0, 0, width, height);
    fill(255, 50, 100); textSize(50); textAlign(CENTER, CENTER);
    text("遊戲已暫停", width/2, height/2);
  }
  pop();

  let fingerX = 0, fingerY = 0;
  let isHandDetected = false;
  let currentHandData = null;
  let isHandOpen = false; 
  let isFist = false; 
  let isThumbsUp = false;
  let isOK = false;
  let handSide = "RIGHT"; // 預設鏡頭前的左右手判定
  
  if (predictions.length > 0) {
    isHandDetected = true;
    currentHandData = predictions[0];
    
    let indexTip = currentHandData.annotations.indexFinger[3];
    fingerX = width - (indexTip[0] * (width / video.width)); 
    fingerY = indexTip[1] * (height / video.height);
    
    let thumbTip = currentHandData.annotations.thumb[3];
    let thumbX = width - (thumbTip[0] * (width / video.width));
    let thumbY = thumbTip[1] * (height / video.height);
    
    let d = dist(fingerX, fingerY, thumbX, thumbY);
    isPinching = (d < 40); 
    isHandOpen = checkHandOpen(currentHandData);
    isFist = checkIsFist(currentHandData); 
    isThumbsUp = checkThumbsUp(currentHandData);
    isOK = checkOKGesture(currentHandData);

    // 根據手掌中心點在畫面的左半邊或右半邊，判定為左手或右手（因為鏡頭鏡像鏡射）
    let palmX = width - (currentHandData.landmarks[0][0] * (width / video.width));
    if (palmX < width / 2) {
      handSide = "LEFT";  // 畫面左側 (玩家的右手)
    } else {
      handSide = "RIGHT"; // 畫面右側 (玩家的左手)
    }
    
    drawHandSkeleton(currentHandData, isPinching, isHandOpen, isFist, isThumbsUp, isOK);
  }

  // 當前手勢即時文字提示
  let currentGestureText = "";
  if (isThumbsUp) currentGestureText = "👍 偵測到：準備開啟商店";
  else if (isOK) currentGestureText = "👌 偵測到：準備關閉商店";
  else if (isPinching) currentGestureText = "🤏 偵測到：抓取食材中";

  let currentTime = millis();
  let deltaTime = currentTime - lastCheckTime;
  lastCheckTime = currentTime;

  if (shopCooldownTimer > 0) shopCooldownTimer -= deltaTime;

  // --- 經營模式：全天總時間倒數 ---
  if (gameState.startsWith("STAGE") && gameState !== "STAGE_CLEAR" && gameMode === "TYCOON" && !isPaused) {
    dayTimer = max(0, baseDayDuration - (millis() - dayStartMillis) / 1000);
    if (totalMoney <= 0) { totalMoney = 0; changeGameState("GAMEOVER"); }
    if (dayTimer <= 0) { handleDayTimeout(); }
  }

  let isPageLocked = (millis() - stateEnterMillis < pageSafetyDuration);
  let isGuideLocked = (gameState === "GUIDE" && millis() - stateEnterMillis < guideSafetyDuration);

  switch (gameState) {
    case "INTRO":
      runIntroScreen(isHandOpen, fingerX, fingerY, isHandDetected, deltaTime);
      break;
    case "GUIDE":
      runGuideScreen(fingerX, fingerY, isHandDetected, deltaTime, isGuideLocked);
      break;
    case "START":
      runStartScreen(isHandOpen, deltaTime);
      break;
    case "MODE_SELECT": 
      runModeSelectScreen(fingerX, fingerY, isHandDetected, deltaTime, isPageLocked);
      break;
    case "STAGE1":
      runStage1(fingerX, fingerY, isFist, deltaTime, currentGestureText); 
      break;
    case "STAGE2":
      runStage2(fingerX, fingerY, isHandDetected, deltaTime, currentGestureText); 
      break;
    case "STAGE3":
      runStage3(fingerX, fingerY, deltaTime, currentGestureText); 
      break;
    case "STAGE_CLEAR":
      // 將偵測到的特殊手勢傳入結算畫面
      runStageClearScreen(fingerX, fingerY, isHandDetected, isHandOpen, isThumbsUp, isOK, handSide, deltaTime);
      break;
    case "GAMEOVER":
      drawGameOverScreen();
      break;
  }

  if (!isPageLocked && isHandDetected && gameState !== "STAGE_CLEAR") {
    checkUIInteraction(fingerX, fingerY, false, deltaTime);
  }

  if (isPaused) {
    drawPauseOverlay(fingerX, fingerY, isHandDetected);
  }

  if (bombFlashTimer > 0) {
    fill(255, 0, 0, bombFlashTimer); rect(0, 0, width, height); bombFlashTimer -= 15; 
  }

  if (isHandDetected) {
    prevHandX = fingerX; prevHandY = fingerY;
  }

  if (!isPaused) updateParticles();
  drawInventory();
}

// ==========================================
// 特殊手勢演算法
// ==========================================
function checkThumbsUp(hand) {
  let ann = hand.annotations;
  // 比讚：大拇指頂點高於大拇指根部，且其他四隻手指收起（靠近掌心）
  let thumbUp = ann.thumb[3][1] < ann.thumb[1][1];
  let palmBase = hand.landmarks[0];
  let closedCount = 0;
  for (let f of ['indexFinger', 'middleFinger', 'ringFinger', 'pinky']) {
    if (dist(ann[f][3][0], ann[f][3][1], palmBase[0], palmBase[1]) < 90) closedCount++;
  }
  return (thumbUp && closedCount >= 3);
}

function checkOKGesture(hand) {
  let ann = hand.annotations;
  // OK：大拇指指尖與食指指尖捏合，但中指、無名指伸直高於根部
  let d = dist(ann.thumb[3][0], ann.thumb[3][1], ann.indexFinger[3][0], ann.indexFinger[3][1]);
  let isPinch = (d < 35);
  let othersOpen = (ann.middleFinger[3][1] < ann.middleFinger[1][1] && ann.ringFinger[3][1] < ann.ringFinger[1][1]);
  return (isPinch && othersOpen);
}

function checkHandOpen(hand) {
  let ann = hand.annotations;
  return (ann.indexFinger[3][1] < ann.indexFinger[1][1] && ann.middleFinger[3][1] < ann.middleFinger[1][1] && ann.ringFinger[3][1] < ann.ringFinger[1][1] && ann.pinky[3][1] < ann.pinky[1][1]);
}

function checkIsFist(hand) {
  let ann = hand.annotations; let palmBase = hand.landmarks[0]; let closedCount = 0;
  for (let f of ['indexFinger', 'middleFinger', 'ringFinger', 'pinky']) {
    if (dist(ann[f][3][0], ann[f][3][1], palmBase[0], palmBase[1]) < 80) closedCount++;
  }
  return closedCount >= 3;
}

// ==========================================
// 核心：結算與黑市手勢控制驅動
// ==========================================
function runStageClearScreen(fx, fy, hasHand, isHandOpen, isThumbsUp, isOK, handSide, dt) {
  fill(20, 12, 28, 240); rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  
  let boxW = width * 0.85, boxH = height * 0.68; 
  let boxX = width/2 - boxW/2, boxY = height * 0.1;
  fill(35, 20, 45, 235); stroke(255, 215, 0, 180); strokeWeight(3); 
  rect(boxX, boxY, boxW, boxH, 20); noStroke();
  
  fill(255, 215, 0); textSize(28); text(transitionTitle, width / 2, boxY + 40);
  fill(245, 225, 230); textSize(15); text(transitionDesc, width / 2, boxY + 80);
  
  if (gameMode === "TYCOON" && isActualDayEnd) {
    let statsY = boxY + 125;
    fill(255, 255, 255, 20); rect(boxX + 40, statsY - 20, boxW - 80, 50, 8);
    textAlign(LEFT, CENTER); fill(100, 255, 150); textSize(18); text(`💰 目前總資產: $${totalMoney} 元`, boxX + 60, statsY * 1.005);
    textAlign(RIGHT, CENTER); fill(255, 130, 160); text(`⭐ 顧客滿意度: ${satisfaction} 分`, boxX + boxW - 60, statsY * 1.005);
    
    // 繪製歷史折線圖
    if (moneyHistory.length >= 2) {
      let graphX = boxX + 80, graphY = boxY + 190, graphW = boxW - 160, graphH = boxH - 260;
      stroke(255, 255, 255, 30); strokeWeight(1); noFill(); rect(graphX, graphY, graphW, graphH);
      let maxM = max(moneyHistory), minM = min(moneyHistory);
      if (maxM === minM) { maxM += 100; minM = max(0, minM - 100); }
      let padding = (maxM - minM) * 0.1; maxM += padding; minM = max(0, minM - padding);

      stroke(255, 215, 0); strokeWeight(3); noFill(); beginShape();
      for (let i = 0; i < moneyHistory.length; i++) {
        vertex(graphX + map(i, 0, moneyHistory.length - 1, 0, graphW), graphY + graphH - map(moneyHistory[i], minM, maxM, 0, graphH));
      }
      endShape();
      noStroke();
      for (let i = 0; i < moneyHistory.length; i++) {
        let px = graphX + map(i, 0, moneyHistory.length - 1, 0, graphW);
        let py = graphY + graphH - map(moneyHistory[i], minM, maxM, 0, graphH);
        fill(255, 100, 150); ellipse(px, py, 8, 8);
        fill(255); textAlign(CENTER, BOTTOM); textSize(11); text(`D${i}\n$${Math.round(moneyHistory[i])}`, px, py - 6);
      }
    }
  } else {
    textAlign(CENTER, CENTER); fill(180, 170, 200); textSize(18); text("⏱️ 備料程序正常，系統正在自動對接下個工作台...", width / 2, boxY + 200);
  }

  // --- 手勢商店核心驅動排程 ---
  if (gameMode === "TYCOON" && isActualDayEnd) {
    if (!isShopOpen) {
      // 1. 未開商店時：比讚 👍 即可開啟
      if (hasHand && isThumbsUp && shopCooldownTimer <= 0) {
        isShopOpen = true;
        shopCooldownTimer = 800; // 設置防連擊冷卻
        spawnParticles(width/2, height/2, color(255, 215, 0));
      }
    } else {
      // 2. 已開商店時：比 OK 👌 關閉
      if (hasHand && isOK && shopCooldownTimer <= 0) {
        isShopOpen = false;
        shopCooldownTimer = 800;
      }
      // 3. 已開商店時：舉左/右手購買物品
      if (hasHand && shopCooldownTimer <= 0 && !isOK && !isThumbsUp) {
        if (handSide === "LEFT") { // 畫面左側(玩家右手) -> 買維他命
          buyItem("VITAMIN");
          shopCooldownTimer = 1000; 
        } else if (handSide === "RIGHT") { // 畫面右側(玩家左手) -> 買沙漏
          buyItem("HOURGLASS");
          shopCooldownTimer = 1000;
        }
      }
    }
  }

  textAlign(CENTER, CENTER);

  // 跨日蓄能倒數提示
  if (!isShopOpen) {
    let requiredTime = 3000; 
    if (isActualDayEnd) {
      if (hasHand && isHandOpen && !isThumbsUp && !isOK) { transitionGestureTimer += dt; } 
      else { transitionGestureTimer = max(0, transitionGestureTimer - dt * 1.5); }
      
      let progressW = map(constrain(transitionGestureTimer, 0, requiredTime), 0, requiredTime, 0, 380);
      fill(255, 255, 255, 40); rect(width/2 - 190, height - 120, 380, 14, 7);
      fill(255, 215, 0); rect(width/2 - 190, height - 120, progressW, 14, 7);
      
      fill(255); textSize(15);
      if (hasHand && isHandOpen && !isThumbsUp) {
        text(`✨ 正在蓄能前進下一天... 還剩 ${max(0, (requiredTime - transitionGestureTimer)/1000).toFixed(1)} 秒`, width / 2, height - 85);
      } else {
        fill(255, 230, 150);
        text("👍 比個讚開啟黑市商店 | 🖐️ 舉起手掌(比布) 3 秒直接跨入下一天", width / 2, height - 85);
      }
    } else {
      // 自動轉換關卡
      transitionGestureTimer += dt;
      let countdown = max(0, (requiredTime - transitionGestureTimer) / 1000).toFixed(1);
      fill(255); textSize(16); text(`⏱️ 正在自動前往下一關... 剩餘 ${countdown} 秒`, width / 2, height - 85);
    }

    if (transitionGestureTimer >= requiredTime) {
      transitionGestureTimer = 0;
      if (nextState === "STAGE1") { changeGameState("STAGE1"); } 
      else if (nextState === "STAGE2") { initStage2(); changeGameState("STAGE2"); } 
      else if (nextState === "STAGE3") { initStage3(); changeGameState("STAGE3"); } 
    }
  }

  // 渲染商店覆蓋層
  if (isShopOpen) { 
    drawShopOverlay(fx, fy, hasHand, handSide); 
  }
}

// ==========================================
// UI 渲染：純手勢黑市商店
// ==========================================
function drawShopOverlay(fx, fy, hasHand, handSide) {
  push();
  let shW = 620, shH = 420, shX = width/2 - shW/2, shY = height/2 - shH/2;
  fill(25, 15, 35, 250); stroke(255, 100, 180, 220); strokeWeight(4);
  rect(shX, shY, shW, shH, 18); noStroke();
  
  textAlign(CENTER, CENTER); fill(255, 105, 180); textSize(26);
  text("🛒 每日神廚黑市 (今日限購一次)", width/2, shY + 35);
  fill(240, 220, 255); textSize(14); text(`目前連鎖總資產: $${totalMoney} 元`, width/2, shY + 65);

  let keys = Object.keys(shopInventory);
  for (let i = 0; i < keys.length; i++) {
    let key = keys[i];
    let item = shopInventory[key];
    let col = i % 2; // 0 或 1
    let row = floor(i / 2);
    let ix = shX + 40 + col * 290;
    let iy = shY + 90 + row * 135;

    // 判定該商品對應的手感應區 (左排用左手, 右排用右手)
    let isDetected = hasHand && ((col === 0 && handSide === "LEFT") || (col === 1 && handSide === "RIGHT"));
    
    if (item.bought) fill(60, 60, 70, 150);
    else if (isDetected) fill(90, 50, 110);
    else fill(45, 30, 60);

    stroke(255, 215, 0, isDetected && !item.bought ? 200 : 40);
    rect(ix, iy, 250, 115, 12); noStroke();

    fill(item.bought ? 130 : 255, 230, 150); textAlign(CENTER, CENTER);
    textSize(18); text(item.name, ix + 125, iy + 30);
    fill(200); textSize(12); 
    text(item.bought ? "今日份量已售完" : "感應此區即可購買", ix + 125, iy + 55);
    fill(100, 255, 150); textSize(16); 
    text(item.bought ? "SOLD OUT" : `$ ${item.price}`, ix + 125, iy + 85);

    // 購買觸發
    if (!item.bought && isDetected && shopCooldownTimer <= 0) {
      buyItem(key);
      shopCooldownTimer = 1000;
    }
  }

  // 底部控制操作提示
  fill(255, 100, 150); textSize(15);
  text("👌 比出「OK」手勢 ➔ 關閉並離開商店", width/2, shY + shH - 65);
  
  if (shopCooldownTimer > 0) {
    fill(255, 255, 0); textSize(12); text(`⏳ 交易處理中...`, width/2, shY + shH - 30);
  } else {
    fill(150, 240, 150); textSize(12); text(`✅ 黑市感應器就緒`, width/2, shY + shH - 30);
  }
  pop();
}

function buyItem(key) {
  let item = shopInventory[key];
  if (totalMoney >= item.price) {
    totalMoney -= item.price;
    item.bought = true;
    myItems.push(item.name);
    
    if (key === "VITAMIN") satisfaction = min(100, satisfaction + 15);
    if (key === "HOURGLASS") baseDayDuration += 10;
    
    spawnParticles(width/2, height/2, color(255, 215, 0));
  }
}

// ==========================================
// 骨架繪製與特殊手勢狀態變色
// ==========================================
function drawHandSkeleton(hand, pinching, isOpen, isFist, isThumbsUp, isOK) {
  push();
  let landmarks = hand.landmarks; let annotations = hand.annotations; strokeWeight(4);
  
  if (isThumbsUp) stroke(255, 215, 0, 240);       // 比讚顯示黃金光
  else if (isOK) stroke(0, 191, 255, 240);         // 比 OK 顯示深天藍光
  else if (isFist) stroke(0, 255, 100, 230); 
  else if (isOpen) stroke(255, 255, 255, 200); 
  else if (pinching) stroke(255, 60, 120, 230); 
  else stroke(255, 130, 170, 190); 
  noFill();
  
  for (let finger of ['thumb', 'indexFinger', 'middleFinger', 'ringFinger', 'pinky']) {
    beginShape();
    let fingerPoints = annotations[finger]; 
    for (let i = 0; i < fingerPoints.length; i++) { 
      let pt = fingerPoints[i]; 
      vertex(width - (pt[0] * (width / video.width)), pt[1] * (height / video.height)); 
    }
    endShape();
  }
  
  noStroke();
  for (let pt of landmarks) {
    let x = width - (pt[0] * (width / video.width)), y = pt[1] * (height / video.height);
    if (isThumbsUp) fill(255, 215, 0);
    else if (isOK) fill(0, 191, 255);
    else if (isFist) fill(0, 255, 100);
    else if (isOpen) fill(255);
    else if (pinching) fill(255, 50, 100);
    else fill(255, 160, 190);
    ellipse(x, y, 9, 9);
  }
  pop();
}

function handleDayTimeout() {
  totalMoney = max(0, totalMoney - 30); 
  moneyHistory.push(totalMoney); 
  resetShop(); // 每日結算重置商店
  currentDay++;
  startTransition("STAGE1", "❌ 糟糕！營業時間耗盡", "今天沒能來得及出爐披薩！\n強制扣除店面耗損 -$30\n👍 比讚開黑市，或 🖐️ 比布 3 秒前進...", true);
}

function resetShop() {
  for (let k in shopInventory) shopInventory[k].bought = false;
  myItems = [];
}

function drawInventory() {
  if (myItems.length === 0 || gameState === "INTRO" || gameState === "GUIDE") return;
  push();
  fill(0, 150); noStroke();
  rect(width - 180, height - 130, 160, 110, 10);
  fill(255, 215, 0); textSize(14); textAlign(LEFT, TOP);
  text("🎒 持有道具:", width - 165, height - 115);
  fill(255, 200); textSize(12);
  for (let i = 0; i < myItems.length; i++) {
    text("● " + myItems[i], width - 165, height - 90 + i * 18);
  }
  pop();
}

function checkUIInteraction(hx, hy, isMouseClick, dt = 0) {
  // 為了防止衝突，非結算畫面的滑鼠點擊維持原本的基礎換頁邏輯
  if (gameState.startsWith("STAGE") && !isPaused) {
    let btnX = 20, btnY = height - 70, btnW = 60, btnH = 50;
    if (hx > btnX && hx < btnX + btnW && hy > btnY && hy < btnY + btnH && isMouseClick) {
      isPaused = true; pauseStartMillis = millis();
    }
  }
  if (isPaused && isMouseClick) {
    let boxX = width / 2 - 150;
    if (hx > boxX && hx < boxX + 300 && hy > height/2 - 30 && hy < height/2 + 20) { isPaused = false; dayStartMillis += (millis() - pauseStartMillis); }
    if (hx > boxX && hx < boxX + 300 && hy > height/2 + 40 && hy < height/2 + 90) { isPaused = false; changeGameState("INTRO"); }
  }
}

// ==========================================
// 第一關、第二關、第三關、常駐 UI 與粒子特效其餘邏輯完整保留
// ==========================================
function runIntroScreen(isOpen, fx, fy, hasHand, dt) {
  textAlign(CENTER, CENTER); stroke(0); strokeWeight(5); fill(255); textSize(28);
  text("🌸 期末實作報告：隔空抓藥料理王 👩‍🍳", width / 2, height * 0.15); noStroke();

  let btnW = 320, btnH = 80, btnX = width / 2 - btnW / 2, btnY = height * 0.5;
  fill(45, 15, 25, 230); stroke(255, 215, 0, 200); strokeWeight(2); rect(btnX, btnY, btnW, btnH, 15);
  stroke(0); strokeWeight(2); fill(255); textSize(20); text("🌟 點擊滑鼠進入報告並解鎖全螢幕 🌟", width / 2, btnY + btnH / 2); noStroke();
}

function runGuideScreen(fx, fy, hasHand, dt, isGuideLocked) {
  fill(35, 15, 22, 245); rect(0, 0, width, height);
  textAlign(CENTER, CENTER); fill(255, 215, 0); textSize(width * 0.035); text("💡 系統操作與設計簡介 💡", width / 2, height * 0.08);
  let boxW = min(width * 0.82, 850), boxH = height * 0.62, boxX = width / 2 - boxW / 2, boxY = height * 0.16;
  fill(55, 25, 35, 200); stroke(255, 100, 140, 80); strokeWeight(1); rect(boxX, boxY, boxW, boxH, 12);
  textSize(15); textAlign(LEFT, TOP); fill(255, 210, 220); text("本動態互動系統支援雙模式，經營模式升級為全天總時間制與微型創業經濟：", boxX + 40, boxY + 25);
  drawGuideCard(boxX + 40, boxY + 70, boxW - 80, 65, "🧅 跨關卡一日總限時 (初始 120 秒)", "時間改為整天共用！必須在時間內依序突破 切菜 ➔ 擺盤 ➔ 烘焙 三大關卡。");
  drawGuideCard(boxX + 40, boxY + 150, boxW - 80, 65, "💰 手勢全自動化黑市內政體系", "結算畫面比 👍 開商店、👌 關商店、左右邊高舉單手直接隔空購物！不需滑鼠觸觸碰。");
  drawGuideCard(boxX + 40, boxY + 230, boxW - 80, 65, "📈 關卡間自動倒數 ➔ 每日結束手動手勢", "關卡間轉換只要3秒自動通過！只有一天全部過完的大總結，才需要比手勢3秒並看報表。");
  textAlign(CENTER, CENTER);
  if (isGuideLocked) {
    fill(255, 100, 100); textSize(18); text(`🛑 報告安全防鎖定中... 請放心講解 (${Math.ceil((guideSafetyDuration - (millis() - stateEnterMillis)) / 1000)}秒後解鎖)`, width / 2, height - 70);
  } else {
    fill(100, 255, 150); textSize(18); text("✅ 簡報已解鎖！大範圍快速揮手 🖐️ 或【直接點擊滑鼠】即可進入下一頁！", width / 2, height - 70);
    if (hasHand && (abs(fx - prevHandX) > 25 || abs(fy - prevHandY) > 25)) changeGameState("START");
  }
}
function drawGuideCard(x, y, w, h, title, desc) {
  push(); fill(255, 255, 255, 15); noStroke(); rect(x, y, w, h, 6);
  fill(255, 130, 160); textSize(15); text(title, x + 15, y + 12);
  fill(240, 220, 225); textSize(13); text(desc, x + 15, y + 36); pop();
}
function runStartScreen(isOpen, dt) {
  fill(30, 10, 20, 220); rect(0, 0, width, height);
  textAlign(CENTER, CENTER); fill(255); textSize(width * 0.04); text("🌸 隔空抓藥料理王 🌸", width / 2, height / 2 - 80);
  textSize(18); fill(255, 215, 0); text("【最後準備】請比出「布 🖐️」定格 2 秒，前往模式選擇中心！", width / 2, height / 2 - 10);
  if (isOpen) { gestureTimer += dt; if (gestureTimer >= 2000) { gestureTimer = 0; changeGameState("MODE_SELECT"); } }
  else { gestureTimer = max(0, gestureTimer - dt * 2); }
  fill(255, 255, 255, 30); rect(width / 2 - 150, height / 2 + 40, 300, 10, 6);
  if (isOpen) { fill(255, 215, 0); rect(width / 2 - 150, height / 2 + 40, 300 * constrain(gestureTimer / 2000, 0, 1), 10, 6); }
}
function runModeSelectScreen(fx, fy, hasHand, dt, isPageLocked) {
  fill(20, 10, 25, 240); rect(0, 0, width, height);
  textAlign(CENTER, CENTER); fill(255, 215, 0); textSize(35); text("🍳 選擇你的神廚模式 🍳", width / 2, height * 0.15);
  let btnW = 320, btnH = 220, btnY = height / 2 - 40;
  let expX = width * 0.3 - btnW / 2;
  let isHoverExp = (!isPageLocked && hasHand && fx > expX && fx < expX + btnW && fy > btnY && fy < btnY + btnH);
  drawModeButton(expX, btnY, btnW, btnH, "⏱️ 體驗模式", "單純挑戰三大關卡\n無天數限制與倒數扣款\n適合流暢展示", color(60, 100, 200), isHoverExp);
  let tycX = width * 0.7 - btnW / 2;
  let isHoverTyc = (!isPageLocked && hasHand && fx > tycX && fx < tycX + btnW && fy > btnY && fy < btnY + btnH);
  drawModeButton(tycX, btnY, btnW, btnH, "💰 經營模式", "🔥 精實大亨生存挑戰！\n一天限時 120 秒通關全部！\n從微型資金 $100 起家！", color(180, 50, 80), isHoverTyc);

  if (!isPageLocked && hasHand) {
    if (isHoverExp) {
      gestureTimer += dt; if (gestureTimer >= 1000) { gestureTimer = 0; gameMode = "EXPERIENCE"; stage1CutCount = 0; resetFood(); changeGameState("STAGE1"); }
    } else if (isHoverTyc) {
      gestureTimer += dt; if (gestureTimer >= 1000) { gestureTimer = 0; gameMode = "TYCOON"; totalMoney = 100; currentDay = 1; satisfaction = 100; baseDayDuration = 120; moneyHistory = [100]; stage1CutCount = 0; resetFood(); changeGameState("STAGE1"); }
    } else { gestureTimer = 0; }
  }
}
function drawModeButton(x, y, w, h, title, desc, col, isHover) {
  push(); if (isHover) { translate(0, -6); stroke(255, 215, 0); strokeWeight(5); fill(red(col) + 30, green(col) + 30, blue(col) + 30, 240); } else { noStroke(); fill(red(col), green(col), blue(col), 180); }
  rect(x, y, w, h, 20); fill(255); textAlign(CENTER, TOP); textSize(26); text(title, x + w / 2, y + 35);
  fill(235); textSize(14); textAlign(CENTER, TOP); text(desc, x + w / 2, y + 100); pop();
}
function runStage1(fx, fy, isFist, dt) {
  let titleHeader = (gameMode === "TYCOON") ? `【第 ${currentDay} 天 營運中】` : "【體驗模式】";
  let timerStr = (gameMode === "TYCOON") ? "今日剩餘: " + Math.ceil(dayTimer) + " 秒" : "已耗時: " + floor((millis() - dayStartMillis) / 1000) + " 秒";
  drawUI(titleHeader + "第一關：揮手切菜！(目標 10 個)", timerStr);
  if (!isPaused) { foodX += foodSpeedX; foodY += foodSpeedY; foodSpeedY += 0.48; }
  push(); if (foodColor) fill(foodColor); else fill(200); ellipse(foodX, foodY, 80, 80); 
  if (foodType === "BOMB") { stroke(255, 0, 0, 150 + sin(frameCount * 0.2) * 100); strokeWeight(10); ellipse(foodX, foodY, 90, 90); } pop();
  fill(255); textAlign(CENTER, CENTER); textSize(16); text(foodLabel, foodX, foodY);
  if (!isPaused) {
    let d = dist(fx, fy, foodX, foodY);
    if (d < 100 && abs(fy - prevHandY) > 15) {
      if (foodType === "BOMB") {
        if (isFist) { spawnParticles(foodX, foodY, color(0, 255, 100)); } 
        else { bombFlashTimer = 255; for(let i=0; i<50; i++) spawnParticles(foodX, foodY, color(255, 50, 50)); if (gameMode === "TYCOON") satisfaction = max(0, satisfaction - 2); }
      } else { stage1CutCount++; if (gameMode === "TYCOON") totalMoney += 5; spawnParticles(foodX, foodY, foodColor); }
      resetFood(); 
    }
    if (foodY > height + 100) resetFood();
  }
  if (stage1CutCount >= 10 && !isPaused) { if (gameMode === "TYCOON") totalMoney += 30; startTransition("STAGE2", "🎉 第一關備料達標！", (gameMode === "TYCOON" ? "獲得過關獎金 +$30！\n" : "") + "即將前往下一關...", false); }
  drawProgressBar(stage1CutCount, 10, "食材備料數量");
}
function resetFood() {
  foodX = random(width * 0.2, width * 0.8); foodY = height + 50; foodSpeedX = random(-3, 3); foodSpeedY = random(-19, -23);
  let r = random(100);
  if (r < 30) { foodType = "ONION"; foodLabel = "🧅\n洋蔥"; foodColor = color(200, 160, 220); } 
  else if (r < 60) { foodType = "TOMATO"; foodLabel = "🍅\n番茄"; foodColor = color(255, 90, 90); } 
  else if (r < 85) { foodType = "PINEAPPLE"; foodLabel = "🍍\n鳳梨"; foodColor = color(255, 210, 50); } 
  else { foodType = "BOMB"; foodLabel = "💣\n壞馬鈴薯"; foodColor = color(70, 70, 80); }
}
function initStage2() { stage2PizzaCount = 0; targetBoxX = width / 2; targetBoxY = height - 160; hasItem = false; isWaitingForDrop = false; updateCheesePosition(); }
function updateCheesePosition() { cheeseSpawnX = (random(100) < 50) ? width * 0.2 : width * 0.8; }
function runStage2(fx, fy, hasHand, dt, gestureStatus) {
  let titleHeader = (gameMode === "TYCOON") ? `【第 ${currentDay} 天 營運中】` : "【體驗模式】";
  let timerStr = (gameMode === "TYCOON") ? "今日剩餘: " + Math.ceil(dayTimer) + " 秒" : "已耗時: " + floor((millis() - dayStartMillis) / 1000) + " 秒";
  drawUI(titleHeader + "第二關：👌捏合抓取起司放至披薩皮！", timerStr, gestureStatus);
  let cheeseX = cheeseSpawnX, cheeseY = 180, cheeseW = 140, cheeseH = 80;
  push(); drawingContext.setLineDash([6, 6]); stroke(255, 130, 160, 200); fill(255, 130, 160, 20);
  if (!isPaused && hasHand && isPinching && fx > cheeseX - cheeseW/2 && fx < cheeseX + cheeseW/2 && fy > cheeseY - cheeseH/2 && fy < cheeseY + cheeseH/2) {
    stroke(255, 215, 0); fill(255, 215, 0, 40); if (!hasItem) { hasItem = true; isWaitingForDrop = false; itemX = fx; itemY = fy; spawnParticles(fx, fy, color(255, 215, 0)); }
  }
  rect(cheeseX - cheeseW/2, cheeseY - cheeseH/2, cheeseW, cheeseH, 10); pop();
  fill(255); textAlign(CENTER, CENTER); textSize(16); text("🧀 虛線起司區", cheeseX, cheeseY);
  let currentCheeseX = hasItem ? itemX : cheeseX, currentCheeseY = hasItem ? itemY : cheeseY;
  let distToPizza = dist(currentCheeseX, currentCheeseY, targetBoxX, targetBoxY);
  push(); if (hasItem && distToPizza < 80) { stroke(255, 215, 0); strokeWeight(4); fill(255, 180, 200, 220); } else { noStroke(); fill(255, 150, 180, 180); }
  ellipse(targetBoxX, targetBoxY, 160, 160); pop();
  fill(255); text("🍕 披薩餅皮", targetBoxX, targetBoxY);
  drawProgressBar(stage2PizzaCount, 2, "目前成功擺盤起司數");
  if (hasItem && !isPaused) {
    if (hasHand && isPinching) { itemX = fx; itemY = fy; isWaitingForDrop = false; } 
    else {
      if (!isWaitingForDrop) { isWaitingForDrop = true; pinchReleaseTime = millis(); }
      if (millis() - pinchReleaseTime > 1500) {
        if (distToPizza < 80) { stage2PizzaCount++; if (gameMode === "TYCOON") { totalMoney += 15; satisfaction = min(100, satisfaction + 5); } spawnParticles(targetBoxX, targetBoxY, color(255, 215, 0)); updateCheesePosition(); } else { spawnParticles(itemX, itemY, color(255, 0, 0)); }
        hasItem = false; isWaitingForDrop = false;
      }
    }
    push(); fill(255, 215, 0); ellipse(itemX, itemY, 45, 45); fill(0); textSize(12); text("🧀", itemX, itemY); pop();
  }
  if (stage2PizzaCount >= 2 && !isPaused) { if (gameMode === "TYCOON") totalMoney += 40; startTransition("STAGE3", "🌟 第二關達標！起司放滿", (gameMode === "TYCOON" ? "獲得過關獎金 +$40！\n" : "") + "即將前往下一關...", false); }
}
function initStage3() { ovenStarted = false; ovenButtons = []; }
function spawnOvenButtons() {
  ovenButtons = []; let labels = ["🌡️ 溫度設定", "⏱️ 定時旋鈕", "🌀 旋風風速"]; let colors = [color(255, 120, 50), color(255, 200, 50), color(50, 180, 255)];
  for (let i = 0; i < ovenTargetCount; i++) { ovenButtons.push({ x: random(width * 0.15, width * 0.85), y: random(height * 0.25, height * 0.75), size: 90, label: labels[i], col: colors[i], active: true }); }
}
function runStage3(fx, fy, dt, gestureStatus) {
  let titleHeader = (gameMode === "TYCOON") ? `【第 ${currentDay} 天 營運中】` : "【體驗模式】";
  let timerStr = (gameMode === "TYCOON") ? "今日剩餘: " + Math.ceil(dayTimer) + " 秒" : "已耗時: " + floor((millis() - dayStartMillis) / 1000) + " 秒";
  drawUI(titleHeader + "第三關：設定烤箱參數", timerStr, gestureStatus);
  
  let boxW = 400, boxH = 260, boxX = width/2 - boxW/2, boxY = height/2 - boxH/2;
  push(); fill(30, 30, 40, 200); stroke(120); strokeWeight(5); rect(boxX, boxY, boxW, boxH, 15);
  fill(60, 40, 40, 150); stroke(255, 100, 50, 100); rect(boxX + 30, boxY + 30, boxW - 60, boxH - 100, 5); pop();

  if (!ovenStarted) {
    let startBtnX = width / 2; let startBtnY = height / 2 - 20; let startBtnR = 100;
    let hover = (!isPaused && dist(fx, fy, startBtnX, startBtnY) < startBtnR / 2);
    push(); if (hover) { fill(255, 50, 50); stroke(255, 215, 0); } else { fill(200, 30, 30); stroke(255); } ellipse(startBtnX, startBtnY, startBtnR, startBtnR); pop();
    fill(255); text("🔥\n啟動烤箱", startBtnX, startBtnY); if (hover) { ovenStarted = true; spawnParticles(startBtnX, startBtnY, color(255, 100, 0)); spawnOvenButtons(); }
  } else {
    let remaining = 0;
    for (let btn of ovenButtons) {
      if (btn.active) {
        remaining++; if (!isPaused && dist(fx, fy, btn.x, btn.y) < btn.size / 2) { btn.active = false; if (gameMode === "TYCOON") totalMoney += 10; spawnParticles(btn.x, btn.y, btn.col); }
        push(); fill(btn.col); stroke(255); ellipse(btn.x, btn.y, btn.size, btn.size); fill(255); text(btn.label, btn.x, btn.y); pop();
      }
    }
    drawProgressBar(ovenTargetCount - remaining, ovenTargetCount, "已完成烤箱設定面板");
    if (remaining === 0 && !isPaused) {
      if (gameMode === "TYCOON") { totalMoney += 100; moneyHistory.push(totalMoney); currentDay++; startTransition("STAGE1", `🍕 第 ${currentDay-1} 天 披薩完美出爐！`, `🎉 順利完成一整組披薩！獲得出爐大紅包 +$100 元！`, true); } 
      else { totalUsedSeconds = ((millis() - dayStartMillis) / 1000).toFixed(2); changeGameState("GAMEOVER"); }
    }
  }
}
function drawGameOverScreen() {
  fill(20, 10, 30, 250); rect(0, 0, width, height);
  textAlign(CENTER, CENTER); fill(255, 215, 0); textSize(40); text(gameMode === "EXPERIENCE" ? "⏱️ 體驗模式 通關成績單" : "💸 🚨 遺憾！神廚破產公告 🚨 💸", width / 2, height * 0.15);
  let boxW = 600, boxH = 350; fill(40, 20, 50, 200); stroke(255, 215, 0); rect(width / 2 - boxW / 2, height / 2 - 100, boxW, boxH, 20); noStroke();
  fill(255); textAlign(LEFT, CENTER); textSize(24);
  if (gameMode === "EXPERIENCE") { text(`🏆 第三關烘焙耗時: ${totalUsedSeconds} 秒`, width / 2 - 200, height / 2); } 
  else { text(`📈 最終營運天數: 第 ${currentDay - 1} 天`, width / 2 - 200, height / 2 - 50); text(`💰 破產時資產: $ ${totalMoney} 元`, width / 2 - 200, height / 2); text(`⭐ 最終顧客滿意度: ${satisfaction} 分`, width / 2 - 200, height / 2 + 50); }
  fill(255, 100, 140); rect(width/2 - 100, height - 100, 200, 50, 10); fill(255); textAlign(CENTER, CENTER); text("重新回到首頁", width / 2, height - 75);
}
function drawUI(title, timerStr, gestureStatus = "") {
  // 畫頂部狀態列
  fill(35, 15, 25, 200); 
  rect(0, 0, width, 85);
  
  // 顯示標題與資產
  textAlign(LEFT, CENTER); fill(255); textSize(16);
  let fullTitle = "👩‍🍳 " + title + (gameMode === "TYCOON" ? ` | 💰 資產: $${totalMoney}` : "");
  text(fullTitle, 30, 30);
  
  // 顯示手勢提示框 (新增)
  if (gestureStatus !== "") {
    fill(255, 215, 0, 40); stroke(255, 215, 0); strokeWeight(1);
    rect(30, 48, 220, 26, 5); noStroke();
    fill(255, 215, 0); textSize(13);
    text(gestureStatus, 40, 61);
  }

  // 顯示右上角固定 HUD
  textAlign(RIGHT, CENTER); textSize(18); fill(255, 100, 140);
  text(timerStr, width - 30, 30);
  
  // 懸浮圖示 HUD (常駐提示)
  push();
  fill(255, 255, 255, 50); 
  ellipse(width - 40, 58, 36, 36); // 商店圖示
  fill(255); textAlign(CENTER, CENTER); textSize(16); text("🛒", width - 40, 58);
  
  fill(255, 255, 255, 50); 
  ellipse(width - 85, 58, 36, 36); // 暫停圖示
  fill(255); text("⏸", width - 85, 58);
  pop();
}
function drawProgressBar(current, target, label) {
  push(); let barW = 300; let barH = 22; let barX = width / 2 - barW / 2; let barY = height - 60;
  fill(0, 130); rect(barX, barY, barW, barH, 10); fill(255, 215, 0); rect(barX, barY, map(constrain(current, 0, target), 0, target, 0, barW), barH, 10);
  textAlign(CENTER, CENTER); fill(255); textSize(13); text(label + " : " + current + " / " + target, width / 2, barY + barH / 2); pop();
}
function spawnParticles(x, y, col) { for (let i = 0; i < 20; i++) { particles.push({ x: x, y: y, vx: random(-5, 5), vy: random(-5, 5), alpha: 255, r: red(col), g: green(col), b: blue(col) }); } }
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i]; p.x += p.vx; p.y += p.vy; p.alpha -= 6; fill(p.r, p.g, p.b, p.alpha); noStroke(); ellipse(p.x, p.y, 8, 8); if (p.alpha <= 0) particles.splice(i, 1);
  }
}// ==========================================
// 補充遺漏的函數：負責關卡轉場
// ==========================================
function startTransition(next, title, desc, isDayEnd) {
  gameState = "STAGE_CLEAR";
  nextState = next;
  transitionTitle = title;
  transitionDesc = desc;
  transitionGestureTimer = 0;
  isActualDayEnd = isDayEnd;
}