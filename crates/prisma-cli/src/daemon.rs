//! Daemon mode: PID file management, background process spawning, stop/status.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Default PID file directory.
fn default_pid_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var("PROGRAMDATA")
            .map(|p| PathBuf::from(p).join("prisma"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from("/tmp")
    }
}

/// Default log file directory.
fn default_log_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var("PROGRAMDATA")
            .map(|p| PathBuf::from(p).join("prisma").join("logs"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from("/var/log/prisma")
    }
}

/// Returns the PID file path for a given service name (e.g., "server", "client", "console").
pub fn pid_file_path(service: &str, pid_file: Option<&str>) -> PathBuf {
    if let Some(p) = pid_file {
        PathBuf::from(p)
    } else {
        default_pid_dir().join(format!("prisma-{}.pid", service))
    }
}

/// Returns the log file path for a given service name.
pub fn log_file_path(service: &str, log_file: Option<&str>) -> PathBuf {
    if let Some(p) = log_file {
        PathBuf::from(p)
    } else {
        default_log_dir().join(format!("prisma-{}.log", service))
    }
}

/// Write the current process PID to a file.
pub fn write_pid_file(path: &Path) -> Result<()> {
    let pid = std::process::id();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(path, pid.to_string())
        .with_context(|| format!("Failed to write PID file: {}", path.display()))?;
    Ok(())
}

/// Read PID from a PID file.
pub fn read_pid_file(path: &Path) -> Result<u32> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("PID file not found: {}", path.display()))?;
    let pid: u32 = content
        .trim()
        .parse()
        .with_context(|| format!("Invalid PID in {}: '{}'", path.display(), content.trim()))?;
    Ok(pid)
}

/// Remove the PID file.
pub fn remove_pid_file(path: &Path) {
    let _ = fs::remove_file(path);
}

/// Check if a process with the given PID is running.
#[cfg(unix)]
pub fn is_process_running(pid: u32) -> bool {
    // On Unix, sending signal 0 checks if the process exists
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(windows)]
pub fn is_process_running(pid: u32) -> bool {
    use std::os::raw::c_void;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    unsafe { CloseHandle(handle) };
    true
}

#[cfg(not(any(unix, windows)))]
pub fn is_process_running(_pid: u32) -> bool {
    // Unknown platform — conservatively assume the process is running
    true
}

/// Send SIGTERM to a process (Unix).
#[cfg(unix)]
pub fn send_sigterm(pid: u32) -> Result<()> {
    let ret = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if ret != 0 {
        let err = std::io::Error::last_os_error();
        anyhow::bail!("Failed to send SIGTERM to PID {}: {}", pid, err);
    }
    Ok(())
}

