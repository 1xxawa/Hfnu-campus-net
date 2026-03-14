use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, CheckMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use once_cell::sync::Lazy;

static AUTO_LAUNCH_ITEM: Lazy<Mutex<Option<CheckMenuItem<tauri::Wry>>>> = Lazy::new(|| Mutex::new(None));
static HIDE_ON_STARTUP_ITEM: Lazy<Mutex<Option<CheckMenuItem<tauri::Wry>>>> = Lazy::new(|| Mutex::new(None));

static NETWORK_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("Failed to create network client")
});

static LOGIN_PAGE_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .danger_accept_invalid_certs(true)
        .build()
        .expect("Failed to create login page client")
});

static LOGIN_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .build()
        .expect("Failed to create login client")
});

static GITEE_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .build()
        .expect("Failed to create gitee client")
});

static DOWNLOAD_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .danger_accept_invalid_certs(true)
        .build()
        .expect("Failed to create download client")
});

static NETWORK_STATUS: AtomicBool = AtomicBool::new(false);
static STATUS_MENU_ITEM: Lazy<Mutex<Option<MenuItem<tauri::Wry>>>> = Lazy::new(|| Mutex::new(None));
static NETWORK_MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);
static MANUAL_DISCONNECT: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginConfig {
    pub student_id: String,
    pub password: String,
    pub operator: String,
    pub auto_login: bool,
    pub max_retries: u32,
    pub retry_interval: u32,
    #[serde(default)]
    pub theme_color: Option<String>,
    #[serde(default)]
    pub border_radius: Option<u32>,
    #[serde(default)]
    pub login_opacity: Option<u32>,
    #[serde(default)]
    pub logout_opacity: Option<u32>,
    #[serde(default)]
    pub hide_on_startup: Option<bool>,
}

impl Default for LoginConfig {
    fn default() -> Self {
        Self {
            student_id: String::new(),
            password: String::new(),
            operator: "telecom".to_string(),
            auto_login: true,
            max_retries: 3,
            retry_interval: 3,
            theme_color: None,
            border_radius: None,
            login_opacity: None,
            logout_opacity: None,
            hide_on_startup: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResult {
    pub success: bool,
    pub message: String,
    pub should_retry: bool,
    pub need_verify: bool,
}

fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join("campus-net-login");
    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    app_dir.join("config.json")
}

fn get_key_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join("campus-net-login");
    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    app_dir.join(".key")
}

fn get_or_create_key() -> [u8; 32] {
    let key_path = get_key_path();
    
    if key_path.exists() {
        if let Ok(key_base64) = fs::read_to_string(&key_path) {
            if let Ok(key) = BASE64.decode(key_base64.trim()) {
                if key.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&key);
                    return arr;
                }
            }
        }
    }
    
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    let key_base64 = BASE64.encode(key);
    let _ = fs::write(&key_path, key_base64);
    key
}

fn encrypt_password(password: &str) -> String {
    if password.is_empty() {
        return String::new();
    }
    
    let key = get_or_create_key();
    let cipher = Aes256Gcm::new_from_slice(&key).expect("Invalid key size");
    
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, password.as_bytes()).expect("Encryption failed");
    
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    BASE64.encode(&result)
}

fn decrypt_password(encrypted: &str) -> String {
    if encrypted.is_empty() {
        return String::new();
    }
    
    let key = get_or_create_key();
    let cipher = Aes256Gcm::new_from_slice(&key).expect("Invalid key size");
    
    if let Ok(combined) = BASE64.decode(encrypted) {
        if combined.len() > 12 {
            let (nonce_bytes, ciphertext) = combined.split_at(12);
            let nonce = Nonce::from_slice(nonce_bytes);
            
            if let Ok(decrypted) = cipher.decrypt(nonce, ciphertext) {
                if let Ok(password) = String::from_utf8(decrypted) {
                    return password;
                }
            }
        }
    }
    
    String::new()
}

