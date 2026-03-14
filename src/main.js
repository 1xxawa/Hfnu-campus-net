const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const state = {
    isLoggingIn: false,
    isLoggingOut: false,
    waitLoginInterval: null,
    waitLoginDotCount: 0,
    announcements: [],
    readAnnouncements: [],
    announcementsFetched: false,
    latestVersionInfo: null,
    themeColor: '#333',
    loginOpacity: 100,
    logoutOpacity: 100,
    borderRadius: 0,
};

const $ = (id) => document.getElementById(id);

const elements = {
    loginForm: $('loginForm'),
    studentId: $('studentId'),
    password: $('password'),
    operator: $('operator'),
    savePassword: $('savePassword'),
    autoLogin: $('autoLogin'),
    autoLaunch: $('autoLaunch'),
    hideOnStartup: $('hideOnStartup'),
    loginBtn: $('loginBtn'),
    logoutBtn: $('logoutBtn'),
    statusIndicator: $('statusIndicator'),
    statusLabel: $('statusLabel'),
    localIp: $('localIp'),
    currentTime: $('currentTime'),
    logContent: $('logContent'),
    logModal: $('logModal'),
    logCloseBtn: $('logCloseBtn'),
    logToggle: $('logToggle'),
    themeBtn: $('themeBtn'),
    themeModal: $('themeModal'),
    themeCloseBtn: $('themeCloseBtn'),
    themeColorPicker: $('themeColorPicker'),
    loginOpacitySlider: $('loginOpacitySlider'),
    loginOpacityValue: $('loginOpacityValue'),
    logoutOpacitySlider: $('logoutOpacitySlider'),
    logoutOpacityValue: $('logoutOpacityValue'),
    radiusSlider: $('radiusSlider'),
    radiusValue: $('radiusValue'),
    themeCancelBtn: $('themeCancelBtn'),
    themeConfirmBtn: $('themeConfirmBtn'),
    togglePassword: $('togglePassword'),
    closeBtn: $('closeBtn'),
    announcementBtn: $('announcementBtn'),
    announcementDot: $('announcementDot'),
    announcementModal: $('announcementModal'),
    announcementList: $('announcementList'),
    announcementCloseBtn: $('announcementCloseBtn'),
    markAllReadBtn: $('markAllReadBtn'),
    announcementConfirmBtn: $('announcementConfirmBtn'),
    announcementDetailModal: $('announcementDetailModal'),
    announcementDetailTitle: $('announcementDetailTitle'),
    announcementDetailBody: $('announcementDetailBody'),
    announcementAuthor: $('announcementAuthor'),
    announcementDetailCloseBtn: $('announcementDetailCloseBtn'),
    announcementDetailConfirmBtn: $('announcementDetailConfirmBtn'),
    updateModal: $('updateModal'),
    updateMessage: $('updateMessage'),
    versionInfo: $('versionInfo'),
    currentVersion: $('currentVersion'),
    latestVersion: $('latestVersion'),
    updateProgress: $('updateProgress'),
    updateProgressBar: $('updateProgressBar'),
    updateProgressText: $('updateProgressText'),
    cancelBtn: $('cancelBtn'),
    updateBtn: $('updateBtn'),
    restartBtn: $('restartBtn'),
    errorModal: $('errorModal'),
    errorMessage: $('errorMessage'),
    errorCloseBtn: $('errorCloseBtn'),
    errorConfirmBtn: $('errorConfirmBtn'),
};

function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-message">${message}</span>`;
    elements.logContent.appendChild(entry);
    elements.logContent.scrollTop = elements.logContent.scrollHeight;
    
    while (elements.logContent.children.length > 100) {
        elements.logContent.removeChild(elements.logContent.firstChild);
    }
}

function updateStatus(status, text) {
    elements.statusIndicator.className = `status-indicator ${status}`;
    elements.statusLabel.textContent = text;
}

