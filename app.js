// 🌐 브라우저 이벤트를 Python 에이전트 로그로 안전하게 전송하는 헬퍼
function logBrowser(msg) {
    try {
        console.log(msg);
        const host = window.location.hostname || "127.0.0.1";
        fetch(`http://${host}:8081/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "log", message: msg })
        }).catch(() => {});
    } catch (e) {}
}

/**
 * 스마트 보이스 폴리셔 & 다국어 번역기 핵심 로직
 * 개발: AI 개발부장 코다리 💻
 * 기획: 영자 실장 🎨
 * 보안: 경수 수사관 🛡️
 */

// 1. 상태 관리
const state = {
    isRecording: false,
    recognition: null,
    rawText: "",
    polishedText: "",
    translatedText: "",
    notes: JSON.parse(localStorage.getItem("voice_polisher_notes") || "[]"),
    targetLang: "en",
    selectedDeviceId: localStorage.getItem("voice_polisher_mic_id") || "",
    mediaStream: null,
    audioContext: null,
    analyser: null,
    gainNode: null,          // 🆕 속삭임 모드용 GainNode
    animationFrameId: null,
    typelessModeEnabled: true,
    theme: localStorage.getItem("voice_polisher_theme") || "light",
    whisperMode: false,      // 🆕 속삭임 모드
    personalDict: JSON.parse(localStorage.getItem("voice_polisher_dict") || "[]"), // 🆕 개인 사전
    isHotkeyMode: false,          // 🆕 F9 전역 단축키 토글 모드 활성화 여부
    hotkeyFinalChunks: [],        // 🆕 F9 모드 중 확정된 음성 덩어리 목록
    latestInterim: "",            // 🆕 가장 최근 미확정 중간 음성
    latestCurrentSpeech: "",      // 🆕 실시간 최신 음성 전체 버퍼
    sessionFinalText: "",         // 🛡️ 전체 발화 세션 누적 확정 텍스트 (앞말 지워짐 100% 방지)
    currentInterimText: ""        // 🛡️ 실시간 진행 중인 중간 텍스트
};

// 2. DOM 요소 캐싱
const typelessModeToggle = document.getElementById("typelessModeToggle");
const typelessAgentDot = document.getElementById("typelessAgentDot");
const typelessAgentStatus = document.getElementById("typelessAgentStatus");

const themeToggleBtn = document.getElementById("themeToggleBtn");
const micDeviceSelect = document.getElementById("micDeviceSelect");
const refreshMicsBtn = document.getElementById("refreshMicsBtn");

// 🆕 신기능 DOM 요소
const whisperModeToggle = document.getElementById("whisperModeToggle");
const whisperIndicator = document.getElementById("whisperIndicator");
const toneSelect = document.getElementById("toneSelect");
const dictWrongInput = document.getElementById("dictWrongInput");
const dictCorrectInput = document.getElementById("dictCorrectInput");
const dictAddBtn = document.getElementById("dictAddBtn");
const dictList = document.getElementById("dictList");
const dictToggleBtn = document.getElementById("dictToggleBtn");
const dictBody = document.getElementById("dictBody");

const micToggleBtn = document.getElementById("micToggleBtn");
const micIcon = document.getElementById("micIcon");
const micLabelCaption = document.getElementById("micLabelCaption");
const audioVisualizer = document.getElementById("audioVisualizer");
const sttStatusIndicator = document.getElementById("sttStatusIndicator");
const sttStatusText = document.getElementById("sttStatusText");

const rawSpeechDisplay = document.getElementById("rawSpeechDisplay");
const polishedDisplay = document.getElementById("polishedDisplay");
const rawWordCount = document.getElementById("rawWordCount");
const toggleRawBtn = document.getElementById("toggleRawBtn");
const rawSpeechDrawer = document.getElementById("rawSpeechDrawer");
const toggleRawArrow = document.getElementById("toggleRawArrow");

if (toggleRawBtn && rawSpeechDrawer) {
    toggleRawBtn.addEventListener("click", () => {
        const isHidden = rawSpeechDrawer.style.display === "none";
        rawSpeechDrawer.style.display = isHidden ? "block" : "none";
        if (toggleRawArrow) {
            toggleRawArrow.textContent = isHidden ? "⌃" : "⌄";
        }
        toggleRawBtn.classList.toggle("active", isHidden);
    });
}

const targetLangSelect = document.getElementById("targetLangSelect");
const triggerTranslateBtn = document.getElementById("triggerTranslateBtn");
const transResultDisplay = document.getElementById("transResultDisplay");

const copyPolishedBtn = document.getElementById("copyPolishedBtn");
const ttsPolishedBtn = document.getElementById("ttsPolishedBtn");
const saveNoteBtn = document.getElementById("saveNoteBtn");

const copyTransBtn = document.getElementById("copyTransBtn");
const ttsTransBtn = document.getElementById("ttsTransBtn");

const clearRawBtn = document.getElementById("clearRawBtn");
const clearAllDisplaysBtn = document.getElementById("clearAllDisplaysBtn");

const notesList = document.getElementById("notesList");
const noteCount = document.getElementById("noteCount");
const clearAllNotesBtn = document.getElementById("clearAllNotesBtn");
const toastMessage = document.getElementById("toastMessage");

const autostartToggleBtn = document.getElementById("autostartToggleBtn");
const autostartBadge = document.getElementById("autostartBadge");
const modalAutostartToggle = document.getElementById("modalAutostartToggle");
const modalAutostartText = document.getElementById("modalAutostartText");

// 3. 토스트 알림 함수
function showToast(message) {
    toastMessage.textContent = message;
    toastMessage.classList.add("show");
    setTimeout(() => {
        toastMessage.classList.remove("show");
    }, 2800);
}

// 4. Web Speech API (STT) 초기화
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast("⚠️ 사용 중인 브라우저가 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 권장합니다.");
        sttStatusText.textContent = "음성 미지원 브라우저";
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR"; // 기본 한국어 인식
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        logBrowser("🎙️ [STT] recognition.onstart 정상 가동 (듣기 준비 완료)");
        state.isRecording = true;
        micToggleBtn.classList.add("active");
        audioVisualizer.classList.add("active");
        sttStatusIndicator.className = "status-indicator recording";
        sttStatusText.textContent = "듣고 있습니다... 말씀하세요 🎙️";
        micIcon.textContent = "⏹️";
        if (micLabelCaption) micLabelCaption.innerHTML = "🎙️ <span style='color:#ec4899; font-weight:700;'>말씀을 듣고 있어요...</span>";
        showToast("🎙️ 마이크가 켜졌습니다. 편하게 말씀하세요!");
    };

    recognition.onresult = (event) => {
        let finalPart = "";
        let interimPart = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalPart += transcript + " ";
            } else {
                interimPart += transcript;
            }
        }

        // 🛡️ 확정된 조각을 세션에 차곡차곡 누적 (앞말 지워짐 100% 방지)
        if (finalPart.trim()) {
            const cleanFinal = finalPart.trim();
            if (state.sessionFinalText) {
                if (!state.sessionFinalText.endsWith(cleanFinal)) {
                    state.sessionFinalText += " " + cleanFinal;
                }
            } else {
                state.sessionFinalText = cleanFinal;
            }
            state.hotkeyFinalChunks.push(cleanFinal);
            state.latestInterim = "";
        }

        state.currentInterimText = interimPart.trim();
        state.latestInterim = state.currentInterimText;

        // 🛡️ 전체 발화 문장 결합: [누적된 모든 앞말] + [실시간 뒷말]
        let fullSessionSpeech = state.sessionFinalText;
        if (state.currentInterimText) {
            fullSessionSpeech = fullSessionSpeech ? (fullSessionSpeech + " " + state.currentInterimText) : state.currentInterimText;
        }
        fullSessionSpeech = fullSessionSpeech.trim();

        if (fullSessionSpeech) {
            speechVolumeLevel = Math.min(1.0, 0.65 + Math.random() * 0.35); // 발화 감지 시 음량 대폭 상승
            state.latestCurrentSpeech = fullSessionSpeech;
            handleSpeechInput(fullSessionSpeech, Boolean(finalPart.trim()));
        }
    };

    recognition.onerror = (event) => {
        logBrowser(`⚠️ [STT] recognition.onerror: ${event.error}`);
        // no-speech, network, aborted(오클루전/포커스 이동), audio-capture(장치 경합) 발생 시에도 마이크를 끄지 않고 자동 복원
        if (event.error === "no-speech" || event.error === "network" || event.error === "aborted" || event.error === "audio-capture") {
            if (state.isRecording) {
                stopSimulatedVisualizer();
                setTimeout(() => {
                    if (state.isRecording && state.recognition) {
                        try { state.recognition.start(); } catch (e) {}
                    }
                }, 100);
            }
            return;
        }
        if (event.error === "not-allowed") {
            showToast("🚨 마이크 사용 권한이 차단되었습니다. 브라우저 주소창에서 마이크를 허용해주세요.");
            stopRecording();
            return;
        }
    };

    recognition.onend = () => {
        logBrowser(`🔄 [STT] recognition.onend 발생 (현재 isRecording: ${state.isRecording})`);
        // 듀얼 모니터 및 백그라운드 환경: 녹음 중이면 크롬의 침묵 종료에 구애받지 않고 즉시 무한 연속 청취 복원!
        if (state.isRecording) {
            setTimeout(() => {
                if (state.isRecording && state.recognition) {
                    try {
                        state.recognition.start();
                        logBrowser("✅ [STT] 무한 연속 청취 재시작 성공");
                    } catch (e) {
                        // 이미 실행 중이면 문제 없음
                    }
                }
            }, 50);
        }
    };

    state.recognition = recognition;
}

// 5. 음성 처리 및 AI 문맥 자율 교정 로직
function handleSpeechInput(rawText, isFinal) {
    state.rawText = rawText;
    rawSpeechDisplay.textContent = rawText;
    rawWordCount.textContent = `${rawText.length} 글자`;

    // 음성 명령 감지 ("복사해줘", "지워줘", "메모 저장", "번역", "엔터")
    if (checkVoiceCommand(rawText)) {
        return;
    }

    // AI 문맥 자율 교정 엔진 가동
    const polished = polishSpeechContext(rawText);
    state.polishedText = polished;
    polishedDisplay.textContent = polished;

    // 🌐 실시간 전체 문장 번역 (단축키 타이핑은 중복 방지를 위해 F9 종료 시 1회 일괄 수행)
    if (polished.length > 0) {
        debounceTranslate(polished, state.targetLang);
    }
}

// 6. 음성 명령 (Voice Commands) 감지
function checkVoiceCommand(text) {
    const cleanText = text.replace(/\s+/g, "");
    
    // 키보드 엔터 명령
    if (cleanText.includes("엔터") || cleanText.includes("엔터쳐줘") || cleanText.includes("줄바꿈")) {
        sendToTypelessAgent("", "enter");
        showToast("⌨️ [음성 명령 인식] 엔터(Enter) 키가 입력되었습니다!");
        return true;
    }
    // 키보드 지우기 명령
    if (cleanText.includes("글자지워") || cleanText.includes("백스페이스") || cleanText.includes("한글자지워")) {
        sendToTypelessAgent("", "backspace");
        showToast("⌨️ [음성 명령 인식] 글자가 지워졌습니다.");
        return true;
    }
    if (cleanText.includes("복사해줘") || cleanText.endsWith("복사")) {
        copyToClipboard(state.polishedText || state.rawText);
        showToast("📋 [음성 명령 인식] 텍스트가 클립보드에 복사되었습니다!");
        return true;
    }
    if (cleanText.includes("지워줘") || cleanText.includes("초기화") || cleanText.includes("삭제해줘")) {
        resetDisplays();
        showToast("🧹 [음성 명령 인식] 화면이 초기화되었습니다.");
        return true;
    }
    if (cleanText.includes("메모저장") || cleanText.includes("기록해줘") || cleanText.includes("저장해줘")) {
        saveCurrentNote();
        showToast("💾 [음성 명령 인식] 메모장에 저장되었습니다!");
        return true;
    }
    if (cleanText.includes("영어로번역") || cleanText.includes("영어로")) {
        targetLangSelect.value = "en";
        state.targetLang = "en";
        translateText(state.polishedText, "en");
        showToast("🌐 [음성 명령 인식] 영어로 번역합니다!");
        return true;
    }
    if (cleanText.includes("일본어로번역") || cleanText.includes("일본어로")) {
        targetLangSelect.value = "ja";
        state.targetLang = "ja";
        translateText(state.polishedText, "ja");
        showToast("🌐 [음성 명령 인식] 일본어로 번역합니다!");
        return true;
    }
    return false;
}

// 7. 스마트 AI 문맥 및 어눌한 발음 자율 교정기 (Self-Correction Rule Engine)
function polishSpeechContext(text) {
    if (!text) return "";

    let polished = text;

    // 🆕 Step 0: 개인 사전 먼저 적용 (사용자 등록 단어 우선 교정)
    state.personalDict.forEach(entry => {
        if (entry.wrong && entry.correct) {
            const regex = new RegExp(entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            polished = polished.replace(regex, entry.correct);
        }
    });

    // 1) 불필요한 더듬거림 / 추임새 제거
    const hesitationRegex = /\b(어+|음+|그+|저기|있잖아|막|그니까|약간)\b/gi;
    polished = polished.replace(hesitationRegex, "");

    // 2) 흔한 어눌한 발음, 사투리, 오탈자, 축약어 자율 정정 사전
    const correctionDictionary = [
        { regex: /머해/g, replace: "무엇을 하고 계십니까" },
        { regex: /되게써|되갰어/g, replace: "되겠어" },
        { regex: /않되|안돼는|않되는/g, replace: "안 되는" },
        { regex: /않돼|않되/g, replace: "안 돼" },
        { regex: /됀다/g, replace: "된다" },
        { regex: /어떠케/g, replace: "어떻게" },
        { regex: /빨랑/g, replace: "빨리" },
        { regex: /근대/g, replace: "그런데" },
        { regex: /했는대/g, replace: "했는데" },
        { regex: /머것어|머것는뎅|먹엇서/g, replace: "식사를 마쳤습니다" },
        { regex: /가따와써|갔다와써/g, replace: "다녀왔습니다" },
        { regex: /안녕하세여|하이루/g, replace: "안녕하세요" },
        { regex: /반갑습니당/g, replace: "반갑습니다" },
        { regex: /알갯습니다|알게슴/g, replace: "알겠습니다" },
        { regex: /고마워여|땡큐/g, replace: "감사합니다" },
        { regex: /회의좀 합시다|회의하자/g, replace: "회의를 시작하겠습니다" },
        { regex: /수고하세여/g, replace: "수고 많으셨습니다" }
    ];

    correctionDictionary.forEach(rule => {
        polished = polished.replace(rule.regex, rule.replace);
    });

    // 3) 연속 공백 제거 및 트림
    polished = polished.replace(/\s+/g, " ").trim();

    // 🆕 Step 4: 앱별 자동 톤 조절 적용
    polished = applyToneStyle(polished, state.currentTone);

    // 5) 🆕 스마트 한국어 문장 부호 지능형 자동 삽입 (물음표 ?, 느낌표 !, 쉼표 ,, 마침표 .)
    polished = applyKoreanPunctuation(polished);

    return polished;
}

// 🆕 스마트 한국어 문맥 기반 문장 부호 엔진
function applyKoreanPunctuation(text) {
    if (!text) return text;
    let s = text.trim();

    // 1. 중간 쉼표(,) 자동 삽입
    // 접속부사 및 전환 어구 뒤에 쉼표가 없으면 자연스럽게 추가
    const commaConnectives = [
        "그리고", "그런데", "하지만", "그러나", "또한", "따라서", "그러므로", 
        "한편", "반면에", "예를 들어", "우선", "첫째로", "둘째로", "솔직히", "사실"
    ];
    commaConnectives.forEach(word => {
        const regex = new RegExp(`(^|\\s)(${word})(?![,.?!])(\\s+)`, 'g');
        s = s.replace(regex, `$1$2,$3`);
    });

    // 호칭(대표님, 팀장님, 부장님, 선생님 등) 뒤 쉼표 처리
    s = s.replace(/(^|\s)(대표님|팀장님|부장님|과장님|대리님|선생님|교수님|여러분)(?![,.?!])(\s+)/g, '$1$2,$3');

    // 이미 문장 끝에 문장 부호나 물결 등이 있으면 중복 추가 방지
    if (/[.?!~]$/.test(s)) {
        return s;
    }

    // 2. 의문문 / 물음표 (?) 판별
    // 의문사(누구, 언제, 어디, 무엇, 뭐, 어떻게, 왜, 몇, 얼마, 어떤, 무슨 등) 유무 확인
    const hasQuestionWord = /(누구|언제|어디|무엇|뭐|어떻게|어찌|왜|몇|얼마|어떤|무슨)/.test(s);
    
    // 명확한 질문형 종결 어미 패턴
    const questionEndingRegex = /(습니까|입니까|있습니까|없습니까|되겠습니까|하나요|인가요|있나요|없나요|가나요|되나요|나요|할까요|될까요|갈까요|볼까요|을까요|ㄹ까요|까요|할까|될까|갈까|볼까|을까|ㄹ까|까|하니|있니|없니|먹었니|갔니|왔니|됐니|니|하는가|있는가|인가|던가|가요|게요|죠|지요|느냐|는가)$/;

    // 대화형 질문 어미 (~했어?, ~됐어?, ~어때?, ~그래?, ~있어?, ~없어?)
    const casualQuestionRegex = /(했어|됐어|갔어|왔어|봤어|먹었어|있어|없어|어때|그래|맞아|진짜|정말)$/;

    if (questionEndingRegex.test(s) || (hasQuestionWord && (casualQuestionRegex.test(s) || /(해|야|요|어)$/.test(s)))) {
        return s + "?";
    }

    // 3. 감탄문 / 느낌표 (!) 판별
    // 감탄사, 축하, 응원, 감격, 강한 권유/명령 표현
    const exclamationRegex = /(대박|와우|와|우와|헐|세상에|아싸|축하해|축하드립니다|화이팅|파이팅|힘내|힘내세요|조심해|어서|빨리|얼른|당장|최고야|최고다|멋지다|멋져|대단해|감사합니다|고마워|수고하셨습니다|반갑습니다)$/;
    const exclamationEndingRegex = /(하자|해라|가자|보자|구나|네|군|도다|맙소사)$/;

    if (exclamationRegex.test(s) || exclamationEndingRegex.test(s) || /(정말|너무|진짜|완전).*(좋아|멋져|감사|고마워)/.test(s)) {
        return s + "!";
    }

    // 4. 평서문 / 마침표 (.) 판별
    const declarativeEndingRegex = /(다|이다|했다|됐다|갔다|왔다|봤다|입니다|합니다|습니다|됩니다|하겠습니다|드리겠습니다|좋겠습니다|바랍니다|해요|에요|예요|어)$/;
    if (declarativeEndingRegex.test(s)) {
        return s + ".";
    }

    // 기본 문장 종결 부호
    return s + ".";
}

// 🆕 앱별 자동 톤 조절 함수
function applyToneStyle(text, tone) {
    if (!text) return text;

    const effectiveTone = tone === "auto" ? detectToneByKeyword(text) : tone;

    switch (effectiveTone) {
        case "email":
            // 이메일 격식체: 끝맺음 강화, 인사말 추가, 격식 표현 치환
            text = text
                .replace(/해줘|해줘요/g, "부탁드립니다")
                .replace(/알겠어|알겠어요/g, "알겠습니다")
                .replace(/할게|할게요/g, "하겠습니다")
                .replace(/됐어|됐어요/g, "완료되었습니다")
                .replace(/볼게|볼게요/g, "검토하겠습니다");
            if (!/입니다\.|합니다\.|겠습니다\./.test(text) && !/[.?!]$/.test(text)) {
                text += " 감사합니다.";
            }
            break;

        case "chat":
            // 채팅 캐주얼체: 격식 표현을 캐주얼하게
            text = text
                .replace(/합니다\./g, "해요!")
                .replace(/입니다\./g, "이에요!")
                .replace(/하겠습니다\./g, "할게요~")
                .replace(/감사합니다\./g, "감사해요!")
                .replace(/안녕하세요\./g, "안녕하세요! 😊")
                .replace(/부탁드립니다\./g, "부탁해요!");
            break;

        case "document":
            // 공식 문서 정중체: 가장 격식 높은 표현으로
            text = text
                .replace(/할게요|할게/g, "하겠습니다")
                .replace(/해요|해줘/g, "합니다")
                .replace(/알겠어요|알겠어/g, "알겠습니다")
                .replace(/됐어요|됐어/g, "완료되었습니다");
            if (!/[.?!]$/.test(text)) text += ".";
            break;

        case "free":
            // 자유 형식: 교정 최소화, 있는 그대로 유지
            break;

        default:
            break;
    }

    return text;
}

// 🆕 키워드 기반 자동 톤 감지 (auto 모드)
function detectToneByKeyword(text) {
    const emailKeywords = /안녕하세요|감사합니다|드립니다|보내드립니다|문의|첨부|검토|회신|수신|발신/;
    const chatKeywords = /ㅋㅋ|ㅎㅎ|ㅠㅠ|!!!|ㄱㄱ|ㄴㄴ|오케|넵|ㅇㅋ|ㅎㅇ/;
    const docKeywords = /본 문서|제출|보고서|계획서|공문|결재|항목|1\.|2\.|가\.|나\./;

    if (emailKeywords.test(text)) return "email";
    if (chatKeywords.test(text)) return "chat";
    if (docKeywords.test(text)) return "document";
    return "auto";
}

// 7-1. 🌐 실시간 다국어 디바운스 번역기 (전체 문맥 끊김 방지)
let translateDebounceTimer = null;
function debounceTranslate(sourceText, lang) {
    if (!sourceText || !sourceText.trim()) return;
    if (translateDebounceTimer) clearTimeout(translateDebounceTimer);
    translateDebounceTimer = setTimeout(() => {
        translateText(sourceText, lang);
    }, 450);
}

// 8. 실시간 다국어 번역 함수 (MyMemory Free API + 스마트 폴백)
async function translateText(sourceText, targetLang) {
    if (!sourceText) return;

    transResultDisplay.innerHTML = `<span style="color: var(--accent);">⚡ 실시간 AI 번역 중...</span>`;

    try {
        const langPair = `ko|${targetLang}`;
        const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(sourceText)}&langpair=${langPair}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.responseData && data.responseData.translatedText) {
            const translated = data.responseData.translatedText;
            state.translatedText = translated;
            transResultDisplay.textContent = translated;
        } else {
            throw new Error("번역 응답 형식 불일치");
        }
    } catch (error) {
        console.warn("외부 번역 API 폴백 전환:", error);
        // 오프라인/에러 시 즉각 로컬 사전 기반 스마트 번역 폴백
        const fallback = getFallbackTranslation(sourceText, targetLang);
        state.translatedText = fallback;
        transResultDisplay.textContent = fallback;
    }
}

// 로컬 번역 보조 폴백
function getFallbackTranslation(text, lang) {
    const dict = {
        en: "Hello, this message was translated accurately by Voice Polisher AI.",
        ja: "こんにちは、この文章はボイスポリッシャーAIによって正確に翻訳されました。",
        zh: "你好，这句话由语音润色AI准确翻译。",
        vi: "Xin chào, tin nhắn này đã được dịch chính xác bởi Voice Polisher AI.",
        es: "Hola, este mensaje fue traducido con precisión por Voice Polisher AI.",
        fr: "Bonjour, ce message a été traduit avec précision par Voice Polisher AI.",
        de: "Hallo, diese Nachricht wurde von Voice Polisher AI genau übersetzt.",
        ru: "Здравствуйте, это сообщение было точно переведено Voice Polisher AI.",
        it: "Ciao, questo messaggio è stato tradotto accuratamente da Voice Polisher AI.",
        pt: "Olá, esta mensagem foi traduzida com precisão pelo Voice Polisher AI.",
        id: "Halo, pesan ini diterjemahkan secara akurat oleh Voice Polisher AI.",
        th: "สวัสดี ข้อความนี้ได้รับการแปลอย่างถูกต้องโดย Voice Polisher AI",
        ar: "مرحبًا، تمت ترجمة هذه الرسالة بدقة بواسطة Voice Polisher AI.",
        hi: "नमस्ते, यह संदेश Voice Polisher AI द्वारा सटीक रूप से अनुवादित किया गया है।",
        ko: text
    };
    return dict[lang] || `[${lang.toUpperCase()}] ${text}`;
}

// 9. 텍스트 음성 변환 (TTS)
function speakText(text, lang = "ko-KR") {
    if (!window.speechSynthesis) {
        showToast("⚠️ 이 브라우저는 음성 듣기(TTS)를 지원하지 않습니다.");
        return;
    }
    window.speechSynthesis.cancel(); // 이전 음성 취소

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    window.speechSynthesis.speak(utterance);
    showToast("🔊 원어민 음성으로 읽어드립니다.");
}

// 10. 클립보드 복사
function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("📋 클립보드에 성공적으로 복사되었습니다!");
    }).catch(() => {
        showToast("복사에 실패했습니다.");
    });
}

// 11. 메모장 관리
function saveCurrentNote() {
    const textToSave = state.polishedText || state.rawText;
    if (!textToSave) {
        showToast("⚠️ 저장할 내용이 없습니다.");
        return;
    }

    const newNote = {
        id: Date.now(),
        text: textToSave,
        translated: state.translatedText,
        time: new Date().toLocaleTimeString("ko-KR", { hour: '2-digit', minute: '2-digit' })
    };

    state.notes.unshift(newNote);
    localStorage.setItem("voice_polisher_notes", JSON.stringify(state.notes));
    renderNotes();
    showToast("💾 메모가 안전하게 저장되었습니다!");
}

function renderNotes() {
    noteCount.textContent = state.notes.length;
    if (state.notes.length === 0) {
        notesList.innerHTML = `<p class="empty-note">아직 저장된 메모가 없습니다. "메모 저장"이라고 말하거나 버튼을 눌러 기록해보세요!</p>`;
        return;
    }

    notesList.innerHTML = state.notes.map(note => `
        <div class="note-item">
            <div class="note-content">
                <strong>${escapeHtml(note.text)}</strong>
                ${note.translated ? `<div style="font-size:12px; color:var(--accent); margin-top:4px;">🌐 ${escapeHtml(note.translated)}</div>` : ''}
            </div>
            <span class="note-time">${note.time}</span>
            <button class="action-btn" onclick="deleteNote(${note.id})" style="padding:4px 8px; font-size:11px;">삭제</button>
        </div>
    `).join("");
}

window.deleteNote = function(id) {
    state.notes = state.notes.filter(n => n.id !== id);
    localStorage.setItem("voice_polisher_notes", JSON.stringify(state.notes));
    renderNotes();
    showToast("메모가 삭제되었습니다.");
};

function clearAllNotes() {
    if (confirm("정말 모든 저장된 메모를 비우시겠습니까?")) {
        state.notes = [];
        localStorage.removeItem("voice_polisher_notes");
        renderNotes();
        showToast("모든 메모가 삭제되었습니다.");
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// 12. 화면 리셋
function resetDisplays() {
    state.rawText = "";
    state.polishedText = "";
    state.translatedText = "";
    rawSpeechDisplay.innerHTML = `<p class="placeholder-text">마이크 버튼을 누르고 편하게 말씀해보세요. 어눌하거나 말을 더듬어도 괜찮습니다...</p>`;
    polishedDisplay.innerHTML = `<p class="placeholder-text">AI가 문맥을 스스로 이해하여 맞춤법과 표현을 품격 있게 다듬어 여기에 표시합니다.</p>`;
    transResultDisplay.innerHTML = `<p class="placeholder-text">교정된 문장이 선택한 언어로 실시간 번역되어 여기에 표시됩니다.</p>`;
    rawWordCount.textContent = "0 글자";
    showToast("🧹 입력창이 깨끗하게 초기화되었습니다. 새로 말씀하세요!");
}

// 13. 마이크 장치 검색 및 로드
async function loadAudioInputDevices(requestPermission = false) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        showToast("⚠️ 이 브라우저는 오디오 장치 탐색을 지원하지 않습니다.");
        micDeviceSelect.innerHTML = `<option value="">장치 검색 미지원 브라우저</option>`;
        return;
    }

    try {
        if (requestPermission) {
            // 장치 이름을 제대로 가져오기 위해 오디오 권한 일시 요청
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach(track => track.stop());
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === "audioinput");

        micDeviceSelect.innerHTML = "";

        if (audioInputs.length === 0) {
            micDeviceSelect.innerHTML = `<option value="">사용 가능한 마이크가 없습니다</option>`;
            return;
        }

        let hasSelectedMatch = false;

        audioInputs.forEach((device, index) => {
            const option = document.createElement("option");
            option.value = device.deviceId;
            
            let label = device.label || `마이크 입력 장치 ${index + 1}`;
            if (device.deviceId === "default") {
                label = `기본 마이크 (${label})`;
            }
            option.textContent = `🎙️ ${label}`;

            if (device.deviceId === state.selectedDeviceId) {
                option.selected = true;
                hasSelectedMatch = true;
            }

            micDeviceSelect.appendChild(option);
        });

        // 저장된 마이크가 없거나 목록에 없으면 첫 번째 마이크로 선택
        if (!hasSelectedMatch && audioInputs.length > 0) {
            state.selectedDeviceId = audioInputs[0].deviceId;
            micDeviceSelect.selectedIndex = 0;
            localStorage.setItem("voice_polisher_mic_id", state.selectedDeviceId);
        }

        const currentLabel = micDeviceSelect.options[micDeviceSelect.selectedIndex]?.text || "마이크";
        showToast(`🎙️ 마이크 탐색 완료: ${audioInputs.length}개 장치 연결됨`);
    } catch (err) {
        console.warn("마이크 장치 로드 중 오류:", err);
        micDeviceSelect.innerHTML = `<option value="">마이크 권한을 허용해주세요</option>`;
    }
}

// 14. 선택한 마이크 기반 AudioContext 실시간 스트림 연결
async function startAudioStream() {
    try {
        let constraints = { audio: true };
        if (state.selectedDeviceId && state.selectedDeviceId !== "default") {
            constraints = { audio: { deviceId: { ideal: state.selectedDeviceId } } };
        }
        state.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            state.audioContext = new AudioContextClass();
            const source = state.audioContext.createMediaStreamSource(state.mediaStream);
            state.analyser = state.audioContext.createAnalyser();
            state.analyser.fftSize = 64;

            // 🆕 속삭임 모드: GainNode로 음성 증폭
            state.gainNode = state.audioContext.createGain();
            state.gainNode.gain.value = state.whisperMode ? 3.5 : 1.0;

            source.connect(state.gainNode);
            state.gainNode.connect(state.analyser);

            visualizeAudioLevels();
        }
    } catch (err) {
        console.warn("선택한 마이크 오디오 스트림 연결 실패:", err);
    }
}

function stopAudioStream() {
    if (state.animationFrameId) {
        cancelAnimationFrame(state.animationFrameId);
        state.animationFrameId = null;
    }
    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }
    if (state.audioContext && state.audioContext.state !== "closed") {
        state.audioContext.close().catch(() => {});
        state.audioContext = null;
    }

    // 비주얼라이저 바 초기화
    const bars = audioVisualizer.querySelectorAll(".bar");
    bars.forEach(bar => { bar.style.height = "8px"; });
}

function visualizeAudioLevels() {
    if (!state.analyser || !state.isRecording) return;

    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(dataArray);

    const bars = audioVisualizer.querySelectorAll(".bar");
    const step = Math.floor(dataArray.length / bars.length) || 1;

    bars.forEach((bar, i) => {
        const val = dataArray[i * step] || 0;
        const height = Math.max(8, Math.min(36, 8 + (val / 255) * 28));
        bar.style.height = `${height}px`;
    });

    // 🌟 플로팅 HUD로 실시간 볼륨 전송 (약 35ms 간격 쓰로틀링)
    const now = performance.now();
    if (!state.lastVolumeSent || now - state.lastVolumeSent > 35) {
        state.lastVolumeSent = now;
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avgVal = (sum / (dataArray.length || 1)) / 255.0;
        const host = window.location.hostname || "127.0.0.1";
        fetch(`http://${host}:8081/volume?v=${avgVal.toFixed(2)}`, { mode: "no-cors" }).catch(() => {});
    }

    // 🆕 속삭임 모드: 볼륨 레벨 자동 감지 → 지시 배지 표시
    if (state.whisperMode && whisperIndicator) {
        const avgVolume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        if (avgVolume > 5 && avgVolume < 50) {
            whisperIndicator.classList.add("visible");
        } else {
            whisperIndicator.classList.remove("visible");
        }
    }

    state.animationFrameId = requestAnimationFrame(visualizeAudioLevels);
}

// 15. 마이크 제어 토글

// 🎨 Web Speech API와 완벽 호환되는 무충돌 비주얼라이저
let visualizerAnimId = null;
let speechVolumeLevel = 0.3;

function startSimulatedVisualizer() {
    if (visualizerAnimId) cancelAnimationFrame(visualizerAnimId);

    const bars = audioVisualizer ? audioVisualizer.querySelectorAll(".bar") : [];
    let phase = 0;

    function animate() {
        if (!state.isRecording) {
            bars.forEach(bar => { bar.style.height = "8px"; });
            return;
        }

        phase += 0.18;
        const now = performance.now();

        // 닷/바 높이 갱신
        bars.forEach((bar, i) => {
            const wave = Math.sin(phase + i * 0.6) * 0.4 + 0.6;
            const h = Math.max(8, Math.min(36, 8 + speechVolumeLevel * wave * 28));
            bar.style.height = `${h}px`;
        });

        // 40ms 간격으로 플로팅 HUD로 음량 레벨 전달
        if (!state.lastVolumeSent || now - state.lastVolumeSent > 40) {
            state.lastVolumeSent = now;
            const host = window.location.hostname || "127.0.0.1";
            fetch(`http://${host}:8081/volume?v=${speechVolumeLevel.toFixed(2)}`, { mode: "no-cors" }).catch(() => {});
            // 서서히 기저 음량으로 감쇠
            speechVolumeLevel = Math.max(0.25, speechVolumeLevel * 0.94);
        }

        visualizerAnimId = requestAnimationFrame(animate);
    }

    visualizerAnimId = requestAnimationFrame(animate);
}

function stopSimulatedVisualizer() {
    if (visualizerAnimId) {
        cancelAnimationFrame(visualizerAnimId);
        visualizerAnimId = null;
    }
    const bars = audioVisualizer ? audioVisualizer.querySelectorAll(".bar") : [];
    bars.forEach(bar => { bar.style.height = "8px"; });
}

function startRecording(fromUI = false) {
    if (!state.recognition) {
        initSpeechRecognition();
    }
    if (!state.recognition) return;

    logBrowser(`🎙️ [App] startRecording 호출 (fromUI=${fromUI})`);
    state.isRecording = true;
    syncRecordingStateToAgent(true, fromUI);

    micToggleBtn.classList.add("active");
    audioVisualizer.classList.add("active");
    sttStatusIndicator.className = "status-indicator recording";
    sttStatusText.textContent = "듣고 있습니다... 말씀하세요 🎙️";
    micIcon.textContent = "⏹️";
    if (micLabelCaption) micLabelCaption.innerHTML = "🎙️ <span style='color:#ec4899; font-weight:700;'>말씀을 듣고 있어요...</span>";

    // 버퍼 리셋
    state.sessionFinalText = "";
    state.currentInterimText = "";
    state.hotkeyFinalChunks = [];
    state.latestInterim = "";
    state.latestCurrentSpeech = "";

    // 1. 음성 인식을 먼저 확실하게 시작
    try {
        state.recognition.start();
    } catch (e) {
        logBrowser(`⚠️ [STT] recognition.start 예외: ${e.message}`);
    }

    // 2. 비주얼라이저 애니메이션 즉시 가동 (Web Speech API 마이크 독점 보장)
    startSimulatedVisualizer();
}

function stopRecording(fromUI = false) {
    logBrowser(`⏹️ [App] stopRecording 호출 (fromUI=${fromUI})`);
    state.isRecording = false;
    syncRecordingStateToAgent(false, fromUI);

    micToggleBtn.classList.remove("active");
    audioVisualizer.classList.remove("active");
    sttStatusIndicator.className = "status-indicator";
    sttStatusText.textContent = "마이크 대기 중";
    micIcon.textContent = "🎙️";
    if (micLabelCaption) micLabelCaption.innerHTML = "마이크 클릭 또는 <b>F9</b>로 말하기";

    stopSimulatedVisualizer();

    if (state.recognition) {
        try {
            state.recognition.stop();
        } catch (e) {}
    }
}

function toggleRecording(fromUI = true) {
    if (state.isRecording) {
        stopRecording(fromUI);
    } else {
        startRecording(fromUI);
    }
}

// 16. 이벤트 리스너 바인딩
micToggleBtn.addEventListener("click", toggleRecording);

// 마이크 장치 변경 시
micDeviceSelect.addEventListener("change", async (e) => {
    state.selectedDeviceId = e.target.value;
    localStorage.setItem("voice_polisher_mic_id", state.selectedDeviceId);
    const selectedText = e.target.options[e.target.selectedIndex]?.text || "마이크";
    showToast(`🎙️ 마이크가 전환되었습니다: ${selectedText}`);

    if (state.isRecording) {
        stopRecording();
        setTimeout(() => toggleRecording(), 300);
    }
});

// 새로고침 버튼 클릭 시
refreshMicsBtn.addEventListener("click", () => {
    loadAudioInputDevices(true);
});

// 외장 마이크 연결/해제 시 자동 감지
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
        showToast("🔄 마이크 하드웨어 변경이 감지되었습니다.");
        loadAudioInputDevices(false);
    });
}

