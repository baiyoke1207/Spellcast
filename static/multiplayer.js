let multiplayerState = {
    connected: false,
    inRoom: false,
    inGame: false,
    roomCode: null,
    isHost: false,
    players: [],
    sessionId: null,
    playerName: '',
    boardMode: 'shared',
    activePlayerId: null,
    currentRound: 1,
    maxRounds: 5,
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

function getGameApi() {
    return window.singlePlayerGame || null;
}

function updateConnectionStatus() {
    const statusDot = document.getElementById('connection-dot');
    const statusText = document.getElementById('connection-text');
    if (!statusDot || !statusText) return;

    if (socket && socket.connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected to server';
    } else {
        statusDot.className = 'status-dot connecting';
        statusText.textContent = 'Connecting to server...';
    }
}

function showScreen(screen) {
    const modeSelector = document.getElementById('mode-selector');
    const multiplayerMenu = document.getElementById('multiplayer-menu');
    const lobby = document.getElementById('lobby');
    const gameContainer = document.getElementById('game-container');

    if (modeSelector) modeSelector.style.display = screen === 'mode' ? 'flex' : 'none';
    if (multiplayerMenu) multiplayerMenu.style.display = screen === 'menu' ? 'flex' : 'none';
    if (lobby) lobby.style.display = screen === 'lobby' ? 'flex' : 'none';
    if (gameContainer) gameContainer.style.display = screen === 'game' ? 'flex' : 'none';
}

function showModeSelector() {
    document.body.classList.remove('multiplayer-active');
    showScreen('mode');
}

function selectSinglePlayer() {
    document.body.classList.remove('multiplayer-active');
    showScreen('game');
    restoreSinglePlayerLayout();
    const gameApi = getGameApi();
    if (gameApi) {
        gameApi.setSubmitHandler(null);
        gameApi.setPathChangeHandler(null);
        gameApi.setInteractionEnabled(true);
    }
}

function selectMultiplayer() {
    initializeMultiplayer();
    showScreen('menu');
    updateConnectionStatus();
}

function initializeMultiplayer() {
    if (socket) {
        updateConnectionStatus();
        return;
    }

    socket = io();

    socket.on('connected', (data) => {
        multiplayerState.connected = true;
        multiplayerState.sessionId = data.session_id;
        updateConnectionStatus();

        const createBtn = document.getElementById('create-room-btn');
        const joinBtn = document.getElementById('join-room-btn');
        if (createBtn) createBtn.disabled = false;
        if (joinBtn) joinBtn.disabled = false;
    });

    socket.on('disconnect', () => {
        multiplayerState.connected = false;
        multiplayerState.inGame = false;
        updateConnectionStatus();
    });

    socket.on('room_created', (data) => {
        multiplayerState.inRoom = true;
        multiplayerState.roomCode = data.room_code;
        multiplayerState.isHost = true;
        multiplayerState.players = data.room.players || [];
        multiplayerState.timerSettings.type = data.room.settings.timer_type || 'voting';
        multiplayerState.timerSettings.fixedMinutes = data.room.settings.fixed_minutes || 2;
        showLobby(data.room);
    });

    socket.on('room_joined', (data) => {
        if (data.status !== 'success' && data.status !== 'already_joined') {
            showMultiplayerMenuNotification('Failed to join room', 'red');
            return;
        }

        multiplayerState.inRoom = true;
        multiplayerState.roomCode = data.room_code;
        multiplayerState.isHost = Boolean(data.is_host);
        multiplayerState.players = data.room.players || [];
        showLobby(data.room);
        showLobbyNotification('Joined room. Waiting for host to start.', 'green');
    });

    socket.on('player_joined', (data) => {
        if (!data.room) return;
        multiplayerState.players = data.room.players || [];
        updateLobbyFromRoom(data.room);
        if (data.new_player_name) {
            showLobbyNotification(`${data.new_player_name} joined the room`, 'green');
        }
    });

    socket.on('player_left', (data) => {
        if (socket) socket.emit('get_room_info');
        showLobbyNotification(`${data.player_name || 'A player'} left the room`, 'red');
    });

    socket.on('room_info', (data) => {
        if (!data.room) return;
        multiplayerState.players = data.room.players || [];
        updateLobbyFromRoom(data.room);
    });

    socket.on('timer_settings_updated', (data) => {
        multiplayerState.timerSettings.type = data.timer_type;
        multiplayerState.timerSettings.fixedMinutes = data.fixed_minutes;
        updateLobbyTimerSettings();
    });

    socket.on('error', (data) => {
        const message = data?.message || 'Something went wrong';
        if (multiplayerState.inGame) {
            showGameNotification(message, 'red');
        } else if (multiplayerState.inRoom) {
            showLobbyNotification(message, 'red');
        } else {
            showMultiplayerMenuNotification(message, 'red');
        }
    });

    socket.on('game_started', (data) => {
        multiplayerState.inGame = true;
        multiplayerState.boardMode = data.board_mode;
        multiplayerState.currentRound = data.round_number || 1;
        multiplayerState.activePlayerId = data.active_player_id || null;
        multiplayerState.players = data.room?.players || multiplayerState.players;
        multiplayerState.timerSettings.type = data.timer_type;
        if (data.fixed_minutes) {
            multiplayerState.timerSettings.fixedMinutes = data.fixed_minutes;
        }

        startMultiplayerBoard(data);
    });

    socket.on('word_accepted', (data) => {
        showGameNotification(data.message || `${data.word} accepted`, 'green');
    });

    socket.on('word_rejected', (data) => {
        showGameNotification(data.message || data.reason || 'Word rejected', 'red');
    });

    socket.on('word_accepted_turnbased', (data) => {
        applyScoreDelta(data.player_id, data.score);
        multiplayerState.activePlayerId = data.next_player_id;
        multiplayerState.currentRound = data.round_number || multiplayerState.currentRound;

        const gameApi = getGameApi();
        if (gameApi && data.board_state) {
            gameApi.setBoardState(data.board_state, { syncAnimation: true });
        }

        updateMultiplayerHud();
        updateScoreboard();
        updateBoardAccessState();

        const playedBy = getPlayerName(data.player_id);
        const message = `${playedBy} played ${String(data.word || '').toUpperCase()} for ${data.score} points`;
        showGameNotification(message, data.player_id === multiplayerState.sessionId ? 'green' : 'blue');
    });

    socket.on('turn_timeout', (data) => {
        multiplayerState.activePlayerId = data.next_player_id;
        multiplayerState.currentRound = data.round_number || multiplayerState.currentRound;
        updateMultiplayerHud();
        updateScoreboard();
        updateBoardAccessState();
        showGameNotification(`${getPlayerName(data.skipped_player_id)} ran out of time`, 'red');
    });

    socket.on('player_marked_done', (data) => {
        showGameNotification(`${data.player_name} is done (${data.players_done}/${data.total_players})`, 'blue');
    });

    socket.on('round_ended', (data) => {
        multiplayerState.currentRound = data.next_round_number || multiplayerState.currentRound;
        syncPlayerScores(data.player_scores || {});
        updateScoreboard();
        displayRoundResults(data.results, data.round_number);

        const gameApi = getGameApi();
        if (gameApi && data.board_state) {
            gameApi.setBoardState(data.board_state, { syncAnimation: true });
            gameApi.clearSelection();
        }

        resetRoundState();
        updateMultiplayerHud();
        updateBoardAccessState();
    });

    socket.on('game_finished', (data) => {
        multiplayerState.inGame = false;
        syncPlayerScores(data.player_scores || {});
        updateScoreboard();
        showGameFinished(data);
    });

    socket.on('opponent_tile_highlight', (data) => {
        document.querySelectorAll('.opponent-selected').forEach((el) => {
            el.classList.remove('opponent-selected');
        });

        if (data.action !== 'update' || !Array.isArray(data.positions)) return;

        data.positions.forEach(([row, col]) => {
            const tile = document.querySelector(`[data-r="${row}"][data-c="${col}"]`);
            if (tile) tile.classList.add('opponent-selected');
        });
    });

    socket.on('timer_grace_started', (data) => {
        multiplayerState.timerState.graceActive = true;
        multiplayerState.timerState.votingActive = false;
        multiplayerState.timerState.countdownActive = false;
        multiplayerState.timerState.hasVoted = false;
        updateTimerDisplay('grace', data.duration);
    });

    socket.on('timer_grace_tick', (data) => {
        updateTimerDisplay('grace', data.seconds);
    });

    socket.on('timer_voting_enabled', () => {
        multiplayerState.timerState.graceActive = false;
        multiplayerState.timerState.votingActive = true;
        updateTimerDisplay('voting', multiplayerState.timerState.timeRemaining);
    });

    socket.on('timer_vote_update', (data) => {
        multiplayerState.timerState.votes = data.votes;
        multiplayerState.timerState.required = data.required;
        updateTimerDisplay('voting', multiplayerState.timerState.timeRemaining);
    });

    socket.on('timer_countdown_started', (data) => {
        multiplayerState.timerState.votingActive = false;
        multiplayerState.timerState.countdownActive = true;
        multiplayerState.timerState.timeRemaining = data.duration;
        updateTimerDisplay('countdown', data.duration);
    });

    socket.on('timer_countdown_tick', (data) => {
        multiplayerState.timerState.timeRemaining = data.seconds;
        updateTimerDisplay('countdown', data.seconds);
    });

    socket.on('timer_fixed_started', (data) => {
        multiplayerState.timerState.countdownActive = true;
        multiplayerState.timerState.timeRemaining = data.duration;
        updateTimerDisplay('fixed', data.duration);
    });

    socket.on('timer_fixed_tick', (data) => {
        multiplayerState.timerState.timeRemaining = data.seconds;
        updateTimerDisplay('fixed', data.seconds);
    });

    socket.on('timer_expired', () => {
        multiplayerState.timerState.countdownActive = false;
        hideTimerDisplay();
        showGameNotification('Time expired', 'red');
    });
}

function getPlayerName(playerId) {
    return multiplayerState.players.find((player) => player.id === playerId)?.name || 'Player';
}

function showLobby(room) {
    showScreen('lobby');
    updateLobbyFromRoom(room);
    updateLobbyTimerSettings();
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) startBtn.style.display = multiplayerState.isHost ? 'inline-block' : 'none';
}