function setButtonLoading(btn, loading) {
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

async function checkNetworkStatus() {
    updateStatus('checking', '检测中...');
    try {
        const isOnline = await invoke('check_network_status');
        if (isOnline) {
            updateStatus('online', '网络已连接');
        } else {
            updateStatus('offline', '网络未连接');
        }
        return isOnline;
    } catch (error) {
        updateStatus('offline', '检测失败');
        return false;
    }
}

async function saveConfig() {
    if (!elements.savePassword.checked) return;
    
    const config = {
        student_id: elements.studentId.value,
        password: elements.password.value,
        operator: elements.operator.value,
        auto_login: elements.autoLogin.checked,
        max_retries: 3,
        retry_interval: 3,
        theme_color: state.themeColor,
        border_radius: state.borderRadius,
        login_opacity: state.loginOpacity,
        logout_opacity: state.logoutOpacity,
        hide_on_startup: elements.hideOnStartup ? elements.hideOnStartup.checked : false,
    };
    
    try {
        await invoke('save_config', { config });
    } catch (error) {
        addLog('保存配置失败', 'error');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    if (state.isLoggingIn || state.isLoggingOut) return;
    
    const studentId = elements.studentId.value.trim();
    const password = elements.password.value;
    const operator = elements.operator.value;
    const maxRetries = 3;
    const retryInterval = 3;
    
    if (!studentId || !password) {
        addLog('请填写学号和密码', 'error');
        return;
    }
    
    state.isLoggingIn = true;
    setButtonLoading(elements.loginBtn, true);
    addLog(`正在登录 ${studentId}@${operator}`, 'info');
    
    try {
        await saveConfig();
        
        const result = await invoke('login_with_retry', {
            studentId,
            password,
            operator,
            maxRetries,
            retryInterval,
        });
        
        if (result.success) {
            addLog(result.message, 'success');
            
            if (result.need_verify) {
                await verifyNetworkStatus();
            } else {
                updateStatus('online', '网络已连接');
            }
            
            fetchAnnouncementsAsync();
        } else {
            addLog(result.message, 'error');
            updateStatus('offline', '网络未连接');
        }
    } catch (error) {
        addLog(`登录出错: ${error}`, 'error');
        updateStatus('offline', '登录失败');
    } finally {
        state.isLoggingIn = false;
        setButtonLoading(elements.loginBtn, false);
    }
}

async function verifyNetworkStatus() {
    try {
        const isOnline = await invoke('check_network_status');
        if (isOnline) {
            updateStatus('online', '网络已连接');
        } else {
            updateStatus('offline', '网络未连接');
        }
    } catch (error) {
    }
}

async function handleLogout() {
    if (state.isLoggingIn || state.isLoggingOut) return;
    
    state.isLoggingOut = true;
    setButtonLoading(elements.logoutBtn, true);
    addLog('正在断开连接...', 'info');
    
    try {
        const result = await invoke('logout');
        
        if (result.success) {
            addLog(result.message, 'success');
            updateStatus('offline', '网络未连接');
        } else {
            addLog(result.message, 'warning');
        }
    } catch (error) {
        addLog(`断开连接出错: ${error}`, 'error');
    } finally {
        state.isLoggingOut = false;
        setButtonLoading(elements.logoutBtn, false);
    }
}

async function handleAutoLaunchChange(e) {
    const enabled = e.target.checked;
    try {
        await invoke('set_auto_launch', { enable: enabled });
        addLog(enabled ? '已启用开机自启动' : '已关闭开机自启动', 'success');
    } catch (error) {
        e.target.checked = !enabled;
        addLog('设置开机自启动失败', 'error');
    }
}

async function handleHideOnStartupChange(e) {
    const enabled = e.target.checked;
    try {
        await invoke('set_hide_on_startup_command', { enable: enabled });
        addLog(enabled ? '已启用启动时隐藏窗口' : '已关闭启动时隐藏窗口', 'success');
    } catch (error) {
        addLog('设置启动时隐藏窗口失败: ' + error, 'error');
        e.target.checked = !enabled;
    }
}

async function fetchAnnouncementsWithTimeout() {
    try {
        const urls = await invoke('fetch_announcement_list');
        
        if (!urls || urls.length === 0) return [];
        
        const fetchPromises = urls.map(async (url) => {
            let actualUrl = url;
            let isPinned = false;
            
            if (url.startsWith('top|')) {
                isPinned = true;
                actualUrl = url.substring(4);
            }
            
            try {
                const content = await invoke('fetch_announcement_content', { url: actualUrl });
                const parsed = parseAnnouncement(content, actualUrl);
                if (parsed) {
                    parsed.pinned = isPinned;
                    return parsed;
                }
            } catch (e) {
                console.error('Failed to fetch announcement:', actualUrl, e);
            }
            return null;
        });
        
        const results = await Promise.all(fetchPromises);
        
        const fetchedAnnouncements = results.filter(a => a !== null);
        
        fetchedAnnouncements.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return 0;
        });
        
        return fetchedAnnouncements;
    } catch (error) {
        throw error;
    }
}

