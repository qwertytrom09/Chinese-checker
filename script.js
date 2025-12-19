// --- script.js (FULL AND RUNNABLE IMPLEMENTATION) ---

// --- 1. FIREBASE SETUP AND INITIALIZATION ---

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-analytics.js";
import { getDatabase, ref, push, update, onValue, get, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCRloUJSnAw5y0djtowJibjPtyaf64_ixk",
    authDomain: "chinese-checkers-65c45.firebaseapp.com",
    projectId: "chinese-checkers-65c45",
    storageBucket: "chinese-checkers-65c45.firebasestorage.app",
    messagingSenderId: "778537259594",
    appId: "1:778537259594:web:d388a3173b68bf4c34ccb3",
    measurementId: "G-XRE1NGCMLG"
};

let app, db, auth;

try {
    app = initializeApp(firebaseConfig);
    const analytics = getAnalytics(app);
    db = getDatabase(app);
    auth = getAuth(app);
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization failed:', error);
}

let currentUser = null;
let currentGameId = null;
let unsubscribeGameListener = null;
let currentGameState = null;

const PLAYER_COLORS = ['red', 'green', 'yellow', 'blue', 'black', 'white']; // Order matching initialization peaks

/**
 * Returns the active colors for a given number of players.
 */
function getActiveColors(maxPlayers) {
    switch (maxPlayers) {
        case 2:
            return ['red', 'green'];
        case 3:
            return ['red', 'yellow', 'black'];
        case 4:
            return ['red', 'green', 'blue', 'yellow'];
        case 6:
        default:
            return PLAYER_COLORS;
    }
}

// Coordinates for starting positions on rhombus board (Axial q, r)
// These coordinates are correct for a star board where the max distance is 4 (121 pegs)
// Updated to 10 pieces per color for standard Chinese Checkers
const INITIAL_POSITIONS = {
    // Red: Bottom corner (r=-4 triangle)
    red: [
        "1,-5", "2,-5", "3,-5", "4,-5", "2,-6", "3,-6", "4,-6", "3,-7", "4,-7", "4,-8"
    ],
    // Green: Top corner (r=4 triangle)
    green: [
        "-1,5", "-2,5", "-3,5", "-4,5", "-2,6", "-3,6", "-4,6", "-3,7", "-4,7", "-4,8"
    ],
    // Yellow: NE corner (q=4, r=0 triangle)
    yellow: [
        "4,3", "3,3", "4,1", "3,4", "2,4", "3,2", "4,2", "2,3", "1,4", "4,4"
    ],
    // Blue: SW corner (q=-4, r=0 triangle)
    blue: [
        "-4,-3", "-3,-3", "-4,-1", "-3,-4", "-2,-4", "-3,-2", "-4,-2", "-2,-3", "-1,-4", "-4,-4"
    ],
    // Black: NW corner (q=-4, r=4 triangle)
    black: [
        "-5,1", "-5,2", "-5,3", "-5,4","-6,2","-6,3","-6,4","-7,3","-7,4","-8,4",
    ],
    // White: SE corner (q=4, r=-4 triangle)
    white: [
        "5,-1", "5,-2", "5,-3", "5,-4","6,-2","6,-3","6,-4","7,-3","7,-4","8,-4",
    ]
};

const WIN_POSITIONS = {
    // Red (bottom) wins at top
    red: INITIAL_POSITIONS.green,
    // Green (top) wins at bottom
    green: INITIAL_POSITIONS.red,
    // Yellow (NE) wins at SW
    yellow: INITIAL_POSITIONS.blue,
    // Blue (SW) wins at NE
    blue: INITIAL_POSITIONS.yellow,
    // Black (NW) wins at SE
    black: INITIAL_POSITIONS.white,
    // White (SE) wins at NW
    white: INITIAL_POSITIONS.black
};

// --- 2. AUTHENTICATION ---

function enableGameControls(enabled) {
    const createBtn = document.getElementById('create-game-btn');
    const joinBtn = document.getElementById('join-game-btn');
    createBtn.disabled = !enabled;
    joinBtn.disabled = !enabled;
}

