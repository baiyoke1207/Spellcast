// multiplayer.js - FIXED: Proper lobby display and message handling

let multiplayerState = {
    connected: false,
    inRoom: false,
    roomCode: null,
    isHost: false,
    players: [],
    sessionId: null,
    playerName: '',
    timerSettings: {
        type: 'voting',
        fixedMinutes: 2
    },
    timerState: {
        graceActive: false,
        votingActive: false,
        countdownActive: false,
        votes: 0,
        required: 0,
        timeRemaining: 0,
        hasVoted: false
    }
};

let socket = null;

// FIX #3: Update connection status UI
function updateConnectionStatus() {
    const statusDot = document.getElementById('connection-dot');
    const statusText = document.getElementById('connection-text');
    
    if (!statusDot || !statusText) return; // Element doesn't exist yet
    
    if (socket && socket.connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = '✓ Connected to server';
        console.log('[MULTIPLAYER] UI updated: Connected');
    } else {
        statusDot.className = 'status-dot connecting';
        statusText.textContent = '⌛ Connecting to server...';
        console.log('[MULTIPLAYER] UI updated: Connecting');
    }
}

function initializeMultiplayer() {
    if (socket) {
        console.log('[MULTIPLAYER] Socket already exists, skipping reinit');
        updateConnectionStatus();
        return;
    }
    console.log('[MULTIPLAYER] Creating new Socket.IO connection...');
    socket = io();

    // ===== CONNECTION EVENTS =====
    socket.on('connected', (data) => {
        console.log('[MULTIPLAYER] Socket connected event fired!');
        console.log('[MULTIPLAYER] Session ID:', data.session_id);
        multiplayerState.connected = true;
        multiplayerState.sessionId = data.session_id;
        
        // FIX #3: Update UI to show connected status
        updateConnectionStatus();
        
        // FIX #3: Enable create/join buttons now that we're connected
        const createBtn = document.getElementById('create-room-btn');
        const joinBtn = document.getElementById('join-room-btn');
        if (createBtn) createBtn.disabled = false;
        if (joinBtn) joinBtn.disabled = false;
    });

    socket.on('disconnect', () => {
        multiplayerState.connected = false;
        console.log('[MULTIPLAYER] Disconnected from server');
    });

    // ===== ROOM EVENTS =====
    socket.on('room_created', (data) => {
        console.log('[MULTIPLAYER] Room created successfully!', data);
        multiplayerState.inRoom = true;
        multiplayerState.roomCode = data.room_code;
        multiplayerState.isHost = true;
        multiplayerState.players = data.room.players;
        multiplayerState.timerSettings.type = data.room.settings.timer_type;
        multiplayerState.timerSettings.fixedMinutes = data.room.settings.fixed_minutes;
        
        // Hide multiplayer menu, show lobby
        document.getElementById('multiplayer-menu').style.display = 'none';
        document.getElementById('game-container').style.display = 'none';
        showLobby(data.room);
    });

    socket.on('player_joined', (data) => {
        console.log('[MULTIPLAYER] player_joined event:', data);
        multiplayerState.players = data.room.players;
        updateLobbyPlayerList(data.room);
        
        // FIX #3B: Show notification for new player
        if (data.new_player_name) {
            showLobbyNotification(`${data.new_player_name} joined the room!`, 'green');
        }
    });
    
    // FIX #3A: NEW - Listen for room_joined event (guest receives this)
    socket.on('room_joined', (data) => {
        console.log('[MULTIPLAYER] room_joined event received!', data);
        
        if (data.status === 'success' || data.status === 'already_joined') {
            // Guest successfully joined
            multiplayerState.inRoom = true;
            multiplayerState.roomCode = data.room_code;
            multiplayerState.isHost = data.is_host;
            multiplayerState.players = data.room.players || [];
            
            console.log('[MULTIPLAYER] Guest successfully joined room', data.room_code);
            
            // Hide multiplayer menu
            document.getElementById('multiplayer-menu').style.display = 'none';
            document.getElementById('game-container').style.display = 'none';
            
            // Show lobby with guest-specific UI
            showLobby(data.room);
            
            // Show confirmation message
            showLobbyNotification('✓ Joined! Waiting for host to start...', 'green');
            console.log('[MULTIPLAYER] Updated UI - lobby now visible for guest');
        } else {
            console.error('[MULTIPLAYER] room_joined failed:', data);
            showMultiplayerMenuNotification('Failed to join room', 'red');
        }
    });

    socket.on('player_left', (data) => {
        showLobbyNotification(`${data.player_name || 'A player'} left the room`, 'red');
        socket.emit('get_room_info');
    });

    socket.on('room_info', (data) => {
        if (data.room) {
            multiplayerState.players = data.room.players;
            updateLobbyPlayerList(data.room);
        }
    });

    socket.on('error', (data) => {
        showLobbyNotification(data.message, 'red');
    });

    // ===== TIMER EVENTS =====
    
    socket.on('timer_grace_started', (data) => {
        multiplayerState.timerState.graceActive = true;
        multiplayerState.timerState.votingActive = false;
        multiplayerState.timerState.countdownActive = false;
        multiplayerState.timerState.hasVoted = false;
        updateTimerDisplay('grace', data.duration);
        console.log('[TIMER] Grace period started:', data.duration);
    });

    socket.on('timer_grace_tick', (data) => {
        updateTimerDisplay('grace', data.seconds);
    });

    socket.on('timer_voting_enabled', () => {
        multiplayerState.timerState.graceActive = false;
        multiplayerState.timerState.votingActive = true;
        updateTimerDisplay('voting', 0);
        console.log('[TIMER] Voting enabled');
    });

    socket.on('timer_vote_update', (data) => {
        multiplayerState.timerState.votes = data.votes;
        multiplayerState.timerState.required = data.required;
        updateVoteDisplay(data.votes, data.required);
        console.log('[TIMER] Votes:', data.votes, '/', data.required);
    });

    socket.on('timer_countdown_started', (data) => {
        multiplayerState.timerState.votingActive = false;
        multiplayerState.timerState.countdownActive = true;
        multiplayerState.timerState.timeRemaining = data.duration;
        updateTimerDisplay('countdown', data.duration);
        console.log('[TIMER] Countdown started:', data.duration);
    });

    socket.on('timer_countdown_tick', (data) => {
        multiplayerState.timerState.timeRemaining = data.seconds;
        updateTimerDisplay('countdown', data.seconds);
    });

    socket.on('timer_fixed_started', (data) => {
        multiplayerState.timerState.countdownActive = true;
        multiplayerState.timerState.timeRemaining = data.duration;
        updateTimerDisplay('fixed', data.duration);
        console.log('[TIMER] Fixed timer started:', data.duration);
    });

    socket.on('timer_fixed_tick', (data) => {
        multiplayerState.timerState.timeRemaining = data.seconds;
        
        // Update display using proper elements
        const timerText = document.getElementById('timer-text');
        const timerBar = document.getElementById('timer-bar');
        const timerContainer = document.getElementById('timer-container');
        const timerLabel = document.getElementById('timer-label');
        
        // Get total duration from settings
        const totalSeconds = Math.floor((multiplayerState.timerSettings.fixedMinutes || 2) * 60);
        
        if (timerText && timerBar && timerContainer && timerLabel) {
            updateFixedTimerDisplay(data.seconds, totalSeconds, timerText, timerBar, timerContainer, timerLabel);
        }
    });

    socket.on('timer_expired', (data) => {
        multiplayerState.timerState.countdownActive = false;
        showGameNotification('⏰ Time expired! Turn ended.', 'red');
        console.log('[TIMER] Timer expired for player:', data.player_id);
    });

    socket.on('turn_ended', (data) => {
        multiplayerState.timerState.graceActive = false;
        multiplayerState.timerState.votingActive = false;
        multiplayerState.timerState.countdownActive = false;
        hideTimerDisplay();
        console.log('[TIMER] Turn ended for player:', data.player_id);
    });

    socket.on('timer_settings_updated', (data) => {
        multiplayerState.timerSettings.type = data.timer_type;
        multiplayerState.timerSettings.fixedMinutes = data.fixed_minutes;
        updateLobbyTimerSettings(data);
    });

    socket.on('game_started', (data) => {
        console.log('[GAME] Game started', data);
        
        multiplayerState.boardMode = data.board_mode;
        multiplayerState.timerType = data.timer_type;
        
        // Store timer duration for progress bar calculations
        if (data.timer_type === 'fixed' && data.fixed_minutes) {
            multiplayerState.timerSettings.fixedMinutes = data.fixed_minutes;
        }
        
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('game-container').style.display = 'flex';
        
        // FEATURE 2: Initialize scoreboard
        initializeScoreboard();
        
        // FEATURE 1: For shared board mode, render the board
        if (data.board_mode === 'shared' && data.board_state) {
            renderSharedBoard(data.board_state);
            
            // Add 'I'm Done' button for simultaneous play
            addPlayerDoneButton();
        }
        
        // FEATURE 3: Start timer display
        if (data.timer_type === 'fixed') {
            startFixedTimer(data.duration);
        }
        
        showGameNotification('Game starting...', 'green');
        console.log('[GAME] Started with', data.timer_type, 'timer,', data.board_mode, 'board');
    });
    
    // FEATURE 1: Handle word submission response
    socket.on('word_accepted', (data) => {
        console.log('[GAME] Word accepted:', data.word);
        showGameNotification(data.message, 'green');
    });
    
    socket.on('word_rejected', (data) => {
        console.log('[GAME] Word rejected:', data.reason);
        showGameNotification(data.reason, 'red');
    });
    
    // FEATURE 1: Handle player marking done
    socket.on('player_marked_done', (data) => {
        showGameNotification(`${data.player_name} is done! (${data.players_done}/${data.total_players})`, 'blue');
    });
    
    // FEATURE 1 & 4: Handle round end and score reveal
    socket.on('round_ended', (data) => {
        console.log('[GAME] Round ended', data);
        
        // Display results
        displayRoundResults(data.results, data.round_number);
        
        // FEATURE 2: Update scoreboard with new scores
        updateScoreboard(data.player_scores);
        
        // FEATURE 1: Update board (consumed_positions, not rows)
        if (data.board_state && data.consumed_positions) {
            updateBoardPositions(data.board_state, data.consumed_positions);
        }
        
        // Prepare for next round
        setTimeout(() => {
            showGameNotification(`Starting Round ${data.round_number + 1}...`, 'blue');
            resetRoundState();
        }, 3000);
    });
    
    // FEATURE 2: Tile swap event
    socket.on('tile_swapped', (data) => {
        console.log('[SWAP] Tile swapped:', data.position, data.old_letter, '→', data.new_letter);
        const [row, col] = data.position;
        const tile = document.querySelector(`[data-r="${row}"][data-c="${col}"]`);
        if (tile) {
            const letterSpan = tile.querySelector('span');
            if (letterSpan) {
                // Animate swap
                tile.style.animation = 'tileSwap 0.5s ease-out';
                letterSpan.textContent = data.new_letter;
                setTimeout(() => {
                    tile.style.animation = '';
                }, 500);
            }
        }
    });
    
    // FEATURE 5: Opponent tile selection highlight
    socket.on('opponent_tile_highlight', (data) => {
        console.log('[GAME] Opponent selecting tiles:', data.positions);
        // Clear previous highlights
        document.querySelectorAll('.opponent-selected').forEach(el => {
            el.classList.remove('opponent-selected');
        });
        
        // Add highlights for new positions
        if (data.action === 'update' && data.positions) {
            data.positions.forEach(([row, col]) => {
                const tile = document.querySelector(`[data-r="${row}"][data-c="${col}"]`);
                if (tile) {
                    tile.classList.add('opponent-selected');
                }
            });
        }
    });
}