function parseAnnouncement(content, url) {
    const lines = content.split('\n');
    let title = '';
    let body = [];
    let author = '';
    let inBody = false;
    let inAuthor = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('--') && !inBody && !inAuthor) {
            title = trimmed.substring(2).trim();
            inBody = true;
            continue;
        }
        if (trimmed.startsWith('--') && inBody) {
            inBody = false;
            inAuthor = true;
            author = trimmed.substring(2).trim();
            continue;
        }
        if (inBody) {
            body.push(line);
        }
    }
    
    if (!title) return null;
    
    return {
        id: url,
        title,
        content: body.join('\n').trim(),
        author,
        url
    };
}

function loadReadAnnouncements() {
    try {
        const stored = localStorage.getItem('readAnnouncements');
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveReadAnnouncements() {
    localStorage.setItem('readAnnouncements', JSON.stringify(state.readAnnouncements));
}

function updateAnnouncementDot() {
    const hasUnread = state.announcements.some(a => !state.readAnnouncements.includes(a.id));
    if (hasUnread) {
        elements.announcementDot.classList.add('show');
    } else {
        elements.announcementDot.classList.remove('show');
    }
}

function renderAnnouncementList() {
    if (state.announcements.length === 0) {
        elements.announcementList.innerHTML = '<div class="announcement-empty">暂无公告</div>';
        return;
    }
    
    elements.announcementList.innerHTML = state.announcements.map(a => {
        const isRead = state.readAnnouncements.includes(a.id);
        const pinnedPrefix = a.pinned ? '<span class="pinned-tag">[置顶]</span> ' : '';
        return `
            <div class="announcement-item ${isRead ? '' : 'unread'} ${a.pinned ? 'pinned' : ''}" data-id="${a.id}">
                <svg class="announcement-item-icon ${isRead ? 'read' : 'unread'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${isRead 
                        ? '<path d="M22 4H2v16h20V4z"/><path d="M22 4l-10 7L2 4"/>'
                        : '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'
                    }
                </svg>
                <span class="announcement-item-content">
                    <span class="announcement-item-title ${a.pinned ? 'pinned-title' : ''}">${pinnedPrefix}${escapeHtml(a.title)}</span>
                </span>
                <span class="announcement-item-status ${isRead ? 'read' : 'unread'}">${isRead ? '已读' : '未读'}</span>
            </div>
        `;
    }).join('');
    
    elements.announcementList.querySelectorAll('.announcement-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const announcement = state.announcements.find(a => a.id === id);
            if (announcement) {
                showAnnouncementDetail(announcement);
            }
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<span class="copyable-link" data-url="$1">$1</span>');
}

function showCopyToast(x, y) {
    const toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.textContent = '已复制';
    toast.style.left = x + 'px';
    toast.style.top = y + 'px';
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
    }, 500);
    
    setTimeout(() => {
        toast.remove();
    }, 1500);
}

function showAnnouncementDetail(announcement) {
    elements.announcementDetailTitle.textContent = announcement.title;
    elements.announcementDetailBody.innerHTML = linkify(escapeHtml(announcement.content));
    elements.announcementAuthor.textContent = announcement.author ? `上传人: ${announcement.author}` : '';
    elements.announcementDetailModal.style.display = 'flex';
    
    elements.announcementDetailBody.querySelectorAll('.copyable-link').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const url = link.dataset.url;
            try {
                await navigator.clipboard.writeText(url);
                showCopyToast(e.clientX, e.clientY);
            } catch (err) {
                addLog('复制链接失败', 'error');
            }
        });
    });
    
    if (!state.readAnnouncements.includes(announcement.id)) {
        state.readAnnouncements.push(announcement.id);
        saveReadAnnouncements();
        updateAnnouncementDot();
        renderAnnouncementList();
    }
}

function openAnnouncementModal() {
    elements.announcementModal.style.display = 'flex';
}

function closeAnnouncementModal() {
    elements.announcementModal.style.display = 'none';
}

function closeAnnouncementDetailModal() {
    elements.announcementDetailModal.style.display = 'none';
}