fn extract_message(response: &str) -> (bool, String, bool, bool) {
    // 第一个bool: success, 第二个bool: need_verify (需要验证网络)
    if response.contains("dr1004") {
        return (true, "已断开连接".to_string(), false, false);
    }
    
    // 检查是否已经在线 - 需要验证网络状态
    if response.contains("已经在线") {
        if let Some(start_idx) = response.find("\"msg\":\"") {
            let start = start_idx + 7;
            if let Some(end_offset) = response[start..].find("\"") {
                let end = start + end_offset;
                let msg = &response[start..end];
                return (true, msg.to_string(), false, true);
            }
        }
        return (true, "账号已在线".to_string(), false, true);
    }
    
    if response.contains("\"result\":1") {
        if let Some(start_idx) = response.find("\"msg\":\"") {
            let start = start_idx + 7;
            if let Some(end_offset) = response[start..].find("\"") {
                let end = start + end_offset;
                let msg = &response[start..end];
                return (true, msg.to_string(), false, false);
            }
        }
        return (true, "操作成功".to_string(), false, false);
    }
    
    if response.contains("\"result\":0") {
        if let Some(start_idx) = response.find("\"msg\":\"") {
            let start = start_idx + 7;
            if let Some(end_offset) = response[start..].find("\"") {
                let end = start + end_offset;
                let msg = &response[start..end];
                let msg_str = msg.to_string();
                
                let no_retry = msg_str.contains("密码错误") 
                    || msg_str.contains("账号不存在")
                    || msg_str.contains("用户不存在")
                    || msg_str.contains("余额不足")
                    || msg_str.contains("账号被锁定")
                    || msg_str.contains("账号已停用")
                    || msg_str.contains("时间策略设置本时段不允许上网")
                    || msg_str.contains("Password Error")
                    || msg_str.contains("Account does not exist");
                
                return (false, msg_str, !no_retry, false);
            }
        }
        return (false, "登录失败".to_string(), true, false);
    }
    
    if let Some(start_idx) = response.find("\"msg\":\"") {
        let start = start_idx + 7;
        if let Some(end_offset) = response[start..].find("\"") {
            let end = start + end_offset;
            let msg = &response[start..end];
            return (false, msg.to_string(), true, false);
        }
    }
    
    (false, "未知响应，请关闭代理工具后重试".to_string(), false, false)
}

#[tauri::command]
async fn get_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "10.230.185.35".to_string())
}

#[tauri::command]
async fn load_config() -> LoginConfig {
    let config_path = get_config_path();
    if config_path.exists() {
        if let Ok(content) = tokio::fs::read_to_string(&config_path).await {
            if let Ok(mut config) = serde_json::from_str::<LoginConfig>(&content) {
                config.password = decrypt_password(&config.password);
                return config;
            }
        }
    }
    LoginConfig::default()
}

#[tauri::command]
async fn save_config(mut config: LoginConfig) -> Result<(), String> {
    let config_path = get_config_path();
    config.password = encrypt_password(&config.password);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    tokio::fs::write(&config_path, content).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_network_status(app: AppHandle) -> bool {
    let is_online = check_network_internal().await;
    
    NETWORK_STATUS.store(is_online, Ordering::SeqCst);
    
    let status = if is_online { "网络已连接" } else { "网络未连接" };
    
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&format!("校园网自动登录 - {}", status)));
    }
    
    if let Some(status_item) = STATUS_MENU_ITEM.lock().unwrap().as_ref() {
        let _ = status_item.set_text(status);
    }
    
    is_online
}

async fn check_network_internal() -> bool {
    let urls = vec![
        "http://connect.rom.miui.com/generate_204",
        "http://www.gstatic.com/generate_204",
        "http://www.baidu.com",
    ];
    
    for url in urls {
        match NETWORK_CLIENT.get(url).timeout(std::time::Duration::from_secs(3)).send().await {
            Ok(resp) => {
                let status = resp.status();
                
                // 204 No Content 表示网络连接正常
                if status == 204 {
                    return true;
                }
                
                // 200 OK 也表示网络连接正常
                if status == 200 {
                    return true;
                }
            }
            Err(_) => continue
        }
    }
    
    false
}