// ===== TIMER UI FUNCTIONS =====

function updateTimerDisplay(mode, seconds) {
    const timerContainer = document.getElementById('timer-container');
    const timerLabel = document.getElementById('timer-label');
    const timerBar = document.getElementById('timer-bar');
    const timerText = document.getElementById('timer-text');
    const voteButton = document.getElementById('vote-timer-btn');
    const voteInfo = document.getElementById('vote-info');

    if (!timerContainer) return;

    timerContainer.style.display = 'block';

    if (mode === 'grace') {
        timerLabel.textContent = '⏳ Grace Period';
        timerLabel.style.color = '#60a5fa';
        timerText.textContent = `${seconds}s`;
        timerBar.style.width = `${(seconds / 30) * 100}%`;
        timerBar.style.backgroundColor = '#60a5fa';
        voteButton.style.display = 'none';
        voteInfo.style.display = 'none';
    } else if (mode === 'voting') {
        timerLabel.textContent = '🗳️ Waiting for Votes';
        timerLabel.style.color = '#fbbf24';
        timerText.textContent = `${multiplayerState.timerState.votes}/${multiplayerState.timerState.required} votes`;
        timerBar.style.width = `${(multiplayerState.timerState.votes / multiplayerState.timerState.required) * 100}%`;
        timerBar.style.backgroundColor = '#fbbf24';
        
        if (!multiplayerState.timerState.hasVoted) {
            voteButton.style.display = 'block';
            voteButton.disabled = false;
            voteButton.textContent = '🗳️ Vote to Start Timer';
        } else {
            voteButton.style.display = 'block';
            voteButton.disabled = true;
            voteButton.textContent = '✓ Voted';
        }
        voteInfo.style.display = 'block';
        voteInfo.textContent = `${multiplayerState.timerState.votes}/${multiplayerState.timerState.required} votes - ${multiplayerState.timerState.required - multiplayerState.timerState.votes} more needed`;
    } else if (mode === 'countdown') {
        timerLabel.textContent = '⏱️ Turn Timer';
        timerLabel.style.color = '#ef4444';
        timerText.textContent = `${seconds}s`;
        timerBar.style.width = `${(seconds / 30) * 100}%`;
        timerBar.style.backgroundColor = '#ef4444';
        voteButton.style.display = 'none';
        voteInfo.style.display = 'none';
    } else if (mode === 'fixed') {
        timerLabel.textContent = '⏱️ Turn Timer';
        timerLabel.style.color = '#ef4444';
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerText.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
        const totalSeconds = multiplayerState.timerSettings.fixedMinutes * 60;
        timerBar.style.width = `${(seconds / totalSeconds) * 100}%`;
        timerBar.style.backgroundColor = '#ef4444';
        voteButton.style.display = 'none';
        voteInfo.style.display = 'none';
    }
}