function markAllAsRead() {
    state.announcements.forEach(a => {
        if (!state.readAnnouncements.includes(a.id)) {
            state.readAnnouncements.push(a.id);
        }
    });
    saveReadAnnouncements();
    updateAnnouncementDot();
    renderAnnouncementList();
}

async function fetchAnnouncementsAsync() {
    if (state.announcementsFetched) return;
    state.announcementsFetched = true;
    
    try {
        const fetched = await fetchAnnouncementsWithTimeout();
        state.announcements = fetched;
        updateAnnouncementDot();
        renderAnnouncementList();
    } catch (error) {
        console.error('Failed to fetch announcements:', error);
        elements.announcementList.innerHTML = '<div class="announcement-empty">未获取到公告</div>';
    }
}



async function checkUpdateAsync() {
    try {
        const result = await invoke('check_update');
        if (result) {
            state.latestVersionInfo = result;
            showUpdateModal(result);
        }
    } catch (error) {
        console.error('Check update failed:', error);
    }
}

async function showUpdateModal(info) {
    try {
        elements.currentVersion.textContent = await invoke('get_version');
    } catch {
        elements.currentVersion.textContent = 'v1.0.6';
    }
    elements.latestVersion.textContent = info.version;
    elements.versionInfo.style.display = 'block';
    elements.updateMessage.textContent = info.notes || '发现新版本';
    elements.updateProgress.style.display = 'none';
    elements.cancelBtn.style.display = 'inline-block';
    elements.updateBtn.style.display = 'inline-block';
    elements.restartBtn.style.display = 'none';
    elements.updateModal.style.display = 'flex';
}

function closeUpdateModal() {
    elements.updateModal.style.display = 'none';
}

function showErrorModal(message) {
    elements.errorMessage.textContent = message;
    elements.errorModal.style.display = 'flex';
}

function closeErrorModal() {
    elements.errorModal.style.display = 'none';
}

async function startDownload() {
    if (!state.latestVersionInfo) return;
    
    const url = state.latestVersionInfo.platforms['windows-x86_64'].url;
    
    elements.updateBtn.disabled = true;
    elements.cancelBtn.disabled = true;
    elements.updateMessage.textContent = '正在下载...';
    elements.updateProgress.style.display = 'block';
    
    try {
        const filePath = await invoke('download_update', { url });
        elements.updateMessage.textContent = '下载完成！';
        elements.updateProgress.style.display = 'none';
        elements.cancelBtn.style.display = 'none';
        elements.updateBtn.style.display = 'none';
        elements.restartBtn.style.display = 'inline-block';
        addLog('更新已下载到: ' + filePath, 'success');
    } catch (error) {
        elements.updateMessage.textContent = '下载失败: ' + error;
        elements.updateBtn.disabled = false;
        elements.cancelBtn.disabled = false;
        addLog('下载更新失败: ' + error, 'error');
    }
}

function initAnnouncements() {
    state.readAnnouncements = loadReadAnnouncements();
}

async function updateLocalIp() {
    try {
        const ip = await invoke('get_local_ip');
        elements.localIp.textContent = ip;
    } catch (error) {
        elements.localIp.textContent = '获取失败';
    }
}

async function updateCurrentTime() {
    try {
        const time = await invoke('get_current_time');
        elements.currentTime.textContent = time.split(' ')[1] || time;
    } catch (error) {
        elements.currentTime.textContent = new Date().toLocaleTimeString('zh-CN');
    }
}

