/**
 * @file app.js
 * @author José A. Vázquez Mingorance
 * @date 26-02-2025
 * @description Lógica principal de la Spirit Radio LW. Gestiona el barrido aleatorio de audio,
 * el análisis de frecuencias para el visualizador y la síntesis de voz (EVP) con 
 * protocolos de seguridad anti-bloqueo.
 */
let running = false;
const msgEl = document.getElementById("message");
const btnToggle = document.getElementById("btnToggle");
const btnVisualizer = document.getElementById("btnVisualizer");
const staticNoise = document.getElementById("staticNoise");
const radioBank = document.getElementById("radioBank");
const dialEl = document.getElementById("dial");
const dialWrapper = document.querySelector(".dial-wrapper");

let radioTimerId = null;
let paranormalTimerId = null;
let displayUpdateId = null;
let phrases = [];
let isSpeaking = false; 

// --- MOTOR DE AUDIO ---
let audioCtx, analyser, dataArray;
let visualWindow = null;

function initAudioAnalysis() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        const sourceStatic = audioCtx.createMediaElementSource(staticNoise);
        const sourceRadio = audioCtx.createMediaElementSource(radioBank);
        sourceStatic.connect(analyser);
        sourceRadio.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyser.fftSize = 256; 
        dataArray = new Uint8Array(analyser.frequencyBinCount);
    }
}

function sendDataToVisualizer() {
    if (analyser) analyser.getByteFrequencyData(dataArray);
    if (visualWindow && !visualWindow.closed && running) {
        let total = 0;
        for(let i = 0; i < dataArray.length; i++) total += dataArray[i];
        let audioVolume = (total / dataArray.length) * 2;
        visualWindow.postMessage({ type: 'AUDIO_UPDATE', volume: audioVolume, isSpeaking: isSpeaking }, '*');
    }
}

// --- LÓGICA DE RADIO (BARRIDO) ---
function playRandomRadioSlice() {
    if (!running || isSpeaking) return;
    clearTimeout(radioTimerId);

    const duration = radioBank.duration || 10;
    radioBank.currentTime = Math.random() * duration;
    radioBank.volume = Math.random() * 0.4 + 0.2;
    
    radioBank.play().then(() => {
        const sliceDuration = Math.random() * 400 + 200; 
        radioTimerId = setTimeout(() => {
            radioBank.pause();
            if (running && !isSpeaking) {
                radioTimerId = setTimeout(playRandomRadioSlice, Math.random() * 1000 + 200);
            }
        }, sliceDuration);
    }).catch(() => {
        radioTimerId = setTimeout(playRandomRadioSlice, 500);
    });
}

// --- LÓGICA DE VOZ (CON ANTI-BLOQUEO) ---
fetch('phrases.json').then(res => res.json()).then(data => phrases = data.phrases);

function triggerParanormalEvent() {
    if (!running || phrases.length === 0 || isSpeaking) return;

    isSpeaking = true;
    clearTimeout(radioTimerId);
    radioBank.pause();

    msgEl.classList.add('evp-active');
    msgEl.textContent = "SINTONIZANDO...";

    // Seguridad: Si en 3 segundos no ha hablado, forzar reset
    const safetyTimeout = setTimeout(() => {
        if (msgEl.textContent === "SINTONIZANDO...") {
            console.log("Voz trabada, reseteando...");
            resetAfterVoice();
        }
    }, 4000);

    setTimeout(() => {
        if (!running) return;
        const text = phrases[Math.floor(Math.random() * phrases.length)];
        
        window.speechSynthesis.cancel(); // Limpiar cola previa
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'es-ES';
        utter.pitch = 0.1;
        utter.rate = 0.6;

        utter.onstart = () => {
            clearTimeout(safetyTimeout);
            msgEl.textContent = text.toUpperCase();
        };
        
        utter.onend = () => resetAfterVoice();
        utter.onerror = () => resetAfterVoice();

        window.speechSynthesis.speak(utter);
    }, 1500);
}

function resetAfterVoice() {
    isSpeaking = false;
    msgEl.classList.remove('evp-active');
    if (running) playRandomRadioSlice();
}

// --- CONTROLES ---
function startRadio() {
    initAudioAnalysis();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    // TRUCO: Desbloquear voz con un mensaje vacío al inicio
    const unlock = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(unlock);

    running = true;
    btnToggle.textContent = "Detener";
    dialEl.classList.remove('paused-anim');
    
    staticNoise.volume = 0.2;
    staticNoise.play();
    
    displayUpdateId = setInterval(() => {
        if (!isSpeaking && running) {
            const dialRect = dialEl.getBoundingClientRect();
            const wrapperRect = dialWrapper.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (dialRect.left - wrapperRect.left) / (wrapperRect.width - dialRect.width)));
            msgEl.textContent = `${(153.000 + (percent * 128.000)).toFixed(3)} kHz`;
        }
        sendDataToVisualizer();
    }, 50);
    
    playRandomRadioSlice();
    paranormalTimerId = setInterval(triggerParanormalEvent, 15000); // Cada 15 seg intenta hablar
}

function stopRadio() {
    running = false;
    isSpeaking = false;
    btnToggle.textContent = "Iniciar";
    dialEl.classList.add('paused-anim');
    clearInterval(displayUpdateId);
    clearInterval(paranormalTimerId);
    clearTimeout(radioTimerId);
    staticNoise.pause();
    radioBank.pause();
    // Añadimos esta línea para avisar al visualizador
    if (visualWindow && !visualWindow.closed) {
        visualWindow.postMessage({ type: 'STOP_ALL' }, '*');
    }
    window.speechSynthesis.cancel();
    msgEl.textContent = "OFFLINE";
    msgEl.classList.remove('evp-active');
}

btnToggle.onclick = () => {
    if (running) stopRadio(); else startRadio();
};

btnVisualizer.onclick = () => {
    visualWindow = window.open('visualizer.html', 'SpiritVisualizer', 'width=500,height=600');
};

// Modal (Simplificado)
const modal = document.getElementById("infoModal");
document.getElementById("btnInfo").onclick = () => modal.style.display = "block";
document.querySelector(".close").onclick = () => modal.style.display = "none";