function updateVoteDisplay(votes, required) {
    const voteInfo = document.getElementById('vote-info');
    if (voteInfo) {
        voteInfo.textContent = `${votes}/${required} votes - ${required - votes} more needed`;
    }
}

function hideTimerDisplay() {
    const timerContainer = document.getElementById('timer-container');
    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
}

function voteForTimer() {
    if (!multiplayerState.timerState.votingActive) {
        showGameNotification('Voting not active', 'red');
        return;
    }
    
    if (multiplayerState.timerState.hasVoted) {
        showGameNotification('Already voted', 'red');
        return;
    }
    
    socket.emit('vote_timer');
    multiplayerState.timerState.hasVoted = true;
    
    const voteButton = document.getElementById('vote-timer-btn');
    if (voteButton) {
        voteButton.disabled = true;
        voteButton.textContent = '✓ Voted';
    }
    
    showGameNotification('Vote cast!', 'green');
}

// ===== MODE SELECTION =====

function showModeSelector() {
    // Hide everything
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
    
    // Show mode selector
    const modeSelector = document.getElementById('mode-selector');
    if (modeSelector) {
        modeSelector.style.display = 'flex';
    }
}

function selectSinglePlayer() {
    console.log('[MODE] Single player selected');
    document.getElementById('mode-selector').style.display = 'none';
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
}

