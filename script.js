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
let gameStartTime = null;

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
        // Set game start time
        gameStartTime = new Date();

        const activeColors = getActiveColors(maxPlayers);
        const initialGameState = {
            status: maxPlayers === 1 ? 'in-progress' : 'waiting', // Start immediately for single player testing
            players: [{ userId: currentUser.uid, color: activeColors[0], isHost: true }],
            maxPlayers: maxPlayers,
            turn: activeColors[0],
            boardState: initializeBoard(maxPlayers),
            selectedPiece: null,
            moveHistory: [],
            winner: null,
            hideMoves: false
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
    if (gameState.status === 'finished' && gameState.winner) {
        displayText += `. Winner: ${gameState.winner}`;
    } else if (gameState.status === 'in-progress') {
        const currentPlayerColor = gameState.players.find(p => p.userId === currentUser.uid)?.color;
        if (gameState.turn === currentPlayerColor) {
            displayText += `. Your turn (${gameState.turn})`;
        } else {
            displayText += `. Turn: ${gameState.turn}`;
        }
    }

    document.getElementById('current-turn-display').textContent = displayText;

    // Update fullscreen turn indicator if present
    const turnIndicator = document.getElementById('fullscreen-turn-indicator');
    if (turnIndicator) {
        turnIndicator.textContent = `Turn: ${gameState.turn}`;
        turnIndicator.style.color = gameState.turn;
    }

    // Update hide moves checkbox
    const hideMovesCheckbox = document.getElementById('hide-moves-toggle');
    if (hideMovesCheckbox) {
        hideMovesCheckbox.checked = gameState.hideMoves || false;
    }

    drawBoard(gameState.boardState, gameState.selectedPiece);

    // Handle win screen
    if (gameState.status === 'finished' && gameState.winner) {
        document.body.classList.add('game-won');
        // Exit fake fullscreen when game ends
        if (isFakeFullscreen) {
            exitFakeFullscreen(document.getElementById('game-board-container'));
        }
        showWinScreen(gameState);
    } else {
        document.body.classList.remove('game-won');
        hideWinScreen();
    }
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

function drawBoardToSvg(svg, boardState, selectedPieceCoords) {
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

    // 0. Draw home area triangles
    const homeTriangles = {
        // Red: Bottom triangle
        red: [
            { x: 750, y: 150 - 4*40*0.866 }, // Center bottom
            { x: 700 - 4*40, y: 0 + 4*40*0.866 }, // Left point
            { x: 600 + 4*40, y: 100 + 4*40*0.866 }  // Right point
        ],
        // Green: Top triangle
        green: [
            { x: 250, y: 780 - 4*40*0.866 }, // Center top
            { x: 420 - 4*40, y: 700 + 4*40*0.866 }, // Left point
            { x: 300 + 4*40, y: 600 + 4*40*0.866 }  // Right point
        ],
        // Yellow: NE triangle
        yellow: [
            { x: 750, y: 780 - 4*40*0.866 }, // Center bottom
            { x: 700 - 4*40, y: 600 + 4*40*0.866 }, // Left point
            { x: 570 + 4*40, y: 700 + 4*40*0.866 }  // Right point  // Bottom point
        ],
        // Blue: SW triangle
        blue: [
            { x: 250, y: 150 - 4*40*0.866 }, // Center top
            { x: 420 - 4*40, y: 100 + 4*40*0.866 }, // Left point
            { x: 300 + 4*40, y: 0 + 4*40*0.866 }  // Right point
        ],
        // Black: NW triangle
        black: [
            { x: 500 - 4*40*0.866, y: 435 - 4*40*0.866 }, // NW point
            { x: 500 + 4*40*0.866, y: 435 }, // Right point
            { x: 500, y: 435 + 4*40*0.866 }  // Bottom point
        ],
        // White: SE triangle
        white: [
            { x: 500 + 4*40*0.866, y: 435 + 4*40*0.866 }, // SE point
            { x: 500 - 4*40*0.866, y: 435 }, // Left point
            { x: 500, y: 435 - 4*40*0.866 }  // Top point
        ]
    };

    const activeColors = getActiveColors(currentGameState ? currentGameState.maxPlayers : 6);
    activeColors.forEach(color => {
        const triangle = homeTriangles[color];
        if (triangle) {
            const triangleElement = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            const points = triangle.map(p => `${p.x},${p.y}`).join(' ');
            triangleElement.setAttribute("points", points);
            triangleElement.setAttribute("fill", color);
            triangleElement.setAttribute("fill-opacity", "0.3");
            triangleElement.setAttribute("stroke", color);
            triangleElement.setAttribute("stroke-width", "2");
            triangleElement.setAttribute("stroke-opacity", "0.5");
            svg.appendChild(triangleElement);
        }
    });

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
    if (selectedPieceCoords && (currentGameState.turn === currentPlayerColor || isSinglePlayerGame) && !currentGameState.hideMoves) {
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

function drawBoard(boardState, selectedPieceCoords) {
    const svg = document.getElementById('chinese-checkers-board');
    if (!svg) return;

    // Clear main board
    svg.innerHTML = '';

    // Draw to main board
    drawBoardToSvg(svg, boardState, selectedPieceCoords);

    // Also update fullscreen board if it exists
    const fullscreenSvg = document.getElementById('fake-fullscreen-board-svg');
    if (fullscreenSvg) {
        fullscreenSvg.innerHTML = '';
        drawBoardToSvg(fullscreenSvg, boardState, selectedPieceCoords);
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

    // 2. Jump chains (BFS)
    const hopQueue = [startKey];
    visitedHopDestinations.add(startKey);

    while (hopQueue.length > 0) {
        const currentKey = hopQueue.shift();
        const currentCoord = keyToCoord(currentKey);

        DIRECTIONS.forEach(dir => {
            // Custom rule: jumps where the number of holes between start/jumped and jumped/landing are equal
            for (let M = 1; M <= 4; M++) { // Max M=4 to limit jump distance
                const jumpedKey = coordKey(currentCoord.q + dir.q * M, currentCoord.r + dir.r * M);
                const landingKey = coordKey(currentCoord.q + dir.q * 2 * M, currentCoord.r + dir.r * 2 * M);

                if (boardState[jumpedKey] && // Jump over piece
                    jumpedKey !== startKey && // Chosen peg cannot jump over itself (its starting position)
                    isValidPeg(landingKey) && // Landing spot is valid
                    !boardState[landingKey] && // Landing spot is empty
                    !visitedHopDestinations.has(landingKey)) // Not already visited
                {
                    // Check all positions between current and jumped are empty
                    let allEmpty = true;
                    for (let k = 1; k < M; k++) {
                        const betweenKey = coordKey(currentCoord.q + dir.q * k, currentCoord.r + dir.r * k);
                        if (boardState[betweenKey] || !isValidPeg(betweenKey)) {
                            allEmpty = false;
                            break;
                        }
                    }
                    // Check positions between jumped and landing are empty
                    for (let k = M + 1; k < 2 * M; k++) {
                        const betweenKey = coordKey(currentCoord.q + dir.q * k, currentCoord.r + dir.r * k);
                        if (boardState[betweenKey] || !isValidPeg(betweenKey)) {
                            allEmpty = false;
                            break;
                        }
                    }
                    if (allEmpty) {
                        validDestinations.add(landingKey);
                        visitedHopDestinations.add(landingKey);
                        hopQueue.push(landingKey);
                    }
                }
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
    // Add moving animation class to the piece
    const pieceElement = document.getElementById(`piece-${origin}`);
    if (pieceElement) {
        pieceElement.classList.add('moving');
        // Remove the class after animation
        setTimeout(() => {
            pieceElement.classList.remove('moving');
        }, 800);
    }

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

document.getElementById('hide-moves-toggle').addEventListener('change', (e) => {
    if (currentGameId) {
        update(ref(db, "games/" + currentGameId), { hideMoves: e.target.checked });
    }
});

// --- FAKE FULLSCREEN BOARD FUNCTIONALITY ---

let isFakeFullscreen = false;

function toggleBoardFullscreen() {
    const boardContainer = document.getElementById('game-board-container');
    const boardElement = document.getElementById('chinese-checkers-board');
    const button = document.getElementById('fullscreen-board-btn');

    if (!boardContainer || !boardElement) return;

    if (isFakeFullscreen) {
        // Exit fake fullscreen
        exitFakeFullscreen(boardContainer);
        button.textContent = '⛶'; // Fullscreen icon
        button.title = 'Toggle Fake Fullscreen Board';
        isFakeFullscreen = false;
    } else {
        // Enter fake fullscreen
        enterFakeFullscreen(boardContainer);
        button.textContent = '⛶'; // Exit fullscreen icon (same symbol, different context)
        button.title = 'Exit Fake Fullscreen Board';
        isFakeFullscreen = true;
    }
}

function enterFakeFullscreen(container) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'fake-fullscreen-overlay';
    overlay.id = 'fake-fullscreen-overlay';

    // Clone only the SVG board for fullscreen (not the entire container)
    const boardElement = container.querySelector('#chinese-checkers-board');
    const fullscreenBoard = boardElement.cloneNode(true);
    fullscreenBoard.id = 'fake-fullscreen-board-svg';
    fullscreenBoard.setAttribute('class', 'fake-fullscreen-board-svg');

    // Add click event listener to the fullscreen board for game interactions
    fullscreenBoard.addEventListener('click', handleFullscreenBoardClick);

    // Add close button to fullscreen
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 20px;
        cursor: pointer;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    closeBtn.onclick = () => toggleBoardFullscreen();

    // Add turn indicator
    const turnIndicator = document.createElement('div');
    turnIndicator.id = 'fullscreen-turn-indicator';
    turnIndicator.textContent = `Turn: ${currentGameState.turn}`;
    turnIndicator.style.color = currentGameState.turn;

    overlay.appendChild(fullscreenBoard);
    overlay.appendChild(closeBtn);
    overlay.appendChild(turnIndicator);
    document.body.appendChild(overlay);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

function exitFakeFullscreen(container) {
    const overlay = document.getElementById('fake-fullscreen-overlay');
    if (overlay) {
        overlay.remove();
    }
    document.body.style.overflow = '';
}

// Handle escape key to exit fake fullscreen
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFakeFullscreen) {
        toggleBoardFullscreen();
    }
});

// Handle click on overlay to exit fake fullscreen
document.addEventListener('click', (e) => {
    if (e.target.id === 'fake-fullscreen-overlay' && isFakeFullscreen) {
        toggleBoardFullscreen();
    }
});

// Handle clicks on the fullscreen board
function handleFullscreenBoardClick(event) {
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

// Win Screen Functions
function showWinScreen(gameState) {
    const overlay = document.getElementById('win-screen-overlay');
    const winnerColorSpan = document.getElementById('winner-color');
    const movesCountSpan = document.getElementById('moves-count');
    const durationTextSpan = document.getElementById('duration-text');

    if (overlay && gameState.winner) {
        // Set winner color
        winnerColorSpan.textContent = gameState.winner.charAt(0).toUpperCase() + gameState.winner.slice(1);
        winnerColorSpan.style.color = gameState.winner;

        // Calculate stats
        const totalMoves = gameState.moveHistory ? gameState.moveHistory.length : 0;
        movesCountSpan.textContent = totalMoves;

        // Calculate duration (simplified - would need proper start time tracking)
        const now = new Date();
        const startTime = gameStartTime || now;
        const duration = Math.floor((now - startTime) / 1000 / 60); // minutes
        durationTextSpan.textContent = duration > 0 ? `${duration} minutes` : 'Less than a minute';

        // Show overlay
        overlay.style.display = 'flex';

        // Trigger confetti animation
        triggerConfetti();
    }
}

function hideWinScreen() {
    const overlay = document.getElementById('win-screen-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Confetti animation function
function triggerConfetti() {
    const confettiOptions = {
        zIndex: 10001, // Ensure confetti appears above win screen overlay (overlay is z-index: 10000)
        colors: ['#ff6b6b', '#48ff48', '#ffff6b', '#6bbcff', '#5a5a5a', '#ffffff']
    };

    // First burst - from top
    confetti({
        ...confettiOptions,
        particleCount: 100,
        spread: 70,
        origin: { y: 0.1, x: 0.5 }
    });

    // Second burst - from left
    setTimeout(() => {
        confetti({
            ...confettiOptions,
            particleCount: 80,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.5 }
        });
    }, 200);

    // Third burst - from right
    setTimeout(() => {
        confetti({
            ...confettiOptions,
            particleCount: 80,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.5 }
        });
    }, 400);

    // Fourth burst - center
    setTimeout(() => {
        confetti({
            ...confettiOptions,
            particleCount: 120,
            spread: 90,
            origin: { y: 0.4, x: 0.5 }
        });
    }, 600);

    // Final celebration burst
    setTimeout(() => {
        confetti({
            ...confettiOptions,
            particleCount: 150,
            spread: 100,
            origin: { y: 0.6, x: 0.5 }
        });
    }, 800);
}

// Win Screen Event Listeners
document.getElementById('play-again-btn').addEventListener('click', () => {
    hideWinScreen();
    // Create new game with same player count
    const playerCount = currentGameState ? currentGameState.maxPlayers : 6;
    createNewGame(playerCount);
});

document.getElementById('leave-game-win-btn').addEventListener('click', () => {
    hideWinScreen();
    leaveGame();
});

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    handleWindowResize();
});



// --- START THE APP ---
setupAuthListener();
checkUrlParameters();
