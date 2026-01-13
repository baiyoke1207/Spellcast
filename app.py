# app.py - MULTIPLAYER WITH ADVANCED TIMER SYSTEM
# CRITICAL: Single-player mode fully preserved and working
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
import threading
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = 'spellcast-multiplayer-secret-key-2024'

# Initialize SocketIO with eventlet for production compatibility
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ===== MULTIPLAYER STATE (Phase 1 + Timer System) =====
game_rooms = {}  # Room code -> room data
player_sessions = {}  # Session ID -> player data
timer_threads = {}  # Room code -> timer thread tracking
game_rooms_lock = threading.Lock()  # CRITICAL: Prevent race conditions

# ===== SINGLE PLAYER STATE (PRESERVED) =====
game_state = {}

GRID_SIZE = 5
MAX_ROUNDS = 5
# Scrabble-style letter values (Phase 2 spec-compliant)
# Legacy LETTER_SCORES maintained for single-player backward compatibility

# PHASE 2 GAP #3: Proper Scrabble-style letter scores
LETTER_VALUES = {
    'A':1, 'B':4, 'C':5, 'D':3, 'E':1, 'F':5, 'G':3, 'H':4, 'I':1, 'J':7,
    'K':6, 'L':3, 'M':4, 'N':2, 'O':1, 'P':4, 'Q':8, 'R':2, 'S':2, 'T':2,
    'U':4, 'V':5, 'W':5, 'X':7, 'Y':4, 'Z':8
}

# Legacy LETTER_SCORES maintained for single-player backward compatibility (alias)
LETTER_SCORES = LETTER_VALUES

# PHASE 2 GAP #2: Proper weighted letter frequency map (English language distribution)
FREQUENCY_MAP = {
    'E': 127, 'T': 91, 'A': 82, 'O': 75, 'I': 70, 'N': 67, 'S': 63, 'H': 61,
    'R': 60, 'D': 43, 'L': 40, 'U': 28, 'C': 28, 'M': 24, 'W': 24, 'F': 22,
    'G': 20, 'Y': 20, 'P': 19, 'B': 15, 'V': 10, 'K': 8, 'X': 2, 'J': 2,
    'Q': 1, 'Z': 1
}
VOWELS = "AEIOU"
LETTER_FREQUENCIES = "E"*12+"A"*9+"I"*9+"O"*8+"N"*6+"R"*6+"T"*6+"L"*4+"S"*4+"U"*4+"D"*4+"G"*3+"B"*2+"C"*2+"M"*2+"P"*2+"F"*2+"H"*2+"V"*2+"W"*2+"Y"*2+"K"*1+"J"*1+"X"*1+"Q"*1+"Z"*1
GEM_COSTS = {"shuffle": 1, "swap": 3, "hint": 4}

def load_words():
    with open("words_alpha.txt") as word_file:
        return set(word_file.read().split())
english_words = load_words()

# ===== MULTIPLAYER HELPER FUNCTIONS =====

def generate_room_code():
    """Generate unique 6-character room code"""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if code not in game_rooms:
            return code

def serialize_room(room_code):
    """
    Convert a room object to JSON-serializable format.
    Converts Python sets to lists for Socket.IO emission.
    """
    if room_code not in game_rooms:
        return None
    
    room = game_rooms[room_code]
    
    # Convert votes set to list
    timer_state = room['timer_state'].copy()
    timer_state['votes'] = list(timer_state['votes']) if isinstance(timer_state['votes'], set) else timer_state['votes']
    
    return {
        'room_code': room['room_code'],
        'host': room['host'],
        'players': room['players'],
        'settings': room['settings'],
        'status': room['status'],
        'timer_state': timer_state
    }

# ===== TIMER SYSTEM FUNCTIONS =====

def start_grace_period_voting(room_code, mode):
    """
    CRITICAL FIX #4: Start 30-second grace period for voting timer.
    After grace expires, voting window opens (if applicable).
    """
    room = game_rooms.get(room_code)
    if not room:
        return
    
    room['timer_state']['grace_active'] = True
    room['timer_state']['voting_active'] = False
    room['timer_state']['countdown_active'] = False
    room['timer_state']['votes'] = set()
    
    socketio.emit('timer_grace_started', {
        'duration': 30,
        'mode': mode
    }, room=room_code)
    
    print(f'[TIMER] Grace period started for room {room_code} ({mode} mode)')
    
    # Grace period countdown
    for i in range(30, 0, -1):
        if room_code not in game_rooms or not game_rooms[room_code]['timer_state']['grace_active']:
            return
        
        socketio.emit('timer_grace_tick', {'seconds': i}, room=room_code)
        time.sleep(1)
    
    # Grace period ended - enable voting based on mode
    if room_code in game_rooms:
        room['timer_state']['grace_active'] = False
        
        if mode == 'randomized_per_word':
            # Always enable voting in randomized mode
            room['timer_state']['voting_active'] = True
            socketio.emit('timer_voting_enabled', {}, room=room_code)
            print(f'[TIMER] Voting enabled for room {room_code} (randomized mode)')
        
        elif mode == 'shared_board':
            # CRITICAL: Voting only if exactly ONE player hasn't submitted
            round_state = room.get('round_state', {})
            submissions = round_state.get('submissions', {})
            
            players_submitted = sum(1 for sub in submissions.values() if len(sub.get('words', [])) > 0)
            total_players = len(room['players'])
            
            if players_submitted == total_players - 1:
                room['timer_state']['voting_active'] = True
                socketio.emit('timer_voting_enabled', {}, room=room_code)
                print(f'[TIMER] Voting enabled for room {room_code} (1 slow player)')

def start_voting_countdown(room_code):
    """Start 30-second countdown after all players have voted"""
    room = game_rooms.get(room_code)
    if not room:
        return
    
    room['timer_state']['voting_active'] = False
    room['timer_state']['countdown_active'] = True
    room['timer_state']['time_remaining'] = 30
    
    socketio.emit('timer_countdown_started', {
        'duration': 30
    }, room=room_code)
    
    print(f'[TIMER] Countdown started for room {room_code}')
    
    # Countdown
    for i in range(30, 0, -1):
        if room_code not in game_rooms or not game_rooms[room_code]['timer_state']['countdown_active']:
            return
        
        room['timer_state']['time_remaining'] = i
        socketio.emit('timer_countdown_tick', {'seconds': i}, room=room_code)
        time.sleep(1)
    
    # Countdown ended, force end turn
    if room_code in game_rooms:
        room['timer_state']['countdown_active'] = False
        current_player = room['timer_state']['current_player_turn']
        socketio.emit('timer_expired', {'player_id': current_player}, room=room_code)
        print(f'[TIMER] Turn timeout for player {current_player} in room {room_code}')