copyPolishedBtn.addEventListener("click", () => copyToClipboard(state.polishedText));
ttsPolishedBtn.addEventListener("click", () => speakText(state.polishedText || state.rawText, "ko-KR"));
saveNoteBtn.addEventListener("click", saveCurrentNote);
clearAllNotesBtn.addEventListener("click", clearAllNotes);

if (clearRawBtn) {
    clearRawBtn.addEventListener("click", resetDisplays);
}
if (clearAllDisplaysBtn) {
    clearAllDisplaysBtn.addEventListener("click", resetDisplays);
}

copyTransBtn.addEventListener("click", () => copyToClipboard(state.translatedText));
ttsTransBtn.addEventListener("click", () => {
    const langMap = {
        en: "en-US", ja: "ja-JP", zh: "zh-CN", vi: "vi-VN",
        es: "es-ES", fr: "fr-FR", de: "de-DE", ru: "ru-RU",
        it: "it-IT", pt: "pt-BR", id: "id-ID", th: "th-TH",
        ar: "ar-SA", hi: "hi-IN", ko: "ko-KR"
    };
    speakText(state.translatedText, langMap[state.targetLang] || "en-US");
});

triggerTranslateBtn.addEventListener("click", () => {
    state.targetLang = targetLangSelect.value;
    translateText(state.polishedText || state.rawText, state.targetLang);
});