// FIX #6: Add debug logging
function selectMultiplayer() {
    console.log('[MULTIPLAYER] User selected Multiplayer mode');
    document.getElementById('mode-selector').style.display = 'none';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
    
    initializeMultiplayer();
    console.log('[MULTIPLAYER] initializeMultiplayer() called');
    document.getElementById('multiplayer-menu').style.display = 'flex';
    
    // FIX #3: Update status immediately
    updateConnectionStatus();
}

// ===== LOBBY FUNCTIONS =====

function showLobby(room) {
    console.log('[LOBBY] Showing lobby with room:', room);
    
    // Hide other screens
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('mode-selector').style.display = 'none';
    
    // Show lobby
    const lobby = document.getElementById('lobby');
    if (!lobby) {
        console.error('[LOBBY] Lobby element not found!');
        return;
    }
    
    lobby.style.display = 'flex';
    
    // BUG FIX 1: Fixed room code display - use correct element ID
    // Update lobby content
    const roomCodeElement = document.getElementById('room-code-info');
    if (roomCodeElement) {
        roomCodeElement.textContent = room.room_code;
    }
    
    const playerCountElement = document.getElementById('lobby-player-count');
    if (playerCountElement) {
        playerCountElement.textContent = `${room.players.length}/${room.settings.max_players} Players`;
    }
    
    // Update game info panel
    const currentPlayerCount = document.getElementById('current-player-count');
    if (currentPlayerCount) {
        currentPlayerCount.textContent = `${room.players.length}/4`;
    }
    const roomCodeInfo = document.getElementById('room-code-info');
    if (roomCodeInfo) {
        roomCodeInfo.textContent = room.room_code;
    }
    
    updateLobbyPlayerList(room);
    setConfigAccessibility(multiplayerState.isHost);
    
    // Timer options visible only to host
    const timerOptions = document.getElementById('timer-options');
    const timerInfoDisplay = document.getElementById('timer-info-display');
    
    if (multiplayerState.isHost) {
        console.log('[LOBBY] Host view - showing timer options');
        if (timerOptions) timerOptions.style.display = 'block';
        if (timerInfoDisplay) timerInfoDisplay.style.display = 'none';
    } else {
        console.log('[LOBBY] Non-host view - showing timer info');
        if (timerOptions) timerOptions.style.display = 'none';
        if (timerInfoDisplay) {
            timerInfoDisplay.style.display = 'block';
            updateLobbyTimerSettings({
                timer_type: room.settings.timer_type,
                fixed_minutes: room.settings.fixed_minutes
            });
        }
    }
    
    // Start button visible only to host
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
        startBtn.style.display = multiplayerState.isHost ? 'inline-block' : 'none';
    }
    
    console.log('[LOBBY] Lobby display complete');
}

function updateLobbyPlayerList(room) {
    const playerList = document.getElementById('lobby-player-list');
    if (!playerList) return;
    
    const players = room.players || [];
    const playerCount = players.length;
    
    playerList.innerHTML = `<h3>Players (${playerCount}/4)</h3>`;
    
    players.forEach((player, index) => {
        const playerItem = document.createElement('div');
        playerItem.className = 'lobby-player-item';
        playerItem.style.cssText = `
            padding: 10px 12px;
            background: rgba(139, 92, 246, 0.1);
            border-radius: 6px;
            margin: 5px 0;
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid rgba(139, 92, 246, 0.2);
            transition: all 0.2s ease;
        `;
        
        playerItem.addEventListener('mouseenter', () => {
            playerItem.style.background = 'rgba(139, 92, 246, 0.2)';
        });
        playerItem.addEventListener('mouseleave', () => {
            playerItem.style.background = 'rgba(139, 92, 246, 0.1)';
        });
        
        const playerNum = document.createElement('span');
        playerNum.className = 'player-number';
        playerNum.textContent = index + 1;
        playerNum.style.cssText = `
            background: #4b5563;
            color: #f9fafb;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 0.9em;
        `;
        
        const playerName = document.createElement('span');
        playerName.className = 'player-name';
        playerName.textContent = player.name || 'Player';
        playerName.style.cssText = `
            flex: 1;
            color: #f9fafb;
            font-weight: 500;
        `;
        
        // Host badge
        if (player.id === room.host) {
            const hostBadge = document.createElement('span');
            hostBadge.className = 'host-badge';
            hostBadge.textContent = 'HOST';
            hostBadge.style.cssText = `
                background: linear-gradient(145deg, #ffd700, #ffed4e);
                color: #1f2937;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.75em;
                font-weight: bold;
            `;
            playerItem.appendChild(playerNum);
            playerItem.appendChild(playerName);
            playerItem.appendChild(hostBadge);
        } else {
            playerItem.appendChild(playerNum);
            playerItem.appendChild(playerName);
        }
        
        playerList.appendChild(playerItem);
    });
}

