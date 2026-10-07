use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    webview::WebviewWindowBuilder,
    AppHandle, Manager,
};

/// 初始化系统托盘
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 加载并缩放图标
    let icon_bytes = include_bytes!("../icons/app-icon-squircle.png");
    let base_img =
        image::load_from_memory(icon_bytes).map_err(|e| format!("加载图标失败: {}", e))?;

    let target_size = 128;
    let content_size = 105;
    let padding = (target_size - content_size) / 2;

    let scaled_content = base_img.resize(
        content_size,
        content_size,
        image::imageops::FilterType::Lanczos3,
    );
    let mut final_img = image::RgbaImage::new(target_size, target_size);

    image::imageops::overlay(
        &mut final_img,
        &scaled_content,
        padding as i64,
        padding as i64,
    );

    let (width, height) = final_img.dimensions();
    let icon = Image::new_owned(final_img.into_raw(), width, height);

    // Windows 右键需要真正挂载 native menu；仅监听 TrayIconEvent 会把右键
    // 也当成 popup 点击，系统不会自动生成完整托盘菜单。
    let show_main = MenuItem::with_id(app, "tray-show-main", "Mở cửa sổ chính", true, None::<&str>)?;
    let next_account = MenuItem::with_id(
        app,
        "tray-next-account",
        "Chuyển sang tài khoản tiếp theo",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Thoát"))?;
    let menu = Menu::with_items(app, &[&show_main, &next_account, &separator, &quit])?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show-main" => show_main_window_from_cmd(app),
            "tray-next-account" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<crate::AppState>();
                    let call_handle = app_handle.clone();
                    if let Err(error) =
                        crate::switch_to_next_account_internal(state, call_handle).await
                    {
                        eprintln!("[Tray] 切换下一个账号失败: {}", error);
                    }
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &TrayIcon, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button_state: tauri::tray::MouseButtonState::Up,
                button: tauri::tray::MouseButton::Left,
                position,
                ..
            } = event
            {
                // 左键 → 弹出 popup；右键交给 native menu（Windows 修复）。
                toggle_popup(tray.app_handle(), position);
            }
        })
        .build(app)?;

    println!("[Tray] 系统托盘已启动");
    Ok(())
}

/// 显示/隐藏 tray popup 窗口
fn toggle_popup(app: &AppHandle, position: tauri::PhysicalPosition<f64>) {
    let label = "tray-popup";

    // 如果已存在，切换显示/隐藏
    if let Some(win) = app.get_webview_window(label) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
        // 重新定位并显示
        if let Err(error) = position_popup(&win, position) {
            eprintln!("[Tray] Position failed: {}", error);
            return;
        }
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    // 首次创建
    let popup_width = 380.0;
    let popup_height = 410.0;

    let url = tauri::WebviewUrl::App("index.html".into());

    match WebviewWindowBuilder::new(app, label, url)
        .title("Codex Switcher")
        .inner_size(popup_width, popup_height)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
    {
        Ok(win) => {
            // 监听焦点丢失 → 自动隐藏
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = win_clone.hide();
                }
            });

            if let Err(error) = position_popup(&win, position) {
                eprintln!("[Tray] Position failed: {}", error);
                return;
            }
            let _ = win.show();
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[Tray] 创建 popup 窗口失败: {}", e),
    }
}