function setupAuthListener() {
    onAuthStateChanged(auth, (user) => {
        const userInfo = document.getElementById('user-info');
        const userUidSpan = document.getElementById('user-uid');
        const logoutBtn = document.getElementById('logout-button');

        if (user) {
            currentUser = user;
            userInfo.textContent = `Signed in (Anonymous)`;
            userUidSpan.textContent = user.uid.substring(0, 8) + '...';
            logoutBtn.style.display = 'block';
            enableGameControls(true); 
        } else {
            currentUser = null;
            userInfo.textContent = `Signing in...`;
            logoutBtn.style.display = 'none';
            enableGameControls(false); 
            
            signInAnonymously(auth).catch(error => {
                console.error("Anon sign-in failed:", error);
                userInfo.textContent = 'Auth Failed. Check console.';
            });
        }
    });
}
document.getElementById('logout-button').addEventListener('click', () => {
    signOut(auth);
});


// --- 3. GAME MANAGEMENT (LOBBY) ---

async function createNewGame(maxPlayers = 6) {
    console.log('createNewGame called with maxPlayers:', maxPlayers);
    console.log('currentUser:', currentUser);
    if (!currentUser) {
        console.error("Not authenticated.");
        return;
    }

    try {
        const activeColors = getActiveColors(maxPlayers);
        const initialGameState = {
            status: maxPlayers === 1 ? 'in-progress' : 'waiting', // Start immediately for single player testing
            players: [{ userId: currentUser.uid, color: activeColors[0], isHost: true }],
            maxPlayers: maxPlayers,
            turn: activeColors[0],
            boardState: initializeBoard(maxPlayers),
            selectedPiece: null,
            moveHistory: [],
            winner: null
        };

        console.log('Creating game with state:', initialGameState);
        console.log('Attempting to add game to Realtime Database...');
        const newGameRef = push(ref(db, "games"), initialGameState);
        const gameId = newGameRef.key;
        console.log('Game created with ID:', gameId);
        joinGame(gameId);
        console.log(`Game ${gameId} created and joined.`);

    } catch (e) {
        console.error("Error creating new game: ", e);
    }
}

async function joinGame(gameId) {
    if (!currentUser) return console.error("Not authenticated.");

    if (unsubscribeGameListener) unsubscribeGameListener();
    const gameRef = ref(db, "games/" + gameId);
    currentGameId = gameId;

    unsubscribeGameListener = onValue(gameRef, (snapshot) => {
        if (snapshot.exists()) {
            handleGameUpdate(snapshot.val());
        } else {
            alert("Game not found or ended!");
            leaveGame();
        }
    });

    const gameSnapshot = await get(gameRef);
    if (gameSnapshot.exists() && gameSnapshot.val().status === 'waiting') {
        let gameData = gameSnapshot.val();
        const isAlreadyInGame = gameData.players.some(p => p.userId === currentUser.uid);

        if (!isAlreadyInGame && gameData.players.length < gameData.maxPlayers) {
            const activeColors = getActiveColors(gameData.maxPlayers);
            const nextColorIndex = gameData.players.length;
            const newPlayer = { userId: currentUser.uid, color: activeColors[nextColorIndex] };

            await update(gameRef, {
                players: [...gameData.players, newPlayer]
            });
        }

        if (gameData.players.length + (isAlreadyInGame ? 0 : 1) === gameData.maxPlayers) {
            await update(gameRef, { status: 'in-progress' });
        }
    }
}

function leaveGame() {
    if (unsubscribeGameListener) unsubscribeGameListener();
    currentGameId = null;
    document.getElementById('game-board-container').style.display = 'none';
    document.getElementById('game-lobby').style.display = 'flex';
    document.getElementById('game-id-display').style.display = 'none';
}

function handleGameUpdate(gameState) {
    currentGameState = gameState;

    document.getElementById('game-lobby').style.display = 'none';
    document.getElementById('game-board-container').style.display = 'block';

    // Display game ID
    if (currentGameId) {
        document.getElementById('current-game-id').textContent = currentGameId;
        document.getElementById('game-id-display').style.display = 'block';
    }

    let displayText = `Game Status: ${gameState.status}`;
    let fullscreenText = 'WAITING FOR PLAYERS...';

    if (gameState.status === 'finished' && gameState.winner) {
        displayText += `. Winner: ${gameState.winner}`;
        fullscreenText = `🏆 WINNER: ${gameState.winner.toUpperCase()}! 🏆`;

        // Check if current user won
        const currentPlayerColor = gameState.players.find(p => p.userId === currentUser.uid)?.color;
        const isSinglePlayerGame = gameState.players.length === 1;
        if (isSinglePlayerGame || gameState.winner === currentPlayerColor) {
            // If in fullscreen, exit fullscreen first
            if (document.fullscreenElement) {
                exitFullscreen().then(() => {
                    showWinModal(gameState.winner);
                });
            } else {
                showWinModal(gameState.winner);
            }
        }
    } else if (gameState.status === 'in-progress') {
        const currentPlayerColor = gameState.players.find(p => p.userId === currentUser.uid)?.color;
        fullscreenText = `TURN: ${gameState.turn.toUpperCase()}`;
        if (gameState.turn === currentPlayerColor) {
            displayText += `. Your turn (${gameState.turn})`;
        } else {
            displayText += `. Turn: ${gameState.turn}`;
        }
    }

    document.getElementById('current-turn-display').textContent = displayText;

    // Update fullscreen turn overlay
    const turnOverlay = document.getElementById('fullscreen-turn-overlay');
    const turnText = document.getElementById('fullscreen-turn-text');
    if (turnOverlay && turnText) {
        if (gameState.status === 'in-progress' || gameState.status === 'finished') {
            turnText.textContent = fullscreenText;
            turnOverlay.style.display = 'block';
        } else {
            turnOverlay.style.display = 'none';
        }
    }

    drawBoard(gameState.boardState, gameState.selectedPiece);
}





