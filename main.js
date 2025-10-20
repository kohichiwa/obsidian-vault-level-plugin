const { Plugin, Modal, Notice } = require('obsidian');

class VaultLevelTracker extends Plugin {
    async onload() {
        console.log('Loading Vault Level Tracker plugin');

        // Add ribbon icon with trophy icon only
        this.addRibbonIcon('trophy', 'Vault Level', (evt) => {
            this.openLevelModal();
        });

        // Add styles
        this.addStyle();
        
        // Load or initialize data
        this.data = await this.loadData();
        if (!this.data) {
            this.data = this.getDefaultData();
            await this.saveData(this.data);
        }
        
        // Initialize modal reference
        this.currentModal = null;
        
        // Register events for real-time updates
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file.path.endsWith('.md')) {
                    this.scheduleUpdate();
                }
            })
        );
        
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file.path.endsWith('.md')) {
                    this.scheduleUpdate();
                }
            })
        );
        
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file.path.endsWith('.md')) {
                    this.scheduleUpdate();
                }
            })
        );
        
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file.path.endsWith('.md')) {
                    this.scheduleUpdate();
                }
            })
        );
        
        // Initial update
        await this.updateVaultStats();
    }

    getDefaultData() {
        return {
            level: 1,
            currentXP: 0,
            totalXP: 0,
            nextLevelXP: 100,
            streak: 0,
            lastActivityDate: null,
            stats: {
                totalNotes: 0,
                totalConnections: 0,
                totalTags: 0,
                totalWords: 0,
                totalFiles: 0
            },
            lastUpdated: Date.now()
        };
    }

    scheduleUpdate() {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
            this.updateVaultStats();
        }, 500);
    }

    async updateVaultStats() {
        const vault = this.app.vault;
        const metadataCache = this.app.metadataCache;
        
        const files = vault.getMarkdownFiles();
        
        let totalConnections = 0;
        let uniqueTags = new Set();
        let totalWords = 0;
        let hasActivityToday = false;

        const today = new Date();
        const todayStr = today.toDateString();

        console.log('Checking activity for today:', todayStr);

        for (const file of files) {
            try {
                const cache = metadataCache.getFileCache(file);
                const content = await vault.cachedRead(file);
                
                const words = content.split(/\s+/).filter(word => word.length > 0);
                totalWords += words.length;
                
                if (cache && cache.links) {
                    totalConnections += cache.links.length;
                }
                
                // Count tags from YAML frontmatter and inline tags
                if (cache) {
                    // Tags from YAML frontmatter
                    if (cache.frontmatter && cache.frontmatter.tags) {
                        const tags = Array.isArray(cache.frontmatter.tags) 
                            ? cache.frontmatter.tags 
                            : [cache.frontmatter.tags];
                        tags.forEach(tag => uniqueTags.add(tag.toString().toLowerCase().trim()));
                    }
                    
                    // Tags from YAML frontmatter (tag field)
                    if (cache.frontmatter && cache.frontmatter.tag) {
                        const tags = Array.isArray(cache.frontmatter.tag) 
                            ? cache.frontmatter.tag 
                            : [cache.frontmatter.tag];
                        tags.forEach(tag => uniqueTags.add(tag.toString().toLowerCase().trim()));
                    }
                    
                    // Inline tags in content (#tag)
                    if (cache.tags) {
                        cache.tags.forEach(tagObj => {
                            if (tagObj.tag) {
                                uniqueTags.add(tagObj.tag.toLowerCase().trim());
                            }
                        });
                    }
                }

                // Track streak - проверяем created и modified даты
                const stat = vault.getFileStats(file);
                if (stat) {
                    // Проверяем created date
                    if (stat.ctime) {
                        const createdDate = new Date(stat.ctime);
                        if (this.isSameDay(createdDate, today)) {
                            hasActivityToday = true;
                            console.log(`File ${file.path} was created today: ${createdDate}`);
                        }
                    }
                    
                    // Проверяем modified date
                    if (stat.mtime) {
                        const modifiedDate = new Date(stat.mtime);
                        if (this.isSameDay(modifiedDate, today)) {
                            hasActivityToday = true;
                            console.log(`File ${file.path} was modified today: ${modifiedDate}`);
                        }
                    }
                }
            } catch (e) {
                console.log('Could not process file:', file.path, e);
            }
        }

        console.log(`Activity detected today: ${hasActivityToday}`);

        // Update streak
        this.updateStreak(hasActivityToday);

        const oldLevel = this.data.level;
        
        this.data.stats.totalNotes = files.length;
        this.data.stats.totalConnections = totalConnections;
        this.data.stats.totalTags = uniqueTags.size;
        this.data.stats.totalWords = totalWords;
        this.data.stats.totalFiles = files.length;

        this.calculateXP();
        
        await this.saveData(this.data);
        
        if (this.currentModal) {
            this.currentModal.updateContent();
        }
        
        if (this.data.level > oldLevel) {
            new Notice(`🎉 Level Up! You reached level ${this.data.level}`);
        }
    }

    isSameDay(date1, date2) {
        return date1.getDate() === date2.getDate() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getFullYear() === date2.getFullYear();
    }

    updateStreak(hasActivityToday) {
        const today = new Date();
        const todayStr = today.toDateString();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toDateString();
        
        console.log(`Streak update - Today: ${todayStr}, Yesterday: ${yesterdayStr}, Last activity: ${this.data.lastActivityDate}, Current streak: ${this.data.streak}`);

        if (!this.data.lastActivityDate) {
            // First time - start streak if activity today
            if (hasActivityToday) {
                this.data.streak = 1;
                this.data.lastActivityDate = todayStr;
                console.log('Starting new streak: 1');
            } else {
                console.log('No activity today, no streak started');
            }
            return;
        }

        // Если сегодня уже обновляли, ничего не делаем
        if (this.data.lastActivityDate === todayStr) {
            console.log('Already updated streak today');
            return;
        }

        if (hasActivityToday) {
            if (this.data.lastActivityDate === yesterdayStr) {
                // Последовательный день - увеличиваем стрик
                this.data.streak++;
                this.data.lastActivityDate = todayStr;
                console.log(`Consecutive day! Streak increased to: ${this.data.streak}`);
            } else {
                // Проверяем, не пропущен ли только один день
                const lastActivityDate = new Date(this.data.lastActivityDate);
                const daysDiff = Math.floor((today - lastActivityDate) / (1000 * 60 * 60 * 24));
                
                if (daysDiff === 1) {
                    // Пропущен только один день - продолжаем стрик
                    this.data.streak++;
                    this.data.lastActivityDate = todayStr;
                    console.log(`Missed one day, but streak continues: ${this.data.streak}`);
                } else if (daysDiff > 1) {
                    // Пропущено больше одного дня - начинаем заново
                    this.data.streak = 1;
                    this.data.lastActivityDate = todayStr;
                    console.log(`Missed ${daysDiff} days, starting new streak: 1`);
                } else {
                    // Это первый день активности после перерыва
                    this.data.streak = 1;
                    this.data.lastActivityDate = todayStr;
                    console.log('First activity after break, starting new streak: 1');
                }
            }
        } else {
            // Нет активности сегодня
            console.log('No activity today, streak remains:', this.data.streak);
            // Не обновляем lastActivityDate, но и не сбрасываем стрик
        }
    }

    calculateXP() {
        const stats = this.data.stats;
        
        const notesXP = stats.totalNotes * 15;
        const connectionsXP = stats.totalConnections * 8;
        const tagsXP = stats.totalTags * 5;
        const wordsXP = Math.floor(stats.totalWords / 100) * 2;
        
        // Базовый XP
        let baseXP = notesXP + connectionsXP + tagsXP + wordsXP;
        
        // Бонус за стрик (5% за 7+ дней)
        let streakBonus = 0;
        if (this.data.streak >= 7) {
            streakBonus = baseXP * 0.05;
            console.log(`Streak bonus applied: +${streakBonus} XP (${this.data.streak} days)`);
        }
        
        const newTotalXP = baseXP + streakBonus;
        
        // Level calculation
        let level = 1;
        let xpForCurrentLevel = 100;
        let xpLeft = newTotalXP;
        
        while (xpLeft >= xpForCurrentLevel) {
            xpLeft -= xpForCurrentLevel;
            level++;
            xpForCurrentLevel = Math.floor(100 * Math.pow(1.25, level - 1));
        }
        
        this.data.level = level;
        this.data.currentXP = xpLeft;
        this.data.nextLevelXP = xpForCurrentLevel;
        this.data.totalXP = newTotalXP;
    }

    getLevelBadge(level) {
        // Система титулов по диапазонам уровней
        if (level >= 100) {
            return { emoji: '🌀', title: 'Eternal', color: '#8b5cf6' };
        } else if (level >= 90) {
            return { emoji: '🌠', title: 'Transcendent', color: '#ec4899' };
        } else if (level >= 80) {
            return { emoji: '⚛️', title: 'Quantum', color: '#06b6d4' };
        } else if (level >= 70) {
            return { emoji: '🔱', title: 'Titan', color: '#f97316' };
        } else if (level >= 60) {
            return { emoji: '💎', title: 'Diamond', color: '#0ea5e9' };
        } else if (level >= 50) {
            return { emoji: '🌟', title: 'Stellar', color: '#eab308' };
        } else if (level >= 40) {
            return { emoji: '⚡', title: 'Master', color: '#84cc16' };
        } else if (level >= 30) {
            return { emoji: '🔮', title: 'Sage', color: '#a855f7' };
        } else if (level >= 20) {
            return { emoji: '🎓', title: 'Graduate', color: '#f59e0b' };
        } else if (level >= 15) {
            return { emoji: '📚', title: 'Scholar', color: '#ef4444' };
        } else if (level >= 10) {
            return { emoji: '🌿', title: 'Flourishing', color: '#22c55e' };
        } else if (level >= 5) {
            return { emoji: '🍃', title: 'Budding', color: '#16a34a' };
        } else {
            return { emoji: '🌱', title: 'Seedling', color: '#65a30d' };
        }
    }

    hasStreakBonus() {
        return this.data.streak >= 7;
    }

    addStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .vault-level-modal .modal-content {
                padding: 0;
                font-family: var(--font-interface);
                height: 500px;
                overflow: hidden;
            }
            
            .vault-level-container {
                padding: 25px;
                height: 100%;
                display: flex;
                flex-direction: column;
            }
            
            .level-header {
                text-align: center;
                margin-bottom: 25px;
                padding-bottom: 20px;
                border-bottom: 2px solid var(--background-modifier-border);
                flex-shrink: 0;
            }
            
            .level-badge-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
            }
            
            .level-badge {
                font-size: 4em;
                margin-bottom: 5px;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            }
            
            .level-title {
                font-size: 2em;
                font-weight: bold;
                color: var(--text-accent);
                margin-bottom: 5px;
                background: linear-gradient(135deg, var(--color-accent), var(--interactive-accent));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            
            .level-number {
                font-size: 1.3em;
                color: var(--text-muted);
                font-weight: 600;
            }
            
            .progress-section {
                margin-bottom: 20px;
                background: var(--background-secondary);
                padding: 15px;
                border-radius: 12px;
                border: 1px solid var(--background-modifier-border);
                flex-shrink: 0;
            }
            
            .progress-info {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-bottom: 12px;
                font-size: 1em;
                color: var(--text-muted);
                gap: 10px;
            }
            
            .progress-bar-container {
                width: 100%;
                height: 16px;
                background: var(--background-modifier-border);
                border-radius: 8px;
                overflow: hidden;
                position: relative;
            }
            
            .progress-bar-fill {
                height: 100%;
                border-radius: 8px;
                width: 0%;
                position: absolute;
                left: 0;
                top: 0;
                transition: width 0.8s ease-out;
                background: linear-gradient(90deg, var(--color-accent), var(--interactive-accent));
            }
            
            .progress-bar-fill.streak-bonus {
                background: linear-gradient(90deg, #eab308, #f59e0b, #fbbf24);
                animation: goldenGlow 2s ease-in-out infinite alternate;
            }
            
            .stats-container {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                flex: 1;
                align-content: start;
            }
            
            .stat-item {
                background: var(--background-secondary);
                padding: 15px;
                border-radius: 10px;
                text-align: center;
                border: 1px solid var(--background-modifier-border);
                display: flex;
                flex-direction: column;
                justify-content: center;
                min-height: 60px;
                transition: transform 0.2s ease;
            }
            
            .stat-item:hover {
                transform: translateY(-2px);
            }
            
            .stat-value {
                font-size: 1.5em;
                font-weight: bold;
                color: var(--text-accent);
                display: block;
                line-height: 1.2;
            }
            
            .stat-label {
                font-size: 0.85em;
                color: var(--text-muted);
                margin-top: 4px;
            }
            
            .streak-bonus-active {
                color: #eab308 !important;
                font-weight: bold;
            }
            
            .xp-gain {
                text-align: center;
                margin-top: 15px;
                padding: 12px;
                background: linear-gradient(135deg, var(--background-modifier-success), var(--color-accent));
                color: var(--text-on-accent);
                border-radius: 8px;
                font-weight: bold;
                font-size: 1em;
                flex-shrink: 0;
                border: none;
            }

            @keyframes goldenGlow {
                0% {
                    box-shadow: 0 0 5px rgba(234, 179, 8, 0.5);
                }
                100% {
                    box-shadow: 0 0 15px rgba(234, 179, 8, 0.8);
                }
            }

            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-3px); }
            }

            .level-badge {
                animation: float 3s ease-in-out infinite;
            }

            @media (max-width: 480px) {
                .vault-level-container {
                    padding: 20px;
                }
                
                .stats-container {
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                }
                
                .level-badge {
                    font-size: 3.5em;
                }
                
                .level-title {
                    font-size: 1.8em;
                }
                
                .level-number {
                    font-size: 1.1em;
                }
            }
        `;
        document.head.appendChild(style);
    }

    openLevelModal() {
        if (this.currentModal) {
            this.currentModal.close();
        }
        this.currentModal = new LevelModal(this.app, this);
        this.currentModal.open();
    }

    onunload() {
        console.log('Unloading Vault Level Tracker plugin');
        if (this.currentModal) {
            this.currentModal.close();
        }
    }
}

class LevelModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.data = plugin.data;
        this.currentProgress = 0;
    }

    onOpen() {
        this.updateContent();
    }

    updateContent() {
        const {contentEl} = this;
        contentEl.empty();
        contentEl.addClass('vault-level-modal');
        
        const container = contentEl.createDiv('vault-level-container');
        
        // Header with beautiful level badge
        const header = container.createDiv('level-header');
        const badgeContainer = header.createDiv('level-badge-container');
        
        const levelBadge = this.plugin.getLevelBadge(this.data.level);
        badgeContainer.createDiv('level-badge').setText(levelBadge.emoji);
        badgeContainer.createDiv('level-title').setText(levelBadge.title);
        badgeContainer.createDiv('level-number').setText(`Level ${this.data.level}`);
        
        // Progress section
        const progressSection = container.createDiv('progress-section');
        const progressInfo = progressSection.createDiv('progress-info');
        
        // Добавляем информацию о бонусе стрика
        const xpText = progressInfo.createSpan();
        xpText.setText(`${this.formatNumber(this.data.currentXP)}/${this.formatNumber(this.data.nextLevelXP)} XP`);
        
        if (this.plugin.hasStreakBonus()) {
            const bonusText = progressInfo.createSpan();
            bonusText.setText('🔥 +5%');
            bonusText.addClass('streak-bonus-active');
        }
        
        // Progress bar
        const progressContainer = progressSection.createDiv('progress-bar-container');
        this.progressFill = progressContainer.createDiv('progress-bar-fill');
        
        const progressPercent = Math.min((this.data.currentXP / this.data.nextLevelXP) * 100, 100);
        
        // Применяем класс бонуса если стрик >= 7 дней
        if (this.plugin.hasStreakBonus()) {
            this.progressFill.addClass('streak-bonus');
        }
        
        // Плавная анимация прогресс-бара без перезапуска
        this.animateProgressBar(progressPercent);
        
        // Stats grid
        const statsContainer = container.createDiv('stats-container');
        
        this.createStatItem(statsContainer, '📝', 'Notes', this.data.stats.totalNotes);
        this.createStatItem(statsContainer, '🔗', 'Connections', this.data.stats.totalConnections);
        this.createStatItem(statsContainer, '🏷️', 'Tags', this.data.stats.totalTags);
        this.createStatItem(statsContainer, '📖', 'Words', this.formatNumber(this.data.stats.totalWords));
        
        // Отображаем стрик с эмодзи огня если есть бонус
        const streakValue = this.plugin.hasStreakBonus() ? `🔥 ${this.data.streak}` : this.data.streak;
        this.createStatItem(statsContainer, '📅', 'Streak', `${streakValue} days`);
        
        this.createStatItem(statsContainer, '⭐', 'Total XP', this.formatNumber(this.data.totalXP));
        
        const xpInfo = container.createDiv('xp-gain');
        if (this.plugin.hasStreakBonus()) {
            xpInfo.setText('✨ +5% XP Bonus Active! Keep the streak! 🔥');
        } else {
            xpInfo.setText('✨ Keep writing to earn more XP!');
        }
    }

    animateProgressBar(targetPercent) {
        // Плавно анимируем от текущего значения к целевому
        const startPercent = this.currentProgress;
        const duration = 800;
        const startTime = performance.now();
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            const currentPercent = startPercent + (targetPercent - startPercent) * easeOut;
            this.progressFill.style.width = `${currentPercent}%`;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.currentProgress = targetPercent;
            }
        };
        
        requestAnimationFrame(animate);
    }

    createStatItem(container, icon, label, value) {
        const statItem = container.createDiv('stat-item');
        statItem.createSpan('stat-value').setText(`${icon} ${value}`);
        statItem.createDiv('stat-label').setText(label);
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
        this.plugin.currentModal = null;
    }
}

module.exports = VaultLevelTracker;