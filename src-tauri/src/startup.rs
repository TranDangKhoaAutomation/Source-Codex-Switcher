use std::ffi::OsStr;
use std::path::Path;

const BACKGROUND_ARG: &str = "--background";

#[cfg(target_os = "windows")]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const VALUE_NAME: &str = "Codex Switcher";
#[cfg(target_os = "windows")]
const LEGACY_WATCHDOG_VALUE_NAME: &str = "CodexSwitcherWatchdog";

pub fn is_background_launch<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter().skip(1).any(|arg| {
        arg.as_ref()
            .to_string_lossy()
            .eq_ignore_ascii_case(BACKGROUND_ARG)
    })
}

fn startup_command_for_path(exe: &Path, start_minimized: bool) -> Result<String, String> {
    let path = exe.to_string_lossy();
    if path.contains('"') {
        return Err("Đường dẫn ứng dụng chứa ký tự không hợp lệ".to_string());
    }
    Ok(if start_minimized {
        format!("\"{}\" {}", path, BACKGROUND_ARG)
    } else {
        format!("\"{}\"", path)
    })
}

#[cfg(target_os = "windows")]
pub fn sync_windows_startup(enabled: bool, start_minimized: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new("reg.exe");
    command.creation_flags(CREATE_NO_WINDOW);

    if enabled {
        let exe = std::env::current_exe()
            .map_err(|error| format!("Không xác định được đường dẫn ứng dụng: {error}"))?;
        let value = startup_command_for_path(&exe, start_minimized)?;
        command.args([
            "add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", &value, "/f",
        ]);
    } else {
        // `reg delete` returns exit code 1 when the value is already absent. Query
        // first so disabling an already-disabled option remains idempotent.
        let query = Command::new("reg.exe")
            .args(["query", RUN_KEY, "/v", VALUE_NAME])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("Không thể kiểm tra Startup của Windows: {error}"))?;
        if !query.status.success() {
            return Ok(());
        }
        command.args(["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]);
    }

    let output = command
        .output()
        .map_err(|error| format!("Không thể cập nhật Startup của Windows: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() {
            "Windows từ chối cập nhật mục Startup".to_string()
        } else {
            format!("Windows từ chối cập nhật mục Startup: {detail}")
        })
    }
}

#[cfg(target_os = "windows")]
fn registry_value_exists(value_name: &str) -> bool {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new("reg.exe")
        .args(["query", RUN_KEY, "/v", value_name])
        .creation_flags(CREATE_NO_WINDOW)
        // Capture output so a missing optional legacy value does not leak
        // reg.exe's noisy "unable to find registry key" line into proxy.log.
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
pub fn legacy_watchdog_registered() -> bool {
    registry_value_exists(LEGACY_WATCHDOG_VALUE_NAME)
}

#[cfg(target_os = "windows")]
pub fn remove_legacy_watchdog_startup() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if !registry_value_exists(LEGACY_WATCHDOG_VALUE_NAME) {
        return Ok(());
    }
    let output = Command::new("reg.exe")
        .args(["delete", RUN_KEY, "/v", LEGACY_WATCHDOG_VALUE_NAME, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Không thể gỡ Startup watchdog cũ: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Windows từ chối gỡ mục Startup watchdog cũ".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn sync_windows_startup(enabled: bool, _start_minimized: bool) -> Result<(), String> {
    if enabled {
        Err("Tùy chọn này hiện chỉ hỗ trợ Windows".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn legacy_watchdog_registered() -> bool {
    false
}

#[cfg(not(target_os = "windows"))]
pub fn remove_legacy_watchdog_startup() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn background_flag_is_exact_and_case_insensitive() {
        assert!(is_background_launch([
            OsString::from("switcher.exe"),
            OsString::from("--BACKGROUND"),
        ]));
        assert!(!is_background_launch([
            OsString::from("switcher.exe"),
            OsString::from("--background-extra"),
        ]));
    }

    #[test]
    fn startup_command_quotes_paths_and_only_adds_background_when_requested() {
        let path = Path::new(r"C:\Program Files\Codex Switcher\codex-switcher.exe");
        assert_eq!(
            startup_command_for_path(path, true).unwrap(),
            r#""C:\Program Files\Codex Switcher\codex-switcher.exe" --background"#
        );
        assert_eq!(
            startup_command_for_path(path, false).unwrap(),
            r#""C:\Program Files\Codex Switcher\codex-switcher.exe""#
        );
    }
}