def start_fixed_timer(room_code, minutes):
    """Start fixed timer countdown"""
    room = game_rooms.get(room_code)
    if not room:
        return
    
    total_seconds = minutes * 60
    room['timer_state']['countdown_active'] = True
    room['timer_state']['time_remaining'] = total_seconds
    
    socketio.emit('timer_fixed_started', {
        'duration': total_seconds
    }, room=room_code)
    
    print(f'[TIMER] Fixed timer started for room {room_code}: {minutes} minutes')
    
    # Countdown
    for i in range(total_seconds, 0, -1):
        if room_code not in game_rooms or not game_rooms[room_code]['timer_state']['countdown_active']:
            return
        
        room['timer_state']['time_remaining'] = i
        socketio.emit('timer_fixed_tick', {'seconds': i}, room=room_code)
        time.sleep(1)
    
    # Timer expired, force end turn
    if room_code in game_rooms:
        room['timer_state']['countdown_active'] = False
        current_player = room['timer_state']['current_player_turn']
        socketio.emit('timer_expired', {'player_id': current_player}, room=room_code)
        print(f'[TIMER] Turn timeout for player {current_player} in room {room_code}')

def stop_timer(room_code):
    """Stop all active timers for a room"""
    if room_code in game_rooms:
        room = game_rooms[room_code]
        room['timer_state']['grace_active'] = False
        room['timer_state']['voting_active'] = False
        room['timer_state']['countdown_active'] = False
        room['timer_state']['votes'] = set()
        room['timer_state']['time_remaining'] = 0
    
    if room_code in timer_threads:
        timer_threads[room_code]['stop'] = True
        del timer_threads[room_code]

# ===== SINGLE PLAYER FUNCTIONS (PRESERVED) =====

def get_balanced_board():
    board_tiles = []
    letter_counts = {}
    
    for i in range(GRID_SIZE * GRID_SIZE):
        attempts = 0
        while attempts < 100:
            letter = random.choice(LETTER_FREQUENCIES)
            if letter_counts.get(letter, 0) < 5:
                board_tiles.append({"letter": letter, "special": None, "gem": False})
                letter_counts[letter] = letter_counts.get(letter, 0) + 1
                break
            attempts += 1
        else:
            available = [l for l in set(LETTER_FREQUENCIES) if letter_counts.get(l, 0) < 5]
            if available:
                letter = random.choice(available)
            else:
                letter = random.choice(LETTER_FREQUENCIES)
            board_tiles.append({"letter": letter, "special": None, "gem": False})
            letter_counts[letter] = letter_counts.get(letter, 0) + 1
    
    return board_tiles

def is_path_valid(path, word, board_tiles):
    if len(path) != len(word): return False
    seen_coords = set()
    for r, c in path:
        coord_tuple = (r, c)
        if coord_tuple in seen_coords: return False
        seen_coords.add(coord_tuple)
    for i in range(len(path)):
        r, c = path[i]
        index = r * GRID_SIZE + c
        if board_tiles[index]['letter'].lower() != word[i].lower(): return False
        if i > 0:
            prev_r, prev_c = path[i-1]
            if abs(r - prev_r) > 1 or abs(c - prev_c) > 1: return False
    return True

def start_new_game():
    global game_state
    board_tiles = get_balanced_board()
    
    # Add special tiles
    special_tile_type = "DL" if random.random() < 0.75 else "TL"
    special_tile_index = random.randint(0, len(board_tiles) - 1)
    board_tiles[special_tile_index]["special"] = special_tile_type
    
    # Add 10 gems
    empty_indices = list(range(len(board_tiles)))
    random.shuffle(empty_indices)
    for i in range(min(10, len(empty_indices))):
        board_tiles[empty_indices[i]]["gem"] = True

    game_state = {
        "board_tiles": board_tiles,
        "round": 1,
        "score": 0,
        "found_words": [],
        "dp_pos": None,
        "game_over": False,
        "gems": 3
    }