#[tauri::command]
async fn start_network_monitor(app: AppHandle) -> Result<(), String> {
    if NETWORK_MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    
    let app_handle = app.clone();
    let app_handle_periodic = app.clone();
    
    // 定期检测任务（异步，每30秒检测一次）
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        interval.tick().await;
        
        loop {
            interval.tick().await;
            
            let current_online = check_network_internal().await;
            let prev_online = NETWORK_STATUS.load(Ordering::SeqCst);
            
            if current_online != prev_online {
                NETWORK_STATUS.store(current_online, Ordering::SeqCst);
                
                let status = if current_online { "网络已连接" } else { "网络未连接" };
                
                if let Some(tray) = app_handle_periodic.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some(&format!("校园网自动登录 - {}", status)));
                }
                
                if let Some(status_item) = STATUS_MENU_ITEM.lock().unwrap().as_ref() {
                    let _ = status_item.set_text(status);
                }
                
                if !current_online && !MANUAL_DISCONNECT.load(Ordering::SeqCst) {
                    show_notification(&app_handle_periodic, "网络断开", "网络连接已断开，请检查网络");
                }
                
                if current_online {
                    MANUAL_DISCONNECT.store(false, Ordering::SeqCst);
                }
                
                let _ = app_handle_periodic.emit("network-status-changed", serde_json::json!({ "online": current_online, "initial": false }));
            }
        }
    });
    
    // 事件驱动检测任务（Windows 使用 NotifyAddrChange）
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            use std::ptr;
            use winapi::um::iphlpapi::NotifyAddrChange;
            use winapi::um::handleapi::CloseHandle;
            use winapi::um::synchapi::WaitForSingleObject;
            use winapi::um::winbase::INFINITE;
            
            let mut prev_online = check_network_status_sync();
            NETWORK_STATUS.store(prev_online, Ordering::SeqCst);
            let _ = app_handle.emit("network-status-changed", serde_json::json!({ "online": prev_online, "initial": true }));
            
            loop {
                let mut handle: winapi::shared::ntdef::HANDLE = ptr::null_mut();
                let ret = unsafe { NotifyAddrChange(&mut handle, ptr::null_mut()) };
                
                if ret != 0 {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    continue;
                }
                
                unsafe {
                    WaitForSingleObject(handle, INFINITE);
                    CloseHandle(handle);
                }
                
                std::thread::sleep(std::time::Duration::from_millis(500));
                
                let current_online = check_network_status_sync();
                
                if current_online != prev_online {
                    prev_online = current_online;
                    
                    NETWORK_STATUS.store(current_online, Ordering::SeqCst);
                    
                    let status = if current_online { "网络已连接" } else { "网络未连接" };
                    
                    if let Some(tray) = app_handle.tray_by_id("main") {
                        let _ = tray.set_tooltip(Some(&format!("校园网自动登录 - {}", status)));
                    }
                    
                    if let Some(status_item) = STATUS_MENU_ITEM.lock().unwrap().as_ref() {
                        let _ = status_item.set_text(status);
                    }
                    
                    if !current_online && !MANUAL_DISCONNECT.load(Ordering::SeqCst) {
                        show_notification(&app_handle, "网络断开", "网络连接已断开，请检查网络");
                    }
                    
                    if current_online {
                        MANUAL_DISCONNECT.store(false, Ordering::SeqCst);
                    }
                    
                    let _ = app_handle.emit("network-status-changed", serde_json::json!({ "online": current_online, "initial": false }));
                }
            }
        }
        
        #[cfg(not(windows))]
        {
            let mut prev_online = check_network_status_sync();
            NETWORK_STATUS.store(prev_online, Ordering::SeqCst);
            let _ = app_handle.emit("network-status-changed", serde_json::json!({ "online": prev_online, "initial": true }));
            
            loop {
                std::thread::sleep(std::time::Duration::from_secs(10));
                
                let current_online = check_network_status_sync();
                
                if current_online != prev_online {
                    prev_online = current_online;
                    NETWORK_STATUS.store(current_online, Ordering::SeqCst);
                    
                    if !current_online && !MANUAL_DISCONNECT.load(Ordering::SeqCst) {
                        show_notification(&app_handle, "网络断开", "网络连接已断开，请检查网络");
                    }
                    
                    if current_online {
                        MANUAL_DISCONNECT.store(false, Ordering::SeqCst);
                    }
                    
                    let _ = app_handle.emit("network-status-changed", serde_json::json!({ "online": current_online, "initial": false }));
                }
            }
        }
    });
    
    Ok(())
}