function updateLobbyFromRoom(room) {
    const roomCodeInfo = document.getElementById('room-code-info');
    const currentPlayerCount = document.getElementById('current-player-count');
    const playerList = document.getElementById('lobby-player-list');

    if (roomCodeInfo) roomCodeInfo.textContent = room.room_code;
    if (currentPlayerCount) currentPlayerCount.textContent = `${(room.players || []).length}/${room.settings.max_players || 4}`;

    if (playerList) {
        playerList.innerHTML = `<h3>Players (${(room.players || []).length}/${room.settings.max_players || 4})</h3>`;
        (room.players || []).forEach((player, index) => {
            const row = document.createElement('div');
            row.className = 'lobby-player-item';
            row.innerHTML = `
                <span class="player-number">${index + 1}</span>
                <span class="player-name">${player.name}</span>
                ${player.id === room.host ? '<span class="host-badge">HOST</span>' : ''}
            `;
            playerList.appendChild(row);
        });
    }
}

function updateLobbyTimerSettings() {
    const timerSummary = document.getElementById('timer-info-display');
    if (!timerSummary) return;

    if (multiplayerState.boardMode === 'randomized' && multiplayerState.timerSettings.type !== 'fixed') {
        timerSummary.textContent = 'Randomized mode uses fixed timers per turn.';
        return;
    }

    if (multiplayerState.timerSettings.type === 'fixed') {
        timerSummary.textContent = `Timer: ${multiplayerState.timerSettings.fixedMinutes} minute${multiplayerState.timerSettings.fixedMinutes === 1 ? '' : 's'} per turn`;
    } else {
        timerSummary.textContent = 'Timer: vote-to-cutoff round flow';
    }
}