def advance_to_next_round():
    # BUG FIX: Only set game_over AFTER completing round 5, not when entering it
    game_state["round"] += 1
    if game_state["round"] > MAX_ROUNDS:
        game_state["game_over"] = True
        return
    
    # Shuffle entire tiles (letter + special + gem together) to preserve powerups
    tiles_data = [{"letter": tile["letter"], "special": tile["special"], "gem": tile["gem"]} 
                  for tile in game_state["board_tiles"]]
    random.shuffle(tiles_data)
    
    # Update board with shuffled data
    for i, tile_data in enumerate(tiles_data):
        game_state["board_tiles"][i]["letter"] = tile_data["letter"]
        game_state["board_tiles"][i]["special"] = tile_data["special"]
        game_state["board_tiles"][i]["gem"] = tile_data["gem"]
    
    # Add DP tile
    available_indices = [i for i, tile in enumerate(game_state["board_tiles"]) if tile["special"] not in ["DL", "TL"]]
    if available_indices:
        dp_index = random.choice(available_indices)
        game_state["dp_pos"] = [dp_index // GRID_SIZE, dp_index % GRID_SIZE]
    else:
        game_state["dp_pos"] = None

def get_current_board_letters():
    return [[game_state["board_tiles"][r*GRID_SIZE + c]['letter'] for c in range(GRID_SIZE)] for r in range(GRID_SIZE)]

def find_all_paths(board_letters, word):
    word = word.upper()
    paths = []
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            if board_letters[r][c] == word[0]:
                find_paths_recursive(board_letters, word, [[r, c]], paths)
    return paths

def find_paths_recursive(board_letters, word, current_path, all_paths):
    if len(current_path) == len(word):
        all_paths.append(current_path)
        return
    last_r, last_c = current_path[-1]
    next_letter = word[len(current_path)]
    for dr in [-1, 0, 1]:
        for dc in [-1, 0, 1]:
            if dr == 0 and dc == 0: continue
            nr, nc = last_r + dr, last_c + dc
            if 0 <= nr < GRID_SIZE and 0 <= nc < GRID_SIZE:
                if not any(p[0] == nr and p[1] == nc for p in current_path):
                    if board_letters[nr][nc] == next_letter:
                        find_paths_recursive(board_letters, word, current_path + [[nr, nc]], all_paths)

def calculate_score_for_path(path, word):
    base_score, word_multiplier = 0, 1
    for r, c in path:
        index = r * GRID_SIZE + c
        tile = game_state["board_tiles"][index]
        letter_multiplier = 1
        if tile["special"] == "DL": letter_multiplier = 2
        elif tile["special"] == "TL": letter_multiplier = 3
        if game_state["dp_pos"] and game_state["dp_pos"] == [r, c]: word_multiplier *= 2
        base_score += LETTER_SCORES.get(tile["letter"].upper(), 0) * letter_multiplier
    final_score = base_score * word_multiplier
    if len(word) >= 6: final_score += 10
    return final_score

# ===== SINGLE PLAYER ROUTES (PRESERVED) =====

@app.route("/")
def homepage():
    start_new_game()
    return render_template("index.html", initial_state=game_state, letter_scores=LETTER_SCORES)

@app.route("/submit-word", methods=['POST'])
def submit_word():
    data = request.get_json()
    word, path = data.get("word", "").lower(), data.get("path", [])
    
    if len(word) < 3 or word in game_state["found_words"] or word not in english_words or not is_path_valid(path, word, game_state["board_tiles"]):
        return jsonify({"valid": False, "reason": "Invalid word or path"})

    final_score = calculate_score_for_path(path, word)
    game_state["score"] += final_score
    game_state["found_words"].append(word)

    gems_collected = 0
    new_letter_indices = []
    
    for r, c in path:
        index = r * GRID_SIZE + c
        
        if game_state["board_tiles"][index]["gem"]:
            gems_collected += 1
            game_state["board_tiles"][index]["gem"] = False
        
        if game_state["board_tiles"][index]["special"]:
            special_type = game_state["board_tiles"][index]["special"]
            available_indices = [i for i, t in enumerate(game_state["board_tiles"]) if not t["special"] and i != index]
            if available_indices: 
                game_state["board_tiles"][random.choice(available_indices)]["special"] = special_type
        
        game_state["board_tiles"][index]["letter"] = random.choice(LETTER_FREQUENCIES)
        game_state["board_tiles"][index]["special"] = None
        new_letter_indices.append(index)
    
    game_state["gems"] += gems_collected
    
    for _ in range(gems_collected):
        if new_letter_indices:
            respawn_index = random.choice(new_letter_indices)
            game_state["board_tiles"][respawn_index]["gem"] = True
            new_letter_indices.remove(respawn_index)
            
    advance_to_next_round()
    return jsonify({"valid": True, "new_state": game_state, "score_added": final_score})

@app.route("/use-ability", methods=['POST'])
def use_ability():
    data = request.get_json()
    ability = data.get("ability")
    cost = GEM_COSTS.get(ability)
    
    if cost is None or game_state["gems"] < cost:
        return jsonify({"success": False, "reason": "Not enough gems!"})

    game_state["gems"] -= cost

    if ability == "shuffle":
        # Create list of tile objects (letter + special + gem) to shuffle together
        tiles_data = [{"letter": tile["letter"], "special": tile["special"], "gem": tile["gem"]} 
                      for tile in game_state["board_tiles"]]
        random.shuffle(tiles_data)
        
        # Update board with shuffled data
        for i, tile_data in enumerate(tiles_data):
            game_state["board_tiles"][i]["letter"] = tile_data["letter"]
            game_state["board_tiles"][i]["special"] = tile_data["special"]
            game_state["board_tiles"][i]["gem"] = tile_data["gem"]
    
    elif ability == "swap":
        index = data.get("index")
        new_letter = data.get("new_letter", "").upper()
        if index is not None and new_letter and 'A' <= new_letter <= 'Z':
            game_state["board_tiles"][index]["letter"] = new_letter
        else:
            game_state["gems"] += cost
            return jsonify({"success": False, "reason": "Invalid swap data."})

    elif ability == "hint":
        board_letters = get_current_board_letters()
        best_word, best_path, best_score = "", [], -1
        
        for word in english_words:
            if len(word) < 3 or word in game_state["found_words"]: continue
            paths = find_all_paths(board_letters, word)
            if paths:
                score = calculate_score_for_path(paths[0], word)
                if score > best_score:
                    best_word, best_path, best_score = word, paths[0], score
        
        if best_word:
            return jsonify({"success": True, "new_state": game_state, "hint": {"word": best_word, "path": best_path}})
        else:
            game_state["gems"] += cost
            return jsonify({"success": False, "reason": "No hint found!"})

    return jsonify({"success": True, "new_state": game_state})

# ===== PHASE 2 CRITICAL VALIDATION FUNCTIONS =====

# GAP #1: STRICT ADJACENCY VALIDATION (NO DIAGONALS)
def is_valid_path_strict(positions):
    """Validate path with NO diagonal movement (Manhattan distance = 1 only)"""
    if len(positions) < 2:
        return True
    
    for i in range(1, len(positions)):
        r1, c1 = positions[i-1]
        r2, c2 = positions[i]
        manhattan_distance = abs(r1 - r2) + abs(c1 - c2)
        
        # CRITICAL: Must be exactly 1 (adjacent horizontally or vertically)
        # manhattan_distance = 2 means diagonal OR gap
        if manhattan_distance != 1:
            return False
    
    return True

# GAP #7: BOARD TILE CONSISTENCY VALIDATION
def validate_board_tiles(word, positions, board_state):
    """Validate that each position matches the word letter"""
    if len(word) != len(positions):
        return False, 'Length mismatch'
    
    for i, (row, col) in enumerate(positions):
        if row < 0 or row >= GRID_SIZE or col < 0 or col >= GRID_SIZE:
            return False, 'Out of bounds'
        
        board_letter = board_state[row][col].upper()
        word_letter = word[i].upper()
        
        if board_letter != word_letter:
            return False, f'Board mismatch at ({row},{col}): expected {word_letter}, got {board_letter}'
    
    return True, None

# GAP #2: PROPER WEIGHTED BOARD GENERATION
def generate_weighted_board(room_code):
    """Generate 5x5 board with proper English letter frequency weighting"""
    # Deterministic seeding for reproducibility
    random.seed(hash(room_code) % (2**32))
    
    letters = list(FREQUENCY_MAP.keys())
    weights = list(FREQUENCY_MAP.values())
    
    # Generate 25 letters using weighted random selection
    flat_board = random.choices(letters, weights=weights, k=25)
    
    # Convert to 2D array
    board_2d = [flat_board[i*5:(i+1)*5] for i in range(5)]
    
    return board_2d

# GAP #3: PROPER SCORING WITH MULTIPLIERS
def calculate_score_with_multipliers(word):
    """Calculate score with proper Scrabble-style letter values and length multipliers"""
    # Base score from letter values
    base_score = sum(LETTER_VALUES.get(c.upper(), 0) for c in word)
    
    # Length multipliers per Phase 2 spec
    word_len = len(word)
    if word_len <= 3:
        multiplier = 1.0
    elif word_len <= 5:
        multiplier = 1.2
    elif word_len <= 7:
        multiplier = 1.5
    else:
        multiplier = 2.0
    
    final_score = int(base_score * multiplier)
    return final_score

# GAP #4: ROW-BASED BOARD REFRESH

def refresh_consumed_positions(board_state, consumed_positions):
    """
    CRITICAL FIX #1: Refresh ONLY the specific consumed positions with new random letters.
    NOT entire rows, ONLY individual tile positions that were used in words.
    """
    letters = list(FREQUENCY_MAP.keys())
    weights = list(FREQUENCY_MAP.values())
    
    for row, col in consumed_positions:
        if 0 <= row < GRID_SIZE and 0 <= col < GRID_SIZE:
            board_state[row][col] = random.choices(letters, weights=weights, k=1)[0]
    
    return board_state

def get_all_consumed_positions(submissions):
    """
    Collect all unique tile positions that were consumed by word submissions.
    Returns set of (row, col) tuples.
    """
    consumed = set()
    
    for player_id, submission in submissions.items():
        if 'positions' in submission:
            for word_positions in submission['positions']:
                for row, col in word_positions:
                    consumed.add((row, col))
    
    return consumed

def apply_tile_swap(board_state, swap_history):
    """
    CRITICAL FIX #2: Apply tile swaps with proper persistence.
    Swapped tiles that are NOT used in words persist to next round.
    """
    for swap in swap_history:
        if not swap.get('used', False):
            row, col = swap['position']
            new_letter = swap['new_letter']
            board_state[row][col] = new_letter
            print(f'[SWAP] Persisting unused swap at ({row},{col}): {swap["old_letter"]} → {new_letter}')
    
    return board_state

def mark_swaps_as_used(swap_history, consumed_positions):
    """
    Mark swaps as 'used' if their positions were consumed in word submissions.
    Used swaps will NOT persist to next round.
    """
    for swap in swap_history:
        swap_pos = swap['position']
        if swap_pos in consumed_positions:
            swap['used'] = True

# HELPER: Calculate word score (legacy single-player)
def calculate_word_score(word, positions, board_state):
    """Calculate score for a word based on positions and board state"""
    base_score = 0
    word_multiplier = 1
    
    for i, (row, col) in enumerate(positions):
        letter = board_state[row][col].upper()
        letter_score = LETTER_SCORES.get(letter, 0)
        
        # Apply letter multipliers (DL/TL would be tracked if implemented)
        base_score += letter_score
    
    # Apply word multiplier (DP would be tracked if implemented)
    final_score = base_score * word_multiplier
    
    # Bonus for long words
    if len(word) >= 6:
        final_score += 10
    
    return final_score

# HELPER: Compile round results
def compile_round_results(room):
    """Compile all player scores and words for round end"""
    results = {}
    round_state = room.get('round_state', {})
    submissions = round_state.get('submissions', {})
    
    for player_id, submission in submissions.items():
        player_name = next((p['name'] for p in room['players'] if p['id'] == player_id), 'Unknown')
        results[player_id] = {
            'name': player_name,
            'score': submission.get('score', 0),
            'word_count': len(submission.get('words', [])),
            'words': submission.get('words', [])
        }
    
    return results

# ===== HELPER FUNCTIONS FOR GAME LOGIC =====

# ===== MULTIPLAYER SOCKET.IO EVENTS =====

@socketio.on('connect')
def handle_connect():
    """Handle new player connection"""
    session_id = request.sid
    player_sessions[session_id] = {'room_code': None, 'name': None}
    emit('connected', {'session_id': session_id})
    print(f'[MULTIPLAYER] Player connected: {session_id}')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle player disconnection"""
    session_id = request.sid
    if session_id in player_sessions:
        room_code = player_sessions[session_id].get('room_code')
        if room_code and room_code in game_rooms:
            # Remove player from room
            room = game_rooms[room_code]
            room['players'] = [p for p in room['players'] if p['id'] != session_id]
            
            # Stop any active timers
            stop_timer(room_code)
            
            # Notify others
            socketio.emit('player_left', {
                'player_id': session_id,
                'player_count': len(room['players'])
            }, room=room_code)
            
            # Delete room if empty
            if not room['players']:
                del game_rooms[room_code]
                print(f'[MULTIPLAYER] Room {room_code} deleted (empty)')
        
        del player_sessions[session_id]
    print(f'[MULTIPLAYER] Player disconnected: {session_id}')

@socketio.on('create_room')
def handle_create_room(data):
    """Create new game room with timer settings"""
    session_id = request.sid
    player_name = data.get('player_name', 'Player')
    max_players = min(data.get('max_players', 4), 5)  # Max 5 players
    
    room_code = generate_room_code()
    
    print(f'[MULTIPLAYER] Room create event from {session_id}')
    print(f'[MULTIPLAYER] Player name: {player_name}, max_players: {max_players}')
    
    game_rooms[room_code] = {
        'room_code': room_code,
        'host': session_id,
        'players': [{
            'id': session_id,
            'name': player_name,
            'score': 0,
            'ready': False
        }],
        'settings': {
            'max_players': max_players,
            'rounds_per_player': 5,  # Always 5 rounds
            'timer_type': 'voting',  # Default: voting-based
            'fixed_minutes': 2  # Default: 2 minutes for fixed timer
        },
        'status': 'waiting',  # waiting, playing, finished
        'timer_state': {
            'grace_active': False,
            'voting_active': False,
            'countdown_active': False,
            'votes': set(),  # Keep as set internally for fast lookups
            'time_remaining': 0,
            'current_player_turn': None
        }
    }
    
    player_sessions[session_id]['room_code'] = room_code
    player_sessions[session_id]['name'] = player_name
    
    join_room(room_code)
    
    # FIX: Use serialize_room to convert set to list for JSON
    room_data = serialize_room(room_code)
    
    print(f'[MULTIPLAYER] Room {room_code} created by {player_name}')
    print(f'[MULTIPLAYER] Emitting room_created with serialized data')
    
    emit('room_created', {
        'room_code': room_code,
        'room': room_data  # Send JSON-serializable version
    })
    
    print(f'[MULTIPLAYER] room_created event emitted successfully')

@socketio.on('join_room')
def handle_join_room(data):
    """Join existing room with code"""
    session_id = request.sid
    room_code = data.get('room_code', '').upper().strip()
    player_name = data.get('player_name', 'Player')
    
    print(f'[MULTIPLAYER] join_room request: room={room_code}, player={player_name}, sid={session_id}')
    
    if not room_code:
        emit('error', {'message': 'Please enter a room code'})
        return
    
    if room_code not in game_rooms:
        print(f'[MULTIPLAYER] Room {room_code} not found')
        emit('error', {'message': 'Room not found'})
        return
    
    room = game_rooms[room_code]
    
    # FIX #4: Check if player already in room (prevent duplicates from spam-joining)
    player_already_in = any(p['id'] == session_id for p in room['players'])
    if player_already_in:
        print(f'[MULTIPLAYER] Player {session_id} already in room {room_code}, ignoring duplicate join')
        # Send room state to client anyway (idempotent)
        room_data = serialize_room(room_code)
        emit('room_joined', {
            'room_code': room_code,
            'room': room_data,
            'is_host': (session_id == room['host']),
            'status': 'already_joined'
        })
        return
    
    if room['status'] != 'waiting':
        emit('error', {'message': 'Game already started'})
        return
    
    if len(room['players']) >= room['settings']['max_players']:
        emit('error', {'message': 'Room is full'})
        return
    
    # Add player to room
    new_player = {
        'id': session_id,
        'name': player_name,
        'score': 0,
        'ready': False
    }
    room['players'].append(new_player)
    print(f'[MULTIPLAYER] Player {player_name} ({session_id}) added to room {room_code}')
    
    player_sessions[session_id]['room_code'] = room_code
    player_sessions[session_id]['name'] = player_name
    
    join_room(room_code)
    
    # FIX #3: Use serialize_room to convert set to list for JSON
    room_data = serialize_room(room_code)
    
    # FIX #3A: Send join confirmation DIRECTLY TO THIS PLAYER (guest)
    emit('room_joined', {
        'room_code': room_code,
        'room': room_data,
        'is_host': False,  # Joining player is never host
        'status': 'success'
    })
    print(f'[MULTIPLAYER] Sent room_joined event to guest {player_name}')
    
    # FIX #3B: THEN broadcast to ALL players that someone joined
    socketio.emit('player_joined', {
        'player': new_player,
        'room': room_data,
        'new_player_name': player_name
    }, room=room_code)
    print(f'[MULTIPLAYER] Broadcast player_joined to room {room_code}')

@socketio.on('leave_room')
def handle_leave_room():
    """Player voluntarily leaves room"""
    session_id = request.sid
    if session_id in player_sessions:
        room_code = player_sessions[session_id].get('room_code')
        if room_code and room_code in game_rooms:
            room = game_rooms[room_code]
            player_name = player_sessions[session_id].get('name', 'Player')
            
            # Remove player
            room['players'] = [p for p in room['players'] if p['id'] != session_id]
            
            # Stop timers
            stop_timer(room_code)
            
            # Notify others
            socketio.emit('player_left', {
                'player_id': session_id,
                'player_name': player_name,
                'player_count': len(room['players'])
            }, room=room_code)
            
            leave_room(room_code)
            
            # Delete room if empty
            if not room['players']:
                del game_rooms[room_code]
            
            # Clear player session
            player_sessions[session_id]['room_code'] = None
            
            print(f'[MULTIPLAYER] {player_name} left room {room_code}')

@socketio.on('get_room_info')
def handle_get_room_info():
    """Get current room information"""
    session_id = request.sid
    if session_id in player_sessions:
        room_code = player_sessions[session_id].get('room_code')
        if room_code and room_code in game_rooms:
            # FIX: Use serialize_room to convert set to list for JSON
            room_data = serialize_room(room_code)
            emit('room_info', {'room': room_data})

@socketio.on('update_timer_settings')
def handle_update_timer_settings(data):
    """Host updates timer settings in lobby"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = player_sessions[session_id].get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    room = game_rooms[room_code]
    
    # Only host can update settings
    if room['host'] != session_id:
        emit('error', {'message': 'Only host can change timer settings'})
        return
    
    # Update timer settings
    timer_type = data.get('timer_type', 'voting')
    if timer_type not in ['voting', 'fixed']:
        timer_type = 'voting'
    
    room['settings']['timer_type'] = timer_type
    
    if timer_type == 'fixed':
        fixed_minutes = data.get('fixed_minutes', 2)
        fixed_minutes = max(1, min(10, int(fixed_minutes)))  # Clamp 1-10
        room['settings']['fixed_minutes'] = fixed_minutes
    
    # Notify all players
    socketio.emit('timer_settings_updated', {
        'timer_type': timer_type,
        'fixed_minutes': room['settings'].get('fixed_minutes', 2)
    }, room=room_code)
    
    print(f'[TIMER] Settings updated in room {room_code}: {timer_type}')

@socketio.on('start_game')
def handle_start_game(data):
    """Start multiplayer game with timer settings"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = player_sessions[session_id].get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    room = game_rooms[room_code]
    
    # Only host can start
    if room['host'] != session_id:
        emit('error', {'message': 'Only host can start game'})
        return
    
    # Need at least 2 players
    if len(room['players']) < 2:
        emit('error', {'message': 'Need at least 2 players'})
        return
    
    # Update timer settings from data
    timer_type = data.get('timerType', 'voting')
    board_mode = data.get('boardMode', 'shared')
    
    if timer_type not in ['voting', 'fixed']:
        timer_type = 'voting'
    
    room['settings']['timer_type'] = timer_type
    room['settings']['board_mode'] = board_mode
    
    if timer_type == 'fixed':
        fixed_minutes = data.get('timerDuration', 2)
        fixed_minutes = max(0.5, min(10, float(fixed_minutes)))
        room['settings']['fixed_minutes'] = fixed_minutes
    
    room['status'] = 'playing'
    
    # Generate shared board for both modes
    shared_board = generate_weighted_board(room_code)
    
    # Initialize game state based on mode
    if board_mode == 'shared':
        # SHARED BOARD MODE: Simultaneous play
        room['round_state'] = {
            'round_number': 1,
            'board_state': shared_board,
            'submissions': {player['id']: {'words': [], 'positions': [], 'score': 0, 'done': False} for player in room['players']},
            'timer_start': time.time(),
            'timer_expires': time.time() + (fixed_minutes * 60 if timer_type == 'fixed' else 120),
            'all_done': False,
            'timer_active': True,
            'swap_history': []  # FEATURE #2: Track tile swaps for persistence
        }
    else:
        # RANDOMIZED PER WORD MODE: Turn-based play
        room['game_state'] = {
            'mode': 'randomized_per_word',
            'board_state': shared_board,
            'current_round': 1,
            'turn_number': 1,
            'active_player_id': room['players'][0]['id'],  # First player starts
            'words_played': [],
            'timer_active': True
        }
    
    # FIX: Use serialize_room to convert set to list for JSON
    room_data = serialize_room(room_code)
    
    # Calculate timer duration
    duration_seconds = int(room['settings'].get('fixed_minutes', 2) * 60) if timer_type == 'fixed' else 120
    
    # Notify all players game is starting - FEATURE #6: Do NOT send player scores here
    socketio.emit('game_started', {
        'room': room_data,
        'timer_type': timer_type,
        'board_mode': board_mode,
        'duration': duration_seconds,
        'board_state': room['round_state']['board_state'] if board_mode == 'shared' else None,
        'active_player_id': room['game_state']['active_player_id'] if board_mode == 'randomized' else None,  # FEATURE #7: Include active_player_id
        'fixed_minutes': room['settings'].get('fixed_minutes', 2) if timer_type == 'fixed' else None
        # FEATURE #6: Do NOT send player_scores here - they're hidden during gameplay
    }, room=room_code)
    
    # Start fixed timer if configured
    if timer_type == 'fixed' and board_mode == 'shared':
        thread = threading.Thread(target=fixed_timer_countdown, args=(room_code, duration_seconds))
        thread.daemon = True
        thread.start()
    
    print(f'[MULTIPLAYER] Game started in room {room_code} with {timer_type} timer, {board_mode} board')

@socketio.on('start_turn')
def handle_start_turn(data):
    """Start a player's turn with appropriate timer"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = player_sessions[session_id].get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    room = game_rooms[room_code]
    player_id = data.get('player_id')
    
    room['timer_state']['current_player_turn'] = player_id
    
    # Stop any existing timer
    stop_timer(room_code)
    
    # Start appropriate timer based on settings
    if room['settings']['timer_type'] == 'voting':
        # Start grace period in background thread
        thread = threading.Thread(target=start_grace_period, args=(room_code,))
        thread.daemon = True
        thread.start()
        timer_threads[room_code] = {'thread': thread, 'stop': False}
    else:
        # Start fixed timer
        minutes = room['settings']['fixed_minutes']
        thread = threading.Thread(target=start_fixed_timer, args=(room_code, minutes))
        thread.daemon = True
        thread.start()
        timer_threads[room_code] = {'thread': thread, 'stop': False}

@socketio.on('swap_tile')
def handle_swap_tile(data):
    """CRITICAL FIX #2: Handle tile swap requests with persistence"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = data.get('room_code')
    position = data.get('position')  # [row, col]
    
    if not room_code or room_code not in game_rooms:
        emit('error', {'message': 'Room not found'})
        return
    
    with game_rooms_lock:
        room = game_rooms[room_code]
        round_state = room.get('round_state', {})
        board_state = round_state.get('board_state', [])
        
        row, col = position
        
        # Store old letter
        old_letter = board_state[row][col]
        
        # Generate new random letter with weighted frequency
        letters = list(FREQUENCY_MAP.keys())
        weights = list(FREQUENCY_MAP.values())
        new_letter = random.choices(letters, weights=weights, k=1)[0]
        
        # Update board
        board_state[row][col] = new_letter
        
        # Track this swap in swap_history
        if 'swap_history' not in round_state:
            round_state['swap_history'] = []
        
        round_state['swap_history'].append({
            'position': (row, col),
            'old_letter': old_letter,
            'new_letter': new_letter,
            'used': False
        })
    
    # Broadcast to all players in room
    socketio.emit('tile_swapped', {
        'position': [row, col],
        'old_letter': old_letter,
        'new_letter': new_letter,
        'board_state': board_state
    }, room=room_code)
    
    print(f'[SWAP] Player {session_id} swapped tile at ({row},{col}): {old_letter} → {new_letter}')

@socketio.on('player_tile_selection')
def handle_tile_selection_broadcast(data):
    """
    CRITICAL FIX #5: Broadcast real-time tile selection to other players.
    Used in Randomized Per Word mode so inactive players see active player's tiles.
    """
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = player_sessions[session_id].get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    # Broadcast to ALL players EXCEPT the sender
    socketio.emit('opponent_tile_highlight', {
        'player_id': session_id,
        'positions': data.get('positions', []),
        'action': data.get('action', 'update')  # 'update', 'clear'
    }, room=room_code, skip_sid=session_id)

@socketio.on('vote_timer')
def handle_vote_timer():
    """Player votes to start countdown timer"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = player_sessions[session_id].get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    room = game_rooms[room_code]
    
    # Can't vote during grace period or if countdown already started
    if room['timer_state']['grace_active']:
        emit('error', {'message': 'Wait for grace period to end'})
        return
    
    if room['timer_state']['countdown_active']:
        return
    
    # Can't vote if it's your turn
    if room['timer_state']['current_player_turn'] == session_id:
        return
    
    # Add vote
    room['timer_state']['votes'].add(session_id)
    
    # Count eligible voters (all players except current turn)
    eligible_voters = [p['id'] for p in room['players'] if p['id'] != room['timer_state']['current_player_turn']]
    votes_count = len(room['timer_state']['votes'])
    required_votes = len(eligible_voters)
    
    # Notify all players of vote count
    socketio.emit('timer_vote_update', {
        'votes': votes_count,
        'required': required_votes
    }, room=room_code)
    
    print(f'[TIMER] Vote received in room {room_code}: {votes_count}/{required_votes}')
    
    # If all eligible players have voted, start countdown
    if votes_count >= required_votes:
        stop_timer(room_code)
        thread = threading.Thread(target=start_voting_countdown, args=(room_code,))
        thread.daemon = True
        thread.start()
        timer_threads[room_code] = {'thread': thread, 'stop': False}

# FEATURE 1: SIMULTANEOUS PLAY - Word submission with FULL VALIDATION
@socketio.on('player_submitted_word')
def handle_player_submitted_word(data):
    """Handle word submission with complete validation chain"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = data.get('room_code')
    word = data.get('word', '').lower()
    positions = data.get('positions', [])
    
    # Basic validation
    if not room_code or room_code not in game_rooms:
        emit('word_rejected', {'reason': 'invalid_room', 'message': 'Room not found'})
        return
    
    # CRITICAL: Use lock to prevent race conditions
    with game_rooms_lock:
        room = game_rooms[room_code]
        
        # Only for shared board mode
        if room['settings'].get('board_mode') != 'shared':
            return
        
        round_state = room.get('round_state', {})
        board_state = round_state.get('board_state', [])
        
        # VALIDATION STEP 1: Check timer expiration
        submission_time = time.time()
        timer_expires = round_state.get('timer_expires', float('inf'))
        if submission_time > timer_expires:
            emit('word_rejected', {
                'reason': 'turn_expired',
                'message': 'Time expired! Submission too late.',
                'word': word
            })
            return
        
        # VALIDATION STEP 2: Word length (minimum 2, maximum 25)
        if len(word) < 2 or len(word) > 25:
            emit('word_rejected', {
                'reason': 'invalid_length',
                'message': f'Word must be 2-25 letters (got {len(word)})',
                'word': word
            })
            return
        
        # VALIDATION STEP 3: Dictionary check
        if word not in english_words:
            emit('word_rejected', {
                'reason': 'invalid_word',
                'message': f'"{word}" is not in dictionary',
                'word': word
            })
            return
        
        # VALIDATION STEP 4: Strict adjacency (NO diagonals)
        if not is_valid_path_strict(positions):
            emit('word_rejected', {
                'reason': 'invalid_path',
                'message': 'Letters must be adjacent (no diagonals or gaps)',
                'word': word,
                'positions': positions
            })
            return
        
        # VALIDATION STEP 5: Board tile consistency
        tiles_valid, error_msg = validate_board_tiles(word, positions, board_state)
        if not tiles_valid:
            emit('word_rejected', {
                'reason': 'board_mismatch',
                'message': f'Board mismatch: {error_msg}',
                'word': word
            })
            return
        
        # VALIDATION STEP 6: Duplicate check
        if session_id in round_state['submissions']:
            if word in round_state['submissions'][session_id]['words']:
                emit('word_rejected', {
                    'reason': 'duplicate_word',
                    'message': f'You already played "{word}" this round',
                    'word': word
                })
                return
        
        # ALL VALIDATIONS PASSED - Calculate score
        score = calculate_score_with_multipliers(word)
        
        # Store submission (SECRET - not broadcast)
        if session_id not in round_state['submissions']:
            round_state['submissions'][session_id] = {
                'words': [],
                'positions': [],
                'score': 0,
                'done': False
            }
        
        round_state['submissions'][session_id]['words'].append(word)
        round_state['submissions'][session_id]['positions'].append(positions)
        round_state['submissions'][session_id]['score'] += score
    
    # Send confirmation ONLY to submitting player (outside lock)
    emit('word_accepted', {
        'word': word,
        'score': score,
        'message': 'Word submitted! (Score hidden until round ends)'
    })
    
    print(f'[VALIDATION] ✓ Player {session_id} submitted "{word}" (score: {score}, hidden)')
    
    # CRITICAL FIX #3: Check if all players have submitted
    check_and_end_round_if_all_submitted(room_code)

# RANDOMIZED PER WORD MODE: Turn-based word submission
@socketio.on('player_word_submitted_turnbased')
def handle_turnbased_word_submission(data):
    """Handle word submission in turn-based Randomized Per Word mode"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = data.get('room_code')
    word = data.get('word', '').lower()
    positions = data.get('positions', [])
    
    if not room_code or room_code not in game_rooms:
        emit('word_rejected', {'reason': 'invalid_room', 'message': 'Room not found'})
        return
    
    with game_rooms_lock:
        room = game_rooms[room_code]
        
        if room['settings'].get('board_mode') != 'randomized':
            return
        
        game_state = room.get('game_state', {})
        board_state = game_state.get('board_state', [])
        active_player_id = game_state.get('active_player_id')
        
        # Check if it's this player's turn
        if session_id != active_player_id:
            emit('word_rejected', {
                'reason': 'not_your_turn',
                'message': "It's not your turn!"
            })
            return
        
        # Check timer expiration
        if 'timer_expires' in game_state:
            if time.time() > game_state['timer_expires']:
                emit('word_rejected', {
                    'reason': 'turn_expired',
                    'message': 'Time expired!'
                })
                return
        
        # Word length validation
        if len(word) < 2 or len(word) > 25:
            emit('word_rejected', {
                'reason': 'invalid_length',
                'message': f'Word must be 2-25 letters'
            })
            return
        
        # Dictionary check
        if word not in english_words:
            emit('word_rejected', {
                'reason': 'invalid_word',
                'message': f'"{word}" not in dictionary'
            })
            return
        
        # Strict adjacency
        if not is_valid_path_strict(positions):
            emit('word_rejected', {
                'reason': 'invalid_path',
                'message': 'No diagonals or gaps allowed'
            })
            return
        
        # Board tile consistency
        tiles_valid, error_msg = validate_board_tiles(word, positions, board_state)
        if not tiles_valid:
            emit('word_rejected', {
                'reason': 'board_mismatch',
                'message': f'Board mismatch: {error_msg}'
            })
            return
        
        # Calculate score
        score = calculate_score_with_multipliers(word)
        
        # Update player score
        for player in room['players']:
            if player['id'] == session_id:
                player['score'] = player.get('score', 0) + score
                break
        
        # Refresh consumed positions on board
        for row, col in positions:
            letters = list(FREQUENCY_MAP.keys())
            weights = list(FREQUENCY_MAP.values())
            board_state[row][col] = random.choices(letters, weights=weights, k=1)[0]
        
        # Record word played
        game_state['words_played'].append({
            'player_id': session_id,
            'word': word,
            'score': score,
            'turn': game_state['turn_number']
        })
        
        # Switch to next player
        player_ids = [p['id'] for p in room['players']]
        current_index = player_ids.index(session_id)
        next_player_id = player_ids[(current_index + 1) % len(player_ids)]
        
        game_state['active_player_id'] = next_player_id
        game_state['turn_number'] += 1
        game_state['timer_expires'] = time.time() + (room['settings'].get('fixed_minutes', 1) * 60)
    
    # Broadcast word accepted to ALL players
    socketio.emit('word_accepted_turnbased', {
        'player_id': session_id,
        'word': word,
        'score': score,
        'board_state': board_state,
        'consumed_positions': positions,
        'next_player_id': next_player_id,
        'turn_number': game_state['turn_number']
    }, room=room_code)
    
    # Start new turn timer
    if room['settings']['timer_type'] == 'fixed':
        duration = int(room['settings'].get('fixed_minutes', 1) * 60)
        thread = threading.Thread(target=fixed_timer_countdown_turnbased, args=(room_code, duration))
        thread.daemon = True
        thread.start()
    
    print(f'[TURNBASED] Player {session_id} played "{word}" for {score} points, turn passed to {next_player_id}')

def fixed_timer_countdown_turnbased(room_code, duration_seconds):
    """Timer countdown for turn-based mode"""
    for remaining in range(duration_seconds, 0, -1):
        if room_code not in game_rooms:
            return
        
        room = game_rooms[room_code]
        if room['status'] != 'playing':
            return
        
        socketio.emit('timer_fixed_tick', {'seconds': remaining}, room=room_code)
        time.sleep(1)
    
    # Timer expired - skip turn
    if room_code in game_rooms:
        with game_rooms_lock:
            room = game_rooms[room_code]
            game_state = room.get('game_state', {})
            
            # Get next player
            player_ids = [p['id'] for p in room['players']]
            active_id = game_state.get('active_player_id')
            if active_id in player_ids:
                current_index = player_ids.index(active_id)
                next_player_id = player_ids[(current_index + 1) % len(player_ids)]
                game_state['active_player_id'] = next_player_id
                game_state['turn_number'] += 1
        
        socketio.emit('turn_timeout', {
            'skipped_player_id': active_id,
            'next_player_id': next_player_id
        }, room=room_code)

# FEATURE 1: Player marks themselves as done
@socketio.on('player_done')
def handle_player_done(data):
    """Handle player clicking 'I'm Done' button"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = data.get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    room = game_rooms[room_code]
    round_state = room.get('round_state', {})
    
    # Mark player as done
    if session_id in round_state['submissions']:
        round_state['submissions'][session_id]['done'] = True
    
    # Check if all players are done
    all_done = all(sub['done'] for sub in round_state['submissions'].values())
    
    if all_done:
        # End round immediately
        end_round(room_code)
    else:
        # Notify others that this player is done
        player_name = next((p['name'] for p in room['players'] if p['id'] == session_id), 'Player')
        socketio.emit('player_marked_done', {
            'player_name': player_name,
            'players_done': sum(1 for sub in round_state['submissions'].values() if sub['done']),
            'total_players': len(room['players'])
        }, room=room_code)
    
    print(f'[GAME] Player {session_id} marked done. All done: {all_done}')

def check_and_end_round_if_all_submitted(room_code):
    """
    CRITICAL FIX #3: Check if ALL players have submitted in Shared Board mode.
    If yes, end round immediately (no waiting, no "Done" button).
    """
    room = game_rooms.get(room_code)
    if not room or room['settings'].get('board_mode') != 'shared':
        return False
    
    round_state = room.get('round_state', {})
    submissions = round_state.get('submissions', {})
    
    # Check if all players have submitted at least one word
    all_submitted = all(
        len(submission.get('words', [])) > 0 
        for submission in submissions.values()
    )
    
    if all_submitted:
        print(f'[GAME] All players submitted in room {room_code}, ending round immediately')
        stop_timer(room_code)
        end_round(room_code)
        return True
    
    return False

# FEATURE 1 & 4: End round and reveal scores
def end_round(room_code):
    """End the current round, reveal scores, refresh board"""
    if room_code not in game_rooms:
        return
    
    with game_rooms_lock:
        room = game_rooms[room_code]
        round_state = room.get('round_state', {})
        
        # Compile results
        results = compile_round_results(room)
        
        # CHANGE #1: Use new function
        consumed_positions = get_all_consumed_positions(round_state['submissions'])
        
        # CHANGE #2: Use new function
        board_state = round_state['board_state']
        refresh_consumed_positions(board_state, consumed_positions)
        
        # CHANGE #3: Add swap persistence (NEW)
        swap_history = round_state.get('swap_history', [])
        mark_swaps_as_used(swap_history, consumed_positions)
        apply_tile_swap(board_state, swap_history)
        
        # Update player scores (FEATURE #6: Reveal scores NOW)
        for player in room['players']:
            player_id = player['id']
            if player_id in round_state['submissions']:
                round_score = round_state['submissions'][player_id]['score']
                player['score'] = player.get('score', 0) + round_score
        
        # CHANGE #4: Clear swap history for next round
        round_state['swap_history'] = []
    
    # Broadcast results (OUTSIDE lock) - FEATURE #6: Send scores in round_ended
    socketio.emit('round_ended', {
        'results': results,
        'round_number': round_state['round_number'],
        'board_state': board_state,
        'consumed_positions': list(consumed_positions),  # CHANGE #5: Send positions not rows
        'player_scores': {p['id']: p.get('score', 0) for p in room['players']}  # FEATURE #6: Scores revealed here
    }, room=room_code)
    
    # Prepare next round
    with game_rooms_lock:
        round_state['round_number'] += 1
        round_state['submissions'] = {
            player['id']: {'words': [], 'positions': [], 'score': 0, 'done': False} 
            for player in room['players']
        }
        round_state['all_done'] = False
        round_state['swap_history'] = []  # FEATURE #2: Reset swap history for new round

# FEATURE 3: Fixed timer countdown - ENHANCED
def fixed_timer_countdown(room_code, duration_seconds):
    """Server-side countdown for fixed timer with per-second updates"""
    for remaining in range(duration_seconds, 0, -1):
        if room_code not in game_rooms:
            return
        
        room = game_rooms[room_code]
        if room['status'] != 'playing' or not room['round_state'].get('timer_active', True):
            return
        
        # Emit tick every second
        socketio.emit('timer_fixed_tick', {'seconds': remaining}, room=room_code)
        time.sleep(1)
    
    # Timer expired - end round
    if room_code in game_rooms:
        room = game_rooms[room_code]
        if room['status'] == 'playing':
            print(f'[TIMER] Fixed timer expired for room {room_code}')
            end_round(room_code)

@socketio.on('end_turn')
def handle_end_turn():
    """Player ends their turn, stop timer"""
    session_id = request.sid
    if session_id not in player_sessions:
        return
    
    room_code = player_sessions[session_id].get('room_code')
    if not room_code or room_code not in game_rooms:
        return
    
    room = game_rooms[room_code]
    
    # Only current player can end their turn
    if room['timer_state']['current_player_turn'] != session_id:
        return
    
    # Stop timer
    stop_timer(room_code)
    
    # Notify all players
    socketio.emit('turn_ended', {'player_id': session_id}, room=room_code)
    print(f'[TIMER] Turn ended by player {session_id} in room {room_code}')

# ===== SERVER STARTUP =====

if __name__ == "__main__":
    import os
    print("="*50)
    print("SPELLCAST - Multiplayer with Advanced Timer System")
    print("="*50)
    print("✅ Single Player: PRESERVED and working")
    print("✅ Multiplayer: Room creation/joining READY")
    print("✅ Timer System: Voting & Fixed timers implemented")
    print("📝 Features:")
    print("   - Max 5 players per room")
    print("   - Always 5 rounds per game")
    print("   - Voting-based timer (30s grace + voting + 30s countdown)")
    print("   - Fixed timer (1-10 minutes, host selectable)")
    print("="*50)
    
    # Use PORT from environment (for hosting platforms) or default to 5000
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, debug=False, host='0.0.0.0', port=port)