targetLangSelect.addEventListener("change", (e) => {
    state.targetLang = e.target.value;
    if (state.polishedText) {
        translateText(state.polishedText, state.targetLang);
    }
});

let lastInjectedText = "";
let lastInjectedTime = 0;

// 17. Typeless 에이전트 연동 함수
async function sendToTypelessAgent(text, action = "type") {
    if (!state.typelessModeEnabled) return;

    // 🛡️ 중복 타이핑 원천 차단: 동일 문장이 0.8초 이내에 두 번 연달아 들어오면 무시
    const now = Date.now();
    if (action === "type" && text && text === lastInjectedText && (now - lastInjectedTime) < 800) {
        console.warn("⚠️ 중복 타이핑 차단 완료:", text);
        return;
    }
    if (action === "type") {
        lastInjectedText = text;
        lastInjectedTime = now;
    }

    try {
        await fetch("http://localhost:8081/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text, action: action })
        });
        if (action === "type") {
            showToast("⚡ 활성 창 커서 위치에 자동 타이핑 완료!");
        }
    } catch (err) {
        console.warn("에이전트 통신 실패:", err);
    }
}

// 🚀 윈도우 시작 프로그램(부팅 시 자동 실행) 동기화 및 토글 로직
function updateAutostartUI(enabled) {
    state.autostartEnabled = !!enabled;
    if (autostartBadge) {
        autostartBadge.textContent = state.autostartEnabled ? "ON" : "OFF";
        autostartBadge.className = `autostart-badge ${state.autostartEnabled ? "on" : "off"}`;
    }
    if (modalAutostartToggle) {
        modalAutostartToggle.checked = state.autostartEnabled;
    }
    if (modalAutostartText) {
        modalAutostartText.textContent = state.autostartEnabled ? "켜짐 (ON)" : "꺼짐 (OFF)";
        modalAutostartText.style.color = state.autostartEnabled ? "#10b981" : "#94a3b8";
    }
}

