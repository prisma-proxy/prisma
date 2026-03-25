use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState},
    Terminal,
};
use serde::Deserialize;

use crate::api_client;

// ---------------------------------------------------------------------------
// Data types for API responses
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
struct MetricsResponse {
    #[serde(default)]
    active_connections: u64,
    #[serde(default)]
    total_connections: u64,
    #[serde(default)]
    bytes_uploaded: u64,
    #[serde(default)]
    bytes_downloaded: u64,
    #[serde(default)]
    uptime_secs: u64,
    #[serde(default)]
    authorized_clients: u64,
}

#[derive(Debug, Default, Clone, Deserialize)]
struct ConnectionEntry {
    #[serde(default)]
    #[allow(dead_code)]
    session_id: String,
    #[serde(default)]
    client_name: String,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    transport: String,
    #[serde(default)]
    peer_addr: String,
    #[serde(default)]
    bytes_up: u64,
    #[serde(default)]
    bytes_down: u64,
    #[serde(default)]
    duration_secs: u64,
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

struct App {
    client: api_client::ApiClient,
    metrics: MetricsResponse,
    connections: Vec<ConnectionEntry>,
    table_state: TableState,
    focus: Focus,
    last_error: Option<String>,
    should_quit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Focus {
    Metrics,
    Connections,
    Help,
}

impl App {
    fn new(client: api_client::ApiClient) -> Self {
        Self {
            client,
            metrics: MetricsResponse::default(),
            connections: Vec::new(),
            table_state: TableState::default(),
            focus: Focus::Connections,
            last_error: None,
            should_quit: false,
        }
    }

    fn fetch_data(&mut self) {
        // Fetch metrics
        match self.client.get_json::<MetricsResponse>("/api/metrics") {
            Ok(m) => {
                self.metrics = m;
                self.last_error = None;
            }
            Err(e) => {
                self.last_error = Some(format!("metrics: {}", e));
            }
        }

        // Fetch connections
        match self
            .client
            .get_json::<Vec<ConnectionEntry>>("/api/connections")
        {
            Ok(c) => {
                self.connections = c;
                // Ensure selection stays in bounds
                if self.connections.is_empty() {
                    self.table_state.select(None);
                } else if let Some(sel) = self.table_state.selected() {
                    if sel >= self.connections.len() {
                        self.table_state.select(Some(self.connections.len() - 1));
                    }
                }
            }
            Err(e) => {
                self.last_error = Some(format!("connections: {}", e));
            }
        }
    }

    fn scroll_up(&mut self) {
        if self.connections.is_empty() {
            return;
        }
        let i = match self.table_state.selected() {
            Some(i) => {
                if i == 0 {
                    self.connections.len() - 1
                } else {
                    i - 1
                }
            }
            None => 0,
        };
        self.table_state.select(Some(i));
    }

    fn scroll_down(&mut self) {
        if self.connections.is_empty() {
            return;
        }
        let i = match self.table_state.selected() {
            Some(i) => {
                if i >= self.connections.len() - 1 {
                    0
                } else {
                    i + 1
                }
            }
            None => 0,
        };
        self.table_state.select(Some(i));
    }

    fn cycle_focus(&mut self) {
        self.focus = match self.focus {
            Focus::Metrics => Focus::Connections,
            Focus::Connections => Focus::Help,
            Focus::Help => Focus::Metrics,
        };
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub async fn run_monitor(
    mgmt_url: Option<String>,
    token: Option<String>,
    _config: Option<String>,
) -> Result<()> {
    // Resolve the management API client
    let client = api_client::ApiClient::resolve(
        mgmt_url.as_deref(),
        token.as_deref(),
        false, // not JSON mode
    )?;

    // Set up terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(client);

    // Initial fetch
    app.fetch_data();

    let result = run_loop(&mut terminal, &mut app);

    // Restore terminal on exit
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

fn run_loop(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
    let tick_rate = Duration::from_secs(1);

    loop {
        terminal.draw(|f| ui(f, app))?;

        // Poll for events with a timeout equal to the tick rate
        if event::poll(tick_rate)? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => {
                            app.should_quit = true;
                        }
                        KeyCode::Up | KeyCode::Char('k') => {
                            app.scroll_up();
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            app.scroll_down();
                        }
                        KeyCode::Tab => {
                            app.cycle_focus();
                        }
                        KeyCode::Char('r') => {
                            // Force refresh
                            app.fetch_data();
                        }
                        _ => {}
                    }
                }
            }
        } else {
            // Tick: refresh data
            app.fetch_data();
        }