fn check_network_status_sync() -> bool {
    let urls = vec![
        "http://connect.rom.miui.com/generate_204",
        "http://www.gstatic.com/generate_204",
        "http://www.baidu.com",
    ];
    
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok();
    
    if let Some(client) = client {
        for url in urls {
            if let Ok(resp) = client.get(url).send() {
                let status = resp.status();
                if status == 204 || status == 200 {
                    return true;
                }
            }
        }
    }
    
    false
}

#[tauri::command]
async fn check_login_page_available() -> bool {
    match LOGIN_PAGE_CLIENT.get("http://192.168.180.3/").send().await {
        Ok(resp) => {
            if resp.status() == 200 {
                if let Ok(text) = resp.text().await {
                    let check_len = text.len().min(1024);
                    return text[..check_len].contains("登录") 
                        || text[..check_len].contains("eportal") 
                        || text[..check_len].contains("校园");
                }
            }
            false
        }
        Err(_) => false
    }
}

#[tauri::command]
async fn login(app: AppHandle, student_id: String, password: String, operator: String) -> LoginResult {
    let local_ip = get_local_ip().await;
    
    let user_account = format!(",0,{}@{}", student_id, operator);
    
    let params = [
        ("callback", "dr1003".to_string()),
        ("login_method", "1".to_string()),
        ("user_account", user_account),
        ("user_password", password),
        ("wlan_user_ip", local_ip),
        ("wlan_user_ipv6", "".to_string()),
        ("wlan_user_mac", "000000000000".to_string()),
        ("wlan_ac_ip", "192.168.240.2".to_string()),
        ("wlan_ac_name", "".to_string()),
        ("jsVersion", "4.2.1".to_string()),
        ("terminal_type", "1".to_string()),
        ("lang", "zh-cn".to_string()),
        ("v", "7382".to_string()),
    ];

    let url = "http://192.168.180.3:801/eportal/portal/login";

    let response = LOGIN_CLIENT
        .get(url)
        .query(&params)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .header("Accept", "*/*")
        .header("Host", "192.168.180.3:801")
        .header("Referer", "http://192.168.180.3/")
        .send()
        .await;

    match response {
        Ok(resp) => {
            let _status = resp.status();
            let text = resp.text().await.unwrap_or_else(|_| "无法读取响应".to_string());
            let (success, message, should_retry, need_verify) = extract_message(&text);
            
            if success && !need_verify {
                NETWORK_STATUS.store(true, Ordering::SeqCst);
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some("校园网自动登录 - 网络已连接"));
                }
            }
            
            LoginResult {
                success,
                message,
                should_retry,
                need_verify,
            }
        }
        Err(e) => {
            let error_msg = if e.is_timeout() {
                "连接超时".to_string()
            } else if e.is_connect() {
                "无法连接服务器".to_string()
            } else {
                format!("请求失败: {}", e)
            };
            
            LoginResult {
                success: false,
                message: error_msg,
                should_retry: true,
                need_verify: false,
            }
        }
    }
}