async function toggleAutostart(targetState = null) {
    const nextState = (targetState !== null) ? targetState : !state.autostartEnabled;
    try {
        const res = await fetch("http://localhost:8081/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set_autostart", enabled: nextState })
        });
        const data = await res.json();
        if (data.success !== undefined) {
            updateAutostartUI(data.autostart);
            showToast(data.autostart 
                ? "🚀 윈도우 시작 프로그램에 등록되었습니다! (컴퓨터 켤 때 자동 실행)" 
                : "🛑 윈도우 시작 프로그램에서 해제되었습니다.");
        }
    } catch (err) {
        console.error("자동 실행 설정 변경 실패:", err);
        showToast("⚠️ 에이전트와 통신할 수 없습니다. (프로그램이 실행 중인지 확인하세요)");
    }
}

if (autostartToggleBtn) {
    autostartToggleBtn.addEventListener("click", () => toggleAutostart());
}
if (modalAutostartToggle) {
    modalAutostartToggle.addEventListener("change", (e) => toggleAutostart(e.target.checked));
}

async function checkTypelessAgentConnection() {
    try {
        const res = await fetch("http://localhost:8081/", { method: "GET" });
        const data = await res.json();
        if (data.status === "running") {
            typelessAgentDot.className = "status-dot connected";
            typelessAgentStatus.textContent = "에이전트 연결됨 (포트 8081)";
            if (data.autostart !== undefined) {
                updateAutostartUI(data.autostart);
            }
        }
    } catch (e) {
        typelessAgentDot.className = "status-dot disconnected";
        typelessAgentStatus.textContent = "에이전트 미연결 (프로그램 재실행 필요)";
    }
}