        if app.should_quit {
            return Ok(());
        }
    }
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

fn ui(f: &mut ratatui::Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(20), // Metrics cards
            Constraint::Percentage(45), // Connections table
            Constraint::Percentage(35), // Help / status
        ])
        .split(f.area());

    render_metrics(f, app, chunks[0]);
    render_connections(f, app, chunks[1]);
    render_help(f, app, chunks[2]);
}

fn render_metrics(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let is_focused = app.focus == Focus::Metrics;
    let border_style = if is_focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .title(" Metrics ")
        .borders(Borders::ALL)
        .border_style(border_style);

    let inner = block.inner(area);
    f.render_widget(block, area);

    // Split the inner area into metric cards
    let card_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(17),
            Constraint::Percentage(17),
            Constraint::Percentage(17),
            Constraint::Percentage(17),
            Constraint::Percentage(16),
            Constraint::Percentage(16),
        ])
        .split(inner);

    let m = &app.metrics;

    let cards: Vec<(&str, String, Color)> = vec![
        ("Active", m.active_connections.to_string(), Color::Green),
        ("Total", m.total_connections.to_string(), Color::Blue),
        ("Upload", format_bytes(m.bytes_uploaded), Color::Cyan),
        ("Download", format_bytes(m.bytes_downloaded), Color::Magenta),
        ("Clients", m.authorized_clients.to_string(), Color::Yellow),
        ("Uptime", format_duration(m.uptime_secs), Color::White),
    ];

    for (i, (label, value, color)) in cards.iter().enumerate() {
        if i >= card_chunks.len() {
            break;
        }
        let card = Paragraph::new(vec![
            Line::from(Span::styled(
                *label,
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                value.clone(),
                Style::default().fg(*color).add_modifier(Modifier::BOLD),
            )),
        ])
        .block(Block::default().borders(Borders::RIGHT));

        f.render_widget(card, card_chunks[i]);
    }
}

fn render_connections(f: &mut ratatui::Frame, app: &mut App, area: Rect) {
    let is_focused = app.focus == Focus::Connections;
    let border_style = if is_focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let header_cells = [
        "Peer",
        "Client",
        "Transport",
        "Upload",
        "Download",
        "Duration",
    ]
    .iter()
    .map(|h| {
        Cell::from(*h).style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )
    });
    let header = Row::new(header_cells).height(1);

    let rows = app.connections.iter().map(|c| {
        let name = if c.client_name.is_empty() {
            // Show truncated client_id if no name
            if c.client_id.len() > 12 {
                format!("{}...", &c.client_id[..12])
            } else {
                c.client_id.clone()
            }
        } else {
            c.client_name.clone()
        };

        let cells = vec![
            Cell::from(c.peer_addr.clone()),
            Cell::from(name),
            Cell::from(c.transport.clone()),
            Cell::from(format_bytes(c.bytes_up)),
            Cell::from(format_bytes(c.bytes_down)),
            Cell::from(format_duration(c.duration_secs)),
        ];
        Row::new(cells)
    });

    let title = format!(" Connections ({}) ", app.connections.len());

    let highlight_style = Style::default()
        .bg(Color::DarkGray)
        .add_modifier(Modifier::BOLD);

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(22),
            Constraint::Percentage(18),
            Constraint::Percentage(14),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
            Constraint::Percentage(16),
        ],
    )
    .header(header)
    .block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(border_style),
    )
    .row_highlight_style(highlight_style)
    .highlight_symbol("> ");

    f.render_stateful_widget(table, area, &mut app.table_state);
}

fn render_help(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let is_focused = app.focus == Focus::Help;
    let border_style = if is_focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "q",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Quit  "),
            Span::styled(
                "Up/Down",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Scroll  "),
            Span::styled(
                "Tab",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Cycle focus  "),
            Span::styled(
                "r",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Refresh"),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            format!("API: {}", app.client.base_url()),
            Style::default().fg(Color::DarkGray),
        )),
    ];

    if let Some(ref err) = app.last_error {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!("Error: {}", err),
            Style::default().fg(Color::Red),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "Connected -- data refreshes every 1s",
            Style::default().fg(Color::Green),
        )));
    }

    let help = Paragraph::new(lines).block(
        Block::default()
            .title(" Help ")
            .borders(Borders::ALL)
            .border_style(border_style),
    );

    f.render_widget(help, area);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    const TB: u64 = 1024 * GB;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn format_duration(secs: u64) -> String {
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;

    if days > 0 {
        format!("{}d {:02}h {:02}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {:02}m {:02}s", hours, minutes, seconds)
    } else if minutes > 0 {
        format!("{}m {:02}s", minutes, seconds)
    } else {
        format!("{}s", seconds)
    }
}