#[cfg(windows)]
pub fn send_sigterm(pid: u32) -> Result<()> {
    use std::os::raw::c_void;

    const PROCESS_TERMINATE: u32 = 0x0001;

    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        fn TerminateProcess(handle: *mut c_void, exit_code: u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if handle.is_null() {
        let err = std::io::Error::last_os_error();
        anyhow::bail!("Failed to open process PID {}: {}", pid, err);
    }

    let ret = unsafe { TerminateProcess(handle, 1) };
    unsafe { CloseHandle(handle) };

    if ret == 0 {
        let err = std::io::Error::last_os_error();
        anyhow::bail!("Failed to terminate PID {}: {}", pid, err);
    }

    Ok(())
}

#[cfg(not(any(unix, windows)))]
pub fn send_sigterm(pid: u32) -> Result<()> {
    anyhow::bail!(
        "Sending signals is not supported on this platform. Manually terminate PID {}.",
        pid
    );
}

/// Spawn the current executable as a background daemon process.
///
/// Re-executes the binary with `--daemon-child` appended, redirecting
/// stdout/stderr to the log file. The parent prints a success message and exits.
pub fn daemonize(
    service: &str,
    args: &[String],
    pid_file: Option<&str>,
    log_file: Option<&str>,
) -> Result<()> {
    let exe = std::env::current_exe().context("Failed to determine current executable path")?;

    let pid_path = pid_file_path(service, pid_file);
    let log_path = log_file_path(service, log_file);

    // Check if already running
    if pid_path.exists() {
        if let Ok(existing_pid) = read_pid_file(&pid_path) {
            if is_process_running(existing_pid) {
                anyhow::bail!(
                    "Prisma {} is already running (PID: {}). Use 'prisma {} stop' first.",
                    service,
                    existing_pid,
                    service
                );
            }
            // Stale PID file, clean up
            remove_pid_file(&pid_path);
        }
    }

    // Ensure log directory exists
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    // Open log file for stdout/stderr redirection
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("Failed to open log file: {}", log_path.display()))?;

    let log_err = log.try_clone()?;

    // Build command: re-exec with --daemon-child flag
    // Filter out --daemon/-d from args, add --daemon-child
    let filtered_args: Vec<&String> = args
        .iter()
        .filter(|a| *a != "--daemon" && *a != "-d")
        .collect();

    let mut cmd = std::process::Command::new(&exe);
    cmd.args(&filtered_args);
    cmd.arg("--daemon-child");
    cmd.arg("--pid-file");
    // Pass PID file path to child. Use OsStr so non-UTF-8 paths still work.
    cmd.arg(&pid_path);
    cmd.stdout(log);
    cmd.stderr(log_err);

    // Redirect stdin from /dev/null so the child never blocks on terminal input
    #[cfg(unix)]
    {
        let devnull = fs::OpenOptions::new()
            .read(true)
            .open("/dev/null")
            .context("Failed to open /dev/null for stdin redirect")?;
        cmd.stdin(devnull);
    }
    #[cfg(not(unix))]
    {
        cmd.stdin(std::process::Stdio::null());
    }

    // Detach from terminal
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                // Create new session (detach from terminal)
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Preserve the working directory so config-relative paths resolve correctly
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    cmd.current_dir(&cwd);

    let child = cmd
        .spawn()
        .with_context(|| format!("Failed to spawn daemon process for {}", service))?;

    let pid = child.id();

    // Brief wait for the child to start and write PID file; avoids race
    // where the user immediately runs `prisma <service> status` and finds
    // no PID file.
    std::thread::sleep(std::time::Duration::from_millis(150));

    println!("Prisma {} started (PID: {})", service, pid);
    println!("  PID file: {}", pid_path.display());
    println!("  Log file: {}", log_path.display());
    println!("  Work dir: {}", cwd.display());

    Ok(())
}

/// Stop a running daemon by service name.
pub fn stop_service(service: &str, pid_file: Option<&str>) -> Result<()> {
    let pid_path = pid_file_path(service, pid_file);

    if !pid_path.exists() {
        println!("Prisma {} is not running (no PID file found).", service);
        return Ok(());
    }

    let pid = read_pid_file(&pid_path)?;

    if !is_process_running(pid) {
        println!(
            "Prisma {} is not running (stale PID file, PID {} not found). Cleaning up.",
            service, pid
        );
        remove_pid_file(&pid_path);
        return Ok(());
    }

    println!("Stopping prisma {} (PID: {})...", service, pid);
    send_sigterm(pid)?;

    // Wait briefly for the process to exit
    for i in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if !is_process_running(pid) {
            remove_pid_file(&pid_path);
            println!("Prisma {} stopped.", service);
            return Ok(());
        }
        if i == 9 {
            eprintln!("  Waiting for process to exit...");
        }
    }

    eprintln!(
        "Warning: Process {} did not exit after 3 seconds. It may still be shutting down.",
        pid
    );
    remove_pid_file(&pid_path);

    Ok(())
}

/// Check the status of a service.
pub fn check_status(service: &str, pid_file: Option<&str>, json: bool) -> Result<()> {
    let pid_path = pid_file_path(service, pid_file);
    let log_path = log_file_path(service, None);

    if !pid_path.exists() {
        if json {
            println!(
                "{}",
                serde_json::json!({"service": service, "status": "stopped"})
            );
        } else {
            println!("Prisma {} is not running.", service);
        }
        return Ok(());
    }

    let pid = read_pid_file(&pid_path)?;
    let running = is_process_running(pid);

    if json {
        println!(
            "{}",
            serde_json::json!({
                "service": service,
                "status": if running { "running" } else { "stopped" },
                "pid": pid,
                "pid_file": pid_path.to_string_lossy(),
                "log_file": log_path.to_string_lossy(),
            })
        );
    } else if running {
        println!("Prisma {} is running (PID: {}).", service, pid);
        println!("  PID file: {}", pid_path.display());
        println!("  Log file: {}", log_path.display());
    } else {
        println!(
            "Prisma {} is not running (stale PID file, PID {} not found).",
            service, pid
        );
        remove_pid_file(&pid_path);
    }

    Ok(())
}
