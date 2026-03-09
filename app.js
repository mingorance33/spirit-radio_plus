/**
 * @file app.js
 * @description Spirit Radio LW con IA (TensorFlow.js) y detección de entidades.
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

// --- CONFIGURACIÓN DE IA (TensorFlow.js) ---
let recognizer;
const CONFIDENCE_THRESHOLD = 0.85; // Sensibilidad de la IA para detectar voces

async function initAI() {
    try {
        // Cargamos el modelo de comandos de voz (FFT)
        recognizer = speechCommands.create("BROWSER_FFT");
        await recognizer.ensureModelLoaded();
        console.log("IA: Modelo cargado correctamente.");

        // La IA escucha en segundo plano
        recognizer.listen(result => {
            if (!running || isSpeaking) return;

            const scores = result.scores;
            const labels = recognizer.wordLabels();
            let topScore = 0;
            let wordDetected = "";

            for (let i = 0; i < scores.length; i++) {
                if (scores[i] > topScore) {
                    topScore = scores[i];
                    wordDetected = labels[i];
                }
            }

            // Si la IA detecta "habla" humana por encima del umbral
            if (topScore > CONFIDENCE_THRESHOLD && wordDetected !== '_background_noise_') {
                console.log(`IA detectó entidad sonora: ${wordDetected} (${(topScore * 100).toFixed(2)}%)`);
                triggerParanormalEvent(wordDetected);
            }
        }, {
            includeSpectrogram: true,
            probabilityThreshold: 0.70,
            overlapFactor: 0.5
        });
    } catch (e) {
        console.error("Error al iniciar la IA:", e);
    }
}

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
        for (let i = 0; i < dataArray.length; i++) total += dataArray[i];
        let audioVolume = (total / dataArray.length) * 2;
        visualWindow.postMessage({ type: 'AUDIO_UPDATE', volume: audioVolume, isSpeaking: isSpeaking }, '*');
    }
}

// --- BARRIDO DE RADIO (Audio Interno) ---
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
                radioTimerId = setTimeout(playRandomRadioSlice, Math.random() * 800 + 200);
            }
        }, sliceDuration);
    }).catch(() => {
        radioTimerId = setTimeout(playRandomRadioSlice, 500);
    });
}

// --- LÓGICA DE RESPUESTA INTELIGENTE (EVP) ---
fetch('phrases.json').then(res => res.json()).then(data => phrases = data.phrases);

let watchdogTimer = null;

function triggerParanormalEvent(aiInput = "") {
    if (!running || phrases.length === 0 || isSpeaking) return;

    // Si ya había un vigilante, lo limpiamos
    clearTimeout(watchdogTimer);
    
    isSpeaking = true;
    clearTimeout(radioTimerId);
    radioBank.pause();

    msgEl.classList.add('evp-active');
    msgEl.textContent = "SINTONIZANDO...";

    // VIGILANTE: Si en 6 segundos no ha hablado, resetear a la fuerza
    watchdogTimer = setTimeout(() => {
        if (isSpeaking && msgEl.textContent === "SINTONIZANDO...") {
            console.warn("Watchdog: Bloqueo detectado, reseteando...");
            resetAfterVoice();
        }
    }, 6000);

    // ... resto de tu código de setTimeout para la voz ...
    setTimeout(() => {
        if (!running) {
            resetAfterVoice();
            return;
        }
        // ... (el resto de la lógica de frases que ya tienes)
    }, 1200);
}

function resetAfterVoice() {
    isSpeaking = false;
    msgEl.classList.remove('evp-active');
    if (running) playRandomRadioSlice();
}

// --- CONTROLES PRINCIPALES ---
async function startRadio() {
    initAudioAnalysis();
    if (!recognizer) await initAI(); // Inicia la IA la primera vez
    
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    // Desbloqueo de audio para móviles
    const unlock = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(unlock);

// TRUCO PARA IOS: Reanudar el audio cada vez que el usuario toca la pantalla
    // o ante cualquier interrupción
    const resumeAudio = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    };
    document.addEventListener('click', resumeAudio);
    document.addEventListener('touchstart', resumeAudio);

    // Asegurarnos de que el reconocedor de IA esté activo
    if (recognizer && !recognizer.isListening()) {
        await startAI(); // Función auxiliar para re-conectar
    }


    
    running = true;
    btnToggle.textContent = "Detener";
    dialEl.classList.remove('paused-anim');
    staticNoise.volume = 0.15;
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
    // Evento aleatorio de seguridad cada 40s si no hay interacción
    paranormalTimerId = setInterval(() => {
        if (!isSpeaking) triggerParanormalEvent("random");
    }, 40000);
    
}

function stopRadio() {
    running = false;
    isSpeaking = false;
    btnToggle.textContent = "Iniciar";
    dialEl.classList.add('paused-anim');
    
    if (recognizer) recognizer.stopListening();
    
    clearInterval(displayUpdateId);
    clearInterval(paranormalTimerId);
    clearTimeout(radioTimerId);
    
    staticNoise.pause();
    radioBank.pause();
    
    if (visualWindow && !visualWindow.closed) visualWindow.postMessage({ type: 'STOP_ALL' }, '*');
    window.speechSynthesis.cancel();
    
    msgEl.textContent = "OFFLINE";
    msgEl.classList.remove('evp-active');
}

btnToggle.onclick = () => { if (running) stopRadio(); else startRadio(); };

btnVisualizer.onclick = () => { 
    visualWindow = window.open('visualizer.html', 'SpiritVisualizer', 'width=500,height=600'); 
};

// Modal Info
const modal = document.getElementById("infoModal");
document.getElementById("btnInfo").onclick = () => modal.style.display = "block";
document.querySelector(".close").onclick = () => modal.style.display = "none";