function updateLobbyTimerSettings(data) {
    const timerInfo = document.getElementById('timer-info-display');
    if (!timerInfo) return;
    
    if (data.timer_type === 'voting') {
        timerInfo.textContent = '⏱️ Timer: Voting-based (Spellcast style)';
    } else {
        timerInfo.textContent = `⏱️ Timer: ${data.fixed_minutes} minute${data.fixed_minutes > 1 ? 's' : ''} per turn`;
    }
    timerInfo.style.display = 'block';
}

function leaveLobby() {
    if (socket) socket.emit('leave_room');
    multiplayerState.inRoom = false;
    multiplayerState.roomCode = null;
    multiplayerState.isHost = false;
    multiplayerState.players = [];
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('multiplayer-menu').style.display = 'flex';
}

// ===== ROOM CREATION/JOINING =====

function showCreateRoomDialog() {
    const playerName = document.getElementById('player-name-input').value.trim();
    
    // Validation
    if (!playerName) {
        showMultiplayerMenuNotification('Please enter your name', 'red');
        return;
    }
    
    // CRITICAL FIX #1: Check if socket is connected and ready
    if (!socket || !socket.connected) {
        showMultiplayerMenuNotification('Connecting to server... please wait', 'yellow');
        console.error('[MULTIPLAYER] Socket not ready. socket:', socket, 'connected:', socket?.connected);
        
        // Retry in 1 second
        setTimeout(() => {
            showCreateRoomDialog();
        }, 1000);
        return;
    }
    
    // All checks passed, emit create room
    multiplayerState.playerName = playerName;
    
    console.log('[MULTIPLAYER] Emitting create_room event with player:', playerName);
    
    socket.emit('create_room', { player_name: playerName, max_players: 5 }, (response) => {
        if (response && response.success === false) {
            console.error('[MULTIPLAYER] Server error:', response.error);
            showMultiplayerMenuNotification(`Error: ${response.error}`, 'red');
        }
    });
    
    // Don't hide menu yet - wait for room_created event
    console.log('[MULTIPLAYER] Waiting for room_created event...');
}

function showJoinRoomDialog() {
    const playerName = document.getElementById('player-name-input').value.trim();
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
    
    if (!playerName) {
        showMultiplayerMenuNotification('Please enter your name', 'red');
        return;
    }
    
    if (!roomCode || roomCode.length !== 6) {
        showMultiplayerMenuNotification('Please enter a 6-character room code', 'red');
        return;
    }
    
    // CRITICAL FIX #1: Check if socket is connected and ready
    if (!socket || !socket.connected) {
        showMultiplayerMenuNotification('Connecting to server... please wait', 'yellow');
        console.error('[MULTIPLAYER] Socket not ready. socket:', socket, 'connected:', socket?.connected);
        
        // Retry in 1 second
        setTimeout(() => {
            showJoinRoomDialog();
        }, 1000);
        return;
    }
    
    // FIX #4: Disable join button to prevent spam
    const joinBtn = document.getElementById('join-room-btn');
    if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joining...';
    }
    
    console.log('[MULTIPLAYER] Joining room:', roomCode);
    multiplayerState.playerName = playerName;
    
    socket.emit('join_room', { room_code: roomCode, player_name: playerName });
    
    // Re-enable button after 2 seconds (in case of error)
    setTimeout(() => {
        if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.textContent = '🚪 Join Room';
        }
    }, 2000);
}

// ===== GAME START =====

function getGameSettings() {
    const timerSystem = document.querySelector('input[name="timerSystem"]:checked')?.value || 'voting';
    const boardMode = document.querySelector('input[name="boardMode"]:checked')?.value || 'shared';
    const timerDuration = parseFloat(document.getElementById('timer-duration-slider')?.value || 2);

    return {
        timerType: timerSystem,
        timerDuration: timerDuration,
        boardMode: boardMode,
        maxRounds: 5,
        maxPlayers: 4
    };
}

function startMultiplayerGame() {
    if (!multiplayerState.isHost) {
        showLobbyNotification('Only the host can start the game', 'red');
        return;
    }
    
    if (multiplayerState.players.length < 2) {
        showLobbyNotification('Need at least 2 players to start', 'red');
        return;
    }
    
    const settings = getGameSettings();
    
    console.log('[GAME] Starting game with settings:', settings);
    
    socket.emit('start_game', {
        room_code: multiplayerState.roomCode,
        settings: settings
    });
}

// ===== CONFIG PANEL ACCESSIBILITY =====