function togglePasswordVisibility() {
    const passwordInput = elements.password;
    const eyeIcon = elements.togglePassword.querySelector('.eye-icon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
        passwordInput.type = 'password';
        eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
}

function openThemeModal() {
    elements.themeModal.style.display = 'flex';
    elements.themeColorPicker.value = state.themeColor;
    elements.loginOpacitySlider.value = state.loginOpacity;
    elements.loginOpacityValue.textContent = `${state.loginOpacity}%`;
    elements.logoutOpacitySlider.value = state.logoutOpacity;
    elements.logoutOpacityValue.textContent = `${state.logoutOpacity}%`;
    elements.radiusSlider.value = state.borderRadius;
    elements.radiusValue.textContent = `${state.borderRadius}px`;
}

function closeThemeModal() {
    elements.themeModal.style.display = 'none';
}

function openLogModal() {
    elements.logModal.style.display = 'flex';
}

function closeLogModal() {
    elements.logModal.style.display = 'none';
}

function handleThemeColorChange(e) {
    const selectedColor = e.target.value;
    state.themeColor = selectedColor;
    document.documentElement.style.setProperty('--primary', selectedColor);
    const hoverColor = adjustColorBrightness(selectedColor, -20);
    document.documentElement.style.setProperty('--primary-hover', hoverColor);
    document.documentElement.style.setProperty('--header-bg', selectedColor);
    document.documentElement.style.setProperty('--header-text', '#fff');
    applyButtonColors();
}

function handleLoginOpacityChange(e) {
    state.loginOpacity = parseInt(e.target.value);
    elements.loginOpacityValue.textContent = `${state.loginOpacity}%`;
    applyButtonColors();
}

function handleLogoutOpacityChange(e) {
    state.logoutOpacity = parseInt(e.target.value);
    elements.logoutOpacityValue.textContent = `${state.logoutOpacity}%`;
    applyButtonColors();
}

function applyButtonColors() {
    const themeRgb = hexToRgb(state.themeColor);
    document.documentElement.style.setProperty('--login-color', `rgba(${themeRgb.r}, ${themeRgb.g}, ${themeRgb.b}, ${state.loginOpacity / 100})`);
    document.documentElement.style.setProperty('--logout-color', `rgba(${themeRgb.r}, ${themeRgb.g}, ${themeRgb.b}, ${state.logoutOpacity / 100})`);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 51, g: 51, b: 51 };
}

function adjustColorBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + 
        (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + 
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + 
        (B < 255 ? B < 1 ? 0 : B : 255)
    ).toString(16).slice(1);
}

function handleRadiusChange(e) {
    state.borderRadius = parseInt(e.target.value);
    elements.radiusValue.textContent = `${state.borderRadius}px`;
    document.documentElement.style.setProperty('--radius', `${state.borderRadius}px`);
}

async function applyTheme() {
    await saveConfig();
    closeThemeModal();
    addLog('主题已更新', 'success');
}

function applyThemeSettings() {
    const hoverColor = adjustColorBrightness(state.themeColor, -20);
    document.documentElement.style.setProperty('--primary', state.themeColor);
    document.documentElement.style.setProperty('--primary-hover', hoverColor);
    document.documentElement.style.setProperty('--header-bg', state.themeColor);
    document.documentElement.style.setProperty('--header-text', '#fff');
    document.documentElement.style.setProperty('--radius', `${state.borderRadius}px`);
    applyButtonColors();
}

