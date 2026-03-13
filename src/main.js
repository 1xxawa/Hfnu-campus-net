const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let isLoggingIn = false;
let isLoggingOut = false;

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
};

function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-message">${message}</span>`;
    elements.logContent.appendChild(entry);
    elements.logContent.scrollTop = elements.logContent.scrollHeight;
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

async function loadSavedConfig() {
    try {
        const config = await invoke('load_config');
        if (config.student_id) {
            elements.studentId.value = config.student_id;
            elements.password.value = config.password || '';
            elements.operator.value = config.operator || 'telecom';
            elements.autoLogin.checked = config.auto_login !== false;
            
            if (config.theme_color) {
                selectedThemeColor = config.theme_color;
                document.documentElement.style.setProperty('--primary', selectedThemeColor);
                const hoverColor = adjustColorBrightness(selectedThemeColor, -20);
                document.documentElement.style.setProperty('--primary-hover', hoverColor);
                document.documentElement.style.setProperty('--header-bg', selectedThemeColor);
                document.documentElement.style.setProperty('--header-text', '#fff');
                applyButtonColors();
            }
            if (config.border_radius !== null && config.border_radius !== undefined) {
                selectedRadius = config.border_radius;
                document.documentElement.style.setProperty('--radius', `${selectedRadius}px`);
            }
            if (config.login_opacity !== null && config.login_opacity !== undefined) {
                selectedLoginOpacity = config.login_opacity;
                applyButtonColors();
            }
            if (config.logout_opacity !== null && config.logout_opacity !== undefined) {
                selectedLogoutOpacity = config.logout_opacity;
                applyButtonColors();
            }
            if (config.hide_on_startup !== null && config.hide_on_startup !== undefined && elements.hideOnStartup) {
                elements.hideOnStartup.checked = config.hide_on_startup;
            }
            
            addLog('已加载保存的配置', 'info');
            return true;
        }
    } catch (error) {
        addLog('加载配置失败', 'warning');
    }
    return false;
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
        theme_color: selectedThemeColor,
        border_radius: selectedRadius,
        login_opacity: selectedLoginOpacity,
        logout_opacity: selectedLogoutOpacity,
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
    
    if (isLoggingIn || isLoggingOut) return;
    
    const studentId = elements.studentId.value.trim();
    const password = elements.password.value;
    const operator = elements.operator.value;
    const maxRetries = 3;
    const retryInterval = 3;
    
    if (!studentId || !password) {
        addLog('请填写学号和密码', 'error');
        return;
    }
    
    isLoggingIn = true;
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
            updateStatus('online', '网络已连接');
            
            if (result.need_verify) {
                verifyNetworkStatus();
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
        isLoggingIn = false;
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
    if (isLoggingIn || isLoggingOut) return;
    
    isLoggingOut = true;
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
        isLoggingOut = false;
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

let announcements = [];
let readAnnouncements = [];
let announcementsFetched = false;

async function fetchAnnouncementsWithTimeout() {
    const timeout = 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const urls = await invoke('fetch_announcement_list');
        clearTimeout(timeoutId);
        
        if (!urls || urls.length === 0) return [];
        
        const fetchedAnnouncements = [];
        for (const url of urls) {
            try {
                const content = await invoke('fetch_announcement_content', { url });
                const parsed = parseAnnouncement(content, url);
                if (parsed) {
                    fetchedAnnouncements.push(parsed);
                }
            } catch (e) {
                console.error('Failed to fetch announcement:', url, e);
            }
        }
        return fetchedAnnouncements;
    } catch (error) {
        clearTimeout(timeoutId);
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
    localStorage.setItem('readAnnouncements', JSON.stringify(readAnnouncements));
}

function updateAnnouncementDot() {
    const hasUnread = announcements.some(a => !readAnnouncements.includes(a.id));
    if (hasUnread) {
        elements.announcementDot.classList.add('show');
    } else {
        elements.announcementDot.classList.remove('show');
    }
}

function renderAnnouncementList() {
    if (announcements.length === 0) {
        elements.announcementList.innerHTML = '<div class="announcement-empty">暂无公告</div>';
        return;
    }
    
    elements.announcementList.innerHTML = announcements.map(a => {
        const isRead = readAnnouncements.includes(a.id);
        return `
            <div class="announcement-item ${isRead ? '' : 'unread'}" data-id="${a.id}">
                <svg class="announcement-item-icon ${isRead ? 'read' : 'unread'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${isRead 
                        ? '<path d="M22 4H2v16h20V4z"/><path d="M22 4l-10 7L2 4"/>'
                        : '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'
                    }
                </svg>
                <span class="announcement-item-content">
                    <span class="announcement-item-title">${escapeHtml(a.title)}</span>
                </span>
                <span class="announcement-item-status ${isRead ? 'read' : 'unread'}">${isRead ? '已读' : '未读'}</span>
            </div>
        `;
    }).join('');
    
    elements.announcementList.querySelectorAll('.announcement-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const announcement = announcements.find(a => a.id === id);
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
    
    if (!readAnnouncements.includes(announcement.id)) {
        readAnnouncements.push(announcement.id);
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
    announcements.forEach(a => {
        if (!readAnnouncements.includes(a.id)) {
            readAnnouncements.push(a.id);
        }
    });
    saveReadAnnouncements();
    updateAnnouncementDot();
    renderAnnouncementList();
}

async function fetchAnnouncementsAsync() {
    if (announcementsFetched) return;
    announcementsFetched = true;
    
    try {
        const fetched = await fetchAnnouncementsWithTimeout();
        announcements = fetched;
        updateAnnouncementDot();
        renderAnnouncementList();
    } catch (error) {
        console.error('Failed to fetch announcements:', error);
        elements.announcementList.innerHTML = '<div class="announcement-empty">未获取到公告</div>';
    }
}

let latestVersionInfo = null;

async function checkUpdateAsync() {
    try {
        const result = await invoke('check_update');
        if (result) {
            latestVersionInfo = result;
            showUpdateModal(result);
        }
    } catch (error) {
        console.error('Check update failed:', error);
    }
}

function showUpdateModal(info) {
    elements.currentVersion.textContent = 'v1.0.6';
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

async function startDownload() {
    if (!latestVersionInfo) return;
    
    const url = latestVersionInfo.platforms['windows-x86_64'].url;
    
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
    readAnnouncements = loadReadAnnouncements();
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

let selectedThemeColor = '#333';
let selectedLoginOpacity = 100;
let selectedLogoutOpacity = 100;
let selectedRadius = 0;

function openThemeModal() {
    elements.themeModal.style.display = 'flex';
    elements.themeColorPicker.value = selectedThemeColor;
    elements.loginOpacitySlider.value = selectedLoginOpacity;
    elements.loginOpacityValue.textContent = `${selectedLoginOpacity}%`;
    elements.logoutOpacitySlider.value = selectedLogoutOpacity;
    elements.logoutOpacityValue.textContent = `${selectedLogoutOpacity}%`;
    elements.radiusSlider.value = selectedRadius;
    elements.radiusValue.textContent = `${selectedRadius}px`;
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
    selectedThemeColor = selectedColor;
    document.documentElement.style.setProperty('--primary', selectedColor);
    const hoverColor = adjustColorBrightness(selectedColor, -20);
    document.documentElement.style.setProperty('--primary-hover', hoverColor);
    document.documentElement.style.setProperty('--header-bg', selectedColor);
    document.documentElement.style.setProperty('--header-text', '#fff');
    applyButtonColors();
}

function handleLoginOpacityChange(e) {
    selectedLoginOpacity = parseInt(e.target.value);
    elements.loginOpacityValue.textContent = `${selectedLoginOpacity}%`;
    applyButtonColors();
}

function handleLogoutOpacityChange(e) {
    selectedLogoutOpacity = parseInt(e.target.value);
    elements.logoutOpacityValue.textContent = `${selectedLogoutOpacity}%`;
    applyButtonColors();
}

function applyButtonColors() {
    const themeRgb = hexToRgb(selectedThemeColor);
    document.documentElement.style.setProperty('--login-color', `rgba(${themeRgb.r}, ${themeRgb.g}, ${themeRgb.b}, ${selectedLoginOpacity / 100})`);
    document.documentElement.style.setProperty('--logout-color', `rgba(${themeRgb.r}, ${themeRgb.g}, ${themeRgb.b}, ${selectedLogoutOpacity / 100})`);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 51, g: 51, b: 51 };
}

function isColorDark(hex) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
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
    selectedRadius = parseInt(e.target.value);
    elements.radiusValue.textContent = `${selectedRadius}px`;
    document.documentElement.style.setProperty('--radius', `${selectedRadius}px`);
}

function applyTheme() {
    closeThemeModal();
    addLog('主题已更新', 'success');
}

async function init() {
    const initHoverColor = adjustColorBrightness(selectedThemeColor, -20);
    document.documentElement.style.setProperty('--primary', selectedThemeColor);
    document.documentElement.style.setProperty('--primary-hover', initHoverColor);
    document.documentElement.style.setProperty('--header-bg', selectedThemeColor);
    document.documentElement.style.setProperty('--header-text', '#fff');
    applyButtonColors();
    
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });
    
    addLog('程序启动', 'info');
    
    await updateLocalIp();
    await updateCurrentTime();
    initAnnouncements();
    
    const isOnline = await checkNetworkStatus();
    if (isOnline) {
        fetchAnnouncementsAsync();
        checkUpdateAsync();
    }
    
    const hasConfig = await loadSavedConfig();
    
    const config = await invoke('load_config');
    if (!config.hide_on_startup) {
        await invoke('show_window');
    }
    
    if (elements.themeColorPicker) {
        elements.themeColorPicker.value = selectedThemeColor;
    }
    if (elements.radiusSlider) {
        elements.radiusSlider.value = selectedRadius;
        elements.radiusValue.textContent = `${selectedRadius}px`;
    }
    if (elements.loginOpacitySlider) {
        elements.loginOpacitySlider.value = selectedLoginOpacity;
        elements.loginOpacityValue.textContent = `${selectedLoginOpacity}%`;
    }
    if (elements.logoutOpacitySlider) {
        elements.logoutOpacitySlider.value = selectedLogoutOpacity;
        elements.logoutOpacityValue.textContent = `${selectedLogoutOpacity}%`;
    }
    
    try {
        const isAutoLaunch = await invoke('is_auto_launch_enabled');
        elements.autoLaunch.checked = isAutoLaunch;
    } catch (error) {
    }
    
    if (hasConfig && elements.autoLogin.checked) {
        const onlineStatus = await checkNetworkStatus();
        if (!onlineStatus) {
            addLog('等待登录界面可用...', 'info');
            
            let retryCount = 0;
            const maxWaitRetry = 10;
            
            const checkAndLogin = async () => {
                retryCount++;
                try {
                    const loginPageAvailable = await invoke('check_login_page_available');
                    if (loginPageAvailable) {
                        addLog('登录界面已就绪，自动登录中...', 'info');
                        setTimeout(() => {
                            elements.loginForm.dispatchEvent(new Event('submit'));
                        }, 500);
                    } else if (retryCount < maxWaitRetry) {
                        setTimeout(checkAndLogin, 1000);
                    } else {
                        addLog('登录界面不可用，请检查网络连接', 'warning');
                    }
                } catch (error) {
                    if (retryCount < maxWaitRetry) {
                        setTimeout(checkAndLogin, 1000);
                    } else {
                        addLog('检测登录界面失败', 'error');
                    }
                }
            };
            
            setTimeout(checkAndLogin, 1000);
        }
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

if (elements.cancelBtn) {
    elements.cancelBtn.addEventListener('click', closeUpdateModal);
}
if (elements.updateBtn) {
    elements.updateBtn.addEventListener('click', startDownload);
}
if (elements.restartBtn) {
    elements.restartBtn.addEventListener('click', closeUpdateModal);
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
