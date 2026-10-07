// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
fn configure_fixed_webview2_runtime() {
    let Ok(exe_path) = std::env::current_exe() else {
        return;
    };
    let Some(app_dir) = exe_path.parent() else {
        return;
    };

    let fixed_runtime = app_dir
        .join("WebView2Fixed")
        .join("154.0.4258.53")
        .join("Microsoft.WebView2.FixedVersionRuntime.154.0.4258.53.x64");

    if fixed_runtime.join("msedgewebview2.exe").is_file() {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", fixed_runtime);
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    configure_fixed_webview2_runtime();

    codex_switcher_lib::run()
}