async function init() {
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });
    
    addLog('程序启动', 'info');
    
    initAnnouncements();
    
    updateLocalIp();
    updateCurrentTime();
    
    invoke('start_network_monitor');
    
    const config = await invoke('load_config');
    const hasConfig = !!config.student_id;
    
    if (hasConfig) {
        elements.studentId.value = config.student_id;
        elements.password.value = config.password || '';
        elements.operator.value = config.operator || 'telecom';
        elements.autoLogin.checked = config.auto_login !== false;
        
        if (config.theme_color) {
            state.themeColor = config.theme_color;
        }
        if (config.border_radius !== null && config.border_radius !== undefined) {
            state.borderRadius = config.border_radius;
        }
        if (config.login_opacity !== null && config.login_opacity !== undefined) {
            state.loginOpacity = config.login_opacity;
        }
        if (config.logout_opacity !== null && config.logout_opacity !== undefined) {
            state.logoutOpacity = config.logout_opacity;
        }
        if (config.hide_on_startup !== null && config.hide_on_startup !== undefined && elements.hideOnStartup) {
            elements.hideOnStartup.checked = config.hide_on_startup;
        }
    }
    
    applyThemeSettings();
    
    if (!config.hide_on_startup) {
        await invoke('show_window');
    }
    
    if (elements.themeColorPicker) {
        elements.themeColorPicker.value = state.themeColor;
    }
    if (elements.radiusSlider) {
        elements.radiusSlider.value = state.borderRadius;
        elements.radiusValue.textContent = `${state.borderRadius}px`;
    }
    if (elements.loginOpacitySlider) {
        elements.loginOpacitySlider.value = state.loginOpacity;
        elements.loginOpacityValue.textContent = `${state.loginOpacity}%`;
    }
    if (elements.logoutOpacitySlider) {
        elements.logoutOpacitySlider.value = state.logoutOpacity;
        elements.logoutOpacityValue.textContent = `${state.logoutOpacity}%`;
    }
    
    invoke('is_auto_launch_enabled').then(isAutoLaunch => {
        elements.autoLaunch.checked = isAutoLaunch;
    }).catch(() => {});
    
    if (hasConfig && elements.autoLogin.checked) {
        const onlineStatus = await checkNetworkStatus();
        if (onlineStatus) {
            fetchAnnouncementsAsync();
            checkUpdateAsync();
        } else {
            updateStatus('waiting', '等待登录界面...');
            
            let retryCount = 0;
            const maxWaitRetry = 60;
            state.waitLoginDotCount = 0;
            
            const checkAndLogin = async () => {
                retryCount++;
                try {
                    const loginPageAvailable = await invoke('check_login_page_available');
                    if (loginPageAvailable) {
                        if (state.waitLoginInterval) {
                            clearInterval(state.waitLoginInterval);
                            state.waitLoginInterval = null;
                        }
                        updateStatus('waiting', '登录界面已就绪...');
                        addLog('登录界面已就绪，自动登录中...', 'info');
                        setTimeout(() => {
                            elements.loginForm.dispatchEvent(new Event('submit'));
                        }, 500);
                    } else if (retryCount < maxWaitRetry) {
                        setTimeout(checkAndLogin, 1000);
                    } else {
                        if (state.waitLoginInterval) {
                            clearInterval(state.waitLoginInterval);
                            state.waitLoginInterval = null;
                        }
                        updateStatus('offline', '无法访问登录界面');
                        addLog('无法访问登录界面，请检查网线是否连接', 'error');
                        showErrorModal('无法访问登录界面，请检查网线是否连接');
                    }
                } catch (error) {
                    if (retryCount < maxWaitRetry) {
                        setTimeout(checkAndLogin, 1000);
                    } else {
                        if (state.waitLoginInterval) {
                            clearInterval(state.waitLoginInterval);
                            state.waitLoginInterval = null;
                        }
                        addLog('检测登录界面失败', 'error');
                        showErrorModal('无法访问登录界面，请检查网线是否连接');
                    }
                }
            };
            
            state.waitLoginInterval = setInterval(() => {
                state.waitLoginDotCount = (state.waitLoginDotCount + 1) % 4;
                const dots = '.'.repeat(state.waitLoginDotCount);
                updateStatus('waiting', `等待登录界面${dots}`);
            }, 500);
            
            setTimeout(checkAndLogin, 1000);
        }
    } else {
        checkNetworkStatus().then(isOnline => {
            if (isOnline) {
                fetchAnnouncementsAsync();
                checkUpdateAsync();
            }
        });
    }
    
    setInterval(updateCurrentTime, 1000);
}

listen('login-retry', (event) => {
    const data = event.payload;
    addLog(data.message, 'warning');
});

listen('tray-login-result', async (event) => {
    const result = event.payload;
    addLog(result.message, result.success ? 'success' : 'error');
    await verifyNetworkStatus();
    await updateLocalIp();
    if (result.success) {
        fetchAnnouncementsAsync();
    }
});

listen('tray-logout-result', async (event) => {
    const result = event.payload;
    addLog(result.message, result.success ? 'success' : 'error');
    await verifyNetworkStatus();
    await updateLocalIp();
});

listen('auto-launch-changed', async (event) => {
    const isEnabled = await invoke('is_auto_launch_enabled');
    elements.autoLaunch.checked = isEnabled;
});

listen('hide-on-startup-changed', async (event) => {
    const enabled = event.payload;
    if (elements.hideOnStartup) {
        elements.hideOnStartup.checked = enabled;
    }
    addLog(enabled ? '已启用启动时隐藏窗口' : '已关闭启动时隐藏窗口', 'success');
});

listen('network-status-changed', async (event) => {
    const { online, initial } = event.payload;
    
    if (initial) {
        if (online) {
            updateStatus('online', '网络已连接');
        } else {
            updateStatus('offline', '网络未连接');
        }
        return;
    }
    
    if (online) {
        updateStatus('online', '网络已连接');
        addLog('网络已恢复连接', 'success');
    } else {
        updateStatus('offline', '网络未连接');
        addLog('网络连接已断开', 'warning');
    }
});