function setConfigAccessibility(isHost) {
    const configInputs = document.querySelectorAll('#game-config-panel input');
    const radioOptions = document.querySelectorAll('#game-config-panel .radio-option');
    
    configInputs.forEach(input => {
        input.disabled = !isHost;
        if (!isHost) {
            input.style.cursor = 'not-allowed';
            input.style.opacity = '0.6';
        }
    });
    
    radioOptions.forEach(option => {
        if (!isHost) {
            option.classList.add('disabled');
            option.style.cursor = 'not-allowed';
        } else {
            option.classList.remove('disabled');
            option.style.cursor = 'pointer';
        }
    });
}

// ===== TIMER SETTINGS (HOST ONLY) =====

function updateTimerSettings() {
    if (!multiplayerState.isHost) return;
    
    const timerType = document.querySelector('input[name="timerType"]:checked')?.value || 'voting';
    let fixedMinutes = 2;
    
    if (timerType === 'fixed') {
        fixedMinutes = parseInt(document.getElementById('fixed-timer-minutes').value, 10);
        if (isNaN(fixedMinutes) || fixedMinutes < 1 || fixedMinutes > 10) {
            fixedMinutes = 2;
        }
    }
    
    console.log('[TIMER] Updating settings:', timerType, fixedMinutes);
    
    socket.emit('update_timer_settings', {
        timer_type: timerType,
        fixed_minutes: fixedMinutes
    });
}

// ===== FEATURE 2: SCOREBOARD FUNCTIONS =====

function initializeScoreboard() {
    const rightPanel = document.getElementById('right-panel');
    if (!rightPanel) return;
    
    // Create scoreboard container if it doesn't exist
    let scoreDisplay = document.getElementById('score-display');
    if (!scoreDisplay) {
        scoreDisplay = document.createElement('div');
        scoreDisplay.id = 'score-display';
        scoreDisplay.className = 'score-container';
        scoreDisplay.style.cssText = `
            background: rgba(17, 24, 39, 0.8);
            border: 2px solid #374151;
            border-radius: 10px;
            padding: 15px;
            margin-top: 20px;
        `;
        
        const title = document.createElement('h3');
        title.textContent = 'SCORES';
        title.style.cssText = 'color: #ffd700; margin-top: 0; margin-bottom: 15px; font-size: 1.2em;';
        scoreDisplay.appendChild(title);
        
        rightPanel.appendChild(scoreDisplay);
    }
    
    // Initialize with current players (0 score)
    const initialScores = {};
    multiplayerState.players.forEach(player => {
        initialScores[player.id] = 0;
    });
    updateScoreboard(initialScores);
}

function updateScoreboard(playerScores) {
    const container = document.getElementById('score-display');
    if (!container) return;
    
    // Keep title, remove old scores
    const title = container.querySelector('h3');
    container.innerHTML = '';
    if (title) container.appendChild(title);
    
    // Use multiplayerState.players (always available)
    const players = multiplayerState.players || [];
    if (players.length === 0) return;
    
    players.forEach((player, index) => {
        const score = playerScores[player.id] !== undefined ? playerScores[player.id] : (player.score || 0);
        const isActive = (multiplayerState.activePlayerId === player.id);
        
        const item = document.createElement('div');
        item.className = `score-item ${isActive ? 'active' : 'inactive'}`;
        item.style.cssText = `
            padding: 8px;
            margin: 4px 0;
            opacity: ${isActive ? 1 : 0.4};
            color: ${isActive ? '#ffffff' : '#9ca3af'};
            font-size: 16px;
            font-weight: ${isActive ? 600 : 500};
            transition: opacity 0.3s ease;
        `;
        item.textContent = `${player.name}: ${score}`;
        
        container.appendChild(item);
    });
}

// ===== FEATURE 3: TIMER FUNCTIONS =====

let timerInterval = null;

function startFixedTimer(durationSeconds) {
    // Clear any existing timer
    if (timerInterval) clearInterval(timerInterval);
    
    const timerContainer = document.getElementById('timer-container');
    const timerText = document.getElementById('timer-text');
    const timerBar = document.getElementById('timer-bar');
    const timerLabel = document.getElementById('timer-label');
    
    if (!timerContainer || !timerText) {
        console.warn('[TIMER] Timer elements not found');
        return;
    }
    
    timerContainer.style.display = 'block';
    
    // Initial display
    const totalSeconds = durationSeconds;
    updateFixedTimerDisplay(durationSeconds, totalSeconds, timerText, timerBar, timerContainer, timerLabel);
    
    console.log('[TIMER] Fixed timer started locally, listening for server ticks');
}