function leaveLobby() {
    if (socket) socket.emit('leave_room');
    multiplayerState.inRoom = false;
    multiplayerState.inGame = false;
    multiplayerState.roomCode = null;
    multiplayerState.isHost = false;
    multiplayerState.players = [];
    document.body.classList.remove('multiplayer-active');
    showScreen('menu');
}

function showCreateRoomDialog() {
    const playerName = document.getElementById('player-name-input').value.trim();
    if (!playerName) {
        showMultiplayerMenuNotification('Please enter your name', 'red');
        return;
    }
    if (!socket || !socket.connected) {
        showMultiplayerMenuNotification('Still connecting to the server', 'red');
        return;
    }

    multiplayerState.playerName = playerName;
    socket.emit('create_room', {
        player_name: playerName,
        max_players: 4
    });
}

function showJoinRoomDialog() {
    const playerName = document.getElementById('player-name-input').value.trim();
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();

    if (!playerName) {
        showMultiplayerMenuNotification('Please enter your name', 'red');
        return;
    }

    if (roomCode.length !== 6) {
        showMultiplayerMenuNotification('Please enter a 6-character room code', 'red');
        return;
    }

    if (!socket || !socket.connected) {
        showMultiplayerMenuNotification('Still connecting to the server', 'red');
        return;
    }

    multiplayerState.playerName = playerName;
    socket.emit('join_room', {
        room_code: roomCode,
        player_name: playerName
    });
}