/// Use the clicked monitor's physical work area, including its taskbar and DPI.
fn position_popup(
    win: &tauri::WebviewWindow,
    tray_pos: tauri::PhysicalPosition<f64>,
) -> Result<(), String> {
    let monitor = match win
        .monitor_from_point(tray_pos.x, tray_pos.y)
        .map_err(|e| e.to_string())?
    {
        Some(monitor) => monitor,
        None => match win.current_monitor().map_err(|e| e.to_string())? {
            Some(monitor) => monitor,
            None => win
                .primary_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("No monitor available for tray popup")?,
        },
    };
    let area = monitor.work_area();
    let rect = crate::tray_position::place(
        (tray_pos.x, tray_pos.y),
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        monitor.scale_factor(),
    )
    .ok_or("Invalid tray monitor work area")?;
    win.set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
        .map_err(|e| e.to_string())?;
    win.set_size(tauri::PhysicalSize::new(rect.width, rect.height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        if let Err(error) = fit_main_window_to_work_area(&window) {
            eprintln!("[Window] Could not fit main window to work area: {}", error);
        }
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        app.set_activation_policy(tauri::ActivationPolicy::Regular)
            .unwrap_or(());
    }
}

#[derive(Debug, PartialEq)]
struct MainWindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Keep the restored main window completely inside the active monitor's work
/// area. Windows remembers the last physical position, which can become invalid
/// after a DPI, resolution, taskbar, or monitor-layout change. That used to put
/// the right side of the navigation off-screen and made existing items look as
/// if they were missing.
fn main_window_rect(
    current_pos: (i32, i32),
    current_size: (u32, u32),
    work_origin: (i32, i32),
    work_size: (u32, u32),
    scale: f64,
) -> Option<MainWindowRect> {
    if work_size.0 == 0 || work_size.1 == 0 || !scale.is_finite() || scale <= 0.0 {
        return None;
    }

    let margin = (12.0 * scale).round().max(0.0) as u32;
    let horizontal_margin = margin.saturating_mul(2).min(work_size.0.saturating_sub(1));
    let vertical_margin = margin.saturating_mul(2).min(work_size.1.saturating_sub(1));
    let max_width = work_size.0.saturating_sub(horizontal_margin).max(1);
    let max_height = work_size.1.saturating_sub(vertical_margin).max(1);
    let width = current_size.0.max(1).min(max_width);
    let height = current_size.1.max(1).min(max_height);

    let left = work_origin.0.saturating_add(margin as i32);
    let top = work_origin.1.saturating_add(margin as i32);
    let right = work_origin
        .0
        .saturating_add(work_size.0 as i32)
        .saturating_sub(margin as i32)
        .saturating_sub(width as i32);
    let bottom = work_origin
        .1
        .saturating_add(work_size.1 as i32)
        .saturating_sub(margin as i32)
        .saturating_sub(height as i32);

    Some(MainWindowRect {
        x: current_pos.0.clamp(left, right.max(left)),
        y: current_pos.1.clamp(top, bottom.max(top)),
        width,
        height,
    })
}

fn fit_main_window_to_work_area(window: &tauri::WebviewWindow) -> Result<(), String> {
    let monitor = match window.current_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => monitor,
        None => window
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("No monitor available for main window")?,
    };
    let area = monitor.work_area();
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let rect = main_window_rect(
        (position.x, position.y),
        (size.width, size.height),
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        monitor.scale_factor(),
    )
    .ok_or("Invalid main-window work area")?;

    if rect.width != size.width || rect.height != size.height {
        window
            .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
            .map_err(|e| e.to_string())?;
    }
    if rect.x != position.x || rect.y != position.y {
        window
            .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 供 Tauri command 调用的入口
pub fn show_main_window_from_cmd(app: &AppHandle) {
    show_main_window(app);
    // 同时隐藏 popup
    if let Some(popup) = app.get_webview_window("tray-popup") {
        let _ = popup.hide();
    }
}

/// 更新托盘 tooltip（不再需要完整菜单）
///
/// **关键**：`tray.set_tooltip` 是 Tauri/Cocoa GUI API，内部走 mpmc channel
/// 等主线程在 NSApplication runloop 处理。如果调用时**还持有 store.lock()**，
/// 而主线程刚好在执行 UI 的 `get_accounts`（也要拿同一把 store lock），就死锁：
///   - tokio worker: 持 store.lock() → 调 set_tooltip → 等主线程
///   - 主线程: 在 get_accounts → 等 store.lock()
/// 修法：tooltip 构建放在内层 block 让 guard 在 set_tooltip 前 drop。
pub fn update_tray_menu(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let (tooltip, title, mode) = {
        let store = match state.store.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        let mode = store.settings.tray_display_mode;
        let tooltip = if let Some(current_id) = &store.current {
            if let Some(acc) = store.accounts.get(current_id) {
                let quota = acc
                    .cached_quota
                    .as_ref()
                    .map(|q| format!(" | 5 giờ: {:.0}%  Tuần: {:.0}%", q.five_hour_left, q.weekly_left))
                    .unwrap_or_default();
                format!("Codex Switcher - {}{}", acc.name, quota)
            } else {
                "Codex Switcher".to_string()
            }
        } else {
            "Codex Switcher - Chưa đăng nhập".to_string()
        };
        let title = store.current.as_ref().and_then(|current_id| {
            store.accounts.get(current_id).map(|acc| {
                acc.cached_quota
                    .as_ref()
                    .map(|q| format!("5H {:.0}% · 7D {:.0}%", q.five_hour_left, q.weekly_left))
                    .unwrap_or_else(|| acc.name.clone())
            })
        });
        (tooltip, title, mode)
        // store guard 在 block 结束（这一行）时 drop，set_tooltip 在外面跑
    };

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&tooltip));
        match mode {
            crate::account::TrayDisplayMode::IconAndSession => {
                let _ = tray.set_visible(true);
                let _ = tray.set_title(None::<&str>);
            }
            crate::account::TrayDisplayMode::ActiveUsageText => {
                let _ = tray.set_visible(true);
                let _ = tray.set_title(title.as_deref());
            }
            crate::account::TrayDisplayMode::Hidden => {
                let _ = tray.set_title(None::<&str>);
                let _ = tray.set_visible(false);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_is_clamped_when_its_right_side_is_off_screen() {
        let rect = main_window_rect((210, 20), (1500, 950), (0, 0), (1536, 1040), 1.25)
            .expect("valid work area");
        assert_eq!(rect.x, 21);
        assert_eq!(rect.y, 20);
        assert_eq!(rect.width, 1500);
        assert_eq!(rect.height, 950);
    }

    #[test]
    fn main_window_shrinks_to_small_work_area_with_dpi_margin() {
        let rect = main_window_rect((-500, -500), (1800, 1200), (-1280, 40), (1280, 680), 1.5)
            .expect("valid work area");
        assert_eq!(rect.x, -1262);
        assert_eq!(rect.y, 58);
        assert_eq!(rect.width, 1244);
        assert_eq!(rect.height, 644);
    }

    #[test]
    fn main_window_keeps_valid_position_and_size() {
        let rect = main_window_rect((100, 80), (1000, 700), (0, 0), (1920, 1040), 1.0)
            .expect("valid work area");
        assert_eq!(
            rect,
            MainWindowRect {
                x: 100,
                y: 80,
                width: 1000,
                height: 700,
            }
        );
    }

    #[test]
    fn main_window_rejects_invalid_monitor_metadata() {
        assert!(main_window_rect((0, 0), (100, 100), (0, 0), (0, 100), 1.0).is_none());
        assert!(main_window_rect((0, 0), (100, 100), (0, 0), (100, 100), f64::NAN).is_none());
    }
}