// --- 4. BOARD GEOMETRY AND DRAWING (Axial Coordinates) ---

// Constants for drawing the hex grid on the SVG viewBox (1000x870)
const SIZE = 40; 
const BOARD_CENTER_X = 500;
const BOARD_CENTER_Y = 435;
const PEG_RADIUS = 10;
const PIECE_RADIUS = 30;
const MAX_DISTANCE = 4; // Max axial distance for a 121-peg board

// The 6 directions in Axial (q, r) coordinates
const DIRECTIONS = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

const coordKey = (q, r) => `${q},${r}`;
const keyToCoord = (key) => {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
};

/**
 * Converts Axial coordinates (q, r) to screen pixel coordinates (x, y).
 */
function axialToPixel(q, r) {
    const x = SIZE * (3 / 2 * q);
    const y = SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
    return {
        x: x + BOARD_CENTER_X,
        y: y + BOARD_CENTER_Y
    };
}

// Creates the original 121-hole star board, defined hole by hole
const PEG_MAP = generatePegMap();
function generatePegMap() {
    const map = new Map();

    // Define all 121 points of the original Chinese Checkers star board, point by point
    const starPositions = [
        // Center hexagon - distance 0-2
        { q: 0, r: 0 },
        { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
        { q: 2, r: 0 }, { q: 1, r: 1 }, { q: 0, r: 2 }, { q: -1, r: 2 }, { q: -2, r: 2 }, { q: -2, r: 1 },
        { q: -2, r: 0 }, { q: -1, r: -1 }, { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 }, { q: 2, r: -1 },

        // Star arms extending to distance 5
        { q: 3, r: 0 }, { q: 2, r: 1 }, { q: 1, r: 2 }, { q: 0, r: 3 },
        { q: -1, r: 3 }, { q: -2, r: 3 }, { q: -3, r: 3 }, { q: -3, r: 2 }, { q: -3, r: 1 }, { q: -3, r: 0 },
        { q: -2, r: -1 }, { q: -1, r: -2 }, { q: 0, r: -3 },
        { q: 1, r: -3 }, { q: 2, r: -3 }, { q: 3, r: -3 }, { q: 3, r: -2 }, { q: 3, r: -1 },
        { q: 4, r: 0 }, { q: 3, r: 1 }, { q: 2, r: 2 }, { q: 1, r: 3 }, { q: 0, r: 4 },
        { q: -1, r: 4 }, { q: -2, r: 4 }, { q: -3, r: 4 }, { q: -4, r: 4 }, { q: -4, r: 3 }, { q: -4, r: 2 }, { q: -4, r: 1 }, { q: -4, r: 0 },
        { q: -3, r: -1 }, { q: -2, r: -2 }, { q: -1, r: -3 }, { q: 0, r: -4 },
        { q: 1, r: -4 }, { q: 2, r: -4 }, { q: 3, r: -4 }, { q: 4, r: -4 }, { q: 4, r: -3 }, { q: 4, r: -2 }, { q: 4, r: -1 },
        
        { q: 5, r: -1 }, { q: 5, r: -2 }, { q: 5, r: -3 }, { q: 5, r: -4 },
        { q: 6, r: -2 }, { q: 6, r: -3 }, { q: 6, r: -4 }, 
        { q: 7, r: -3 }, { q: 7, r: -4 },
        { q: 8, r: -4 },  
        
        { q: -5, r: 1 }, { q: -5, r: 2 }, { q: -5, r: 3 }, { q: -5, r: 4 },
        { q: -6, r: 2 }, { q: -6, r: 3 }, { q: -6, r: 4 },
        { q: -7, r: 3 }, { q: -7, r: 4 },
        { q: -8, r: 4 },
        
        { q: 1, r: -5 },{ q: 3, r: -5 },{ q: 2, r: -5 },{ q: 4, r: -5 }, 
        { q: 4, r: -6 },{ q: 3, r: -6 },{ q: 2, r: -6 },
        { q: 4, r: -7 },{ q: 3, r: -7 },
        { q: 4, r: -8 },

        { q: -1, r: 5 },{ q: -3, r: 5 },{ q: -2, r: 5 },{ q: -4, r: 5 },
        { q: -4, r: 6 },{ q: -3, r: 6 },{ q: -2, r: 6 },
        { q: -4, r: 7 },{ q: -3, r: 7 },
        { q: -4, r: 8 },

        { q: 1, r: 4 },{ q: 2, r: 4 },{ q: 3, r: 4 },{ q: 4, r: 4 },
        { q: 2, r: 3 }, { q: 3, r: 3 }, { q: 4, r: 3 },
        { q: 3, r: 2 }, { q: 4, r: 2 },
        { q: 4, r: 1 },
        { q: -1, r: -4 }, { q: -2, r: -4 }, { q: -3, r: -4 }, { q: -4, r: -4 },
        { q: -2, r: -3 }, { q: -3, r: -3 }, { q: -4, r: -3 },
        { q: -3, r: -2 }, { q: -4, r: -2 },
        { q: -4, r: -1 }
    ];

    // Remove duplicates and add all positions to the map
    const uniquePositions = [...new Set(starPositions.map(pos => coordKey(pos.q, pos.r)))];
    uniquePositions.forEach(key => {
        const { q, r } = keyToCoord(key);
        map.set(key, { q, r });
    });

    console.log(`Original star board created with ${map.size} holes (defined hole by hole).`);
    return map;
}

/**
 * Places pieces for the specified number of players.
 * Uses standard Chinese Checkers player arrangements.
 */
function initializeBoard(maxPlayers) {
    const boardState = {};
    // Place pieces only for the active colors based on number of players
    const activeColors = getActiveColors(maxPlayers);

    activeColors.forEach(color => {
        const positionKeys = INITIAL_POSITIONS[color] || [];
        positionKeys.forEach(key => {
            boardState[key] = color;
        });
    });

    return boardState;
}

function drawBoard(boardState, selectedPieceCoords) {
    const svg = document.getElementById('chinese-checkers-board');
    if (!svg) return;

    svg.innerHTML = '';

    // Add gradient definitions for marble effects
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

    // Red marble gradient
    const redGradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    redGradient.setAttribute("id", "marble-red");
    redGradient.setAttribute("cx", "30%");
    redGradient.setAttribute("cy", "30%");
    redGradient.setAttribute("r", "70%");
    const redStop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    redStop1.setAttribute("offset", "0%");
    redStop1.setAttribute("stop-color", "#ff6b6b");
    const redStop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    redStop2.setAttribute("offset", "70%");
    redStop2.setAttribute("stop-color", "#e74c3c");
    const redStop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    redStop3.setAttribute("offset", "100%");
    redStop3.setAttribute("stop-color", "#c0392b");
    redGradient.appendChild(redStop1);
    redGradient.appendChild(redStop2);
    redGradient.appendChild(redStop3);
    defs.appendChild(redGradient);

    // Green marble gradient
    const greenGradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    greenGradient.setAttribute("id", "marble-green");
    greenGradient.setAttribute("cx", "30%");
    greenGradient.setAttribute("cy", "30%");
    greenGradient.setAttribute("r", "70%");
    const greenStop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    greenStop1.setAttribute("offset", "0%");
    greenStop1.setAttribute("stop-color", "#48ff48");
    const greenStop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    greenStop2.setAttribute("offset", "70%");
    greenStop2.setAttribute("stop-color", "#2ecc71");
    const greenStop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    greenStop3.setAttribute("offset", "100%");
    greenStop3.setAttribute("stop-color", "#27ae60");
    greenGradient.appendChild(greenStop1);
    greenGradient.appendChild(greenStop2);
    greenGradient.appendChild(greenStop3);
    defs.appendChild(greenGradient);

    // Yellow marble gradient
    const yellowGradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    yellowGradient.setAttribute("id", "marble-yellow");
    yellowGradient.setAttribute("cx", "30%");
    yellowGradient.setAttribute("cy", "30%");
    yellowGradient.setAttribute("r", "70%");
    const yellowStop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    yellowStop1.setAttribute("offset", "0%");
    yellowStop1.setAttribute("stop-color", "#ffff6b");
    const yellowStop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    yellowStop2.setAttribute("offset", "70%");
    yellowStop2.setAttribute("stop-color", "#f1c40f");
    const yellowStop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    yellowStop3.setAttribute("offset", "100%");
    yellowStop3.setAttribute("stop-color", "#f39c12");
    yellowGradient.appendChild(yellowStop1);
    yellowGradient.appendChild(yellowStop2);
    yellowGradient.appendChild(yellowStop3);
    defs.appendChild(yellowGradient);

    // Blue marble gradient
    const blueGradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    blueGradient.setAttribute("id", "marble-blue");
    blueGradient.setAttribute("cx", "30%");
    blueGradient.setAttribute("cy", "30%");
    blueGradient.setAttribute("r", "70%");
    const blueStop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    blueStop1.setAttribute("offset", "0%");
    blueStop1.setAttribute("stop-color", "#6bbcff");
    const blueStop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    blueStop2.setAttribute("offset", "70%");
    blueStop2.setAttribute("stop-color", "#3498db");
    const blueStop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    blueStop3.setAttribute("offset", "100%");
    blueStop3.setAttribute("stop-color", "#2980b9");
    blueGradient.appendChild(blueStop1);
    blueGradient.appendChild(blueStop2);
    blueGradient.appendChild(blueStop3);
    defs.appendChild(blueGradient);

    // Black marble gradient (subtle shine)
    const blackGradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    blackGradient.setAttribute("id", "marble-black");
    blackGradient.setAttribute("cx", "30%");
    blackGradient.setAttribute("cy", "30%");
    blackGradient.setAttribute("r", "70%");
    const blackStop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    blackStop1.setAttribute("offset", "0%");
    blackStop1.setAttribute("stop-color", "#5a5a5a");
    const blackStop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    blackStop2.setAttribute("offset", "70%");
    blackStop2.setAttribute("stop-color", "#34495e");
    const blackStop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    blackStop3.setAttribute("offset", "100%");
    blackStop3.setAttribute("stop-color", "#2c3e50");
    blackGradient.appendChild(blackStop1);
    blackGradient.appendChild(blackStop2);
    blackGradient.appendChild(blackStop3);
    defs.appendChild(blackGradient);

    // White marble gradient
    const whiteGradient = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    whiteGradient.setAttribute("id", "marble-white");
    whiteGradient.setAttribute("cx", "30%");
    whiteGradient.setAttribute("cy", "30%");
    whiteGradient.setAttribute("r", "70%");
    const whiteStop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    whiteStop1.setAttribute("offset", "0%");
    whiteStop1.setAttribute("stop-color", "#ffffff");
    const whiteStop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    whiteStop2.setAttribute("offset", "70%");
    whiteStop2.setAttribute("stop-color", "#ecf0f1");
    const whiteStop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    whiteStop3.setAttribute("offset", "100%");
    whiteStop3.setAttribute("stop-color", "#bdc3c7");
    whiteGradient.appendChild(whiteStop1);
    whiteGradient.appendChild(whiteStop2);
    whiteGradient.appendChild(whiteStop3);
    defs.appendChild(whiteGradient);

    svg.appendChild(defs);

    // 1. Draw all 121 Pegs
    for (const key of PEG_MAP.keys()) {
        const { q, r } = keyToCoord(key);
        const { x, y } = axialToPixel(q, r);

        let peg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        peg.setAttribute("cx", x);
        peg.setAttribute("cy", y);
        peg.setAttribute("r", PEG_RADIUS);
        peg.classList.add("peg");
        peg.dataset.coords = key;
        svg.appendChild(peg);

        // 2. Draw the Piece
        if (boardState[key]) {
            let piece = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            piece.setAttribute("cx", x);
            piece.setAttribute("cy", y);
            piece.setAttribute("r", PIECE_RADIUS);
            piece.setAttribute("id", `piece-${key}`);
            piece.classList.add("game-piece", `piece-${boardState[key]}`);
            piece.setAttribute("fill", `url(#marble-${boardState[key]})`); // Use the marble gradient
            piece.dataset.coords = key;
            svg.appendChild(piece);

            if (key === selectedPieceCoords) {
                piece.classList.add('piece-selected');
            }
        }
    }

    // 3. Highlight Valid Moves
    const currentPlayerColor = currentGameState.players.find(p => p.userId === currentUser.uid)?.color;
    const isSinglePlayerGame = currentGameState.players.length === 1;
    if (selectedPieceCoords && (currentGameState.turn === currentPlayerColor || isSinglePlayerGame)) {
        const moves = calculateValidMoves(selectedPieceCoords, boardState);
        moves.forEach(key => {
            const { q, r } = keyToCoord(key);
            const { x, y } = axialToPixel(q, r);
            let highlight = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            highlight.setAttribute("cx", x);
            highlight.setAttribute("cy", y);
            highlight.setAttribute("r", PIECE_RADIUS * 0.9);
            highlight.setAttribute("fill", "transparent");
            highlight.classList.add("move-highlight");
            highlight.dataset.coords = key;
            svg.appendChild(highlight);
        });
    }
}


// --- 5. GAME LOGIC ENGINE (Functional Core) ---

function addCoords(start, direction) {
    return { q: start.q + direction.q, r: start.r + direction.r };
}

function isValidPeg(key) {
    return PEG_MAP.has(key);
}

/**
 * Calculates all valid single steps and hop chains for a given piece.
 */
function calculateValidMoves(startKey, boardState) {
    const validDestinations = new Set();
    const visitedHopDestinations = new Set();
    const startCoord = keyToCoord(startKey);

    // 1. Single-step moves
    DIRECTIONS.forEach(dir => {
        const neighborKey = coordKey(startCoord.q + dir.q, startCoord.r + dir.r);
        if (isValidPeg(neighborKey) && !boardState[neighborKey]) {
            validDestinations.add(neighborKey);
        }
    });

    // 2. Jump chains (BFS) - only allow jumps over adjacent pieces
    const hopQueue = [startKey];
    visitedHopDestinations.add(startKey);

    while (hopQueue.length > 0) {
        const currentKey = hopQueue.shift();
        const currentCoord = keyToCoord(currentKey);

        DIRECTIONS.forEach(dir => {
            const jumpedKey = coordKey(currentCoord.q + dir.q, currentCoord.r + dir.r);
            const landingKey = coordKey(currentCoord.q + dir.q * 2, currentCoord.r + dir.r * 2);

            if (boardState[jumpedKey] && // Jump over adjacent piece
                isValidPeg(landingKey) && // Landing spot is valid
                !boardState[landingKey] && // Landing spot is empty
                !visitedHopDestinations.has(landingKey)) // Not already visited
            {
                validDestinations.add(landingKey);
                visitedHopDestinations.add(landingKey);
                hopQueue.push(landingKey);
            }
        });
    }
    validDestinations.delete(startKey);
    return Array.from(validDestinations);
}

/**
 * Checks if the given color has won by having all pieces in the win positions.
 */
function checkWinCondition(boardState, color) {
    return WIN_POSITIONS[color].every(key => boardState[key] === color);
}


// --- 6. EVENT HANDLERS (The Functional Interaction) ---

async function executeGameMove(origin, destination) {
    // 1. Update the board state
    const newBoardState = { ...currentGameState.boardState };
    const pieceColor = newBoardState[origin];
    newBoardState[destination] = pieceColor;
    delete newBoardState[origin];

    // 2. Check for win condition
    const hasWon = checkWinCondition(newBoardState, pieceColor);
    const status = hasWon ? 'finished' : 'in-progress';
    const winner = hasWon ? pieceColor : null;

    // 3. Determine the next player's turn (only if game not finished)
    let nextTurnColor = currentGameState.turn;
    if (!hasWon) {
        const currentPlayerIndex = currentGameState.players.findIndex(p => p.color === currentGameState.turn);
        const nextPlayerIndex = (currentPlayerIndex + 1) % currentGameState.players.length;
        nextTurnColor = currentGameState.players[nextPlayerIndex].color;
    }

    // 4. Update Realtime Database
    await update(ref(db, "games/" + currentGameId), {
        boardState: newBoardState,
        turn: nextTurnColor,
        status: status,
        winner: winner,
        selectedPiece: null,
        moveHistory: [...(currentGameState.moveHistory || []), { from: origin, to: destination, player: currentGameState.turn, time: new Date() }]
    });
}

document.getElementById('create-game-btn').addEventListener('click', () => {
    console.log('Create game button clicked');
    const playerCount = parseInt(document.getElementById('player-count-select').value);
    createNewGame(playerCount);
});

document.getElementById('join-game-btn').addEventListener('click', () => {
    const gameId = document.getElementById('game-id-input').value.trim();
    if (gameId) {
        joinGame(gameId);
    } else {
        alert("Please enter a Game ID.");
    }
});

document.getElementById('leave-game-btn').addEventListener('click', leaveGame);

document.getElementById('copy-link-btn').addEventListener('click', () => {
    if (currentGameId) {
        const gameUrl = `${window.location.origin}${window.location.pathname}?game=${currentGameId}`;
        navigator.clipboard.writeText(gameUrl).then(() => {
            alert('Game link copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy link:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = gameUrl;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('Game link copied to clipboard!');
        });
    }
});

document.getElementById('fullscreen-board-btn').addEventListener('click', () => {
    toggleBoardFullscreen();
});

// --- FULLSCREEN BOARD FUNCTIONALITY ---

let fullscreenContainer = null;

function toggleBoardFullscreen() {
    const boardElement = document.getElementById('chinese-checkers-board');
    const button = document.getElementById('fullscreen-board-btn');

    if (!boardElement) return;

    // Check if fullscreen is supported
    if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled &&
        !document.mozFullScreenEnabled && !document.msFullscreenEnabled) {
        alert('Fullscreen is not supported by your browser.');
        return;
    }

    // Check if we're currently in fullscreen
    const isFullscreen = document.fullscreenElement ||
                        document.webkitFullscreenElement ||
                        document.mozFullScreenElement ||
                        document.msFullscreenElement;

    if (isFullscreen) {
        // Exit fullscreen
        exitFullscreen();
        button.textContent = '⛶'; // Fullscreen icon
        button.title = 'Toggle Fullscreen Board';
    } else {
        // Add fullscreen class to board and position it over everything
        boardElement.classList.add('fullscreen-board');

        // Also include the win modal and turn overlay in fullscreen by positioning them fixed
        const winModal = document.getElementById('win-modal');
        const turnOverlay = document.getElementById('fullscreen-turn-overlay');

        if (winModal) {
            winModal.style.position = 'fixed';
            winModal.style.zIndex = '10000';
        }

        if (turnOverlay) {
            turnOverlay.style.position = 'fixed';
            turnOverlay.style.zIndex = '10001';
            turnOverlay.style.top = '20px';
            turnOverlay.style.right = '20px';
        }

        // Enter fullscreen with the document body
        enterFullscreen(document.body);
        button.textContent = '⛶'; // Exit fullscreen icon (same symbol, different context)
        button.title = 'Exit Fullscreen Board';
    }
}

function enterFullscreen(element) {
    if (element.requestFullscreen) {
        element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
    }
}

function exitFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
}