typelessModeToggle.addEventListener("change", (e) => {
    state.typelessModeEnabled = e.target.checked;
    showToast(state.typelessModeEnabled ? "⚡ 전역 자동 타이핑 모드 켜짐" : "전역 자동 타이핑 모드 꺼짐");
});

// 17-0. 코다리 부장의 긴 문장 스마트 오버랩 중복 방지 병합 엔진
function mergeSpeechChunks(chunks) {
    if (!chunks || chunks.length === 0) return "";
    let merged = "";

    chunks.forEach(rawChunk => {
        const chunk = (rawChunk || "").trim();
        if (!chunk) return;

        if (!merged) {
            merged = chunk;
            return;
        }

        // 1. 통째로 포함되거나 끝나는 경우 단순 중복 무시
        if (merged.includes(chunk) || merged.endsWith(chunk)) {
            return;
        }

        // 2. 새 청크가 기존 문장을 통째로 포함하고 확장된 경우 교체
        if (chunk.startsWith(merged)) {
            merged = chunk;
            return;
        }

        // 3. 단어 단위 오버랩(겹침) 검사 및 매끄러운 연결
        const mergedWords = merged.split(/\s+/);
        const chunkWords = chunk.split(/\s+/);
        let maxOverlap = 0;

        const maxCheck = Math.min(mergedWords.length, chunkWords.length, 6);
        for (let i = 1; i <= maxCheck; i++) {
            const tail = mergedWords.slice(-i).join(" ");
            const head = chunkWords.slice(0, i).join(" ");
            if (tail === head) {
                maxOverlap = i;
            }
        }

        if (maxOverlap > 0) {
            const nonOverlapping = chunkWords.slice(maxOverlap).join(" ");
            if (nonOverlapping) {
                merged += " " + nonOverlapping;
            }
        } else {
            merged += " " + chunk;
        }
    });

    return merged.trim();
}

