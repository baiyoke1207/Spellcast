// static/game.js - RESTORED FROM BACKUP + BUG FIXES APPLIED
// CRITICAL: File was corrupted (24k of 43k) - now fully restored
// Bug fixes: #1 (10+ freeze), #2 (6-letter message), #3 (rainbow cleanup)

function initGame(initialState, letterScores) {
    let gameState = initialState;
    const LETTER_SCORES = letterScores;
    const GRID_SIZE = 5;

    // Sound effects
    const sounds = {
        tile_select: new Audio('/static/sounds/tile_select.mp3'),
        drag: new Audio('/static/sounds/drag.mp3'),
        change_word: new Audio('/static/sounds/change_word.mp3'),
        swap: new Audio('/static/sounds/swap.mp3')
    };

    function playSound(soundName) {
        if (sounds[soundName]) {
            sounds[soundName].currentTime = 0;
            sounds[soundName].play().catch(e => console.log('Audio play failed:', e));
        }
    }

    // DOM Elements
    const boardElement = document.getElementById('game-board');
    const wordInput = document.getElementById('word-input');
    const messageArea = document.getElementById('message-area');
    const roundDisplay = document.getElementById('round-display');
    const scoreDisplay = document.getElementById('score-display');
    const gemDisplay = document.getElementById('gem-display');
    const foundWordsList = document.getElementById('found-words-list');
    const newGameButton = document.getElementById('new-game-button');
    const currentWordDisplay = document.getElementById('current-word-display');
    const scorePreviewDisplay = document.getElementById('score-preview-display');
    const letterPickerOverlay = document.getElementById('letter-picker-overlay');
    const letterPicker = document.getElementById('letter-picker');
    const hintLoaderOverlay = document.getElementById('hint-loader-overlay');
    const hintPercentage = document.getElementById('hint-percentage');

    // Client-side State
    let isInteracting = false;
    let currentPath = [];
    let potentialPaths = [];
    let interactionMode = 'play';
    let tileIndexToSwap = null;
    let currentScore = gameState.score;
    let currentGems = gameState.gems;
    let hasShimmer = false;

    // Dynamic background gradient follows mouse
    document.body.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        document.body.style.setProperty('--mouse-x', `${x}%`);
        document.body.style.setProperty('--mouse-y', `${y}%`);
    });

    // Parallax tile hover effect
    function addParallaxToTile(tileElement) {
        tileElement.addEventListener('mouseenter', () => {
            tileElement.classList.add('tile-parallax');
        });
        
        tileElement.addEventListener('mouseleave', () => {
            tileElement.classList.remove('tile-parallax');
            tileElement.style.transform = '';
        });
        
        tileElement.addEventListener('mousemove', (e) => {
            if (!tileElement.classList.contains('tile-parallax')) return;
            
            const rect = tileElement.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            const offsetX = ((e.clientX - centerX) / rect.width) * 3;
            const offsetY = ((e.clientY - centerY) / rect.height) * 3;
            
            requestAnimationFrame(() => {
                tileElement.style.transform = `translateY(-2px) translate(${offsetX}px, ${offsetY}px)`;
            });
        });
    }

    function renderBoard() {
        boardElement.innerHTML = '<svg id="path-svg"></svg>';
        if (hasShimmer) {
            boardElement.classList.add('persistent-shimmer');
        } else {
            boardElement.classList.remove('persistent-shimmer');
        }
        
        gameState.board_tiles.forEach((tile, index) => {
            const r = Math.floor(index / GRID_SIZE), c = index % GRID_SIZE;
            const tileElement = document.createElement('div');
            tileElement.classList.add('grid-tile');
            tileElement.dataset.r = r;
            tileElement.dataset.c = c;
            
            // FIX: Sequential animation from top-left to bottom-right
            const animationDelay = (r * GRID_SIZE + c) * 0.05;
            tileElement.style.animationDelay = `${animationDelay}s`;
            
            const letterSpan = document.createElement('span');
            letterSpan.textContent = tile.letter;
            tileElement.appendChild(letterSpan);

            let score = LETTER_SCORES[tile.letter.toUpperCase()] || 0;
            let multiplier = 1;
            if (tile.special === 'DL') multiplier = 2;
            if (tile.special === 'TL') multiplier = 3;
            score *= multiplier;
            
            const scoreIndicator = document.createElement('span');
            scoreIndicator.classList.add('tile-score');
            scoreIndicator.textContent = score;
            tileElement.appendChild(scoreIndicator);
            
            if (tile.special === 'DL') addIndicator(tileElement, 'DL', 'dl');
            if (tile.special === 'TL') addIndicator(tileElement, 'TL', 'tl');
            if (gameState.dp_pos && gameState.dp_pos[0] === r && gameState.dp_pos[1] === c) {
                addIndicator(tileElement, '2x', 'dp');
                tileElement.classList.add('tile-dp');
            }
            if (tile.gem) {
                const gemElement = document.createElement('div');
                gemElement.classList.add('gem');
                gemElement.textContent = '💎';
                tileElement.appendChild(gemElement);
            }
            boardElement.appendChild(tileElement);
            
            // Add parallax effect to each tile
            addParallaxToTile(tileElement);
        });
        addInteractionListeners();
    }
    
    function addIndicator(tileElement, text, className) {
        const indicator = document.createElement('div');
        indicator.classList.add('indicator', `indicator-${className}`);
        indicator.textContent = text;
        tileElement.appendChild(indicator);
    }

    // FIX #3: Word metadata storage
    const wordMetadata = {};
    
    function updateUI() {
        roundDisplay.textContent = gameState.round;
        scoreDisplay.textContent = currentScore;
        gemDisplay.textContent = currentGems;
        
        // FIX #3: Make found words interactive with click handlers
        foundWordsList.innerHTML = '';
        gameState.found_words.forEach(word => {
            const li = document.createElement('li');
            li.style.cursor = 'pointer';
            li.style.transition = 'all 0.2s ease';
            
            const wordText = document.createElement('span');
            wordText.textContent = word.toUpperCase();
            // BUG FIX #4: Restore original font styling
            wordText.style.fontWeight = 'bold';
            wordText.style.fontSize = '1.1em';
            wordText.style.color = '#fbbf24'; // Gold color
            wordText.style.textShadow = '0 0 8px rgba(251, 191, 36, 0.5)';
            
            const pointsBadge = document.createElement('span');
            pointsBadge.style.cssText = `
                float:right;
                background:rgba(16,185,129,0.2);
                color:#10b981;
                padding:2px 8px;
                border-radius:12px;
                font-size:0.85em;
                font-weight:600;
            `;
            // BUG FIX #2: Use uppercase key for consistent lookup
            const wordKey = word.toUpperCase();
            pointsBadge.textContent = wordMetadata[wordKey] ? `+${wordMetadata[wordKey].points}` : '';
            
            li.appendChild(wordText);
            if (pointsBadge.textContent) {
                li.appendChild(pointsBadge);
            }
            
            // Add click handler
            li.addEventListener('click', () => showWordDetails(word));
            
            // Hover effect
            li.addEventListener('mouseenter', () => {
                li.style.background = 'rgba(255,215,0,0.2)';
                li.style.transform = 'translateX(8px)';
            });
            li.addEventListener('mouseleave', () => {
                li.style.background = 'rgba(75, 85, 99, 0.3)';
                li.style.transform = 'translateX(0)';
            });
            
            foundWordsList.appendChild(li);
        });
        
        updateAbilityButtons();

        if (gameState.game_over) {
            wordInput.disabled = true;
            newGameButton.classList.remove('hidden');
            document.querySelectorAll('.ability-button').forEach(b => b.disabled = true);
            showMessage(`Game Over! Final Score: ${gameState.score}`, 'blue');
        }
    }

    function updateAbilityButtons() {
        const shuffleBtn = document.querySelector('.ability-button[data-ability="shuffle"]');
        const swapBtn = document.querySelector('.ability-button[data-ability="swap"]');
        const hintBtn = document.querySelector('.ability-button[data-ability="hint"]');
        
        if (shuffleBtn) shuffleBtn.disabled = currentGems < 1;
        if (swapBtn && interactionMode !== 'swap') swapBtn.disabled = currentGems < 3;
        if (hintBtn) hintBtn.disabled = currentGems < 4;
        
        [shuffleBtn, swapBtn, hintBtn].forEach((btn, idx) => {
            const costs = [1, 3, 4];
            if (btn && currentGems >= costs[idx]) {
                btn.style.boxShadow = '0 0 15px rgba(255, 215, 0, 0.6)';
            } else if (btn) {
                btn.style.boxShadow = '';
            }
            
            // FEATURE #3: Add parallax effect to ability buttons (one-time setup)
            if (btn && !btn.dataset.parallaxAdded) {
                addParallaxToAbilityButton(btn);
                btn.dataset.parallaxAdded = 'true';
            }
        });
    }
    
    // FEATURE #3: Parallax effect for ability buttons
    function addParallaxToAbilityButton(button) {
        button.style.transformStyle = 'preserve-3d';
        button.style.perspective = '1000px';
        
        button.addEventListener('mouseenter', () => {
            button.classList.add('ability-parallax-active');
        });
        
        button.addEventListener('mouseleave', () => {
            button.classList.remove('ability-parallax-active');
            requestAnimationFrame(() => {
                button.style.transform = '';
                button.style.background = '';
            });
        });
        
        button.addEventListener('mousemove', (e) => {
            if (!button.classList.contains('ability-parallax-active')) return;
            
            const rect = button.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            // Calculate offset (±3px movement)
            const offsetX = ((e.clientX - centerX) / rect.width) * 3;
            const offsetY = ((e.clientY - centerY) / rect.height) * 3;
            
            // Calculate rotation (±4deg)
            const rotateX = ((e.clientY - centerY) / rect.height) * -4;
            const rotateY = ((e.clientX - centerX) / rect.width) * 4;
            
            // Calculate gradient position for depth effect
            const gradientX = ((e.clientX - rect.left) / rect.width) * 100;
            const gradientY = ((e.clientY - rect.top) / rect.height) * 100;
            
            requestAnimationFrame(() => {
                button.style.transform = `translate(${offsetX}px, ${offsetY}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                button.style.background = `
                    radial-gradient(circle at ${gradientX}% ${gradientY}%, 
                        rgba(255, 215, 0, 0.2), 
                        transparent 70%),
                    linear-gradient(145deg, #4b5563, #374151)
                `;
            });
        });
    }
    
    // FIX #3: PRONUNCIATION - Enhanced Web Speech API with better quality
    function pronounceWord(word) {
        if ('speechSynthesis' in window) {
            // Cancel any ongoing speech to prevent overlap
            window.speechSynthesis.cancel();
            
            // Wait a moment to ensure cancellation completes
            setTimeout(() => {
                const utterance = new SpeechSynthesisUtterance(word);
                
                // Enhanced settings for better quality
                utterance.rate = 0.85; // Slightly slower for clarity
                utterance.pitch = 1.0; // Natural pitch
                utterance.volume = 1.0; // Full volume
                utterance.lang = 'en-US'; // US English
                
                // Try to use a higher-quality voice if available
                const voices = window.speechSynthesis.getVoices();
                if (voices.length > 0) {
                    // Prefer enhanced/premium voices
                    const preferredVoice = voices.find(v => 
                        (v.lang === 'en-US' || v.lang.startsWith('en-')) && 
                        (v.name.includes('Enhanced') || v.name.includes('Premium') || v.name.includes('Google'))
                    ) || voices.find(v => v.lang === 'en-US' || v.lang.startsWith('en-'));
                    
                    if (preferredVoice) {
                        utterance.voice = preferredVoice;
                    }
                }
                
                // Error handling
                utterance.onerror = (event) => {
                    console.warn('Speech synthesis error:', event.error);
                };
                
                window.speechSynthesis.speak(utterance);
            }, 50); // Small delay to ensure clean cancellation
        } else {
            console.warn('Speech synthesis not supported in this browser');
            showMessage('Speech synthesis not supported in your browser', 'red');
        }
    }
    
    // Load voices when they become available
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {
            // Voices loaded, will be used on next pronunciation
        };
    }
    
    // FEATURE #4: Fetch and display word definition
    async function showWordDefinition(word, listItem) {
        // Remove any existing definition panels
        document.querySelectorAll('.word-definition-panel').forEach(panel => panel.remove());
        
        // Create loading indicator
        const panel = document.createElement('div');
        panel.classList.add('word-definition-panel');
        panel.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            margin-top: 8px;
            background: rgba(17, 24, 39, 0.95);
            border: 2px solid #4b5563;
            border-radius: 8px;
            padding: 12px;
            z-index: 1000;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            animation: fadeIn 0.2s ease;
        `;
        panel.innerHTML = '<p style="margin:0;color:#9ca3af;">Loading definition...</p>';
        listItem.appendChild(panel);
        
        // Fetch definition from Free Dictionary API
        try {
            const definition = await fetchWordDefinition(word);
            
            if (definition) {
                panel.innerHTML = `
                    <div style="color: #f9fafb;">
                        <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 8px;">
                            ${definition.word} ${definition.phonetic ? '<span style="color: #9ca3af; font-weight: normal; font-size: 0.9em;">' + definition.phonetic + '</span>' : ''}
                        </div>
                        <div style="color: #fbbf24; font-size: 0.85em; margin-bottom: 4px; font-style: italic;">
                            ${definition.partOfSpeech}
                        </div>
                        <div style="color: #d1d5db; line-height: 1.5;">
                            ${definition.definition}
                        </div>
                        ${definition.example ? '<div style="color: #9ca3af; font-size: 0.9em; margin-top: 8px; font-style: italic;">"' + definition.example + '"</div>' : ''}
                    </div>
                `;
            } else {
                panel.innerHTML = '<p style="margin:0;color:#ef4444;">Definition not found. Try clicking the speaker icon to hear pronunciation.</p>';
            }
        } catch (error) {
            panel.innerHTML = '<p style="margin:0;color:#ef4444;">Error loading definition. Please try again.</p>';
            console.error('Definition fetch error:', error);
        }
        
        // FIX #2: DEFINITIONS - Only dismiss on explicit close or different word click
        // Removed auto-dismiss on click outside - definitions stay visible
    }
    
    // FEATURE #4: Fetch word definition from Free Dictionary API
    async function fetchWordDefinition(word) {
        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
            
            if (!response.ok) {
                throw new Error('Word not found');
            }
            
            const data = await response.json();
            const entry = data[0];
            
            // Extract first meaning
            const meaning = entry.meanings && entry.meanings[0];
            if (!meaning) return null;
            
            const firstDefinition = meaning.definitions && meaning.definitions[0];
            if (!firstDefinition) return null;
            
            return {
                word: entry.word,
                phonetic: entry.phonetic || (entry.phonetics && entry.phonetics[0] && entry.phonetics[0].text) || '',
                partOfSpeech: meaning.partOfSpeech || 'word',
                definition: firstDefinition.definition || 'No definition available',
                example: firstDefinition.example || ''
            };
        } catch (error) {
            console.error('Failed to fetch definition:', error);
            return null;
        }
    }

    async function setStateAndRender(newState, animationType = null) {
        const previousRound = gameState.round;
        gameState = newState;
        currentScore = newState.score;
        currentGems = newState.gems;
        
        // FIX #1: Clear hint display when advancing to new round
        if (animationType !== 'shuffle' && previousRound !== undefined && previousRound < newState.round) {
            const hintDisplay = document.getElementById('hint-display');
            if (hintDisplay) {
                hintDisplay.style.display = 'none';
            }
            await showRoundTransition(newState.round);
        }

        renderBoard();
        updateUI();
    }
    
    async function showRoundTransition(round) {
        const transition = document.createElement('div');
        transition.classList.add('round-transition');
        
        const ripple = document.createElement('div');
        ripple.classList.add('ripple');
        transition.appendChild(ripple);
        
        const title = document.createElement('h1');
        title.textContent = `Round ${round}`;
        transition.appendChild(title);
        
        document.body.appendChild(transition);
        await new Promise(resolve => setTimeout(() => {
            transition.remove();
            resolve();
        }, 1500));
    }
    
    async function displayPlayedWordCenter(word, scoreAdded) {
        const len = word.length;
        
        // FIX #1: Create separate containers for word and message to prevent overlap
        const container = document.createElement('div');
        container.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            z-index:1000;pointer-events:none;
            display:flex;flex-direction:column;align-items:center;gap:20px;
        `;
        
        // Word display (separate element)
        const wordDisplay = document.createElement('div');
        wordDisplay.style.cssText = `
            font-size:5em;font-weight:900;
            color:#ffd700;
            text-shadow:0 0 40px rgba(255,215,0,1), 0 0 80px rgba(255,215,0,0.8), 0 4px 6px rgba(0,0,0,0.8);
            -webkit-text-stroke: 2px #4c1d95;
            letter-spacing: 0.1em;
            transform: scale(0);
        `;
        wordDisplay.textContent = word.toUpperCase();
        
        // Enhanced message system for all tiers
        const messages = {
            6: { text: 'Excellent!', color: '#ffffff' },
            7: { text: 'Amazing!', color: '#ffd700' },
            8: { text: 'SPECTACULAR!', color: '#ff1493' },
            9: { text: 'LEGENDARY!', color: '#00ffff' },
            10: { text: 'GOD-LIKE!', color: '#c0c0c0' },
            11: { text: 'MYTHICAL!', color: '#c0c0c0' },
            12: { text: 'TRANSCENDENT!', color: 'linear-gradient(90deg, #00d4ff, #ff00ff)' },
            13: { text: 'INFINITE!', color: '#ffffff' }
        };
        
        let messageText = '';
        let messageColor = '#fff';
        
        if (scoreAdded >= 100) {
            messageText = 'ULTIMATE!';
            messageColor = '#c0c0c0'; // Platinum/silver
        } else if (len >= 6) {
            const msg = messages[len] || messages[13];
            messageText = msg.text;
            messageColor = msg.color;
        }
        
        // Message display (separate element, positioned BELOW word)
        let msgElement = null;
        if (messageText) {
            msgElement = document.createElement('div');
            msgElement.style.cssText = `
                font-size:1.8em;font-weight:700;
                color:${messageColor};
                text-shadow:0 0 20px ${messageColor === '#c0c0c0' ? 'rgba(192,192,192,0.8)' : 'rgba(255,255,255,0.8)'};
                -webkit-text-stroke: 1px #4c1d95;
                opacity:0;
            `;
            msgElement.textContent = messageText;
        }
        
        // Glow sweep effect on word
        const glowSweep = document.createElement('div');
        glowSweep.style.cssText = `
            position:absolute;top:0;left:-100%;width:100%;height:100%;
            background:linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent);
            animation: glowSweep 1.5s ease-in-out;
            pointer-events:none;
        `;
        wordDisplay.appendChild(glowSweep);
        
        // Assemble container
        container.appendChild(wordDisplay);
        if (msgElement) {
            container.appendChild(msgElement);
        }
        
        document.body.appendChild(container);
        
        // FIX BUG #1: Add tracking class and disable pointer events
        const overlay = document.createElement('div');
        overlay.classList.add('word-animation-overlay');
        overlay.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background-color:rgba(0,0,0,0.85);z-index:999;opacity:0;
            transition:opacity 0.3s ease;pointer-events:none;
        `;
        document.body.appendChild(overlay);
        
        setTimeout(() => overlay.style.opacity = '1', 10);
        
        // Animate word
        wordDisplay.style.transition = 'transform 0.6s cubic-bezier(0.68,-0.55,0.265,1.55)';
        setTimeout(() => wordDisplay.style.transform = 'scale(1)', 10);
        
        // Animate message with delay
        if (msgElement) {
            msgElement.style.transition = 'opacity 0.4s ease';
            setTimeout(() => msgElement.style.opacity = '1', 300);
        }
        
        // FIX BUG #1: Wrap in try-catch to prevent freezing
        try {
            await applyLongWordEffects(len, wordDisplay, scoreAdded);
        } catch (error) {
            console.error('Animation error:', error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Fade out both word and message
        container.style.transition = 'opacity 0.4s ease';
        container.style.opacity = '0';
        overlay.style.opacity = '0';
        
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // FIX BUG #1: Force cleanup with existence checks
        if (container && container.parentNode) {
            container.remove();
        }
        if (overlay && overlay.parentNode) {
            overlay.remove();
        }
        // Remove any stuck overlays
        document.querySelectorAll('.word-animation-overlay').forEach(el => el.remove());
    }

    async function applyLongWordEffects(len, wordDisplay, scoreAdded) {
    // Check for 100+ point ULTIMATE effect first
    if (scoreAdded >= 100) {
    await createUltimateEffect();
    }
    
    // Individual tiers (6-10) - execute tier-specific effects only
    if (len === 6) {
    // 6 letters: "Excellent!" with white text and subtle rainbow shift
    createRainbowShiftEffect(wordDisplay);
        createStarSparkles(wordDisplay, 20);
    }
    else if (len === 7) {
    // 7 letters: Fireworks
    createFirework();
    createGoldenBurst();
    document.body.style.animation = 'screenShake 0.5s ease';
        setTimeout(() => document.body.style.animation = '', 500);
    }
    else if (len === 8) {
    // 8 letters: "SPECTACULAR!" with realistic confetti
    await createScreenFlash();
    createRealisticConfetti(150);
        createBorderGlow();
    }
    else if (len === 9) {
    // 9 letters: "LEGENDARY!" with electric surge
        createElectricSurge(wordDisplay);
    }
    else if (len === 10) {
    // EXACTLY 10 letters: "GOD-LIKE!" with reality shatter
    await createRealityShatterEnhanced();
        hasShimmer = true;
    }
    // Progressive stacking tiers (11+)
    else if (len === 11) {
        // MYTHICAL: Stack all 6-10 effects + mythical
        await Promise.all([
            createRainbowShiftEffect(wordDisplay),
            createStarSparkles(wordDisplay, 20),
            createFirework(),
            createGoldenBurst(),
            createScreenFlash(),
            createRealisticConfetti(150),
            createBorderGlow(),
            createElectricSurge(wordDisplay),
            createRealityShatterEnhanced(),
            createMythicalEffect(wordDisplay)
        ]);
        document.body.style.animation = 'screenShake 0.5s ease';
        setTimeout(() => document.body.style.animation = '', 500);
        hasShimmer = true;
    }
    else if (len === 12) {
        // TRANSCENDENT: Stack all 6-11 effects + transcendent
        await Promise.all([
            createRainbowShiftEffect(wordDisplay),
            createStarSparkles(wordDisplay, 20),
            createFirework(),
            createGoldenBurst(),
            createScreenFlash(),
            createRealisticConfetti(150),
            createBorderGlow(),
            createElectricSurge(wordDisplay),
            createRealityShatterEnhanced(),
            createMythicalEffect(wordDisplay),
            createTranscendentEffect(wordDisplay)
        ]);
        document.body.style.animation = 'screenShake 0.5s ease';
        setTimeout(() => document.body.style.animation = '', 500);
        hasShimmer = true;
    }
    else if (len >= 13) {
        // INFINITE: Stack all 6-12 effects + infinite
        await Promise.all([
            createRainbowShiftEffect(wordDisplay),
            createStarSparkles(wordDisplay, 20),
            createFirework(),
            createGoldenBurst(),
            createScreenFlash(),
            createRealisticConfetti(150),
            createBorderGlow(),
            createElectricSurge(wordDisplay),
            createRealityShatterEnhanced(),
            createMythicalEffect(wordDisplay),
            createTranscendentEffect(wordDisplay),
            createInfiniteEffect(wordDisplay)
        ]);
        document.body.style.animation = 'screenShake 0.5s ease';
        setTimeout(() => document.body.style.animation = '', 500);
        hasShimmer = true;
    }
}

    // FIX BUG #3: Rainbow shift with two-stage cleanup
    function createRainbowShiftEffect(wordDisplay) {
        const rainbowOverlay = document.createElement('div');
        rainbowOverlay.classList.add('rainbow-shift-overlay');
        rainbowOverlay.style.cssText = `
            position:absolute;top:0;left:0;width:100%;height:100%;
            background:linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff);
            background-size:200% 100%;
            -webkit-background-clip:text;
            background-clip:text;
            -webkit-text-fill-color:transparent;
            animation:rainbowShift 2s ease-in-out forwards;
            pointer-events:none;
        `;
        rainbowOverlay.textContent = wordDisplay.textContent;
        wordDisplay.appendChild(rainbowOverlay);
        
        // Two-stage cleanup: fade then remove
        setTimeout(() => {
            rainbowOverlay.style.transition = 'opacity 0.3s ease';
            rainbowOverlay.style.opacity = '0';
            setTimeout(() => {
                rainbowOverlay.style.display = 'none';
                if (rainbowOverlay && rainbowOverlay.parentNode) {
                    rainbowOverlay.remove();
                }
            }, 300);
        }, 2000);
    }
    
    // 4-pointed star sparkles for 6-letter words
    function createStarSparkles(parent, count) {
        for (let i = 0; i < count; i++) {
            const star = document.createElement('div');
            const angle = Math.random() * Math.PI * 2;
            const distance = 50 + Math.random() * 100;
            const duration = 1 + Math.random() * 0.5;
            
            star.innerHTML = '✦';
            star.style.cssText = `
                position:absolute;
                left:50%;top:50%;
                font-size:${12 + Math.random() * 8}px;
                color:#ffffff;
                text-shadow:0 0 8px rgba(255,255,255,0.8);
                pointer-events:none;
                z-index:10;
                transform:translate(-50%,-50%);
            `;
            parent.appendChild(star);
            
            // Animate using Web Animations API for precise control
            const endX = Math.cos(angle) * distance;
            const endY = Math.sin(angle) * distance;
            
            star.animate([
                {transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1},
                {transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) scale(0) rotate(360deg)`, opacity: 0}
            ], {
                duration: duration * 1000,
                delay: Math.random() * 300,
                easing: 'ease-out',
                fill: 'forwards'
            });
        }
    }

    function createFirework() {
        const colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position:fixed;width:10px;height:10px;
                background-color:${colors[Math.floor(Math.random()*colors.length)]};
                border-radius:50%;left:50%;top:50%;z-index:9999;
            `;
            document.body.appendChild(particle);
            
            const angle = (Math.PI * 2 * i) / 50;
            const velocity = 250 + Math.random() * 150;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            
            particle.animate([
                {transform:'translate(-50%,-50%)',opacity:1},
                {transform:`translate(calc(-50% + ${vx}px),calc(-50% + ${vy}px))`,opacity:0}
            ],{duration:1200,easing:'ease-out'}).onfinish = () => particle.remove();
        }
    }

    function createGoldenBurst() {
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position:fixed;width:8px;height:8px;
                background-color:#ffd700;border-radius:50%;
                left:50%;top:50%;z-index:9999;
                box-shadow:0 0 10px #ffd700;
            `;
            document.body.appendChild(particle);
            
            const angle = Math.random() * Math.PI * 2;
            const velocity = 100 + Math.random() * 100;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            
            particle.animate([
                {transform:'translate(-50%,-50%) scale(1)',opacity:1},
                {transform:`translate(calc(-50% + ${vx}px),calc(-50% + ${vy}px)) scale(0)`,opacity:0}
            ],{duration:800,easing:'ease-out'}).onfinish = () => particle.remove();
        }
    }

    async function createScreenFlash() {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background-color:white;z-index:9998;opacity:0;
        `;
        document.body.appendChild(flash);
        
        flash.style.transition = 'opacity 0.1s ease';
        setTimeout(() => flash.style.opacity = '1', 10);
        await new Promise(resolve => setTimeout(resolve, 150));
        flash.style.opacity = '0';
        setTimeout(() => flash.remove(), 200);
    }

    // Realistic falling confetti with continuous rotation
    function createRealisticConfetti(count) {
        const colors = ['#ffd700', '#4169e1', '#ff0000', '#00ff00', '#ff1493', '#00ffff'];
        for (let i = 0; i < count; i++) {
            const confetti = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = 8 + Math.random() * 6;
            const startX = Math.random() * 100;
            const endX = startX + (Math.random() - 0.5) * 20;
            const duration = 3000 + Math.random() * 2000;
            const rotationSpeed = 2 + Math.random() * 3;
            
            confetti.style.cssText = `
                position:fixed;
                width:${size}px;
                height:${size}px;
                background-color:${color};
                left:${startX}%;
                top:-20px;
                z-index:9999;
                animation:confettiRotate ${rotationSpeed}s linear infinite;
            `;
            document.body.appendChild(confetti);
            
            confetti.animate([
                {transform:'translateY(0)', opacity:1},
                {transform:`translate(${endX - startX}vw, ${window.innerHeight + 40}px)`, opacity:0.7}
            ], {duration: duration, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'}).onfinish = () => confetti.remove();
        }
    }

    function createBorderGlow() {
        const glow = document.createElement('div');
        glow.style.cssText = `
            position:fixed;top:0;left:0;right:0;bottom:0;
            border:8px solid #ffd700;
            pointer-events:none;z-index:9999;
            animation:borderGlow 2s ease-in-out;
        `;
        document.body.appendChild(glow);
        setTimeout(() => glow.remove(), 2000);
    }

    // Electric surge effect with SVG filter
    function createElectricSurge(wordDisplay) {
        // Create SVG filter for electric distortion
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;width:0;height:0;';
        svg.innerHTML = `
            <defs>
                <filter id="electricSurge">
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="1">
                        <animate attributeName="baseFrequency" 
                            values="0.05;0.15;0.05" 
                            dur="0.3s" 
                            repeatCount="5"/>
                    </feTurbulence>
                    <feDisplacementMap in="SourceGraphic" scale="15"/>
                </filter>
            </defs>
        `;
        document.body.appendChild(svg);
        
        // Apply filter to word
        wordDisplay.style.filter = 'url(#electricSurge) drop-shadow(0 0 20px #00ffff)';
        
        // Add electric glow around word
        for (let i = 0; i < 12; i++) {
            const bolt = document.createElement('div');
            const angle = (i / 12) * 360;
            bolt.style.cssText = `
                position:absolute;
                width:4px;
                height:${40 + Math.random() * 80}px;
                background:linear-gradient(180deg, #00ffff, #ffffff, transparent);
                box-shadow:0 0 20px #00ffff, 0 0 40px #00ffff;
                left:50%;
                top:50%;
                transform:translate(-50%, -50%) rotate(${angle}deg);
                transform-origin:center ${-50 - Math.random() * 30}px;
                animation:electricBolt 0.2s ease-in-out ${i * 0.05}s;
                opacity:0;
                pointer-events:none;
            `;
            wordDisplay.appendChild(bolt);
        }
        
        // Remove filter and cleanup after effect
        setTimeout(() => {
            wordDisplay.style.filter = '';
            svg.remove();
        }, 1500);
    }

    // ULTIMATE effect for 100+ point words
    async function createUltimateEffect() {
        // Create overlay for color inversion
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            z-index:9998;pointer-events:none;
            filter:invert(1);
            opacity:0;
            transition:opacity 0.2s ease;
        `;
        
        // Clone visible content for inversion effect
        const content = document.getElementById('game-container');
        const clone = content.cloneNode(true);
        overlay.appendChild(clone);
        document.body.appendChild(overlay);
        
        // Fade in inversion
        setTimeout(() => overlay.style.opacity = '1', 10);
        
        // Hold inverted state
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Flash effect
        const flash = document.createElement('div');
        flash.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background:radial-gradient(circle, rgba(255,255,255,0.8), rgba(200,200,255,0.4));
            z-index:9999;opacity:0;
            transition:opacity 0.15s ease;
        `;
        document.body.appendChild(flash);
        setTimeout(() => flash.style.opacity = '1', 10);
        
        // Return to normal
        setTimeout(() => {
            overlay.style.opacity = '0';
            flash.style.opacity = '0';
        }, 150);
        
        // Create stardust particles
        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                const x = Math.random() * 100;
                const size = 3 + Math.random() * 4;
                particle.style.cssText = `
                    position:fixed;
                    left:${x}%;
                    bottom:-10px;
                    width:${size}px;
                    height:${size}px;
                    background:radial-gradient(circle, #ffffff, #ffd700);
                    border-radius:50%;
                    box-shadow:0 0 ${size * 2}px rgba(255,215,0,0.8);
                    z-index:9999;
                    animation:stardustRise ${4 + Math.random() * 3}s ease-out forwards;
                    animation-delay:${Math.random() * 0.5}s;
                `;
                document.body.appendChild(particle);
                setTimeout(() => particle.remove(), 8000);
            }, i * 30);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        overlay.remove();
        flash.remove();
    }
    
    // 11 Letters - MYTHICAL Tier
    async function createMythicalEffect(wordDisplay) {
        // Chromatic aberration on word
        wordDisplay.style.animation = 'chromaticShift 2s ease-in-out infinite';
        
        // Time dilation pulse
        const dilationOverlay = document.createElement('div');
        dilationOverlay.style.cssText = `
            position:absolute;top:0;left:0;width:100%;height:100%;
            animation:timeDilation 2s ease-in-out infinite;
            pointer-events:none;
        `;
        dilationOverlay.textContent = wordDisplay.textContent;
        wordDisplay.appendChild(dilationOverlay);
        
        // Rainbow wave sweep across screen
        const rainbowWave = document.createElement('div');
        rainbowWave.style.cssText = `
            position:fixed;
            top:0;
            left:0;
            width:100%;
            height:100%;
            background:linear-gradient(90deg, 
                transparent 0%, 
                #ff0000 10%, 
                #ff7f00 20%, 
                #ffff00 30%, 
                #00ff00 40%, 
                #0000ff 50%, 
                #8b00ff 60%, 
                #ff0000 70%, 
                transparent 100%);
            opacity:0.6;
            z-index:9998;
            pointer-events:none;
            animation:rainbowWaveSweep 2s ease-in-out;
        `;
        document.body.appendChild(rainbowWave);
        
        // Cleanup after 2 seconds
        setTimeout(() => {
            wordDisplay.style.animation = '';
            dilationOverlay.remove();
            rainbowWave.remove();
        }, 2000);
    }

    // 12 Letters - TRANSCENDENT Tier
    async function createTranscendentEffect(wordDisplay) {
        // Kaleidoscope hue rotation on word
        wordDisplay.style.animation = 'kaleidoscope 3s linear infinite';
        
        // Cascading prismatic waves from center
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.style.cssText = `
                    position:fixed;
                    left:${centerX}px;
                    top:${centerY}px;
                    width:100px;
                    height:100px;
                    border:8px solid transparent;
                    border-image:linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff, #ff0000) 1;
                    border-radius:50%;
                    transform:translate(-50%, -50%) scale(0);
                    animation:prismaticExpand 2s ease-out forwards;
                    pointer-events:none;
                    z-index:9999;
                    box-shadow:0 0 30px rgba(255,255,255,0.8);
                `;
                document.body.appendChild(wave);
                setTimeout(() => wave.remove(), 2000);
            }, i * 150);
        }
        
        // Board crystallization overlay
        const crystalOverlay = document.createElement('div');
        crystalOverlay.style.cssText = `
            position:absolute;
            top:0;
            left:0;
            width:100%;
            height:100%;
            background:repeating-linear-gradient(
                45deg,
                rgba(255,255,255,0.1) 0px,
                rgba(255,255,255,0.1) 10px,
                transparent 10px,
                transparent 20px
            ),
            repeating-linear-gradient(
                -45deg,
                rgba(255,255,255,0.1) 0px,
                rgba(255,255,255,0.1) 10px,
                transparent 10px,
                transparent 20px
            );
            animation:shimmerEffect 2s ease-in-out infinite;
            pointer-events:none;
            z-index:5;
        `;
        boardElement.appendChild(crystalOverlay);
        
        // Full screen particle explosion (300 particles)
        for (let i = 0; i < 300; i++) {
            const particle = document.createElement('div');
            const shapes = ['⭐', '💎', '●'];
            const colors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff', '#ff00ff'];
            const angle = Math.random() * Math.PI * 2;
            const velocity = 200 + Math.random() * 400;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            
            particle.textContent = shapes[Math.floor(Math.random() * shapes.length)];
            particle.style.cssText = `
                position:fixed;
                left:50%;
                top:50%;
                font-size:${12 + Math.random() * 20}px;
                color:${colors[Math.floor(Math.random() * colors.length)]};
                z-index:9999;
                pointer-events:none;
                text-shadow:0 0 10px currentColor;
            `;
            document.body.appendChild(particle);
            
            particle.animate([
                {transform:'translate(-50%, -50%) scale(1) rotate(0deg)', opacity:1},
                {transform:`translate(calc(-50% + ${vx}px), calc(-50% + ${vy}px)) scale(0) rotate(${Math.random() * 720}deg)`, opacity:0}
            ], {duration:2000 + Math.random() * 1000, easing:'ease-out'}).onfinish = () => particle.remove();
        }
        
        // Cleanup after 4 seconds
        setTimeout(() => {
            wordDisplay.style.animation = '';
            crystalOverlay.remove();
        }, 4000);
    }

    // 13+ Letters - INFINITE Tier
    async function createInfiniteEffect(wordDisplay) {
        // Reality break overlay with fractal noise
        const realityBreak = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;width:0;height:0;';
        svg.innerHTML = `
            <defs>
                <filter id="fractalNoise">
                    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="5" seed="2">
                        <animate attributeName="baseFrequency" 
                            values="0.02;0.08;0.02" 
                            dur="3s" 
                            repeatCount="indefinite"/>
                    </feTurbulence>
                    <feColorMatrix type="hueRotate">
                        <animate attributeName="values" 
                            from="0" 
                            to="360" 
                            dur="6s" 
                            repeatCount="indefinite"/>
                    </feColorMatrix>
                    <feBlend in="SourceGraphic" mode="overlay"/>
                </filter>
            </defs>
        `;
        realityBreak.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.4);
            filter:url(#fractalNoise);
            opacity:0.7;
            z-index:9997;
            pointer-events:none;
        `;
        realityBreak.appendChild(svg);
        document.body.appendChild(realityBreak);
        
        // Matrix rain effect (50 columns)
        for (let col = 0; col < 50; col++) {
            const column = document.createElement('div');
            column.style.cssText = `
                position:fixed;
                left:${(col / 50) * 100}%;
                top:0;
                width:20px;
                font-family:monospace;
                font-size:14px;
                color:#00ff41;
                text-shadow:0 0 8px #00ff41;
                line-height:20px;
                z-index:9998;
                pointer-events:none;
                animation:matrixFall ${3 + Math.random() * 2}s linear infinite;
                animation-delay:${Math.random() * 2}s;
            `;
            
            // Generate random letters
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (let i = 0; i < 30; i++) {
                const char = document.createElement('div');
                char.textContent = letters[Math.floor(Math.random() * letters.length)];
                char.style.opacity = Math.random();
                column.appendChild(char);
            }
            
            document.body.appendChild(column);
            setTimeout(() => column.remove(), 8000);
        }
        
        // Holographic tiles on board
        const tiles = document.querySelectorAll('.grid-tile');
        tiles.forEach(tile => {
            tile.style.background = 'linear-gradient(45deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff)';
            tile.style.backgroundSize = '400% 400%';
            tile.style.animation = 'rainbowShift 3s ease-in-out infinite';
        });
        
        // Aurora borealis background
        const aurora = document.createElement('div');
        aurora.style.cssText = `
            position:absolute;
            top:0;
            left:0;
            width:100%;
            height:100%;
            background:linear-gradient(90deg, 
                rgba(0,255,255,0.3) 0%, 
                rgba(255,0,255,0.3) 25%, 
                rgba(255,255,0,0.3) 50%, 
                rgba(0,255,255,0.3) 75%, 
                rgba(255,0,255,0.3) 100%);
            background-size:200% 100%;
            animation:auroraWave 6s ease-in-out infinite;
            pointer-events:none;
            z-index:1;
            opacity:0.6;
        `;
        boardElement.appendChild(aurora);
        
        // Animated glowing message
        wordDisplay.style.animation = 'kaleidoscope 2s linear infinite, timeDilation 3s ease-in-out infinite';
        
        // Cleanup after 6 seconds
        setTimeout(() => {
            realityBreak.remove();
            wordDisplay.style.animation = '';
            aurora.remove();
            tiles.forEach(tile => {
                tile.style.background = '';
                tile.style.backgroundSize = '';
                tile.style.animation = '';
            });
        }, 6000);
    }

    // ADVANCED FEATURE #2: TWO-PHASE REALITY SHATTER
    // Phase 1: Crack lines (SVG paths)
    // Phase 2: Glass pieces break apart (polygon animation)
    async function createRealityShatterEnhanced() {
        await createRealityShatterWithGlassBreak();
    }
    
    // REALISTIC REALITY SHATTER with SVG path-based cracks + GLASS BREAK ANIMATION
    async function createRealityShatterWithGlassBreak() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            z-index: 9999; pointer-events: none;
        `;
        
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        // Generate realistic crack paths with branching
        const crackPaths = [];
        
        // Create 10-12 main crack lines radiating from center
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            const length = 200 + Math.random() * 400;
            
            // Start path from center with slight random offset
            let pathData = `M ${centerX + (Math.random() - 0.5) * 20} ${centerY + (Math.random() - 0.5) * 20}`;
            
            // Add jagged segments with branching
            let currentX = centerX;
            let currentY = centerY;
            const segments = 6 + Math.floor(Math.random() * 8);
            
            for (let j = 0; j < segments; j++) {
                const segmentLength = length / segments;
                const deviation = (Math.random() - 0.5) * 60; // Random zigzag
                
                currentX += Math.cos(angle) * segmentLength + deviation;
                currentY += Math.sin(angle) * segmentLength + deviation;
                
                pathData += ` L ${currentX} ${currentY}`;
                
                // Add branch cracks (30% chance per segment)
                if (Math.random() < 0.3) {
                    const branchAngle = angle + (Math.random() - 0.5) * Math.PI / 3;
                    const branchLength = segmentLength * (0.3 + Math.random() * 0.4);
                    const branchX = currentX + Math.cos(branchAngle) * branchLength;
                    const branchY = currentY + Math.sin(branchAngle) * branchLength;
                    crackPaths.push(`M ${currentX} ${currentY} L ${branchX} ${branchY}`);
                }
            }
            
            crackPaths.push(pathData);
        }
        
        // Create paths and animate them
        crackPaths.forEach((pathData, i) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('stroke', 'rgba(255,255,255,0.8)');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('filter', 'drop-shadow(0 0 6px rgba(255,255,255,0.8))');
            
            const pathLength = path.getTotalLength();
            path.style.strokeDasharray = pathLength;
            path.style.strokeDashoffset = pathLength;
            
            svg.appendChild(path);
            
            // Animate crack drawing with varying speed
            const duration = i < 10 ? 150 : 100; // Main cracks vs branches
            const delay = i * 50; // Stagger effect
            
            setTimeout(() => {
                path.style.transition = `stroke-dashoffset ${duration}ms ease-out`;
                path.style.strokeDashoffset = '0';
            }, delay);
        });
        
        document.body.appendChild(svg);
        
        // FEATURE #1 FIX: Add proper cleanup to glass distortion overlay
        setTimeout(() => {
            const overlay = document.createElement('div');
            overlay.classList.add('crack-shimmer-overlay'); // Add class for tracking
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: linear-gradient(45deg, 
                    transparent 30%, 
                    rgba(255,255,255,0.1) 50%, 
                    transparent 70%
                );
                background-size: 200% 200%;
                backdrop-filter: blur(1px);
                z-index: 9998; pointer-events: none;
                opacity: 0;
                animation: crackShimmer 1.2s ease-in-out forwards;
            `;
            document.body.appendChild(overlay);
            
            // FEATURE #1 FIX: Proper cleanup using animationend event
            overlay.addEventListener('animationend', () => {
                console.log('[DEBUG] Crack shimmer animation ended');
                overlay.style.opacity = '0';
                overlay.style.pointerEvents = 'none';
                setTimeout(() => {
                    if (overlay && overlay.parentNode) {
                        overlay.remove();
                        console.log('[DEBUG] Shimmer overlay removed from DOM');
                    }
                }, 100);
            });
            
            // Fallback cleanup
            setTimeout(() => {
                if (overlay && overlay.parentNode) {
                    overlay.remove();
                    console.log('[DEBUG] Fallback: Shimmer overlay removed');
                }
            }, 2000);
        }, 800);
        
        // Wait for crack animation to complete before starting shatter
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // FEATURE #2: PHASE 2 - GLASS SHATTER ANIMATION
        await animateGlassShatter(centerX, centerY);
        
        // Cleanup SVG after both phases
        setTimeout(() => {
            if (svg && svg.parentNode) {
                svg.remove();
                console.log('[DEBUG] Reality shatter SVG removed');
            }
        }, 2000);
        
        // Enable persistent shimmer on board
        boardElement.classList.add('persistent-shimmer');
    }
    
    // FEATURE #2: Glass Shatter Animation - Phase 2
    async function animateGlassShatter(centerX, centerY) {
        console.log('[DEBUG] Starting glass shatter animation');
        
        // Create container for glass pieces
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 9997;
            pointer-events: none;
        `;
        document.body.appendChild(container);
        
        // Generate polygon pieces (15-25 pieces)
        const pieceCount = 20;
        const pieces = [];
        
        // Create Voronoi-style polygon tessellation
        for (let i = 0; i < pieceCount; i++) {
            const piece = document.createElement('div');
            
            // Random polygon shape
            const size = 60 + Math.random() * 80;
            const sides = 5 + Math.floor(Math.random() * 3); // 5-7 sides
            
            // Position relative to center with some spread
            const angleOffset = (Math.random() - 0.5) * Math.PI / 2;
            const distFromCenter = Math.random() * 200;
            const pieceAngle = (i / pieceCount) * Math.PI * 2 + angleOffset;
            const startX = centerX + Math.cos(pieceAngle) * distFromCenter;
            const startY = centerY + Math.sin(pieceAngle) * distFromCenter;
            
            // Create polygon clip-path
            let clipPath = 'polygon(';
            for (let j = 0; j < sides; j++) {
                const angle = (j / sides) * Math.PI * 2;
                const x = 50 + Math.cos(angle) * 50;
                const y = 50 + Math.sin(angle) * 50;
                clipPath += `${x}% ${y}%`;
                if (j < sides - 1) clipPath += ', ';
            }
            clipPath += ')';
            
            piece.style.cssText = `
                position: absolute;
                left: ${startX}px;
                top: ${startY}px;
                width: ${size}px;
                height: ${size}px;
                background: linear-gradient(135deg, rgba(255,255,255,0.3), rgba(255,255,255,0.1));
                backdrop-filter: blur(2px);
                clip-path: ${clipPath};
                transform: translate(-50%, -50%);
                box-shadow: inset 0 0 20px rgba(255,255,255,0.5),
                           0 0 10px rgba(255,255,255,0.3);
            `;
            
            container.appendChild(piece);
            pieces.push({element: piece, startX, startY});
        }
        
        // Animate each piece flying outward
        const animations = pieces.map((pieceData, i) => {
            const { element, startX, startY } = pieceData;
            
            // Calculate direction away from center
            const angle = Math.atan2(startY - centerY, startX - centerX);
            const distance = 300 + Math.random() * 400;
            const endX = Math.cos(angle) * distance;
            const endY = Math.sin(angle) * distance;
            
            // Random rotation
            const rotation = (Math.random() - 0.5) * 720;
            
            // Animate using Web Animations API
            return element.animate([
                {
                    transform: 'translate(-50%, -50%) rotate(0deg)',
                    opacity: 1,
                    filter: 'blur(0px)'
                },
                {
                    transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) rotate(${rotation}deg)`,
                    opacity: 0,
                    filter: 'blur(4px)'
                }
            ], {
                duration: 1000,
                delay: i * 30,
                easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                fill: 'forwards'
            });
        });
        
        // Wait for all animations to complete
        await Promise.all(animations.map(anim => anim.finished));
        
        // Cleanup
        container.remove();
        console.log('[DEBUG] Glass shatter complete, container removed');
    }

    // FIXED: Gem flight animation - animates ORIGINAL gem elements
    async function animateGemFlight(submittedPath, gemsCollected) {
        if (gemsCollected === 0) return;
        
        // Get destination coordinates from the gem counter icon
        const gemCounterRect = gemDisplay.getBoundingClientRect();
        const targetX = gemCounterRect.left + gemCounterRect.width / 2;
        const targetY = gemCounterRect.top + gemCounterRect.height / 2;
        
        const promises = [];
        
        for (const [r, c] of submittedPath) {
            const tile = document.querySelector(`[data-r='${r}'][data-c='${c}']`);
            if (!tile) continue;
            
            const gemElement = tile.querySelector('.gem');
            if (!gemElement) continue;
            
            // STEP 1 & 2: Get starting position BEFORE moving the gem
            const startRect = gemElement.getBoundingClientRect();
            const startX = startRect.left + startRect.width / 2;
            const startY = startRect.top + startRect.height / 2;
            
            // STEP 1: Preserve the gem - move it out of the tile to the body
            document.body.appendChild(gemElement);
            
            // STEP 3: Prepare for flight - set fixed position at starting coordinates
            gemElement.style.position = 'fixed';
            gemElement.style.left = startX + 'px';
            gemElement.style.top = startY + 'px';
            gemElement.style.transform = 'translate(-50%, -50%)';
            gemElement.style.zIndex = '9999';
            gemElement.style.transition = 'all 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            gemElement.style.pointerEvents = 'none';
            
            // STEP 4: Execute the animation
            const promise = new Promise((resolve) => {
                // Small delay to ensure styles are applied
                setTimeout(() => {
                    gemElement.style.left = targetX + 'px';
                    gemElement.style.top = targetY + 'px';
                    gemElement.style.transform = 'translate(-50%, -50%) rotate(720deg) scale(0.5)';
                    gemElement.style.opacity = '0';
                    
                    // Wait for animation to complete
                    setTimeout(() => {
                        gemElement.remove();
                        
                        // Increment counter when gem arrives
                        currentGems++;
                        gemDisplay.textContent = currentGems;
                        gemDisplay.parentElement.style.animation = 'scorePopup 0.3s ease-out';
                        setTimeout(() => gemDisplay.parentElement.style.animation = '', 300);
                        
                        resolve();
                    }, 900);
                }, 50);
            });
            
            promises.push(promise);
            
            // Stagger gem launches
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        await Promise.all(promises);
    }

    /**
     * Score counting animation with green color effect
     * 
     * USER GUIDE - Animation Speed Adjustment:
     * 
     * 1. To adjust overall animation speed:
     *    - Change 'rapidDuration' (line below) to control fast counting speed
     *    - Default: 500ms. Lower = faster counting, Higher = slower counting
     * 
     * 2. To adjust slowdown point:
     *    - Change 'slowdownPoint' variable (line below)
     *    - Default: 10 (last 10 points slow down)
     *    - Set to 5 to slow only the last 5 points
     *    - Set to 15 to slow the last 15 points, etc.
     * 
     * 3. To adjust base delay for slow counting:
     *    - Change 'baseDelay' (line below)
     *    - Default: 75ms. Higher = slower count per point, Lower = faster
     */
    async function animateScoreCount(scoreAdded) {
        if (scoreAdded <= 0) return;
        
        // === USER ADJUSTABLE PARAMETERS ===
        const slowdownPoint = 7;      // Change this: 5 = last 5 points, 10 = last 10 points, etc.
        const rapidDuration = 500;     // Change this: animation time for rapid count (ms)
        const baseDelay = 50;          // Change this: delay multiplier for slow count (ms)
        // ==================================
        
        const fastPoints = Math.max(scoreAdded - slowdownPoint, 0);
        const slowPoints = Math.min(scoreAdded, slowdownPoint);
        
        // Turn score green during animation
        scoreDisplay.style.color = '#10b981';
        scoreDisplay.style.transition = 'color 0.3s ease';
        
        // PHASE 1: Rapid counting using requestAnimationFrame (no bounce)
        if (fastPoints > 0) {
            const startScore = currentScore;
            const start = Date.now();
            
            await new Promise((resolve) => {
                function animate() {
                    const elapsed = Date.now() - start;
                    const progress = Math.min(elapsed / rapidDuration, 1);
                    currentScore = Math.floor(startScore + fastPoints * progress);
                    scoreDisplay.textContent = currentScore;
                    
                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        resolve();
                    }
                }
                animate();
            });
        }
        
        // PHASE 2: Exponential slowdown for last N points (no bounce)
        if (slowPoints > 0) {
            for (let i = 0; i < slowPoints; i++) {
                const delay = baseDelay * Math.pow(1.5, i);
                await new Promise(resolve => {
                    setTimeout(() => {
                        currentScore++;
                        scoreDisplay.textContent = currentScore;
                        // No bounce animation - just update number
                        resolve();
                    }, delay);
                });
            }
        }
        
        // Revert score color back to white after counting completes
        setTimeout(() => {
            scoreDisplay.style.color = '#f9fafb';
        }, 200);
    }

    async function animateShuffleCards() {
        const tiles = Array.from(document.querySelectorAll('.grid-tile'));
        
        tiles.forEach((tile, i) => {
            setTimeout(() => {
                tile.style.animation = 'flipDown 0.3s ease forwards';
            }, i * 20);
        });
        
        await new Promise(resolve => setTimeout(resolve, 600));
        
        tiles.forEach((tile, i) => {
            setTimeout(() => {
                tile.style.animation = 'shuffleToCenter 0.4s ease forwards';
            }, i * 15);
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // FIX #2 & BUG FIX #5: Enhanced message display with auto-clear
    function showMessage(msg, color) {
        messageArea.textContent = msg;
        messageArea.style.color = color === 'green' ? '#10b981' : color === 'red' ? '#ef4444' : '#60a5fa';
        messageArea.style.opacity = '1';
        messageArea.style.visibility = 'visible';
        messageArea.style.fontSize = '1.1em';
        messageArea.style.fontWeight = 'bold';
        
        // Clear previous timeout if exists
        if (window.messageTimeout) {
            clearTimeout(window.messageTimeout);
        }
        
        // Auto-clear after 4 seconds
        window.messageTimeout = setTimeout(() => {
            messageArea.style.opacity = '0';
            setTimeout(() => {
                messageArea.textContent = '\u00A0'; // nbsp
                messageArea.style.visibility = 'hidden'; // BUG FIX #5: Hide completely
            }, 300);
        }, 4000);
    }
    
    // FIX #2 & #3: Show word details popup (prevents flickering)
    async function showWordDetails(word) {
        // Remove any existing popup
        const existingPopup = document.getElementById('word-details-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // Remove any old definition panels in found words list
        document.querySelectorAll('.word-definition-panel').forEach(panel => panel.remove());
        
        // BUG FIX #1: Ensure word key is uppercase and provide default metadata
        const wordKey = word.toUpperCase();
        const metadata = wordMetadata[wordKey] || { 
            points: 0, 
            definition: null, 
            example: null,
            phonetic: null,
            partOfSpeech: null
        };
        
        // Create popup overlay
        const overlay = document.createElement('div');
        overlay.id = 'word-details-popup';
        overlay.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.85);backdrop-filter:blur(5px);
            display:flex;justify-content:center;align-items:center;
            z-index:10000;opacity:0;transition:opacity 0.3s ease;
        `;
        
        // Create popup box
        const popup = document.createElement('div');
        popup.style.cssText = `
            background:linear-gradient(145deg, #1f2937, #111827);
            border:3px solid #ffd700;
            border-radius:20px;padding:30px;max-width:500px;width:90%;
            box-shadow:0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(255,215,0,0.3);
            animation:modalSlideIn 0.4s cubic-bezier(0.68,-0.55,0.265,1.55);
            position:relative;
        `;
        
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            position:absolute;top:15px;right:15px;
            width:35px;height:35px;border:none;
            background:rgba(239,68,68,0.8);color:#fff;
            border-radius:50%;cursor:pointer;font-size:1.3em;font-weight:bold;
            transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;
        `;
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = '#ef4444';
            closeBtn.style.transform = 'scale(1.1) rotate(90deg)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(239,68,68,0.8)';
            closeBtn.style.transform = 'scale(1) rotate(0deg)';
        });
        closeBtn.addEventListener('click', () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        });
        
        // Word title
        const title = document.createElement('h2');
        title.textContent = word.toUpperCase();
        title.style.cssText = `
            margin:0 0 20px 0;color:#ffd700;font-size:2.5em;
            text-align:center;text-shadow:0 0 20px rgba(255,215,0,0.6);
            letter-spacing:3px;
        `;
        
        // Points earned
        const points = document.createElement('div');
        points.style.cssText = `
            text-align:center;font-size:1.3em;color:#10b981;
            font-weight:bold;margin-bottom:25px;
            text-shadow:0 0 10px rgba(16,185,129,0.5);
        `;
        // BUG FIX #2: Ensure correct points value from stored metadata
        const pointValue = wordMetadata[wordKey]?.points || 0;
        points.textContent = `Points Earned: +${pointValue} ✓`;
        
        // Loading indicator
        const loading = document.createElement('div');
        loading.style.cssText = `
            text-align:center;color:#9ca3af;font-style:italic;
            padding:20px;font-size:1.1em;
        `;
        loading.innerHTML = '🔍 Loading definition...';
        
        // Assemble popup
        popup.appendChild(closeBtn);
        popup.appendChild(title);
        popup.appendChild(points);
        popup.appendChild(loading);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        
        // Fade in
        setTimeout(() => overlay.style.opacity = '1', 10);
        
        // BUG FIX #3: Add timeout and error handling for definition fetch
        if (!metadata.definition) {
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => resolve(null), 5000); // 5 second timeout
            });
            
            try {
                const definition = await Promise.race([
                    fetchWordDefinition(word),
                    timeoutPromise
                ]);
                
                if (definition) {
                    // BUG FIX #1: Store with uppercase key
                    if (!wordMetadata[wordKey]) {
                        wordMetadata[wordKey] = metadata;
                    }
                    wordMetadata[wordKey].definition = definition.definition;
                    wordMetadata[wordKey].phonetic = definition.phonetic;
                    wordMetadata[wordKey].partOfSpeech = definition.partOfSpeech;
                    wordMetadata[wordKey].example = definition.example;
                } else {
                    // Timeout - no definition available
                    loading.innerHTML = '<p style="margin:0;color:#9ca3af;font-size:1em;">📚 Definition not available. Try the pronunciation button below!</p>';
                    setTimeout(() => loading.remove(), 100);
                    
                    // Show pronunciation button even without definition
                    const pronounceBtn = document.createElement('button');
                    pronounceBtn.innerHTML = '🔊 Hear Pronunciation';
                    pronounceBtn.style.cssText = `
                        width:100%;margin-top:20px;padding:12px;
                        background:linear-gradient(145deg, #6366f1, #4f46e5);
                        border:2px solid #4f46e5;border-radius:10px;
                        color:#fff;font-size:1.1em;font-weight:600;
                        cursor:pointer;transition:all 0.3s ease;
                    `;
                    pronounceBtn.addEventListener('mouseenter', () => {
                        pronounceBtn.style.background = 'linear-gradient(145deg, #818cf8, #6366f1)';
                        pronounceBtn.style.transform = 'translateY(-2px)';
                    });
                    pronounceBtn.addEventListener('mouseleave', () => {
                        pronounceBtn.style.background = 'linear-gradient(145deg, #6366f1, #4f46e5)';
                        pronounceBtn.style.transform = 'translateY(0)';
                    });
                    pronounceBtn.addEventListener('click', () => pronounceWord(word));
                    popup.appendChild(pronounceBtn);
                    return; // Exit early
                }
            } catch (error) {
                console.error('Definition fetch error:', error);
                loading.innerHTML = '<p style="margin:0;color:#ef4444;font-size:1em;">❌ Error loading definition. Please try again.</p>';
                setTimeout(() => loading.remove(), 100);
                return; // Exit early
            }
        }
        
        // Remove loading, show definition
        loading.remove();
        
        const def = wordMetadata[wordKey];
        if (def.definition) {
            // Phonetic
            if (def.phonetic) {
                const phonetic = document.createElement('div');
                phonetic.style.cssText = `
                    text-align:center;color:#9ca3af;font-size:1.1em;
                    margin-bottom:20px;font-style:italic;
                `;
                phonetic.textContent = def.phonetic;
                popup.insertBefore(phonetic, points.nextSibling);
            }
            
            // Part of speech
            const pos = document.createElement('div');
            pos.style.cssText = `
                color:#fbbf24;font-size:1em;margin-bottom:10px;
                font-weight:600;font-style:italic;
            `;
            pos.textContent = def.partOfSpeech || 'word';
            popup.appendChild(pos);
            
            // Definition
            const defSection = document.createElement('div');
            defSection.style.cssText = `
                background:rgba(75,85,99,0.3);padding:15px;
                border-radius:10px;margin-bottom:15px;border-left:4px solid #ffd700;
            `;
            const defLabel = document.createElement('div');
            defLabel.textContent = 'Definition:';
            defLabel.style.cssText = 'color:#d1d5db;font-weight:600;margin-bottom:8px;font-size:0.95em;';
            const defText = document.createElement('div');
            defText.textContent = def.definition;
            defText.style.cssText = 'color:#f9fafb;line-height:1.6;font-size:1.05em;';
            defSection.appendChild(defLabel);
            defSection.appendChild(defText);
            popup.appendChild(defSection);
            
            // Example sentence
            if (def.example) {
                const exampleSection = document.createElement('div');
                exampleSection.style.cssText = `
                    background:rgba(75,85,99,0.3);padding:15px;
                    border-radius:10px;border-left:4px solid #10b981;
                `;
                const exampleLabel = document.createElement('div');
                exampleLabel.textContent = 'Example:';
                exampleLabel.style.cssText = 'color:#d1d5db;font-weight:600;margin-bottom:8px;font-size:0.95em;';
                const exampleText = document.createElement('div');
                exampleText.textContent = `"${def.example}"`;
                exampleText.style.cssText = 'color:#f9fafb;line-height:1.6;font-style:italic;font-size:1.05em;';
                exampleSection.appendChild(exampleLabel);
                exampleSection.appendChild(exampleText);
                popup.appendChild(exampleSection);
            }
            
            // Pronunciation button
            const pronounceBtn = document.createElement('button');
            pronounceBtn.innerHTML = '🔊 Hear Pronunciation';
            pronounceBtn.style.cssText = `
                width:100%;margin-top:20px;padding:12px;
                background:linear-gradient(145deg, #6366f1, #4f46e5);
                border:2px solid #4f46e5;border-radius:10px;
                color:#fff;font-size:1.1em;font-weight:600;
                cursor:pointer;transition:all 0.3s ease;
            `;
            pronounceBtn.addEventListener('mouseenter', () => {
                pronounceBtn.style.background = 'linear-gradient(145deg, #818cf8, #6366f1)';
                pronounceBtn.style.transform = 'translateY(-2px)';
            });
            pronounceBtn.addEventListener('mouseleave', () => {
                pronounceBtn.style.background = 'linear-gradient(145deg, #6366f1, #4f46e5)';
                pronounceBtn.style.transform = 'translateY(0)';
            });
            pronounceBtn.addEventListener('click', () => pronounceWord(word));
            popup.appendChild(pronounceBtn);
        } else {
            // No definition found
            const noDefMsg = document.createElement('div');
            noDefMsg.style.cssText = `
                text-align:center;color:#ef4444;font-size:1.1em;
                padding:20px;background:rgba(239,68,68,0.1);
                border-radius:10px;border:2px solid rgba(239,68,68,0.3);
            `;
            noDefMsg.textContent = '📚 Definition not available for this word.';
            popup.appendChild(noDefMsg);
        }
        
        // FIX #2: Only close on overlay click or close button - not on panel content click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
            }
        });
        
        // Prevent closing when clicking inside the popup
        popup.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    function addInteractionListeners() {
        boardElement.addEventListener('mousedown', handleInteractionStart);
        boardElement.addEventListener('mouseover', handleInteractionMove);
        document.addEventListener('mouseup', handleInteractionEnd);
        document.addEventListener('keydown', handleGlobalKeyPress);
    }

    function handleGlobalKeyPress(e) {
        if (e.key === 'Enter' && currentPath.length > 0) submitCurrentPath();
    }

    function handleInteractionStart(e) {
        const tile = e.target.closest('.grid-tile');
        if (!tile || interactionMode !== 'play' || potentialPaths.length > 0) return;
        
        if (currentPath.length >= 2) {
            const lastTile = currentPath[currentPath.length - 1];
            const r = parseInt(tile.dataset.r);
            const c = parseInt(tile.dataset.c);
            const isAdjacent = Math.abs(r - lastTile.r) <= 1 && Math.abs(c - lastTile.c) <= 1;
            
            if (!isAdjacent) {
                playSound('change_word');
                isInteracting = true;
                clearSelection();
                addToPath(tile);
                return;
            }
        }
        
        isInteracting = true;
        clearSelection();
        addToPath(tile);
        playSound('tile_select');
    }

    function handleInteractionMove(e) {
        if (!isInteracting) return;
        const tile = e.target.closest('.grid-tile');
        if (tile) addToPath(tile);
    }

    function handleInteractionEnd() { 
        isInteracting = false; 
    }
    
    function addToPath(tileElement) {
        const r = parseInt(tileElement.dataset.r), c = parseInt(tileElement.dataset.c);
        
        if (currentPath.length > 1 && currentPath[currentPath.length - 2].element === tileElement) {
            const lastTile = currentPath.pop();
            lastTile.element.classList.remove('selected');
            playSound('change_word');
        }
        else if (!currentPath.some(p => p.element === tileElement)) {
            const lastTile = currentPath.length > 0 ? currentPath[currentPath.length - 1] : null;
            if (!lastTile || (Math.abs(r - lastTile.r) <= 1 && Math.abs(c - lastTile.c) <= 1)) {
                currentPath.push({ r, c, element: tileElement });
                tileElement.classList.add('selected');
                if (currentPath.length > 1) {
                    playSound('drag');
                }
            }
        }
        updateCurrentWordAndScore();
    }

    function updateCurrentWordAndScore() {
        let word = '', score = 0, wordMultiplier = 1;
        currentPath.forEach(pos => {
            const index = pos.r * GRID_SIZE + pos.c;
            if(index < gameState.board_tiles.length){
                const tile = gameState.board_tiles[index];
                word += tile.letter;
                let letterMultiplier = 1;
                if (tile.special === 'DL') letterMultiplier = 2;
                if (tile.special === 'TL') letterMultiplier = 3;
                if (gameState.dp_pos && gameState.dp_pos[0] === pos.r && gameState.dp_pos[1] === pos.c) wordMultiplier *= 2;
                score += (LETTER_SCORES[tile.letter.toUpperCase()] || 0) * letterMultiplier;
            }
        });
        score *= wordMultiplier;
        if (word.length >= 6) score += 10;
        currentWordDisplay.textContent = word.toUpperCase();
        scorePreviewDisplay.textContent = (word.length > 0) ? `(+${score})` : '';
        drawPathLines();
    }
    
    function drawPathLines() {
        const svg = document.querySelector('#game-board svg');
        if (!svg) return;
        svg.innerHTML = '';
        if (currentPath.length < 2) return;
        for (let i = 1; i < currentPath.length; i++) {
            const prev = currentPath[i-1].element, curr = currentPath[i].element;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', prev.offsetLeft + prev.offsetWidth / 2);
            line.setAttribute('y1', prev.offsetTop + prev.offsetHeight / 2);
            line.setAttribute('x2', curr.offsetLeft + curr.offsetWidth / 2);
            line.setAttribute('y2', curr.offsetTop + curr.offsetHeight / 2);
            svg.appendChild(line);
        }
    }

    function clearSelection() {
        currentPath.forEach(pos => pos.element.classList.remove('selected'));
        currentPath = [];
        potentialPaths = [];
        document.querySelectorAll('.path-highlight').forEach(el => el.remove());
        updateCurrentWordAndScore();
    }

    async function submitCurrentPath() {
        if (currentPath.length === 0) return;
        const word = currentPath.map(p => gameState.board_tiles[p.r * GRID_SIZE + p.c].letter).join('');
        const pathCoords = currentPath.map(p => [p.r, p.c]);
        await submitToServer(word, pathCoords);
    }
    
    async function submitToServer(word, path) {
        const submittedPath = [...path];
        clearSelection();
        wordInput.disabled = true;

        const response = await fetch('/submit-word', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({word: word, path: submittedPath})
        });
        const result = await response.json();

        if (result.valid) {
            // FIX #2 & BUG FIX #5: Show proper feedback message below board
            showMessage(`${word.toUpperCase()} played for +${result.score_added} points!`, 'green');
            
            // BUG FIX #2: Store word metadata IMMEDIATELY with correct points value
            const wordKey = word.toUpperCase();
            wordMetadata[wordKey] = {
                points: result.score_added,
                definition: null, // Will be fetched on demand
                example: null,
                phonetic: null,
                partOfSpeech: null
            };
            
            let gemsCollected = 0;
            submittedPath.forEach(([r, c]) => {
                const tile = document.querySelector(`[data-r='${r}'][data-c='${c}']`);
                if (tile && tile.querySelector('.gem')) gemsCollected++;
            });
            
            submittedPath.forEach((coord, i) => {
                const tile = document.querySelector(`[data-r='${coord[0]}'][data-c='${coord[1]}']`);
                if (tile) {
                    setTimeout(() => {
                        tile.style.animation = 'tileExplode 0.5s ease-out forwards';
                    }, i * 50);
                }
            });

            await new Promise(resolve => setTimeout(resolve, 600));
            
            const wordPromise = displayPlayedWordCenter(word, result.score_added);
            const gemPromise = animateGemFlight(submittedPath, gemsCollected);
            const scorePromise = animateScoreCount(result.score_added);
            
            await Promise.all([wordPromise, gemPromise, scorePromise]);
            
            await setStateAndRender(result.new_state);
            wordInput.disabled = false;
        } else {
            // BUG FIX #5: Ensure proper error message display
            showMessage(result.reason || 'Invalid word!', 'red');
            wordInput.disabled = gameState.game_over;
        }
    }

    async function useAbility(ability, extraData = {}) {
        // FIX #1: HINT - Show loading indicator and handle hint display
        if (ability === 'hint') {
            // Show loading overlay
            const hintLoader = document.getElementById('hint-loader-overlay');
            if (hintLoader) {
                hintLoader.classList.remove('hidden');
            }
        }
        
        const response = await fetch('/use-ability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ability,...extraData})});
        const result = await response.json();
        
        // FIX #1: HINT - Hide loading indicator
        if (ability === 'hint') {
            const hintLoader = document.getElementById('hint-loader-overlay');
            if (hintLoader) {
                hintLoader.classList.add('hidden');
            }
        }
        
        if(result.success){
            if (ability === 'shuffle') {
                showMessage('Shuffling board!', 'blue');
                playSound('swap');
                await animateShuffleCards();
                await setStateAndRender(result.new_state, 'shuffle');
            } else if (ability === 'hint') {
                // FIX #1: HINT - Display hint persistently
                currentGems = result.new_state.gems;
                setStateAndRender(result.new_state);
                
                if (result.hint) {
                    const hintDisplay = document.getElementById('hint-display');
                    const hintWord = document.getElementById('hint-word');
                    const hintScore = document.getElementById('hint-score');
                    
                    if (hintDisplay && hintWord && hintScore) {
                        hintWord.textContent = result.hint.word.toUpperCase();
                        hintScore.textContent = `Score: ${result.hint.path ? calculateHintScore(result.hint.word, result.hint.path) : '?'} pts`;
                        hintDisplay.style.display = 'block';
                        showMessage(`Hint found: ${result.hint.word.toUpperCase()}`, 'green');
                    }
                } else {
                    showMessage('Hint used!', 'green');
                }
            } else {
                if(ability !== 'swap') showMessage(`${ability.charAt(0).toUpperCase()+ability.slice(1)} used!`,'green');
                currentGems = result.new_state.gems;
                setStateAndRender(result.new_state);
            }
        } else {
            showMessage(result.reason,'red');
        }
    }
    
    // FIX #1: Helper function to calculate hint score
    function calculateHintScore(word, path) {
        let base_score = 0;
        let word_multiplier = 1;
        
        path.forEach(([r, c]) => {
            const index = r * GRID_SIZE + c;
            if (index < gameState.board_tiles.length) {
                const tile = gameState.board_tiles[index];
                let letter_multiplier = 1;
                if (tile.special === 'DL') letter_multiplier = 2;
                if (tile.special === 'TL') letter_multiplier = 3;
                if (gameState.dp_pos && gameState.dp_pos[0] === r && gameState.dp_pos[1] === c) word_multiplier *= 2;
                base_score += (LETTER_SCORES[tile.letter.toUpperCase()] || 0) * letter_multiplier;
            }
        });
        
        let final_score = base_score * word_multiplier;
        if (word.length >= 6) final_score += 10;
        return final_score;
    }

    function generateLetterPicker() {
        letterPicker.innerHTML = '';
        for (let i = 65; i <= 90; i++) {
            const letter = String.fromCharCode(i);
            const button = document.createElement('button');
            button.classList.add('letter-picker-button');
            button.textContent = letter;
            letterPicker.appendChild(button);
        }
    }

    function handleTypedWord() {
        console.log('Typed word handler');
    }

    // Event Listeners
    wordInput.addEventListener('keyup', e => { if (e.key === 'Enter') handleTypedWord(); });
    newGameButton.addEventListener('click', () => location.reload());
    
    // ISSUE 6: Fixed swap animation sequence
    document.querySelector('.ability-button[data-ability="swap"]').addEventListener('click', (e) => {
        const button = e.currentTarget;
        interactionMode = (interactionMode === 'swap') ? 'play' : 'swap';
        
        if (interactionMode === 'swap') {
            // Entering swap mode: ALL tiles start pulsing
            showMessage('Swap Mode: Click a tile to change.', 'blue');
            button.innerHTML = 'Cancel Swap';
            document.querySelectorAll('.grid-tile').forEach(tile => {
                tile.classList.add('swap-mode-pulse');
            });
            playSound('swap');
        } else {
            // Exiting swap mode: Stop all pulsing
            showMessage('', 'blue');
            button.innerHTML = '<span class="icon">🔀</span> SWAP (<span class="cost">3💎</span>)';
            document.querySelectorAll('.grid-tile').forEach(tile => {
                tile.classList.remove('swap-mode-pulse');
            });
        }
    });
    
    document.querySelectorAll('.ability-button:not([data-ability="swap"])').forEach(button => {
        button.addEventListener('click', (e) => {
            useAbility(e.currentTarget.dataset.ability);
        });
    });
    
    // ISSUE 6: Swap tile selection with morph animation
    boardElement.addEventListener('click', (e) => {
        const tile = e.target.closest('.grid-tile');
        if (!isInteracting && tile && interactionMode === 'swap') {
            const r = parseInt(tile.dataset.r);
            const c = parseInt(tile.dataset.c);
            tileIndexToSwap = r * GRID_SIZE + c;
            
            // Stop all pulsing when a tile is selected
            document.querySelectorAll('.grid-tile').forEach(t => {
                t.classList.remove('swap-mode-pulse');
            });
            
            letterPickerOverlay.classList.remove('hidden');
        }
    });
    
    // ISSUE 6: Letter picker with morph animation on selected tile
    letterPickerOverlay.addEventListener('click', (e) => {
        const swapButton = document.querySelector('.ability-button[data-ability="swap"]');
        
        if (e.target.classList.contains('letter-picker-button')) {
            const newLetter = e.target.textContent;
            
            // Get the tile element
            const tileElement = document.querySelector(`[data-r='${Math.floor(tileIndexToSwap / GRID_SIZE)}'][data-c='${tileIndexToSwap % GRID_SIZE}']`);
            
            if (tileElement) {
                // Add morph animation class
                tileElement.classList.add('swapping');
                
                // Remove animation class after completion
                setTimeout(() => {
                    tileElement.classList.remove('swapping');
                }, 500);
            }
            
            useAbility('swap', {index: tileIndexToSwap, new_letter: newLetter});
        }
        
        letterPickerOverlay.classList.add('hidden');
        interactionMode = 'play';
        showMessage('');
        if (swapButton) swapButton.innerHTML = '<span class="icon">🔀</span> SWAP (<span class="cost">3💎</span>)';
        document.querySelectorAll('.grid-tile').forEach(tile => {
            tile.classList.remove('swap-mode-pulse');
            tile.classList.remove('swapping');
        });
    });
    
    // Initial Load
    generateLetterPicker();
    renderBoard();
    updateUI();
}