#[tauri::command]
async fn login_with_retry(
    app: tauri::AppHandle,
    student_id: String,
    password: String,
    operator: String,
    max_retries: u32,
    retry_interval: u32,
) -> LoginResult {
    let mut attempt = 0;
    
    loop {
        attempt += 1;
        
        let result = login(
            app.clone(),
            student_id.clone(),
            password.clone(),
            operator.clone(),
        ).await;

        if result.success {
            return result;
        }
        
        if !result.should_retry {
            return result;
        }

        if attempt >= max_retries {
            return LoginResult {
                success: false,
                message: format!("已重试{}次，仍失败", max_retries),
                should_retry: false,
                need_verify: false,
            };
        }

        let _ = app.emit("login-retry", serde_json::json!({
            "attempt": attempt,
            "max_retries": max_retries,
            "message": format!("第{}次失败: {}，{}秒后重试", attempt, result.message, retry_interval)
        }));

        tokio::time::sleep(tokio::time::Duration::from_secs(retry_interval as u64)).await;
    }
}

#[tauri::command]
fn set_auto_launch(enable: bool) -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取可执行文件路径失败: {}", e))?;
    let exe_path_str = exe_path.to_string_lossy().to_string();
    
    let auto = auto_launch::AutoLaunchBuilder::new()
        .set_app_name("CampusNetLogin")
        .set_app_path(&exe_path_str)
        .build()
        .map_err(|e| format!("创建 AutoLaunch 实例失败: {}", e))?;

    if enable {
        auto.enable().map_err(|e| format!("启用开机自启动失败: {}", e))?;
    } else {
        auto.disable().map_err(|e| format!("禁用开机自启动失败: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
fn is_auto_launch_enabled() -> bool {
    let exe_path = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return false,
    };
    
    let auto = match auto_launch::AutoLaunchBuilder::new()
        .set_app_name("CampusNetLogin")
        .set_app_path(&exe_path)
        .build()
    {
        Ok(a) => a,
        Err(_) => return false,
    };
    
    match auto.is_enabled() {
        Ok(enabled) => enabled,
        Err(_) => false,
    }
}

fn is_hide_on_startup_enabled() -> bool {
    get_hide_on_startup_from_config()
}

fn get_hide_on_startup_from_config() -> bool {
    let config_path = get_config_path();
    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<LoginConfig>(&content) {
            return config.hide_on_startup.unwrap_or(false);
        }
    }
    false
}

fn set_hide_on_startup(enable: bool) -> Result<(), String> {
    let config_path = get_config_path();
    
    let mut config = if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(cfg) = serde_json::from_str::<LoginConfig>(&content) {
                cfg
            } else {
                LoginConfig::default()
            }
        } else {
            LoginConfig::default()
        }
    } else {
        LoginConfig::default()
    };
    
    config.hide_on_startup = Some(enable);
    
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = fs::write(&config_path, json);
    }
    
    if let Some(item) = HIDE_ON_STARTUP_ITEM.lock().unwrap().as_ref() {
        let _ = item.set_checked(enable);
    }
    Ok(())
}

#[tauri::command]
fn set_hide_on_startup_command(enable: bool) -> Result<(), String> {
    set_hide_on_startup(enable)
}

#[tauri::command]
async fn fetch_announcement_list() -> Result<Vec<String>, String> {
    let response = GITEE_CLIENT
        .get("https://gitee.com/yxxawa/atocont/raw/master/gggl.txt")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    let text = response.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    let urls: Vec<String> = text
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    
    Ok(urls)
}