elements.loginForm.addEventListener('submit', handleLogin);
elements.logoutBtn.addEventListener('click', handleLogout);
elements.autoLaunch.addEventListener('change', handleAutoLaunchChange);

if (elements.hideOnStartup) {
    elements.hideOnStartup.addEventListener('change', handleHideOnStartupChange);
}
elements.togglePassword.addEventListener('click', togglePasswordVisibility);

if (elements.logToggle) {
    elements.logToggle.addEventListener('click', openLogModal);
}
if (elements.logCloseBtn) {
    elements.logCloseBtn.addEventListener('click', closeLogModal);
}
if (elements.themeBtn) {
    elements.themeBtn.addEventListener('click', openThemeModal);
}
if (elements.themeCloseBtn) {
    elements.themeCloseBtn.addEventListener('click', closeThemeModal);
}
if (elements.themeColorPicker) {
    elements.themeColorPicker.addEventListener('input', handleThemeColorChange);
}
if (elements.loginOpacitySlider) {
    elements.loginOpacitySlider.addEventListener('input', handleLoginOpacityChange);
}
if (elements.logoutOpacitySlider) {
    elements.logoutOpacitySlider.addEventListener('input', handleLogoutOpacityChange);
}
if (elements.radiusSlider) {
    elements.radiusSlider.addEventListener('input', handleRadiusChange);
}
if (elements.themeCancelBtn) {
    elements.themeCancelBtn.addEventListener('click', closeThemeModal);
}
if (elements.themeConfirmBtn) {
    elements.themeConfirmBtn.addEventListener('click', applyTheme);
}

if (elements.announcementBtn) {
    elements.announcementBtn.addEventListener('click', openAnnouncementModal);
}
if (elements.announcementCloseBtn) {
    elements.announcementCloseBtn.addEventListener('click', closeAnnouncementModal);
}
if (elements.announcementConfirmBtn) {
    elements.announcementConfirmBtn.addEventListener('click', closeAnnouncementModal);
}
if (elements.markAllReadBtn) {
    elements.markAllReadBtn.addEventListener('click', markAllAsRead);
}
if (elements.announcementDetailCloseBtn) {
    elements.announcementDetailCloseBtn.addEventListener('click', closeAnnouncementDetailModal);
}
if (elements.announcementDetailConfirmBtn) {
    elements.announcementDetailConfirmBtn.addEventListener('click', closeAnnouncementDetailModal);
}

if (elements.errorCloseBtn) {
    elements.errorCloseBtn.addEventListener('click', closeErrorModal);
}
if (elements.errorConfirmBtn) {
    elements.errorConfirmBtn.addEventListener('click', closeErrorModal);
}

if (elements.cancelBtn) {
    elements.cancelBtn.addEventListener('click', closeUpdateModal);
}
if (elements.updateBtn) {
    elements.updateBtn.addEventListener('click', startDownload);
}
if (elements.restartBtn) {
    elements.restartBtn.addEventListener('click', closeUpdateModal);
}

if (elements.logModal) {
    elements.logModal.addEventListener('click', (e) => {
        if (e.target === elements.logModal) closeLogModal();
    });
}
if (elements.themeModal) {
    elements.themeModal.addEventListener('click', (e) => {
        if (e.target === elements.themeModal) closeThemeModal();
    });
}
if (elements.announcementModal) {
    elements.announcementModal.addEventListener('click', (e) => {
        if (e.target === elements.announcementModal) closeAnnouncementModal();
    });
}
if (elements.announcementDetailModal) {
    elements.announcementDetailModal.addEventListener('click', (e) => {
        if (e.target === elements.announcementDetailModal) closeAnnouncementDetailModal();
    });
}
if (elements.updateModal) {
    elements.updateModal.addEventListener('click', (e) => {
        if (e.target === elements.updateModal) closeUpdateModal();
    });
}
if (elements.errorModal) {
    elements.errorModal.addEventListener('click', (e) => {
        if (e.target === elements.errorModal) closeErrorModal();
    });
}

listen('download-progress', (event) => {
    const percent = event.payload;
    if (elements.updateProgressBar) {
        elements.updateProgressBar.style.width = percent + '%';
    }
    if (elements.updateProgressText) {
        elements.updateProgressText.textContent = percent + '%';
    }
});

if (elements.closeBtn) {
    elements.closeBtn.addEventListener('click', async () => {
        await invoke('hide_window');
    });
}

init();
