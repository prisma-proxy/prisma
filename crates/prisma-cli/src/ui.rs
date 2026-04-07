use colored::Colorize;
use std::io::{IsTerminal, Write};

pub fn info(msg: &str) {
    println!("{} {}", ">>".cyan().bold(), msg);
}

pub fn success(msg: &str) {
    println!("{} {}", "OK".green().bold(), msg);
}

pub fn warn(msg: &str) {
    eprintln!("{} {}", "Warning:".yellow().bold(), msg);
}

pub fn error(msg: &str) {
    eprintln!("{} {}", "Error:".red().bold(), msg);
}

pub fn detail(msg: &str) {
    println!("   {}", msg.dimmed());
}

pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Print a progress line that overwrites itself using carriage return.
/// Only renders on interactive terminals to avoid garbage in pipes.
pub fn print_progress(downloaded: u64, total: u64) {
    if !std::io::stderr().is_terminal() {
        return;
    }
    let dl = format_bytes(downloaded);
    if total > 0 {
        let pct = (downloaded * 100) / total;
        let tot = format_bytes(total);
        eprint!("\r   {} / {} ({}%)", dl, tot, pct);
    } else {
        eprint!("\r   {} downloaded", dl);
    }
    std::io::stderr().flush().ok();
}

/// Clear the progress line after download completes.
pub fn clear_progress() {
    if !std::io::stderr().is_terminal() {
        return;
    }
    eprint!("\r{}\r", " ".repeat(60));
    std::io::stderr().flush().ok();
}