function updateFixedTimerDisplay(seconds, totalSeconds, timerText, timerBar, timerContainer, timerLabel) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const display = `${minutes}:${secs.toString().padStart(2, '0')}`;
    
    if (timerText) {
        timerText.textContent = display;
    }
    
    // Update progress bar
    if (timerBar && totalSeconds > 0) {
        const progress = (seconds / totalSeconds) * 100;
        timerBar.style.width = `${progress}%`;
    }
    
    // Change color as time runs out
    if (timerContainer && timerLabel && timerText) {
        if (seconds <= 10) {
            timerContainer.style.borderColor = '#ef4444';
            timerText.style.color = '#ef4444';
            timerLabel.style.color = '#ef4444';
            timerBar.style.backgroundColor = '#ef4444';
        } else if (seconds <= 30) {
            timerContainer.style.borderColor = '#f59e0b';
            timerText.style.color = '#f59e0b';
            timerLabel.style.color = '#f59e0b';
            timerBar.style.backgroundColor = '#f59e0b';
        } else {
            timerContainer.style.borderColor = '#4b5563';
            timerText.style.color = '#ffd700';
            timerLabel.style.color = '#60a5fa';
            timerBar.style.backgroundColor = '#10b981';
        }
    }
}

function updateTimerDisplay(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const display = `${minutes}:${secs.toString().padStart(2, '0')}`;
    
    const timerText = document.getElementById('timer-text');
    if (timerText) {
        timerText.textContent = display;
    }
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    const timerContainer = document.getElementById('timer-container');
    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
}

// ===== FEATURE 1: SIMULTANEOUS PLAY FUNCTIONS =====

function renderSharedBoard(boardState) {
    console.log('[GAME] Rendering shared board', boardState);
    // Board rendering will be handled by existing game.js logic
    // Just store the board state
    if (window.gameState) {
        window.gameState.board_tiles = [];
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                window.gameState.board_tiles.push({
                    letter: boardState[r][c],
                    special: null,
                    gem: false
                });
            }
        }
    }
}

function addPlayerDoneButton() {
    // Add "I'm Done" button to input area
    const inputArea = document.getElementById('input-area');
    if (!inputArea) return;
    
    // Check if button already exists
    if (document.getElementById('player-done-btn')) return;
    
    const doneBtn = document.createElement('button');
    doneBtn.id = 'player-done-btn';
    doneBtn.className = 'ability-button';
    doneBtn.textContent = "I'm Done";
    doneBtn.style.cssText = `
        background: linear-gradient(145deg, #10b981, #059669);
        border-color: #059669;
        margin-left: 10px;
    `;
    
    doneBtn.onclick = () => {
        if (socket) {
            socket.emit('player_done', {
                room_code: multiplayerState.roomCode
            });
            doneBtn.disabled = true;
            doneBtn.textContent = '✓ Waiting...';
            doneBtn.style.background = 'linear-gradient(145deg, #6b7280, #4b5563)';
        }
    };
    
    inputArea.appendChild(doneBtn);
}

function displayRoundResults(results, roundNumber) {
    // Create results overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: linear-gradient(145deg, #1f2937, #111827);
        border: 3px solid #ffd700;
        border-radius: 20px;
        padding: 30px;
        min-width: 400px;
        max-width: 600px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
    `;
    
    const title = document.createElement('h2');
    title.textContent = `Round ${roundNumber} Results`;
    title.style.cssText = 'color: #ffd700; text-align: center; margin-bottom: 20px;';
    panel.appendChild(title);
    
    Object.values(results).forEach(result => {
        const row = document.createElement('div');
        row.style.cssText = `
            padding: 12px;
            margin: 8px 0;
            background: rgba(75, 85, 99, 0.3);
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const nameWords = document.createElement('div');
        nameWords.innerHTML = `
            <strong style="color: #f9fafb; font-size: 1.1em;">${result.name}</strong><br>
            <small style="color: #9ca3af;">${result.word_count} word${result.word_count !== 1 ? 's' : ''}</small>
        `;
        
        const score = document.createElement('div');
        score.textContent = `+${result.score}`;
        score.style.cssText = 'color: #10b981; font-size: 1.5em; font-weight: bold;';
        
        row.appendChild(nameWords);
        row.appendChild(score);
        panel.appendChild(row);
    });
    
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
        overlay.remove();
    }, 3000);
}

function updateBoardPositions(boardState, consumedPositions) {
    console.log('[GAME] Updating board positions:', consumedPositions);
    
    // FEATURE #1: Update only consumed positions, not entire rows
    consumedPositions.forEach(([row, col]) => {
        const tile = document.querySelector(`[data-r="${row}"][data-c="${col}"]`);
        if (tile) {
            const newLetter = boardState[row][col];
            const letterSpan = tile.querySelector('span');
            if (letterSpan) {
                // Animate tile refresh
                tile.style.animation = 'tileRefresh 0.5s ease-out';
                letterSpan.textContent = newLetter;
                
                setTimeout(() => {
                    tile.style.animation = '';
                }, 500);
            }
        }
    });
}

function resetRoundState() {
    // Reset "I'm Done" button
    const doneBtn = document.getElementById('player-done-btn');
    if (doneBtn) {
        doneBtn.disabled = false;
        doneBtn.textContent = "I'm Done";
        doneBtn.style.background = 'linear-gradient(145deg, #10b981, #059669)';
    }
}

// ===== NOTIFICATION SYSTEM (FIXED - Multiple message areas) =====

function showMultiplayerMenuNotification(message, color) {
    const messageArea = document.querySelector('#multiplayer-menu #message-area');
    if (messageArea) {
        messageArea.textContent = message;
        messageArea.style.color = color === 'green' ? '#10b981' : color === 'red' ? '#ef4444' : '#60a5fa';
    }
}