#[tauri::command]
async fn fetch_announcement_content(url: String) -> Result<String, String> {
    let response = GITEE_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    let text = response.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    Ok(text)
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct PlatformInfo {
    signature: String,
    url: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct Platforms {
    #[serde(rename = "windows-x86_64")]
    windows_x86_64: PlatformInfo,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct LatestVersion {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: Platforms,
}

#[tauri::command]
async fn check_update() -> Result<Option<LatestVersion>, String> {
    let response = GITEE_CLIENT
        .get("https://gitee.com/yxxawa/atocont/raw/master/latest.json")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    let text = response.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    let latest: LatestVersion = serde_json::from_str(&text)
        .map_err(|e| format!("解析JSON失败: {}", e))?;
    
    let current_version = format!("v{}", env!("CARGO_PKG_VERSION"));
    
    if latest.version != current_version {
        Ok(Some(latest))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn download_update(app: AppHandle, url: String) -> Result<String, String> {
    use tauri::Manager;
    
    let response = DOWNLOAD_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    
    let app_dir = app.path().app_config_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?;
    
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    let file_name = url.split('/').last().unwrap_or("update.msi");
    let file_path = app_dir.join(file_name);
    
    let bytes = response.bytes().await
        .map_err(|e| format!("读取数据失败: {}", e))?;
    
    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    
    if total_size > 0 {
        let _ = app.emit("download-progress", 100u32);
    }
    
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_current_time() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[tauri::command]
fn get_version() -> String {
    format!("v{}", env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
async fn logout(app: AppHandle) -> LoginResult {
    let local_ip = get_local_ip().await;
    
    let params = [
        ("callback", "dr1004".to_string()),
        ("login_method", "1".to_string()),
        ("user_account", "drcom".to_string()),
        ("user_password", "123".to_string()),
        ("ac_logout", "0".to_string()),
        ("register_mode", "0".to_string()),
        ("wlan_user_ip", local_ip),
        ("wlan_user_ipv6", "".to_string()),
        ("wlan_vlan_id", "0".to_string()),
        ("wlan_user_mac", "000000000000".to_string()),
        ("wlan_ac_ip", "".to_string()),
        ("wlan_ac_name", "".to_string()),
        ("jsVersion", "4.2.1".to_string()),
        ("v", "6169".to_string()),
        ("lang", "en".to_string()),
    ];

    let url = "http://192.168.180.3:801/eportal/portal/logout";

    let response = LOGIN_CLIENT
        .get(url)
        .query(&params)
        .header("Host", "192.168.180.3:801")
        .header("Accept", "*/*")
        .header("Referer", "http://192.168.180.3/")
        .header("Accept-Encoding", "gzip, deflate")
        .header("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_else(|_| "无法读取响应".to_string());
            let (success, message, _, _) = extract_message(&text);
            
            if status.is_success() || success {
                MANUAL_DISCONNECT.store(true, Ordering::SeqCst);
                NETWORK_STATUS.store(false, Ordering::SeqCst);
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some("校园网自动登录 - 网络未连接"));
                }
                LoginResult {
                    success: true,
                    message: "已断开连接".to_string(),
                    should_retry: false,
                    need_verify: false,
                }
            } else {
                LoginResult {
                    success,
                    message: if success { "已断开连接".to_string() } else { message },
                    should_retry: false,
                    need_verify: false,
                }
            }
        }
        Err(e) => {
            let error_msg = if e.is_timeout() {
                "连接超时，请关闭代理工具后重试".to_string()
            } else if e.is_connect() {
                "无法连接服务器，请关闭代理工具后重试".to_string()
            } else {
                format!("请求失败，请关闭代理工具后重试: {}", e)
            };
            
            LoginResult {
                success: false,
                message: error_msg,
                should_retry: false,
                need_verify: false,
            }
        }
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn show_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
async fn tray_login(app: AppHandle) -> String {
    let config_path = get_config_path();
    let config = if config_path.exists() {
        if let Ok(content) = tokio::fs::read_to_string(&config_path).await {
            if let Ok(mut cfg) = serde_json::from_str::<LoginConfig>(&content) {
                cfg.password = decrypt_password(&cfg.password);
                cfg
            } else {
                show_notification(&app, "错误", "配置文件格式错误");
                return "配置文件格式错误".to_string();
            }
        } else {
            show_notification(&app, "错误", "无法读取配置文件");
            return "无法读取配置文件".to_string();
        }
    } else {
        show_notification(&app, "提示", "请先在窗口中配置账号密码");
        return "请先在窗口中配置账号密码".to_string();
    };
    
    if config.student_id.is_empty() || config.password.is_empty() {
        show_notification(&app, "提示", "请先在窗口中配置账号密码");
        return "请先在窗口中配置账号密码".to_string();
    }
    
    let result = login(app.clone(), config.student_id, config.password, config.operator).await;
    
    let _ = app.emit("tray-login-result", &result);
    
    if result.success {
        update_tray_status(&app, true);
        show_notification(&app, "连接成功", &result.message);
    } else {
        show_notification(&app, "连接失败", &result.message);
    }
    
    result.message
}

#[tauri::command]
async fn tray_logout(app: AppHandle) -> String {
    let result = logout(app.clone()).await;
    let _ = app.emit("tray-logout-result", &result);
    
    if result.success {
        update_tray_status(&app, false);
        show_notification(&app, "断开成功", &result.message);
    } else {
        show_notification(&app, "断开失败", &result.message);
    }
    
    result.message
}

fn show_notification(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder()
        .title(title)
        .body(body)
        .show();
}

fn update_tray_status(app: &AppHandle, is_online: bool) {
    NETWORK_STATUS.store(is_online, Ordering::SeqCst);
    
    let status = if is_online { "网络已连接" } else { "网络未连接" };
    
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&format!("校园网自动登录 - {}", status)));
    }
    
    if let Some(status_item) = STATUS_MENU_ITEM.lock().unwrap().as_ref() {
        let _ = status_item.set_text(status);
    }
}

fn create_tray(app: &AppHandle) -> Result<tauri::tray::TrayIcon, Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let login_item = MenuItem::with_id(app, "login", "连接网络", true, None::<&str>)?;
    let logout_item = MenuItem::with_id(app, "logout", "断开网络", true, None::<&str>)?;
    let auto_launch_item = CheckMenuItem::with_id(app, "auto_launch", "开机自启动", true, is_auto_launch_enabled(), None::<&str>)?;
    let hide_on_startup_item = CheckMenuItem::with_id(app, "hide_on_startup", "启动时隐藏窗口", true, get_hide_on_startup_from_config(), None::<&str>)?;
    let status_text = if NETWORK_STATUS.load(Ordering::SeqCst) { "网络已连接" } else { "网络未连接" };
    let status_item = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    
    {
        let mut item = AUTO_LAUNCH_ITEM.lock().unwrap();
        *item = Some(auto_launch_item.clone());
    }
    
    {
        let mut item = HIDE_ON_STARTUP_ITEM.lock().unwrap();
        *item = Some(hide_on_startup_item.clone());
    }
    
    {
        let mut item = STATUS_MENU_ITEM.lock().unwrap();
        *item = Some(status_item.clone());
    }
    
    let menu = Menu::with_items(app, &[&show_item, &login_item, &logout_item, &auto_launch_item, &hide_on_startup_item, &status_item, &quit_item])?;
    
    let tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("校园网自动登录 - 检测中...")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "login" => {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tray_login(app_clone).await;
                });
            }
            "logout" => {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tray_logout(app_clone).await;
                });
            }
            "auto_launch" => {
                let current = is_auto_launch_enabled();
                if set_auto_launch(!current).is_ok() {
                    let _ = app.emit("auto-launch-changed", !current);
                    if let Some(item) = AUTO_LAUNCH_ITEM.lock().unwrap().as_ref() {
                        let _ = item.set_checked(!current);
                    }
                }
            }
            "hide_on_startup" => {
                let current = is_hide_on_startup_enabled();
                if set_hide_on_startup(!current).is_ok() {
                    let _ = app.emit("hide-on-startup-changed", !current);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    
    Ok(tray)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .setup(|app| {
            let handle = app.handle();
            let _tray = create_tray(handle).expect("Failed to create tray");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler!(
            get_local_ip,
            load_config,
            save_config,
            check_network_status,
            check_login_page_available,
            login,
            login_with_retry,
            logout,
            set_auto_launch,
            is_auto_launch_enabled,
            get_current_time,
            get_version,
            hide_window,
            show_window,
            tray_login,
            tray_logout,
            set_hide_on_startup_command,
            fetch_announcement_list,
            fetch_announcement_content,
            check_update,
            download_update,
            start_network_monitor
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