function getGameSettings() {
    const selectedBoardMode = document.querySelector('input[name="boardMode"]:checked')?.value || 'shared';
    const selectedTimerType = document.querySelector('input[name="timerSystem"]:checked')?.value || 'voting';
    const fixedMinutes = parseFloat(document.getElementById('timer-duration-slider')?.value || '2');

    let timerType = selectedTimerType;
    if (selectedBoardMode === 'randomized') {
        timerType = 'fixed';
    }

    return {
        boardMode: selectedBoardMode,
        timerType,
        timerDuration: fixedMinutes
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
    multiplayerState.boardMode = settings.boardMode;
    multiplayerState.timerSettings.type = settings.timerType;
    multiplayerState.timerSettings.fixedMinutes = settings.timerDuration;
    updateLobbyTimerSettings();

    socket.emit('start_game', settings);
}

function startMultiplayerBoard(data) {
    document.body.classList.add('multiplayer-active');
    showScreen('game');

    const gameApi = getGameApi();
    if (!gameApi) {
        showGameNotification('Game board is not ready yet. Refresh and try again.', 'red');
        return;
    }

    if (Array.isArray(data.board_state)) {
        gameApi.setBoardState(data.board_state, { syncAnimation: true });
    }

    gameApi.setSubmitHandler(submitMultiplayerWord);
    gameApi.setPathChangeHandler(handlePathChanged);

    configureMultiplayerLayout();
    updateMultiplayerHud();
    initializeScoreboard();
    updateScoreboard();
    updateBoardAccessState();

    if (multiplayerState.boardMode === 'shared') {
        addPlayerDoneButton();
    } else {
        removePlayerDoneButton();
    }

    showGameNotification(
        multiplayerState.boardMode === 'shared'
            ? 'Shared board round started. Submit words and tap I\'m Done when you finish.'
            : `${getPlayerName(multiplayerState.activePlayerId)} starts the round.`,
        'blue'
    );
}

function configureMultiplayerLayout() {
    const abilities = document.getElementById('abilities-area');
    const foundWords = document.getElementById('found-words-container');
    const newGameButton = document.getElementById('new-game-button');

    if (abilities) abilities.style.display = 'none';
    if (foundWords) foundWords.style.display = 'none';
    if (newGameButton) newGameButton.style.display = 'none';
}

function restoreSinglePlayerLayout() {
    const abilities = document.getElementById('abilities-area');
    const foundWords = document.getElementById('found-words-container');
    const newGameButton = document.getElementById('new-game-button');
    const inputArea = document.getElementById('input-area');

    if (abilities) abilities.style.display = '';
    if (foundWords) foundWords.style.display = '';
    if (newGameButton) newGameButton.style.display = '';
    if (inputArea) inputArea.style.display = 'none';
    removePlayerDoneButton();
}

function updateMultiplayerHud() {
    const gameApi = getGameApi();
    if (!gameApi) return;

    gameApi.updateHud({
        round: multiplayerState.currentRound,
        score: getPlayerScore(multiplayerState.sessionId),
        gems: '-'
    });
}

function getPlayerScore(playerId) {
    return multiplayerState.players.find((player) => player.id === playerId)?.score || 0;
}

async function submitMultiplayerWord(word, positions) {
    if (!socket || !multiplayerState.inGame) return;

    if (multiplayerState.boardMode === 'shared') {
        socket.emit('player_submitted_word', {
            room_code: multiplayerState.roomCode,
            word: word.toLowerCase(),
            positions
        });
        return;
    }

    socket.emit('player_word_submitted_turnbased', {
        room_code: multiplayerState.roomCode,
        word: word.toLowerCase(),
        positions
    });
}

function handlePathChanged(payload) {
    if (!socket || multiplayerState.boardMode !== 'randomized' || !multiplayerState.inGame) return;

    socket.emit('player_tile_selection', {
        positions: payload.path,
        action: payload.path.length > 0 ? 'update' : 'clear'
    });
}

function updateBoardAccessState() {
    const gameApi = getGameApi();
    if (!gameApi) return;

    const myTurn = multiplayerState.activePlayerId === multiplayerState.sessionId;
    const canPlay = multiplayerState.boardMode === 'shared' || myTurn;
    gameApi.setInteractionEnabled(canPlay);

    if (multiplayerState.boardMode === 'randomized') {
        showGameNotification(
            canPlay ? 'Your turn. Drag through a word to submit it.' : `${getPlayerName(multiplayerState.activePlayerId)} is taking their turn.`,
            canPlay ? 'green' : 'blue'
        );
    }
}

function applyScoreDelta(playerId, amount) {
    multiplayerState.players = multiplayerState.players.map((player) => (
        player.id === playerId
            ? { ...player, score: (player.score || 0) + amount }
            : player
    ));
}

function syncPlayerScores(playerScores) {
    multiplayerState.players = multiplayerState.players.map((player) => ({
        ...player,
        score: playerScores[player.id] ?? player.score ?? 0
    }));
}

function initializeScoreboard() {
    const rightPanel = document.getElementById('right-panel');
    if (!rightPanel) return;

    let container = document.getElementById('multiplayer-scoreboard');
    if (!container) {
        container = document.createElement('div');
        container.id = 'multiplayer-scoreboard';
        container.className = 'score-container';
        container.innerHTML = '<h3>Scores</h3>';
        rightPanel.appendChild(container);
    }
}

function updateScoreboard() {
    const container = document.getElementById('multiplayer-scoreboard');
    if (!container) return;

    container.innerHTML = '<h3>Scores</h3>';
    multiplayerState.players.forEach((player) => {
        const item = document.createElement('div');
        const isActive = multiplayerState.activePlayerId === player.id;
        item.className = `score-item ${isActive ? 'active' : 'inactive'}`;
        item.textContent = `${player.name}: ${player.score || 0}`;
        container.appendChild(item);
    });
}

function addPlayerDoneButton() {
    const inputArea = document.getElementById('input-area');
    if (!inputArea || document.getElementById('player-done-btn')) return;

    const doneButton = document.createElement('button');
    doneButton.id = 'player-done-btn';
    doneButton.className = 'ability-button';
    doneButton.textContent = "I'm Done";
    doneButton.addEventListener('click', () => {
        socket.emit('player_done', { room_code: multiplayerState.roomCode });
        doneButton.disabled = true;
        doneButton.textContent = 'Waiting...';
    });

    inputArea.style.display = 'flex';
    inputArea.appendChild(doneButton);
}

function removePlayerDoneButton() {
    const doneButton = document.getElementById('player-done-btn');
    if (doneButton) doneButton.remove();
}

function resetRoundState() {
    const doneButton = document.getElementById('player-done-btn');
    if (doneButton) {
        doneButton.disabled = false;
        doneButton.textContent = "I'm Done";
    }
}

function displayRoundResults(results, roundNumber) {
    if (!results) return;

    const overlay = document.createElement('div');
    overlay.className = 'results-overlay';

    const panel = document.createElement('div');
    panel.className = 'results-panel';
    panel.innerHTML = `<h2>Round ${roundNumber} Results</h2>`;

    Object.values(results).forEach((result) => {
        const row = document.createElement('div');
        row.className = 'results-row';
        row.innerHTML = `
            <div>
                <strong>${result.name}</strong>
                <div>${result.word_count} word${result.word_count === 1 ? '' : 's'}</div>
            </div>
            <div class="results-score">+${result.score}</div>
        `;
        panel.appendChild(row);
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    setTimeout(() => overlay.remove(), 2500);
}

function showGameFinished(data) {
    const overlay = document.createElement('div');
    overlay.className = 'results-overlay';

    const winnerName = getPlayerName(data.winner_id);
    const panel = document.createElement('div');
    panel.className = 'results-panel';
    panel.innerHTML = `<h2>Game Finished</h2><p class="results-winner">${winnerName} wins!</p>`;

    multiplayerState.players
        .slice()
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .forEach((player) => {
            const row = document.createElement('div');
            row.className = 'results-row';
            row.innerHTML = `
                <div><strong>${player.name}</strong></div>
                <div class="results-score">${player.score || 0}</div>
            `;
            panel.appendChild(row);
        });

    const backButton = document.createElement('button');
    backButton.className = 'lobby-button leave-btn';
    backButton.textContent = 'Back to menu';
    backButton.addEventListener('click', () => {
        overlay.remove();
        leaveLobby();
    });
    panel.appendChild(backButton);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}

function updateTimerDisplay(mode, seconds) {
    const timerContainer = document.getElementById('timer-container');
    const timerLabel = document.getElementById('timer-label');
    const timerBar = document.getElementById('timer-bar');
    const timerText = document.getElementById('timer-text');
    const voteButton = document.getElementById('vote-timer-btn');
    const voteInfo = document.getElementById('vote-info');

    if (!timerContainer || !timerLabel || !timerBar || !timerText) return;

    timerContainer.style.display = 'block';
    timerContainer.classList.remove('grace-period', 'voting-active', 'countdown-active');

    if (mode === 'grace') {
        timerContainer.classList.add('grace-period');
        timerLabel.textContent = 'Grace period';
        timerText.textContent = `${seconds}s`;
        timerBar.style.width = `${(seconds / 30) * 100}%`;
    } else if (mode === 'voting') {
        timerContainer.classList.add('voting-active');
        timerLabel.textContent = 'Vote to cut off round';
        timerText.textContent = `${multiplayerState.timerState.votes}/${multiplayerState.timerState.required}`;
        const denom = Math.max(multiplayerState.timerState.required, 1);
        timerBar.style.width = `${(multiplayerState.timerState.votes / denom) * 100}%`;
    } else if (mode === 'countdown') {
        timerContainer.classList.add('countdown-active');
        timerLabel.textContent = 'Round countdown';
        timerText.textContent = `${seconds}s`;
        timerBar.style.width = `${(seconds / 30) * 100}%`;
    } else {
        timerLabel.textContent = 'Turn timer';
        const totalSeconds = Math.max(1, Math.round(multiplayerState.timerSettings.fixedMinutes * 60));
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        timerText.textContent = `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
        timerBar.style.width = `${(seconds / totalSeconds) * 100}%`;
    }

    if (voteButton && voteInfo) {
        const showVoteUi = mode === 'voting';
        voteButton.style.display = showVoteUi ? 'block' : 'none';
        voteInfo.style.display = showVoteUi ? 'block' : 'none';
        if (showVoteUi) {
            voteButton.disabled = multiplayerState.timerState.hasVoted;
            voteButton.textContent = multiplayerState.timerState.hasVoted ? 'Voted' : 'Vote to start timer';
            voteInfo.textContent = `${multiplayerState.timerState.votes}/${multiplayerState.timerState.required} votes`;
        }
    }
}

function hideTimerDisplay() {
    const timerContainer = document.getElementById('timer-container');
    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
}

function voteForTimer() {
    if (!socket || !multiplayerState.timerState.votingActive || multiplayerState.timerState.hasVoted) return;
    socket.emit('vote_timer');
    multiplayerState.timerState.hasVoted = true;
    updateTimerDisplay('voting', multiplayerState.timerState.timeRemaining);
}

function showMultiplayerMenuNotification(message, color) {
    const messageArea = document.querySelector('#multiplayer-menu #message-area');
    if (messageArea) {
        messageArea.textContent = message;
        messageArea.style.color = colorMap(color);
    }
}

function showLobbyNotification(message, color) {
    const messageArea = document.getElementById('lobby-message');
    if (messageArea) {
        messageArea.textContent = message;
        messageArea.style.color = colorMap(color);
    }
}

function showGameNotification(message, color) {
    const messageArea = document.querySelector('#game-container #message-area');
    if (messageArea) {
        messageArea.textContent = message;
        messageArea.style.color = colorMap(color);
    }
}

function colorMap(color) {
    if (color === 'green') return '#10b981';
    if (color === 'red') return '#ef4444';
    return '#60a5fa';
}

document.addEventListener('DOMContentLoaded', () => {
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');
    if (createBtn) createBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = true;

    document.getElementById('mode-single')?.addEventListener('click', selectSinglePlayer);
    document.getElementById('mode-multi')?.addEventListener('click', selectMultiplayer);
    document.getElementById('create-room-btn')?.addEventListener('click', showCreateRoomDialog);
    document.getElementById('join-room-btn')?.addEventListener('click', showJoinRoomDialog);
    document.getElementById('leave-lobby-btn')?.addEventListener('click', leaveLobby);
    document.getElementById('start-game-btn')?.addEventListener('click', startMultiplayerGame);
    document.getElementById('vote-timer-btn')?.addEventListener('click', voteForTimer);

    const timerSlider = document.getElementById('timer-duration-slider');
    const timerValue = document.getElementById('timer-duration-value');
    const fixedControls = document.getElementById('fixed-timer-controls');
    const boardRadios = document.querySelectorAll('input[name="boardMode"]');
    const timerRadios = document.querySelectorAll('input[name="timerSystem"]');

    function refreshLobbyControls() {
        const settings = getGameSettings();
        multiplayerState.boardMode = settings.boardMode;
        multiplayerState.timerSettings.type = settings.timerType;
        multiplayerState.timerSettings.fixedMinutes = settings.timerDuration;

        if (fixedControls) {
            fixedControls.style.display = settings.timerType === 'fixed' ? 'block' : 'none';
        }

        const votingRadio = document.querySelector('input[name="timerSystem"][value="voting"]');
        const fixedRadio = document.querySelector('input[name="timerSystem"][value="fixed"]');

        if (settings.boardMode === 'randomized' && votingRadio && fixedRadio) {
            votingRadio.disabled = true;
            fixedRadio.checked = true;
            if (fixedControls) fixedControls.style.display = 'block';
        } else if (votingRadio) {
            votingRadio.disabled = false;
        }

        updateLobbyTimerSettings();
    }

    boardRadios.forEach((radio) => radio.addEventListener('change', refreshLobbyControls));
    timerRadios.forEach((radio) => radio.addEventListener('change', refreshLobbyControls));

    if (timerSlider && timerValue) {
        timerSlider.addEventListener('input', (event) => {
            timerValue.textContent = Number.parseFloat(event.target.value).toFixed(1);
            refreshLobbyControls();
        });
    }

    refreshLobbyControls();
    setTimeout(showModeSelector, 100);
});