function showLobbyNotification(message, color) {
    const messageArea = document.getElementById('lobby-message');
    if (messageArea) {
        messageArea.textContent = message;
        messageArea.style.color = color === 'green' ? '#10b981' : color === 'red' ? '#ef4444' : '#60a5fa';
    }
}

function showGameNotification(message, color) {
    const messageArea = document.querySelector('#game-container #message-area');
    if (messageArea) {
        messageArea.textContent = message;
        messageArea.style.color = color === 'green' ? '#10b981' : color === 'red' ? '#ef4444' : '#60a5fa';
    }
}

// ===== EVENT LISTENERS =====

document.addEventListener('DOMContentLoaded', () => {
    console.log('[INIT] Multiplayer.js initializing...');
    
    // FIX #5: Disable create/join buttons by default (until connected)
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');
    
    if (createBtn) {
        createBtn.disabled = true;
        console.log('[INIT] Create button disabled until connected');
    }
    if (joinBtn) {
        joinBtn.disabled = true;
        console.log('[INIT] Join button disabled until connected');
    }
    
    // Mode selection
    const modeSingleBtn = document.getElementById('mode-single');
    if (modeSingleBtn) {
        modeSingleBtn.onclick = selectSinglePlayer;
        console.log('[INIT] Single player button bound');
    }
    
    const modeMultiBtn = document.getElementById('mode-multi');
    if (modeMultiBtn) {
        modeMultiBtn.onclick = selectMultiplayer;
        console.log('[INIT] Multiplayer button bound');
    }

    // Room creation/joining
    const createRoomBtn = document.getElementById('create-room-btn');
    if (createRoomBtn) {
        createRoomBtn.onclick = showCreateRoomDialog;
        console.log('[INIT] Create room button bound');
    }
    
    const joinRoomBtn = document.getElementById('join-room-btn');
    if (joinRoomBtn) {
        joinRoomBtn.onclick = showJoinRoomDialog;
        console.log('[INIT] Join room button bound');
    }

    // Lobby buttons
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');
    if (leaveLobbyBtn) {
        leaveLobbyBtn.onclick = leaveLobby;
        console.log('[INIT] Leave lobby button bound');
    }
    
    const startGameBtn = document.getElementById('start-game-btn');
    if (startGameBtn) {
        startGameBtn.onclick = startMultiplayerGame;
        console.log('[INIT] Start game button bound');
    }
    
    // Vote timer button
    const voteTimerBtn = document.getElementById('vote-timer-btn');
    if (voteTimerBtn) {
        voteTimerBtn.onclick = voteForTimer;
        console.log('[INIT] Vote timer button bound');
    }

    // Config panel UI interactions
    const votingRadio = document.querySelector('input[name="timerSystem"][value="voting"]');
    const fixedRadio = document.querySelector('input[name="timerSystem"][value="fixed"]');
    const fixedControls = document.getElementById('fixed-timer-controls');
    const slider = document.getElementById('timer-duration-slider');
    const valueDisplay = document.getElementById('timer-duration-value');

    function updateTimerUI() {
        if (fixedRadio && fixedRadio.checked) {
            if (fixedControls) fixedControls.style.display = 'block';
        } else {
            if (fixedControls) fixedControls.style.display = 'none';
        }
    }

    if (votingRadio) {
        votingRadio.addEventListener('change', updateTimerUI);
        console.log('[INIT] Voting radio bound');
    }
    if (fixedRadio) {
        fixedRadio.addEventListener('change', updateTimerUI);
        console.log('[INIT] Fixed radio bound');
    }

    // Update slider value display
    if (slider && valueDisplay) {
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = parseFloat(e.target.value).toFixed(1);
        });
        console.log('[INIT] Slider bound');
    }

    // Timer type UI toggle
    const timerOptions = document.getElementById('timer-options');
    if (timerOptions) {
        const votingRadio = document.querySelector('input[value="voting"][name="timerType"]');
        const fixedRadio = document.querySelector('input[value="fixed"][name="timerType"]');
        const fixedInput = document.getElementById('fixed-timer-minutes');
        
        function toggleTimerInput() {
            if (fixedRadio && fixedRadio.checked && fixedInput) {
                fixedInput.style.display = 'inline-block';
            } else if (fixedInput) {
                fixedInput.style.display = 'none';
            }
        }
        
        if (votingRadio) {
            votingRadio.onchange = () => {
                toggleTimerInput();
                updateTimerSettings();
            };
        }
        
        if (fixedRadio) {
            fixedRadio.onchange = () => {
                toggleTimerInput();
                updateTimerSettings();
            };
        }
        
        if (fixedInput) {
            fixedInput.onchange = updateTimerSettings;
        }
        
        toggleTimerInput();
        console.log('[INIT] Timer options bound');
    }

    // Show mode selector on load
    setTimeout(() => {
        showModeSelector();
        console.log('[INIT] Mode selector displayed');
    }, 100);
    
    console.log('[INIT] Multiplayer.js initialization complete');
});