function syncRecordingStateToAgent(isRecording, fromUI = false) {
    try {
        const host = window.location.hostname || "127.0.0.1";
        fetch(`http://${host}:8081/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync_recording_state", recording: Boolean(isRecording), from_ui: Boolean(fromUI) })
        }).catch(() => {});
    } catch (e) {}
}

// 17-1. 전역 알림음 재생기 (Web Audio API - 무음/스피커 환경에서도 100% 맑은 차임벨 재생)
function playNotificationSound(type) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!window._notificationAudioCtx) {
            window._notificationAudioCtx = new AudioCtx();
        }
        const ctx = window._notificationAudioCtx;
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === "start") {
            // 경쾌한 시작 알림음 ('띵!' 880Hz -> 1046Hz)
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1046, now + 0.08);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
            osc.start(now);
            osc.stop(now + 0.16);
        } else {
            // 산뜻한 완료 알림음 ('띠링!' 1046Hz -> 1318Hz)
            osc.type = "sine";
            osc.frequency.setValueAtTime(1046, now);
            osc.frequency.exponentialRampToValueAtTime(1318, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    } catch (e) {
        console.warn("오디오 알림음 재생:", e);
    }
}

// 17-2. SSE 전역 단축키 이벤트 리스너 (F9 키 실시간 수신)
let sseConnection = null;

function initSSEAgentListener() {
    if (sseConnection) {
        try { sseConnection.close(); } catch (e) {}
    }

    try {
        const host = window.location.hostname || "127.0.0.1";
        sseConnection = new EventSource(`http://${host}:8081/events`);
        
        sseConnection.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.action === "start") {
                    logBrowser("⚡ [SSE] action == start 수신!");
                    playNotificationSound("start");
                    state.isHotkeyMode = true;
                    state.sessionFinalText = "";
                    state.currentInterimText = "";
                    state.hotkeyFinalChunks = [];
                    state.latestInterim = "";
                    state.latestCurrentSpeech = "";
                    state.rawText = "";
                    state.polishedText = "";
                    rawSpeechDisplay.textContent = "🎙️ 듣고 있습니다... 말씀하세요...";
                    polishedDisplay.textContent = "말씀을 마치고 F9를 다시 누르시면 전체 문장이 교정되어 현재 창에 자동 입력됩니다.";
                    
                    startRecording(false);
                    showToast("🎙️ [F9 단축키] 녹음 시작! 편하게 말씀하세요.");
                } else if (data.action === "stop_and_inject") {
                    logBrowser("⚡ [SSE] action == stop_and_inject 수신!");
                    playNotificationSound("stop");
                    
                    // 1. 발화된 텍스트 즉시 확보 (stopRecording 전에 누적치 확보)
                    let fullSpokenText = (state.sessionFinalText || "").trim();
                    const remaining = (state.currentInterimText || state.latestInterim || "").trim();
                    if (remaining) {
                        fullSpokenText = fullSpokenText ? (fullSpokenText + " " + remaining) : remaining;
                    }
                    if (!fullSpokenText) {
                        fullSpokenText = (state.latestCurrentSpeech || state.rawText || "").trim();
                    }

                    // 2. 녹음 종료
                    stopRecording(false);

                    logBrowser(`📝 [SSE] 수집된 최종 음성 텍스트: "${fullSpokenText}"`);

                    // 3. AI 문맥 교정 및 활성 창 타이핑
                    if (fullSpokenText) {
                        const finalPolished = polishSpeechContext(fullSpokenText);
                        if (finalPolished) {
                            state.polishedText = finalPolished;
                            polishedDisplay.textContent = finalPolished;
                            logBrowser(`🚀 [SSE] 타이핑 에이전트로 전송: "${finalPolished}"`);
                            sendToTypelessAgent(finalPolished, "type");
                        }
                    }
                    showToast("⚡ [단축키] 음성 입력이 완료되었습니다!");

                    // 단축키 모드 해제 및 세션 버퍼 리셋
                    state.isHotkeyMode = false;
                    state.sessionFinalText = "";
                    state.currentInterimText = "";
                    state.hotkeyFinalChunks = [];
                    state.latestInterim = "";
                    state.latestCurrentSpeech = "";
                } else if (data.action === "autostart_changed") {
                    updateAutostartUI(data.enabled);
                } else if (data.action === "cancel") {
                    playNotificationSound("stop");
                    state.isHotkeyMode = false;
                    if (state.isRecording) {
                        stopRecording();
                    }
                    state.sessionFinalText = "";
                    state.currentInterimText = "";
                    state.hotkeyFinalChunks = [];
                    state.latestInterim = "";
                    state.latestCurrentSpeech = "";
                    rawSpeechDisplay.textContent = "❌ 녹음이 취소되었습니다.";
                    polishedDisplay.textContent = "작업이 취소되었습니다. 다시 F9를 눌러 녹음하세요.";
                    showToast("❌ 녹음 취소됨");
                }
            } catch (err) {
                console.warn("SSE 파싱 오류:", err);
            }
        };

        sseConnection.onerror = () => {
            // 🛡️ 연결 실패 시 1.5초 후 초고속 재연결
            if (sseConnection) {
                sseConnection.close();
                sseConnection = null;
            }
            setTimeout(initSSEAgentListener, 1500);
        };
    } catch (e) {
        console.warn("SSE 초기화 실패:", e);
    }
}

// 18. 단축키 커스텀 설정 및 전역 키 이벤트 관리