// Listen for fullscreen changes to update button state
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

function updateFullscreenButton() {
    const button = document.getElementById('fullscreen-board-btn');
    if (!button) return;

    const isFullscreen = document.fullscreenElement ||
                        document.webkitFullscreenElement ||
                        document.mozFullScreenElement ||
                        document.msFullscreenElement;

    if (isFullscreen) {
        button.textContent = '⛶'; // Exit fullscreen icon
        button.title = 'Exit Fullscreen Board';
    } else {
        button.textContent = '⛶'; // Fullscreen icon
        button.title = 'Toggle Fullscreen Board';

        // Restore elements when exiting fullscreen
        const boardElement = document.getElementById('chinese-checkers-board');
        const winModal = document.getElementById('win-modal');
        const turnOverlay = document.getElementById('fullscreen-turn-overlay');

        // Remove fullscreen class and reset styles
        if (boardElement) {
            boardElement.classList.remove('fullscreen-board');
            boardElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }

        // Reset modal and overlay positioning
        if (winModal) {
            winModal.style.position = '';
            winModal.style.zIndex = '';
        }

        if (turnOverlay) {
            turnOverlay.style.position = '';
            turnOverlay.style.zIndex = '';
            turnOverlay.style.top = '';
            turnOverlay.style.right = '';
        }

        // Trigger a resize to restore normal layout
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    }
}

