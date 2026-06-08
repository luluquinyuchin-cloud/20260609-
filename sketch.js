/* ====================================================================
  【神廚大亨：隔空抓藥料理王 v15.2 - 變數未定義修正版】
  修改重點：
    1. 修正 v15.1 中 drawHandSkeleton 內 pt 未定義的 ReferenceError。
    2. 確保雙重迴圈正確讀取 annotations 的手指頂點資料。
    3. 完整保留雙模式、黑市商店、與經營模式的所有計時與財報機制。
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
let dayTimer = 120;         // 今天的剩餘時間（跨關卡共用）
let dayStartMillis = 0;     // 記錄每天開始的時間戳記
let pauseStartMillis = 0;   
let totalUsedSeconds = 0;  

// 經營系統與統計變數
let totalMoney = 100;       // 初始資金 $100
let satisfaction = 100;   
let stage1CutCount = 0;    
let stage2PizzaCount = 0;  

// 歷史資產紀錄（用於繪製折線圖）
let moneyHistory = [100];   // 初始第 0 天資產為 100

// 全螢幕爆炸特效計時器
let bombFlashTimer = 0; 

// 過渡轉場畫面控制變數
let nextState = "";
let transitionTitle = "";
let transitionDesc = "";
let transitionGestureTimer = 0; // 用於換日手勢/自動倒數的計時器
let isActualDayEnd = false;     // 分辨是關卡間轉換，還是真正的單日結算

// 商店介面控制變數
let isShopOpen = false;

// 第一關物件變數
let foodX, foodY, foodSpeedX, foodSpeedY; 
let foodType = ""; 
let foodLabel = "";
let foodColor;

let prevHandY = 0; 
let prevHandX = 0; 
let isPinching = false; 

let particles = [];

// 手勢計時與蓄能控制變數（用於主選單解鎖）
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

// 多場景通用防誤觸與懸浮變數
let stateEnterMillis = 0;    
let pageSafetyDuration = 1000; 
let guideSafetyDuration = 3000; 

let hoverTimer = 0;            
let hoverTargetMode = "";      
let hoverRequired = 1000; 

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
  
  // 回到第一關代表新的一天正式開始，重設跨關卡總計時器與計數
  if (newState === "STAGE1") {
    dayStartMillis = millis();
    dayTimer = baseDayDuration;
    stage1CutCount = 0;
  }
}

function mousePressed() {
  triggerFullscreen();

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

function triggerFullscreen() {
  let fs = fullscreen();
  if (!fs) fullscreen(true);
}

function draw() {
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  let fingerX = 0, fingerY = 0;
  let isHandDetected = false;
  let currentHandData = null;
  let isHandOpen = false; 
  let isFist = false; 
  
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
    
    drawHandSkeleton(currentHandData, isPinching, isHandOpen, isFist);
  }

  let currentTime = millis();
  let deltaTime = currentTime - lastCheckTime;
  lastCheckTime = currentTime;

  // --- 經營模式：全天總時間倒數 ---
  if (gameState.startsWith("STAGE") && gameState !== "STAGE_CLEAR" && gameMode === "TYCOON" && !isPaused) {
    dayTimer = max(0, baseDayDuration - (millis() - dayStartMillis) / 1000);
    
    if (totalMoney <= 0) {
      totalMoney = 0;
      changeGameState("GAMEOVER");
    }
    
    if (dayTimer <= 0) {
      handleDayTimeout();
    }
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
      runStage1(fingerX, fingerY, isFist, deltaTime); 
      break;
    case "STAGE2":
      runStage2(fingerX, fingerY, isHandDetected, deltaTime); 
      break;
    case "STAGE3":
      runStage3(fingerX, fingerY, deltaTime); 
      break;
    case "STAGE_CLEAR":
      runStageClearScreen(fingerX, fingerY, isHandDetected, isHandOpen, deltaTime);
      break;
    case "GAMEOVER":
      drawGameOverScreen();
      break;
  }

  if (!isPageLocked && isHandDetected) {
    checkUIInteraction(fingerX, fingerY, false, deltaTime);
  } else {
    if (hoverTargetMode.startsWith("UI_")) {
      hoverTargetMode = "";
      hoverTimer = 0;
    }
  }

  if (isPaused) {
    drawPauseOverlay(fingerX, fingerY, isHandDetected);
  }

  if (isPageLocked && gameState === "MODE_SELECT") {
    push();
    fill(255, 50, 50, 40); rect(0, 0, width, height);
    fill(255, 100, 100); textAlign(CENTER, CENTER); textSize(22);
    text("⚠️ 安全鎖定中，請先將手移開按鈕區... ⚠️", width / 2, height - 110);
    pop();
  }

  if (bombFlashTimer > 0) {
    fill(255, 0, 0, bombFlashTimer); 
    rect(0, 0, width, height);
    bombFlashTimer -= 15; 
  }

  if (isHandDetected) {
    prevHandX = fingerX;
    prevHandY = fingerY;
  }

  if (!isPaused) {
    updateParticles();
  }
}

// ==========================================
// 暫停與商店 UI 互動邏輯
// ==========================================
function checkUIInteraction(hx, hy, isMouseClick, dt = 0) {
  if (gameState.startsWith("STAGE") && gameState !== "STAGE_CLEAR" && !isShopOpen) {
    let btnX = 20, btnY = height - 70, btnW = 60, btnH = 50;
    if (hx > btnX && hx < btnX + btnW && hy > btnY && hy < btnY + btnH) {
      handleUIHover("UI_PAUSE", isMouseClick, dt, () => { triggerPause(); });
      return;
    }
  }

  if (isPaused) {
    let boxX = width / 2 - 150;
    if (hx > boxX && hx < boxX + 300 && hy > height/2 - 30 && hy < height/2 + 20) {
      handleUIHover("UI_RESUME", isMouseClick, dt, () => { resumeGame(); });
      return;
    }
    if (hx > boxX && hx < boxX + 300 && hy > height/2 + 40 && hy < height/2 + 90) {
      handleUIHover("UI_QUIT", isMouseClick, dt, () => { isPaused = false; changeGameState("INTRO"); });
      return;
    }
  }

  if (gameState === "STAGE_CLEAR" && gameMode === "TYCOON" && isActualDayEnd) {
    let sBtnX = width - 160, sBtnY = height - 80, sBtnW = 130, sBtnH = 60;
    if (!isShopOpen) {
      if (hx > sBtnX && hx < sBtnX + sBtnW && hy > sBtnY && hy < sBtnY + sBtnH) {
        handleUIHover("UI_OPEN_SHOP", isMouseClick, dt, () => { isShopOpen = true; });
        return;
      }
    } else {
      let shX = width/2 - 250, shY = height/2 - 180;
      if (hx > shX + 40 && hx < shX + 220 && hy > shY + 110 && hy < shY + 230) {
        handleUIHover("UI_BUY_A", isMouseClick, dt, () => { buyItem("VITAMIN"); });
        return;
      }
      if (hx > shX + 280 && hx < shX + 460 && hy > shY + 110 && hy < shY + 230) {
        handleUIHover("UI_BUY_B", isMouseClick, dt, () => { buyItem("HOURGLASS"); });
        return;
      }
      if (hx > shX + 175 && hx < shX + 325 && hy > shY + 260 && hy < shY + 310) {
        handleUIHover("UI_CLOSE_SHOP", isMouseClick, dt, () => { isShopOpen = false; });
        return;
      }
    }
  }

  if (hoverTargetMode.startsWith("UI_") && !isMouseClick) {
    hoverTargetMode = "";
    hoverTimer = 0;
  }
}

function handleUIHover(targetTag, isClick, dt, action) {
  if (isClick) {
    spawnParticles(mouseX, mouseY, color(255, 215, 0));
    action();
    hoverTargetMode = ""; hoverTimer = 0;
  } else {
    if (hoverTargetMode !== targetTag) {
      hoverTargetMode = targetTag;
      hoverTimer = 0;
    }
    hoverTimer += dt;
    if (hoverTimer >= hoverRequired) {
      hoverTargetMode = ""; hoverTimer = 0;
      action();
    }
  }
}

function triggerPause() {
  if (isPaused) return;
  isPaused = true;
  pauseStartMillis = millis();
}

function resumeGame() {
  if (!isPaused) return;
  isPaused = false;
  let pausedDuration = millis() - pauseStartMillis;
  dayStartMillis += pausedDuration; 
}

function buyItem(type) {
  if (type === "VITAMIN") {
    if (totalMoney >= 25) {
      totalMoney -= 25;
      satisfaction = min(100, satisfaction + 15);
      spawnParticles(width/2 - 140, height/2 + 20, color(100, 255, 100));
    }
  } else if (type === "HOURGLASS") {
    if (totalMoney >= 40) {
      totalMoney -= 40;
      baseDayDuration += 10; 
      spawnParticles(width/2 + 100, height/2 + 20, color(50, 180, 255));
    }
  }
}

// ==========================================
// UI 渲染：暫停與商店
// ==========================================
function drawPauseOverlay(fx, fy, hasHand) {
  push();
  fill(10, 5, 15, 200); rect(0, 0, width, height); 
  let boxW = 400, boxH = 260, boxX = width/2 - boxW/2, boxY = height/2 - boxH/2;
  fill(45, 20, 35, 240); stroke(255, 215, 0, 180); strokeWeight(3);
  rect(boxX, boxY, boxW, boxH, 20); noStroke();
  textAlign(CENTER, CENTER); fill(255, 215, 0); textSize(28);
  text("⏸️ 廚房內政暫停中", width / 2, boxY + 40);
  
  let rHover = (hasHand && fx > width/2 - 150 && fx < width/2 + 150 && fy > height/2 - 30 && fy < height/2 + 20);
  fill(rHover ? color(80, 180, 100) : color(40, 120, 60)); rect(width/2 - 150, height/2 - 30, 300, 50, 10);
  fill(255); textSize(18); text("繼續經營料理 (Resume)", width/2, height/2 - 5);
  if (rHover && hoverTargetMode === "UI_RESUME") drawSelectProgress(fx, fy, hoverTimer, hoverRequired);

  let qHover = (hasHand && fx > width/2 - 150 && fx < width/2 + 150 && fy > height/2 + 40 && fy < height/2 + 90);
  fill(qHover ? color(220, 80, 80) : color(150, 40, 40)); rect(width/2 - 150, height/2 + 40, 300, 50, 10);
  fill(255); text("關閉廚房回首頁 (Quit)", width/2, height/2 + 65);
  if (qHover && hoverTargetMode === "UI_QUIT") drawSelectProgress(fx, fy, hoverTimer, hoverRequired);
  pop();
}

function drawShopOverlay(fx, fy, hasHand) {
  push();
  let shW = 500, shH = 360, shX = width/2 - shW/2, shY = height/2 - shH/2;
  fill(30, 20, 40, 245); stroke(255, 100, 180, 200); strokeWeight(4);
  rect(shX, shY, shW, shH, 18); noStroke();
  
  textAlign(CENTER, CENTER); fill(255, 105, 180); textSize(26);
  text("🛒 每日神廚黑市商店 🛒", width/2, shY + 40);
  fill(240, 220, 255); textSize(14); text(`目前連鎖總資產: $${totalMoney} 元`, width/2, shY + 75);

  // 商品 1
  let hA = (hasHand && fx > shX + 40 && fx < shX + 220 && fy > shY + 110 && fy < shY + 230);
  fill(hA ? color(70, 50, 90) : color(45, 30, 60)); stroke(255, 215, 0, 100); strokeWeight(1);
  rect(shX + 40, shY + 110, 180, 120, 10); noStroke();
  fill(255, 230, 150); textSize(16); text("💊 綜合維他命", shX + 130, shY + 135);
  fill(200); textSize(12); text("補滿顧客元氣\n滿意度 +15 分", shX + 130, shY + 165);
  fill(100, 255, 150); textSize(14); text("售價: $25", shX + 130, shY + 205);
  if (hA && hoverTargetMode === "UI_BUY_A") drawSelectProgress(fx, fy, hoverTimer, hoverRequired);

  // 商品 2
  let hB = (hasHand && fx > shX + 280 && fx < shX + 460 && fy > shY + 110 && fy < shY + 230);
  fill(hB ? color(70, 50, 90) : color(45, 30, 60)); stroke(255, 215, 0, 100); strokeWeight(1);
  rect(shX + 280, shY + 110, 180, 120, 10); noStroke();
  fill(255, 230, 150); textSize(16); text("⏰ 時間老沙漏", shX + 370, shY + 135);
  fill(200); textSize(12); text("備料手腳更優雅\n全天時間永久 +10s", shX + 370, shY + 165);
  fill(100, 255, 150); textSize(14); text("售價: $40", shX + 370, shY + 205);
  if (hB && hoverTargetMode === "UI_BUY_B") drawSelectProgress(fx, fy, hoverTimer, hoverRequired);

  // 關閉鈕
  let hC = (hasHand && fx > shX + 175 && fx < shX + 325 && fy > shY + 260 && fy < shY + 310);
  fill(hC ? color(200, 80, 120) : color(130, 40, 70)); rect(shX + 175, shY + 260, 150, 50, 10);
  fill(255); textSize(16); text("離開商店", width/2, shY + 285);
  if (hC && hoverTargetMode === "UI_CLOSE_SHOP") drawSelectProgress(fx, fy, hoverTimer, hoverRequired);
  pop();
}

function handleDayTimeout() {
  totalMoney = max(0, totalMoney - 30); 
  moneyHistory.push(totalMoney); 
  currentDay++;
  startTransition("STAGE1", "❌ 糟糕！營業時間耗盡", "今天沒能來得及出爐披薩！\n強制扣除店面耗損 -$30\n請看下方財報，比布 🖐️ 3秒收拾殘局前進...", true);
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

// 【此處已修正 478 行 pt 變數未定義錯誤】
function drawHandSkeleton(hand, pinching, isOpen, isFist) {
  push();
  let landmarks = hand.landmarks; let annotations = hand.annotations; strokeWeight(4);
  if (isFist) stroke(0, 255, 100, 230); 
  else if (isOpen) stroke(255, 215, 0, 230); 
  else if (pinching) stroke(255, 60, 120, 230); 
  else stroke(255, 130, 170, 190); 
  noFill();
  
  // 遍歷五隻手指
  for (let finger of ['thumb', 'indexFinger', 'middleFinger', 'ringFinger', 'pinky']) {
    beginShape();
    let fingerPoints = annotations[finger]; 
    for (let i = 0; i < fingerPoints.length; i++) { 
      let pt = fingerPoints[i]; // 確實將個別節點指定給 pt 變數
      vertex(width - (pt[0] * (width / video.width)), pt[1] * (height / video.height)); 
    }
    endShape();
  }
  
  noStroke();
  for (let pt of landmarks) {
    let x = width - (pt[0] * (width / video.width)), y = pt[1] * (height / video.height);
    if (isFist) fill(0, 255, 100);
    else if (isOpen) fill(255, 215, 0);
    else if (pinching) fill(255, 50, 100);
    else fill(255, 160, 190);
    ellipse(x, y, 9, 9);
  }
  pop();
}

// ==========================================
// 前導與模式選擇畫面
// ==========================================
let introUnlocked = false;
function runIntroScreen(isOpen, fx, fy, hasHand, dt) {
  textAlign(CENTER, CENTER); stroke(0); strokeWeight(5); fill(255); textSize(28);
  text("🌸 期末實作報告：隔空抓藥料理王 👩‍🍳", width / 2, height * 0.15); noStroke();

  if (!introUnlocked) {
    if (isOpen) { gestureTimer += dt; if (gestureTimer >= requiredHoldTime) { gestureTimer = 0; introUnlocked = true; } }
    else { gestureTimer = max(0, gestureTimer - dt * 2); }
    let bottomY = height * 0.75; let barW = 320; let barH = 10;
    fill(255, 255, 255, 100); rect(width / 2 - barW / 2, bottomY, barW, barH, 5);
    if (isOpen) { fill(255, 215, 0); rect(width / 2 - barW / 2, bottomY, barW * constrain(gestureTimer / requiredHoldTime, 0, 1), barH, 5); }
    stroke(0); strokeWeight(3); fill(isOpen ? color(255, 215, 0) : 255); textSize(16);
    text(isOpen ? "✨ 正在喚醒料理系統... " + Math.ceil((requiredHoldTime - gestureTimer) / 1000) + "秒" : "請舉起手掌 (比布 🖐️) 2 秒解鎖簡報系統", width / 2, bottomY + 35); noStroke();
  } else {
    let btnW = 320, btnH = 80, btnX = width / 2 - btnW / 2, btnY = height * 0.5;
    if (hasHand && fx > btnX && fx < btnX + btnW && fy > btnY && fy < btnY + btnH) changeGameState("GUIDE");
    fill(45, 15, 25, 230); stroke(255, 215, 0, 200); strokeWeight(2); rect(btnX, btnY, btnW, btnH, 15);
    stroke(0); strokeWeight(2); fill(255); textSize(20); text("🌟 點擊滑鼠進入報告並解鎖全螢幕 🌟", width / 2, btnY + btnH / 2); noStroke();
  }
}

function runGuideScreen(fx, fy, hasHand, dt, isGuideLocked) {
  fill(35, 15, 22, 245); rect(0, 0, width, height);
  textAlign(CENTER, CENTER); fill(255, 215, 0); textSize(width * 0.035); text("💡 系統操作與設計簡介 💡", width / 2, height * 0.08);
  let boxW = min(width * 0.82, 850), boxH = height * 0.62, boxX = width / 2 - boxW / 2, boxY = height * 0.16;
  fill(55, 25, 35, 200); stroke(255, 100, 140, 80); strokeWeight(1); rect(boxX, boxY, boxW, boxH, 12);

  textSize(15); textAlign(LEFT, TOP); fill(255, 210, 220); text("本動態互動系統支援雙模式，經營模式升級為全天總時間制與微型創業經濟：", boxX + 40, boxY + 25);
  drawGuideCard(boxX + 40, boxY + 70, boxW - 80, 65, "🧅 跨關卡一日總限時 (初始 120 秒)", "時間改為整天共用！必須在時間內依序突破 切菜 ➔ 擺盤 ➔ 烘焙 三大關卡。");
  drawGuideCard(boxX + 40, boxY + 150, boxW - 80, 65, "💰 刪減臃腫大數字的微型經濟體系", "初始只有精實的 $100。切菜賺 $5、大組裝完工大紅包賺 $100！資金歸零即宣告破產。");
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
  let isHoverTyc = (!isPageLocked && hasHand && fx > tycX && fx < tycX + btnW && fy > tycX && fy < btnY + btnH); 
  // 修正上行邊界檢查防呆
  isHoverTyc = (!isPageLocked && hasHand && fx > tycX && fx < tycX + btnW && fy > btnY && fy < btnY + btnH);
  drawModeButton(tycX, btnY, btnW, btnH, "💰 經營模式", "🔥 精實大亨生存挑戰！\n一天限時 120 秒通關全部！\n從微型資金 $100 起家！", color(180, 50, 80), isHoverTyc);

  if (!isPageLocked && hasHand) {
    if (isHoverExp) {
      if (hoverTargetMode !== "EXPERIENCE") { hoverTargetMode = "EXPERIENCE"; hoverTimer = 0; }
      hoverTimer += dt; drawSelectProgress(fx, fy, hoverTimer, hoverRequired);
      if (hoverTimer >= hoverRequired) { gameMode = "EXPERIENCE"; stage1CutCount = 0; resetFood(); changeGameState("STAGE1"); }
    } else if (isHoverTyc) {
      if (hoverTargetMode !== "TYCOON") { hoverTargetMode = "TYCOON"; hoverTimer = 0; }
      hoverTimer += dt; drawSelectProgress(fx, fy, hoverTimer, hoverRequired);
      if (hoverTimer >= hoverRequired) { 
        gameMode = "TYCOON"; totalMoney = 100; currentDay = 1; satisfaction = 100; baseDayDuration = 120; 
        moneyHistory = [100];
        stage1CutCount = 0; resetFood(); changeGameState("STAGE1"); 
      }
    } else { hoverTargetMode = ""; hoverTimer = 0; }
  }
}

function drawModeButton(x, y, w, h, title, desc, col, isHover) {
  push(); if (isHover) { translate(0, -6); stroke(255, 215, 0); strokeWeight(5); fill(red(col) + 30, green(col) + 30, blue(col) + 30, 240); } else { noStroke(); fill(red(col), green(col), blue(col), 180); }
  rect(x, y, w, h, 20); fill(255); textAlign(CENTER, TOP); textSize(26); text(title, x + w / 2, y + 35);
  fill(235); textSize(14); textAlign(CENTER, TOP); text(desc, x + w / 2, y + 100); pop();
}

function drawSelectProgress(x, y, current, total) {
  push(); noFill(); stroke(255, 150); strokeWeight(6); ellipse(x, y, 65, 65);
  stroke(255, 215, 0); strokeWeight(6); arc(x, y, 65, 65, -HALF_PI, -HALF_PI + map(constrain(current, 0, total), 0, total, 0, TWO_PI));
  fill(255, 215, 0); noStroke(); textSize(11); textAlign(CENTER, CENTER); text("LOCKING", x, y); pop();
}

// ==========================================
// 關卡過渡與結算頁面
// ==========================================
function startTransition(nextStateName, title, desc, isDayEnd = false) {
  gameState = "STAGE_CLEAR"; 
  nextState = nextStateName; 
  transitionTitle = title; 
  transitionDesc = desc; 
  transitionGestureTimer = 0; 
  isActualDayEnd = isDayEnd; 
}

function runStageClearScreen(fx, fy, hasHand, isHandOpen, dt) {
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
    textAlign(LEFT, CENTER);
    fill(100, 255, 150); textSize(18); text(`💰 目前總資產: $${totalMoney} 元`, boxX + 60, statsY * 1.005);
    textAlign(RIGHT, CENTER);
    fill(255, 130, 160); text(`⭐ 顧客滿意度: ${satisfaction} 分`, boxX + boxW - 60, statsY * 1.005);
    
    if (moneyHistory.length >= 2) {
      let graphX = boxX + 80, graphY = boxY + 190, graphW = boxW - 160, graphH = boxH - 260;
      stroke(255, 255, 255, 30); strokeWeight(1); noFill(); rect(graphX, graphY, graphW, graphH);
      for (let i = 1; i < 4; i++) { line(graphX, graphY + (graphH / 4) * i, graphX + graphW, graphY + (graphH / 4) * i); }
      
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
        fill(255); textAlign(CENTER, BOTTOM); textSize(11);
        text(`${i===0?"開店":`D${i}`}\n$${Math.round(moneyHistory[i])}`, px, py - 6);
      }
      textAlign(CENTER, TOP); fill(200, 180, 230); textSize(13); text("📈 歷史每日連鎖資產走勢圖", width / 2, graphY + graphH + 10);
    }
  } else {
    textAlign(CENTER, CENTER); fill(180, 170, 200); textSize(18);
    text("⏱️ 備料程序正常，系統正在自動對接下個工作台...", width / 2, boxY + 200);
  }

  textAlign(CENTER, CENTER);

  if (!isShopOpen) {
    let requiredTime = 3000; 
    
    if (isActualDayEnd) {
      if (hasHand && isHandOpen) { transitionGestureTimer += dt; } 
      else { transitionGestureTimer = max(0, transitionGestureTimer - dt * 1.5); }
      
      let progressW = map(constrain(transitionGestureTimer, 0, requiredTime), 0, requiredTime, 0, 380);
      fill(255, 255, 255, 40); rect(width/2 - 190, height - 100, 380, 14, 7);
      fill(255, 215, 0); rect(width/2 - 190, height - 100, progressW, 14, 7);
      
      fill(255); textSize(16);
      if (hasHand && isHandOpen) {
        text(`✨ 正在蓄能前往下一天... 還剩 ${max(0, (requiredTime - transitionGestureTimer)/1000).toFixed(1)} 秒`, width / 2, height - 60);
      } else {
        text("🖐️ 確認完財報後，請對著鏡頭「舉起手掌比布」停留 3 秒跨入下一天", width / 2, height - 60);
      }
    } else {
      transitionGestureTimer += dt;
      let progressW = map(constrain(transitionGestureTimer, 0, requiredTime), 0, requiredTime, 0, 380);
      fill(255, 255, 255, 40); rect(width/2 - 190, height - 100, 380, 14, 7);
      fill(100, 200, 255); rect(width/2 - 190, height - 100, progressW, 14, 7);
      
      fill(255); textSize(16);
      let countdown = max(0, (requiredTime - transitionGestureTimer) / 1000).toFixed(1);
      text(`⏱️ 正在自動前往下一關... 剩餘 ${countdown} 秒`, width / 2, height - 60);
    }

    if (transitionGestureTimer >= requiredTime) {
      transitionGestureTimer = 0;
      if (nextState === "STAGE1") { changeGameState("STAGE1"); } 
      else if (nextState === "STAGE2") { initStage2(); changeGameState("STAGE2"); } 
      else if (nextState === "STAGE3") { initStage3(); changeGameState("STAGE3"); } 
      else if (nextState === "GAMEOVER") { changeGameState("GAMEOVER"); }
    }
  } else {
    fill(200, 180, 220); textSize(15); text("💡 請先關閉黑市商店，才能進行手勢跨日蓄能哦！", width / 2, height - 70);
  }

  if (gameMode === "TYCOON" && isActualDayEnd) {
    let sBtnX = width - 160, sBtnY = height - 80, sBtnW = 130, sBtnH = 60;
    let sHover = (hasHand && fx > sBtnX && fx < sBtnX + sBtnW && fy > sBtnY && fy < sBtnY + sBtnH);
    push(); fill(sHover ? color(220, 60, 130) : color(160, 30, 90)); stroke(255, 215, 0); strokeWeight(sHover ? 3 : 1);
    rect(sBtnX, sBtnY, sBtnW, sBtnH, 12); fill(255); textAlign(CENTER, CENTER); textSize(16); text("🛒 黑市商店", sBtnX + sBtnW/2, sBtnY + sBtnH/2);
    if (sHover && hoverTargetMode === "UI_OPEN_SHOP") drawSelectProgress(fx, fy, hoverTimer, hoverRequired); pop();
  }

  if (isShopOpen) { drawShopOverlay(fx, fy, hasHand); }
}

// ==========================================
// 第一關 - 神速切食材
// ==========================================
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
        else {
          bombFlashTimer = 255; for(let i=0; i<50; i++) spawnParticles(foodX, foodY, color(255, 50, 50));
          if (gameMode === "TYCOON") satisfaction = max(0, satisfaction - 2);
        }
      } else {
        stage1CutCount++; 
        if (gameMode === "TYCOON") totalMoney += 5; 
        spawnParticles(foodX, foodY, foodColor); 
      }
      resetFood(); 
    }
    if (foodY > height + 100) resetFood();
  }

  if (stage1CutCount >= 10 && !isPaused) {
    if (gameMode === "TYCOON") totalMoney += 30; 
    startTransition("STAGE2", "🎉 第一關備料達標！", (gameMode === "TYCOON" ? "獲得過關獎金 +$30！\n" : "") + "即將前往下一關...", false);
  }
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

// ==========================================
// 第二關 - 隔空抓配料
// ==========================================
function initStage2() { stage2PizzaCount = 0; targetBoxX = width / 2; targetBoxY = height - 160; hasItem = false; isWaitingForDrop = false; updateCheesePosition(); }
function updateCheesePosition() { cheeseSpawnX = (random(100) < 50) ? width * 0.2 : width * 0.8; }

function runStage2(fx, fy, hasHand, dt) {
  let titleHeader = (gameMode === "TYCOON") ? `【第 ${currentDay} 天 營運中】` : "【體驗模式】";
  let timerStr = (gameMode === "TYCOON") ? "今日剩餘: " + Math.ceil(dayTimer) + " 秒" : "已耗時: " + floor((millis() - dayStartMillis) / 1000) + " 秒";
  
  drawUI(titleHeader + "第二關：👌捏合抓取起司放至披薩皮！", timerStr);

  let cheeseX = cheeseSpawnX, cheeseY = 180, cheeseW = 140, cheeseH = 80;
  push(); drawingContext.setLineDash([6, 6]); stroke(255, 130, 160, 200); fill(255, 130, 160, 20);
  if (!isPaused && hasHand && isPinching && fx > cheeseX - cheeseW/2 && fx < cheeseX + cheeseW/2 && fy > cheeseY - cheeseH/2 && fy < cheeseY + cheeseH/2) {
    stroke(255, 215, 0); fill(255, 215, 0, 40);
    if (!hasItem) { hasItem = true; isWaitingForDrop = false; itemX = fx; itemY = fy; spawnParticles(fx, fy, color(255, 215, 0)); }
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
        if (distToPizza < 80) {
          stage2PizzaCount++; if (gameMode === "TYCOON") { totalMoney += 15; satisfaction = min(100, satisfaction + 5); }
          spawnParticles(targetBoxX, targetBoxY, color(255, 215, 0)); updateCheesePosition(); 
        } else { spawnParticles(itemX, itemY, color(255, 0, 0)); }
        hasItem = false; isWaitingForDrop = false;
      }
    }
    push(); if (isWaitingForDrop) { fill(255, 215, 0, 170); stroke(255, 255, 255, 200); strokeWeight(3); } else { fill(255, 215, 0); noStroke(); }
    ellipse(itemX, itemY, 45, 45); fill(0); textSize(12); text("🧀", itemX, itemY); pop();
  }

  if (stage2PizzaCount >= 2 && !isPaused) {
    if (gameMode === "TYCOON") totalMoney += 40;
    startTransition("STAGE3", "🌟 第二關達標！起司放滿", (gameMode === "TYCOON" ? "獲得過關獎金 +$40！\n" : "") + "即將前往下一關...", false);
  }
}

// ==========================================
// 第三關 - 烤箱大作戰
// ==========================================
function initStage3() { ovenStarted = false; ovenButtons = []; }
function spawnOvenButtons() {
  ovenButtons = [];
  let labels = ["🌡️ 溫度設定", "⏱️ 定時旋鈕", "🌀 旋風風速"];
  let colors = [color(255, 120, 50), color(255, 200, 50), color(50, 180, 255)];
  for (let i = 0; i < ovenTargetCount; i++) {
    ovenButtons.push({ x: random(width * 0.15, width * 0.85), y: random(height * 0.25, height * 0.75), size: 90, label: labels[i], col: colors[i], active: true });
  }
}

function runStage3(fx, fy, dt) {
  let titleHeader = (gameMode === "TYCOON") ? `【第 ${currentDay} 天 營運中】` : "【體驗模式】";
  let timerStr = (gameMode === "TYCOON") ? "今日剩餘: " + Math.ceil(dayTimer) + " 秒" : "已耗時: " + floor((millis() - dayStartMillis) / 1000) + " 秒";
  
  drawUI(titleHeader + "第三關：點擊隨機參數鈕。先按中央啟動！", timerStr);

  push(); fill(30, 30, 40, 200); stroke(120); strokeWeight(5); rect(width/2 - 200, height/2 - 150, 400, 260, 15);
  fill(60, 40, 40, 150); stroke(255, 100, 50, 100); rect(width/2 - 170, height/2 - 120, 340, 160, 5); pop();

  if (!ovenStarted) {
    let startBtnX = width / 2; let startBtnY = height / 2 - 40; let startBtnR = 100;
    let hover = (!isPaused && dist(fx, fy, startBtnX, startBtnY) < startBtnR / 2);
    push(); if (hover) { fill(255, 50, 50); stroke(255, 215, 0); strokeWeight(4); } else { fill(200, 30, 30); stroke(255); strokeWeight(2); }
    ellipse(startBtnX, startBtnY, startBtnR, startBtnR); pop();
    fill(255); textAlign(CENTER, CENTER); textSize(16); text("🔥\n啟動烤箱", startBtnX, startBtnY);
    if (hover) { ovenStarted = true; spawnParticles(startBtnX, startBtnY, color(255, 100, 0)); spawnOvenButtons(); }
    drawProgressBar(0, ovenTargetCount, "等待啟動烤箱...");
  } else {
    let remaining = 0;
    for (let btn of ovenButtons) {
      if (btn.active) {
        remaining++;
        if (!isPaused && dist(fx, fy, btn.x, btn.y) < btn.size / 2) {
          btn.active = false; if (gameMode === "TYCOON") totalMoney += 10;
          spawnParticles(btn.x, btn.y, btn.col); 
        }
        push(); fill(btn.col); stroke(255); strokeWeight(3); ellipse(btn.x, btn.y, btn.size, btn.size);
        fill(255); noStroke(); textAlign(CENTER, CENTER); textSize(13); text(btn.label, btn.x, btn.y); pop();
      }
    }
    drawProgressBar(ovenTargetCount - remaining, ovenTargetCount, "已完成烤箱設定面板");

    if (remaining === 0 && !isPaused) {
      if (gameMode === "TYCOON") {
        totalMoney += 100; 
        moneyHistory.push(totalMoney); 
        currentDay++;     
        startTransition("STAGE1", `🍕 第 ${currentDay-1} 天 披薩完美出爐！`, `🎉 順利完成一整組披薩！獲得出爐大紅包 +$100 元！\n【跨日準備】請看下方精美財報，比布 🖐️ 蓄能 3 秒正式邁向第 ${currentDay} 天！`, true);
      } else {
        totalUsedSeconds = ((millis() - dayStartMillis) / 1000).toFixed(2);
        changeGameState("GAMEOVER");
      }
    }
  }
}

// ==========================================
// 結束/破產 畫面
// ==========================================
function drawGameOverScreen() {
  fill(20, 10, 30, 250); rect(0, 0, width, height);
  textAlign(CENTER, CENTER); fill(255, 215, 0); textSize(40);
  text(gameMode === "EXPERIENCE" ? "⏱️ 體驗模式 通關成績單" : "💸 🚨 遺憾！神廚破產公告 🚨 💸", width / 2, height * 0.15);

  let boxW = 600, boxH = 350; fill(40, 20, 50, 200); stroke(255, 215, 0); strokeWeight(3); rect(width / 2 - boxW / 2, height / 2 - 100, boxW, boxH, 20); noStroke();
  fill(255); textAlign(LEFT, CENTER); textSize(24);
  
  if (gameMode === "EXPERIENCE") {
    text(`🏆 第三關烘焙耗時: ${totalUsedSeconds} 秒`, width / 2 - 200, height / 2);
    text(`⭐ 料理熟練度: 100% 完美達標`, width / 2 - 200, height / 2 + 50);
  } else {
    text(`📈 最終營運天數: 第 ${currentDay - 1} 天`, width / 2 - 200, height / 2 - 50);
    text(`💰 破產時剩餘清算資產: $ ${totalMoney} 元`, width / 2 - 200, height / 2);
    text(`⭐ 最終顧客滿意度: ${satisfaction} 分`, width / 2 - 200, height / 2 + 50);
    fill(0, 100); rect(width / 2 - 30, height / 2 + 40, 200, 20, 5);
    fill(255, 100, 100); rect(width / 2 - 30, height / 2 + 40, map(satisfaction, 0, 100, 0, 200), 20, 5);
  }
  fill(255, 100, 140); rect(width/2 - 100, height - 100, 200, 50, 10);
  fill(255); textAlign(CENTER, CENTER); textSize(18); text("重新回到首頁", width / 2, height - 75);
}

// ==========================================
// 頂部常駐 UI
// ==========================================
function drawUI(title, timerStr) {
  fill(35, 15, 25, 180); rect(0, 0, width, 70);
  textAlign(LEFT, CENTER); fill(255); textSize(15); 
  let moneyStatus = (gameMode === "TYCOON") ? ` | 💰 總資產: $${totalMoney}` : "";
  text("👩‍🍳 " + title + moneyStatus, 30, 35);
  textAlign(RIGHT, CENTER); textSize(18); fill(255, 100, 140); text(timerStr, width - 30, 35);

  if (gameState.startsWith("STAGE") && gameState !== "STAGE_CLEAR") {
    let btnX = 20, btnY = height - 70, btnW = 60, btnH = 50;
    push();
    let pHover = (predictions.length > 0) && (prevHandX > btnX && prevHandX < btnX + btnW && prevHandY > btnY && prevHandY < btnY + btnH);
    fill(pHover ? color(120, 60, 180) : color(60, 30, 100)); stroke(255, 215, 0); strokeWeight(2);
    rect(btnX, btnY, btnW, btnH, 8); fill(255); textAlign(CENTER, CENTER); textSize(20); text("⏸️", btnX + btnW/2, btnY + btnH/2);
    if (pHover && hoverTargetMode === "UI_PAUSE") drawSelectProgress(prevHandX, prevHandY, hoverTimer, hoverRequired); pop();
  }
}

function drawProgressBar(current, target, label) {
  push(); let barW = 300; let barH = 22; let barX = width / 2 - barW / 2; let barY = height - 60;
  fill(0, 0, 0, 130); rect(barX, barY, barW, barH, 10);
  fill(255, 215, 0); rect(barX, barY, map(constrain(current, 0, target), 0, target, 0, barW), barH, 10);
  textAlign(CENTER, CENTER); fill(255); textSize(13); text(label + " : " + current + " / " + target, width / 2, barY + barH / 2); pop();
}

// ==========================================
// 粒子特效
// ==========================================
function spawnParticles(x, y, col) {
  for (let i = 0; i < 20; i++) {
    particles.push({ x: x, y: y, vx: random(-5, 5), vy: random(-5, 5), alpha: 255, r: red(col), g: green(col), b: blue(col) });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i]; p.x += p.vx; p.y += p.vy; p.alpha -= 6; 
    fill(p.r, p.g, p.b, p.alpha); noStroke(); ellipse(p.x, p.y, 8, 8);
    if (p.alpha <= 0) particles.splice(i, 1);
  }
}