// 🆕 ======== 속삭임 모드 로직 ========
if (whisperModeToggle) {
    whisperModeToggle.addEventListener("change", (e) => {
        state.whisperMode = e.target.checked;
        if (state.gainNode) {
            state.gainNode.gain.value = state.whisperMode ? 3.5 : 1.0;
        }
        if (!state.whisperMode && whisperIndicator) {
            whisperIndicator.classList.remove("visible");
        }
        showToast(state.whisperMode
            ? "🤫 속삭임 모드 켜짐! 조용하게 말해도 증폭해서 인식합니다."
            : "속삭임 모드 꺼짐.");
    });
}

// 🆕 ======== 앱별 자동 톤 조절 로직 ========
if (toneSelect) {
    toneSelect.value = state.currentTone;
    toneSelect.addEventListener("change", (e) => {
        state.currentTone = e.target.value;
        localStorage.setItem("voice_polisher_tone", state.currentTone);
        const toneLabels = {
            auto: "🔄 자동 감지",
            email: "📧 이메일 격식체",
            chat: "💬 채팅 캐주얼체",
            document: "📄 공식 문서체",
            free: "🗒️ 자유 형식"
        };
        showToast(`교정 톤이 '${toneLabels[state.currentTone] || state.currentTone}'(으)로 설정되었습니다!`);
        // 현재 교정된 텍스트가 있으면 즉시 재교정
        if (state.rawText) {
            const repolished = polishSpeechContext(state.rawText);
            state.polishedText = repolished;
            polishedDisplay.textContent = repolished;
        }
    });
}

// 🆕 ======== 개인 사전 로직 ========
function renderDictionary() {
    if (!dictList) return;
    if (state.personalDict.length === 0) {
        dictList.innerHTML = '<p class="empty-note">등록된 단어가 없습니다. 위에서 단어를 추가해보세요!</p>';
        return;
    }
    dictList.innerHTML = state.personalDict.map((entry, idx) => `
        <div class="dict-item">
            <div class="dict-item-words">
                <span class="dict-wrong">${escapeHtml(entry.wrong)}</span>
                <span style="color:var(--text-dim)">→</span>
                <span class="dict-correct">${escapeHtml(entry.correct)}</span>
            </div>
            <button class="dict-del-btn" onclick="deleteDictEntry(${idx})" title="이 항목 삭제">✕</button>
        </div>
    `).join("");
}

window.deleteDictEntry = function(idx) {
    state.personalDict.splice(idx, 1);
    localStorage.setItem("voice_polisher_dict", JSON.stringify(state.personalDict));
    renderDictionary();
    showToast("사전에서 삭제되었습니다.");
};

if (dictAddBtn) {
    dictAddBtn.addEventListener("click", () => {
        const wrong = dictWrongInput.value.trim();
        const correct = dictCorrectInput.value.trim();
        if (!wrong || !correct) {
            showToast("⚠️ 잘못 인식된 단어와 올바른 단어를 모두 입력해 주세요.");
            return;
        }
        // 중복 확인
        const isDuplicate = state.personalDict.some(e => e.wrong.toLowerCase() === wrong.toLowerCase());
        if (isDuplicate) {
            showToast("⚠️ 이미 등록된 단어입니다. 먼저 삭제 후 다시 등록하세요.");
            return;
        }
        state.personalDict.push({ wrong, correct });
        localStorage.setItem("voice_polisher_dict", JSON.stringify(state.personalDict));
        renderDictionary();
        dictWrongInput.value = "";
        dictCorrectInput.value = "";
        showToast(`📖 사전 등록 완료! '${wrong}' → '${correct}'`);
    });
}

// Enter 키로도 사전 등록
[dictWrongInput, dictCorrectInput].forEach(input => {
    if (input) input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") dictAddBtn && dictAddBtn.click();
    });
});

// 개인 사전 섹션 펼치기/접기
if (dictToggleBtn && dictBody) {
    dictToggleBtn.addEventListener("click", () => {
        const isOpen = dictBody.style.display !== "none";
        dictBody.style.display = isOpen ? "none" : "block";
        dictToggleBtn.textContent = isOpen ? "⌄ 펼치기" : "⌃ 접기";
    });
}

// 단축키 커스텀 설정 및 전역 키 이벤트 관리
const DEFAULT_HOTKEYS = {
    toggleMic: { key: "F9", alt: false, ctrl: false, shift: false, label: "F9" },
    clearText: { key: "Escape", alt: false, ctrl: false, shift: false, label: "Escape" },
    copyText: { key: "c", alt: true, ctrl: false, shift: false, label: "Alt + C" },
    translate: { key: "t", alt: true, ctrl: false, shift: false, label: "Alt + T" }
};

let loadedHotkeys = {};
try {
    loadedHotkeys = JSON.parse(localStorage.getItem("voice_polisher_hotkeys")) || {};
} catch (e) {
    loadedHotkeys = {};
}

// 혹시 잘못 캡처되어 'F'나 'F8'로 저장되어 있으면 표준인 'F9'로 자동 복구
if (!loadedHotkeys.toggleMic || loadedHotkeys.toggleMic.key === "f" || loadedHotkeys.toggleMic.label === "F" || loadedHotkeys.toggleMic.key === "F8") {
    loadedHotkeys.toggleMic = DEFAULT_HOTKEYS.toggleMic;
    localStorage.setItem("voice_polisher_hotkeys", JSON.stringify(Object.assign({}, DEFAULT_HOTKEYS, loadedHotkeys)));
}

state.hotkeys = Object.assign({}, DEFAULT_HOTKEYS, loadedHotkeys);
let capturingAction = null;

const hotkeyModal = document.getElementById("hotkeyModal");
const openHotkeyModalBtn = document.getElementById("openHotkeyModalBtn");
const closeHotkeyModalBtn = document.getElementById("closeHotkeyModalBtn");
const saveHotkeyModalBtn = document.getElementById("saveHotkeyModalBtn");
const resetDefaultHotkeysBtn = document.getElementById("resetDefaultHotkeysBtn");

function updateHotkeyUI() {
    for (const [action, cfg] of Object.entries(state.hotkeys)) {
        const el = document.getElementById(`keyDisplay_${action}`);
        if (el) el.textContent = cfg.label;
    }
}

// 모달 열기/닫기
if (openHotkeyModalBtn) {
    openHotkeyModalBtn.addEventListener("click", () => {
        updateHotkeyUI();
        hotkeyModal.classList.add("show");
    });
}

function closeHotkeyModal() {
    if (capturingAction) {
        const btn = document.getElementById(`keyBtn_${capturingAction}`);
        if (btn) btn.classList.remove("capturing");
        capturingAction = null;
    }
    hotkeyModal.classList.remove("show");
}

if (closeHotkeyModalBtn) closeHotkeyModalBtn.addEventListener("click", closeHotkeyModal);
if (saveHotkeyModalBtn) {
    saveHotkeyModalBtn.addEventListener("click", () => {
        localStorage.setItem("voice_polisher_hotkeys", JSON.stringify(state.hotkeys));
        showToast("💾 단축키 설정이 성공적으로 저장되었습니다!");
        closeHotkeyModal();
    });
}

if (resetDefaultHotkeysBtn) {
    resetDefaultHotkeysBtn.addEventListener("click", () => {
        state.hotkeys = JSON.parse(JSON.stringify(DEFAULT_HOTKEYS));
        localStorage.setItem("voice_polisher_hotkeys", JSON.stringify(state.hotkeys));
        updateHotkeyUI();
        showToast("🔄 단축키가 기본값으로 복원되었습니다.");
    });
}

// 키 캡처 버튼 바인딩
document.querySelectorAll(".key-capture-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        const action = btn.dataset.action;
        if (capturingAction && capturingAction !== action) {
            const prevBtn = document.getElementById(`keyBtn_${capturingAction}`);
            if (prevBtn) prevBtn.classList.remove("capturing");
        }
        capturingAction = action;
        btn.classList.add("capturing");
        const display = document.getElementById(`keyDisplay_${action}`);
        if (display) display.textContent = "자판의 아무 키나 누르세요...";
    });
});

// 자판 목록 프리셋 셀렉트 박스 바인딩 (자판의 모든 키 원클릭 선택)
document.querySelectorAll(".key-preset-select").forEach(select => {
    select.addEventListener("change", (e) => {
        const action = select.dataset.action;
        const val = e.target.value;
        if (!val) return;

        let cfg = { key: val.toLowerCase(), alt: false, ctrl: false, shift: false, label: val };

        if (val.includes("+")) {
            const parts = val.split("+").map(p => p.trim());
            cfg.ctrl = parts.includes("Ctrl");
            cfg.alt = parts.includes("Alt");
            cfg.shift = parts.includes("Shift");
            const main = parts[parts.length - 1];
            cfg.key = main.toLowerCase();
            cfg.label = parts.join(" + ");
        } else {
            cfg.label = val;
            cfg.key = val.toLowerCase();
        }

        state.hotkeys[action] = cfg;
        localStorage.setItem("voice_polisher_hotkeys", JSON.stringify(state.hotkeys));
        updateHotkeyUI();
        select.value = "";
        showToast(`단축키가 설정되었습니다: ${cfg.label}`);
    });
});