document.getElementById('chinese-checkers-board').addEventListener('click', (event) => {
    if (!currentGameState || currentGameState.status !== 'in-progress' || !currentUser) return;

    const target = event.target;
    const currentPlayerColor = currentGameState.players.find(p => p.userId === currentUser.uid)?.color;
    const isPlayerTurn = currentPlayerColor === currentGameState.turn;
    const isSinglePlayerGame = currentGameState.players.length === 1; // Allow playing any color in single player

    if (!isPlayerTurn && !isSinglePlayerGame) {
        return;
    }

    // 1. Piece Selection
    if (target.classList.contains('game-piece')) {
        const pieceColor = target.classList.item(1).replace('piece-', '');

        // Allow selecting any piece if single player, or only your color pieces
        if (isSinglePlayerGame || pieceColor === currentPlayerColor) {
            const coords = target.dataset.coords;
            const newSelection = currentGameState.selectedPiece === coords ? null : coords;

            update(ref(db, "games/" + currentGameId), { selectedPiece: newSelection });
        }
    }

    // 2. Move Execution
    else if (target.classList.contains('move-highlight') || target.classList.contains('peg')) {
        const destCoords = target.dataset.coords;
        const originCoords = currentGameState.selectedPiece;

        if (originCoords) {
            const validMoves = calculateValidMoves(originCoords, currentGameState.boardState);

            if (validMoves.includes(destCoords)) {
                executeGameMove(originCoords, destCoords);
            }
        }
    }
});