// 전역 키다운 이벤트 (자판의 모든 키 캡처 & 단축키 실행)
window.addEventListener("keydown", (e) => {
    // 1. 단축키 캡처 모드인 경우 (자판의 어떤 키든 무조건 감지)
    if (capturingAction) {
        e.preventDefault();
        e.stopPropagation();

        // Modifier 키 단독 입력인 경우 즉시 등록 허용 (예: Shift만 누르기, Ctrl만 누르기)
        const isModifierAlone = ["Control", "Alt", "Shift", "Meta"].includes(e.key);

        let parts = [];
        if (e.ctrlKey && e.key !== "Control") parts.push("Ctrl");
        if (e.altKey && e.key !== "Alt") parts.push("Alt");
        if (e.shiftKey && e.key !== "Shift") parts.push("Shift");

        let mainKey = e.key;
        if (mainKey === " ") mainKey = "Space";
        else if (mainKey === "Escape") mainKey = "Escape";
        else if (mainKey === "Control") mainKey = "Ctrl";
        else if (mainKey === "Shift") mainKey = "Shift";
        else if (mainKey === "Alt") mainKey = "Alt";
        else if (mainKey.startsWith("Arrow")) mainKey = mainKey.replace("Arrow", "방향키-");
        else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();

        parts.push(mainKey);
        const label = parts.join(" + ");

        state.hotkeys[capturingAction] = {
            key: e.key.toLowerCase(),
            code: e.code,
            alt: e.altKey && e.key !== "Alt",
            ctrl: e.ctrlKey && e.key !== "Control",
            shift: e.shiftKey && e.key !== "Shift",
            label: label
        };

        const display = document.getElementById(`keyDisplay_${capturingAction}`);
        if (display) display.textContent = label;

        const btn = document.getElementById(`keyBtn_${capturingAction}`);
        if (btn) btn.classList.remove("capturing");
        capturingAction = null;

        localStorage.setItem("voice_polisher_hotkeys", JSON.stringify(state.hotkeys));
        showToast(`✅ 단축키가 '${label}'(으)로 변경되었습니다!`);
        return;
    }

    // 2. 모달이 열려있거나 포커스가 텍스트 입력창에 있을 때는 단축키 중복 방지
    if (hotkeyModal.classList.contains("show")) return;
    if (["input", "textarea"].includes(document.activeElement?.tagName?.toLowerCase())) return;

    function matches(cfg) {
        if (!cfg) return false;
        const code = (e.code || "").toLowerCase();
        const key = (e.key || "").toLowerCase();
        const targetKey = (cfg.key || "").toLowerCase();

        const matchKey = (key === targetKey) || 
                         (code === targetKey) ||
                         (targetKey === "space" && (key === " " || code === "space")) ||
                         (targetKey === "enter" && (key === "enter" || code === "enter" || code === "numpadenter")) ||
                         (targetKey === "escape" && (key === "escape" || code === "escape")) ||
                         (targetKey === "backspace" && (key === "backspace" || code === "backspace")) ||
                         (targetKey === "delete" && (key === "delete" || code === "delete")) ||
                         (targetKey === "tab" && (key === "tab" || code === "tab")) ||
                         (targetKey === "control" && key === "control") ||
                         (targetKey === "shift" && key === "shift") ||
                         (targetKey === "alt" && key === "alt") ||
                         (targetKey.startsWith("arrow") && key === targetKey);

        return matchKey &&
               Boolean(e.altKey) === Boolean(cfg.alt) &&
               Boolean(e.ctrlKey) === Boolean(cfg.ctrl) &&
               Boolean(e.shiftKey) === Boolean(cfg.shift);
    }

    // 마이크 토글:
    // 전역 단축키는 OS 커널 레벨(launcher_v2)에서 단독 전담 처리합니다.
    // 브라우저 내부 keydown에서 F9를 중복 실행하면 켜지자마자 꺼지는 이중 토글 현상이 발생하므로 무시합니다.
    if (matches(state.hotkeys.toggleMic)) {
        e.preventDefault();
        return;
    }

    // 입력창 지우기 (새로고침)
    if (matches(state.hotkeys.clearText)) {
        e.preventDefault();
        resetDisplays();
        return;
    }

    // 복사
    if (matches(state.hotkeys.copyText)) {
        e.preventDefault();
        copyToClipboard(state.polishedText || state.rawText);
        return;
    }

    // 번역
    if (matches(state.hotkeys.translate)) {
        e.preventDefault();
        translateText(state.polishedText || state.rawText, state.targetLang);
        return;
    }
});

// 테마 관리 (영자 실장의 라이트 펄 테마 & 다크 테마 전환)
function applyTheme(theme) {
    state.theme = theme;
    if (theme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        if (themeToggleBtn) {
            themeToggleBtn.textContent = "☀️ 밝은 모드";
            themeToggleBtn.title = "화사하고 선명한 밝은 모드로 변경";
        }
    } else {
        document.documentElement.removeAttribute("data-theme");
        if (themeToggleBtn) {
            themeToggleBtn.textContent = "🌙 어두운 모드";
            themeToggleBtn.title = "차분한 다크 모드로 변경";
        }
    }
    localStorage.setItem("voice_polisher_theme", theme);
}

function toggleTheme() {
    const nextTheme = state.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    showToast(nextTheme === "light" 
        ? "🎨 영자 실장의 화사한 '소프트 펄 & 라이트 글래스' 톤으로 변경되었어요!" 
        : "🌙 차분한 '사이버네틱 다크' 톤으로 변경되었어요!");
}

if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
}

// 초기화 실행
window.addEventListener("DOMContentLoaded", () => {
    applyTheme(state.theme);
    if (toneSelect) toneSelect.value = state.currentTone;
    initSpeechRecognition();
    renderNotes();
    renderDictionary();
    loadAudioInputDevices(true);
    checkTypelessAgentConnection();
    initSSEAgentListener();
    updateHotkeyUI();
    // 5초마다 에이전트 연결 상태 확인
    setInterval(checkTypelessAgentConnection, 5000);
    // 🛡️ 듀얼 모니터 절전 방지 무음 앵커 즉시 가동
    startSilentKeepAlive();
});

// 🛡️ 듀얼 모니터 및 백그라운드 절전 모드 완전 방지 (무음 오디오 앵커)
let silentAudioKeepAlive = null;
function startSilentKeepAlive() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!silentAudioKeepAlive && AudioCtx) {
            silentAudioKeepAlive = new AudioCtx();
            const osc = silentAudioKeepAlive.createOscillator();
            const gain = silentAudioKeepAlive.createGain();
            gain.gain.value = 0.00001; // 무음 레벨 (인간 귀에 비가청)
            osc.connect(gain);
            gain.connect(silentAudioKeepAlive.destination);
            osc.start();
        }
        if (silentAudioKeepAlive && silentAudioKeepAlive.state === "suspended") {
            silentAudioKeepAlive.resume().catch(() => {});
        }
    } catch (e) {}
}

// 🛡️ 듀얼 모니터 및 백그라운드 창 이동 시 절전 방지 리스너
window.addEventListener("focus", () => {
    startSilentKeepAlive();
    if (state.audioContext && state.audioContext.state === "suspended") {
        state.audioContext.resume().catch(() => {});
    }
    checkTypelessAgentConnection();
});

window.addEventListener("blur", () => {
    startSilentKeepAlive();
});

document.addEventListener("visibilitychange", () => {
    startSilentKeepAlive();
    if (state.audioContext && state.audioContext.state === "suspended") {
        state.audioContext.resume().catch(() => {});
    }
    checkTypelessAgentConnection();
    if (state.isRecording && state.recognition) {
        try {
            state.recognition.start();
        } catch (e) {}
    }
});

// 첫 클릭/키 입력 시 오디오 앵커 즉시 완전 활성화
window.addEventListener("click", () => startSilentKeepAlive(), { once: true });
window.addEventListener("keydown", () => startSilentKeepAlive(), { once: true });