// --- URL PARAMETER HANDLING AND INITIALIZATION ---

function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    if (gameId) {
        // Wait for auth to complete before joining
        const checkAuthAndJoin = () => {
            if (currentUser) {
                joinGame(gameId);
            } else {
                setTimeout(checkAuthAndJoin, 100);
            }
        };
        checkAuthAndJoin();
    }
}

// --- WINDOW RESIZE HANDLING FOR RESPONSIVE DESIGN ---

let isResizing = false;

function handleWindowResize() {
    if (isResizing) return; // Prevent overlapping resize operations
    isResizing = true;

    // Skip resizing if in fullscreen mode
    if (document.fullscreenElement) {
        isResizing = false;
        return;
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Adjust main container height based on viewport
    const mainElement = document.querySelector('main');
    const headerElement = document.querySelector('header');

    if (headerElement && mainElement) {
        const headerHeight = headerElement.offsetHeight;
        const availableHeight = viewportHeight - headerHeight - 20; // 20px for body padding
        mainElement.style.minHeight = `${Math.max(availableHeight, 400)}px`;
        mainElement.style.height = 'auto'; // Allow natural height expansion
    }

    // Ensure game board is properly sized and visible
    const boardElement = document.getElementById('chinese-checkers-board');
    const container = document.getElementById('game-board-container');

    if (boardElement && container) {
        // Temporarily disable CSS transitions to prevent jumping
        const originalTransition = boardElement.style.transition;
        boardElement.style.transition = 'none';

        // Reset any previous scaling
        boardElement.style.transform = 'none';
        boardElement.style.marginTop = '10px';

        // Get available space in container
        const containerRect = container.getBoundingClientRect();
        const availableHeight = containerRect.height - 120; // Account for padding and game info
        const availableWidth = containerRect.width - 40; // Account for padding

        // Original SVG dimensions (1000x870)
        const originalWidth = 1000;
        const originalHeight = 870;

        // Calculate scaling to fit within available space while maintaining aspect ratio
        const scaleX = availableWidth / originalWidth;
        const scaleY = availableHeight / originalHeight;
        const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down if needed

        if (scale < 1) {
            // Apply scaling
            boardElement.style.transform = `scale(${scale})`;
            boardElement.style.transformOrigin = 'top center';

            // Center the scaled board
            const scaledHeight = originalHeight * scale;
            const topMargin = Math.max(10, (availableHeight - scaledHeight) / 2);
            boardElement.style.marginTop = `${topMargin}px`;
        }

        // Restore CSS transitions after a short delay
        setTimeout(() => {
            boardElement.style.transition = originalTransition;
            isResizing = false;
        }, 50);
    } else {
        isResizing = false;
    }

    // Force layout recalculation
    setTimeout(() => {
        // Trigger any CSS media query recalculations
        window.dispatchEvent(new Event('resize'));
    }, 100);
}

// Add resize event listener with increased debouncing
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleWindowResize, 300); // Increased from 250ms to 300ms
});

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    handleWindowResize();
});

function showWinModal(winnerColor) {
    const modal = document.getElementById('win-modal');
    const title = document.getElementById('win-title');
    const message = document.getElementById('win-message');

    title.textContent = `🎉 VICTORY! 🎉`;
    message.textContent = `Congratulations! ${winnerColor.charAt(0).toUpperCase() + winnerColor.slice(1)} has won the game!`;

    modal.style.display = 'flex';
}

document.getElementById('close-win-modal').addEventListener('click', () => {
    const modal = document.getElementById('win-modal');
    modal.style.display = 'none';
});

// --- START THE APP ---
setupAuthListener();
checkUrlParameters();
