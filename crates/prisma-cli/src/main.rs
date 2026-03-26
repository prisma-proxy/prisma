mod api_client;
mod bandwidth;
mod clients;
mod completions;
mod config_ops;
mod connections;
mod console;
mod daemon;
mod diagnose;
mod diagnostics;
mod init;
mod logs;
mod metrics;
mod monitor;
mod profile_wizard;
mod routes;
mod status;
mod subscription;
mod validate;

use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const PROTOCOL_VERSION: u8 = prisma_core::types::PRISMA_PROTOCOL_VERSION;

#[derive(Parser)]
#[command(
    name = "prisma",
    about = "Prisma proxy infrastructure suite",
    version = VERSION,
    after_help = "Run 'prisma <command> --help' for more information on a specific command."
)]
pub struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Output raw JSON instead of formatted tables
    #[arg(long, global = true)]
    json: bool,

    /// Enable verbose (debug) output
    #[arg(short, long, global = true)]
    verbose: bool,

    /// Management API URL (overrides env PRISMA_MGMT_URL and auto-detect)
    #[arg(long, global = true, env = "PRISMA_MGMT_URL")]
    mgmt_url: Option<String>,

    /// Management API auth token (overrides env PRISMA_MGMT_TOKEN and auto-detect)
    #[arg(long, global = true, env = "PRISMA_MGMT_TOKEN")]
    mgmt_token: Option<String>,

    // --- Hidden daemon-internal flags ---
    /// Internal: indicates this process is a daemon child (do not use directly)
    #[arg(long, hide = true)]
    _daemon_child: bool,

    /// Internal: PID file path passed from parent daemon spawner
    #[arg(long, hide = true)]
    _pid_file: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the proxy server (supports -d for background daemon mode)
    Server {
        #[command(subcommand)]
        action: Option<ServerAction>,

        /// Path to server config file
        #[arg(short, long, default_value = "server.toml")]
        config: String,

        /// Run as a background daemon
        #[arg(short = 'd', long)]
        daemon: bool,

        /// PID file path (default: /tmp/prisma-server.pid)
        #[arg(long)]
        pid_file: Option<String>,

        /// Log file path when daemonized (default: /var/log/prisma/prisma-server.log)
        #[arg(long)]
        log_file: Option<String>,
    },
    /// Start the proxy client (supports -d for background daemon mode)
    Client {
        #[command(subcommand)]
        action: Option<ClientAction>,

        /// Path to client config file
        #[arg(short, long, default_value = "client.toml")]
        config: String,

        /// Run as a background daemon
        #[arg(short = 'd', long)]
        daemon: bool,

        /// PID file path (default: /tmp/prisma-client.pid)
        #[arg(long)]
        pid_file: Option<String>,

        /// Log file path when daemonized (default: /var/log/prisma/prisma-client.log)
        #[arg(long)]
        log_file: Option<String>,
    },
    /// Launch the web console (supports -d for background daemon mode)
    Console {
        #[command(subcommand)]
        action: Option<ConsoleAction>,

        /// Management API URL to proxy requests to (auto-detected from server.toml if omitted)
        #[arg(long)]
        mgmt_url: Option<String>,
        /// Auth token for management API
        #[arg(long)]
        token: Option<String>,
        /// Port to serve the console on
        #[arg(long, default_value = "9091")]
        port: u16,
        /// Address to bind the console server to
        #[arg(long, default_value = "0.0.0.0")]
        bind: String,
        /// Don't auto-open browser
        #[arg(long)]
        no_open: bool,
        /// Force re-download of console assets
        #[arg(long)]
        update: bool,
        /// Serve console from a local directory instead of downloading
        #[arg(long)]
        dir: Option<String>,

        /// Run as a background daemon
        #[arg(short = 'd', long)]
        daemon: bool,

        /// PID file path (default: /tmp/prisma-console.pid)
        #[arg(long)]
        pid_file: Option<String>,

        /// Log file path when daemonized (default: /var/log/prisma/prisma-console.log)
        #[arg(long)]
        log_file: Option<String>,
    },

    /// Generate a new client key (UUID + auth secret)
    GenKey,
    /// Generate cryptographic values (secret, uuid)
    Generate {
        #[command(subcommand)]
        what: GenerateCommand,
    },
    /// Generate a self-signed TLS certificate for development
    GenCert {
        /// Output directory for cert and key files
        #[arg(short, long, default_value = ".")]
        output: String,
        /// Common name for the certificate
        #[arg(long, default_value = "prisma-server")]
        cn: String,
    },
    /// Generate annotated config files with auto-generated keys
    Init {
        /// Include CDN section pre-configured
        #[arg(long)]
        cdn: bool,
        /// Generate only server config
        #[arg(long)]
        server_only: bool,
        /// Generate only client config
        #[arg(long)]
        client_only: bool,
        /// Overwrite existing files
        #[arg(long)]
        force: bool,
    },
    /// Validate a config file without starting
    Validate {
        /// Path to config file
        #[arg(short, long, default_value = "server.toml")]
        config: String,
        /// Validate as client config instead of server
        #[arg(long)]
        client: bool,
    },
    /// Interactive TUI dashboard for monitoring the server
    Monitor {
        /// Management API URL
        #[arg(long)]
        mgmt_url: Option<String>,
        /// Auth token for management API
        #[arg(long)]
        token: Option<String>,
        /// Path to server config file (for auto-detecting mgmt URL/token)
        #[arg(short, long)]
        config: Option<String>,
    },
    /// Query management API for server status
    Status {
        /// Management API URL (hidden, use --mgmt-url instead)
        #[arg(short, long, hide = true)]
        url: Option<String>,
        /// Auth token (hidden, use --mgmt-token instead)
        #[arg(short, long, hide = true)]
        token: Option<String>,
    },
    /// Run a speed test against the server
    SpeedTest {
        /// Server address (host:port)
        #[arg(short, long)]
        server: String,
        /// Duration in seconds
        #[arg(short, long, default_value = "10")]
        duration: u64,
        /// Direction: "download", "upload", or "both"
        #[arg(long, default_value = "both")]
        direction: String,
        /// Path to client config file (for auth credentials)
        #[arg(short = 'C', long, default_value = "client.toml")]
        config: String,
    },
    /// Show version, protocol version, supported ciphers and transports
    Version,
    /// Generate shell completion scripts
    Completions {
        /// Shell to generate completions for
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },

    // --- Management API commands ---
    /// Manage authorized clients
    #[command(subcommand)]
    Clients(ClientsCmd),
    /// Manage active connections
    #[command(subcommand)]
    Connections(ConnectionsCmd),
    /// View server metrics and system info
    Metrics {
        /// Auto-refresh metrics
        #[arg(long)]
        watch: bool,
        /// Show historical metrics
        #[arg(long)]
        history: bool,
        /// History period: 1h, 6h, 24h, 7d
        #[arg(long, default_value = "1h")]
        period: String,
        /// Refresh interval in seconds (for --watch)
        #[arg(long, default_value = "2")]
        interval: u64,
        /// Show system info instead of metrics
        #[arg(long)]
        system: bool,
    },
    /// Manage bandwidth limits and quotas
    #[command(subcommand)]
    Bandwidth(BandwidthCmd),
    /// Manage server configuration
    #[command(subcommand)]
    Config(ConfigCmd),
    /// Manage routing rules
    #[command(subcommand)]
    Routes(RoutesCmd),
    /// Stream live server logs via WebSocket
    Logs {
        /// Minimum log level: TRACE, DEBUG, INFO, WARN, ERROR
        #[arg(long)]
        level: Option<String>,
        /// Maximum number of log lines to display
        #[arg(long)]
        lines: Option<usize>,
    },
    /// Ping the server (connect + handshake RTT)
    Ping {
        /// Path to client config file
        #[arg(short, long, default_value = "client.toml")]
        config: String,
        /// Override server address
        #[arg(short, long)]
        server: Option<String>,
        /// Number of pings
        #[arg(long, default_value = "5")]
        count: u32,
        /// Interval between pings in milliseconds
        #[arg(long, default_value = "1000")]
        interval: u64,
    },
    /// Test all configured transports against the server
    TestTransport {
        /// Path to client config file
        #[arg(short, long, default_value = "client.toml")]
        config: String,
    },
    /// Run connectivity diagnostics against the server
    Diagnose {
        /// Path to client config file
        #[arg(short, long, default_value = "client.toml")]
        config: String,
    },
    /// Manage server subscriptions
    #[command(subcommand)]
    Subscription(SubscriptionCmd),
    /// Test latency to servers
    LatencyTest {
        /// Subscription URL to fetch servers from
        #[arg(long)]
        url: Option<String>,
        /// Comma-separated server addresses (host:port)
        #[arg(long)]
        servers: Option<String>,
    },
    /// Create and manage client profiles
    #[command(subcommand)]
    Profile(ProfileCmd),
    /// Check for updates and self-update the binary
    Update {
        /// Just check for updates without downloading
        #[arg(long)]
        check: bool,

        /// Skip confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },
}

// --- Subcommands for daemon-aware services ---

#[derive(Subcommand)]
enum ServerAction {
    /// Stop the running server daemon
    Stop {
        /// PID file path
        #[arg(long)]
        pid_file: Option<String>,
    },
    /// Check if the server daemon is running
    Status {
        /// PID file path
        #[arg(long)]
        pid_file: Option<String>,
    },
}

#[derive(Subcommand)]
enum ClientAction {
    /// Stop the running client daemon
    Stop {
        /// PID file path
        #[arg(long)]
        pid_file: Option<String>,
    },
    /// Check if the client daemon is running
    Status {
        /// PID file path
        #[arg(long)]
        pid_file: Option<String>,
    },
}

#[derive(Subcommand)]
enum ConsoleAction {
    /// Stop the running console daemon
    Stop {
        /// PID file path
        #[arg(long)]
        pid_file: Option<String>,
    },
    /// Check if the console daemon is running
    Status {
        /// PID file path
        #[arg(long)]
        pid_file: Option<String>,
    },
}

#[derive(Subcommand)]
enum SubscriptionCmd {
    /// Add a new subscription
    Add {
        #[arg(short, long)]
        url: String,
        #[arg(short, long)]
        name: String,
    },
    /// Update (re-fetch) a subscription
    Update {
        #[arg(short, long)]
        url: String,
    },
    /// List servers from a subscription URL
    List {
        #[arg(short, long)]
        url: String,
    },
    /// Test latency to all servers from a subscription
    Test {
        #[arg(short, long)]
        url: String,
    },
}

#[derive(Subcommand)]
enum GenerateCommand {
    /// Generate a random hex-encoded 32-byte secret (for PrismaTLS auth)
    Secret,
    /// Generate a random UUID v4 (for client IDs)
    Uuid,
}

#[derive(Subcommand)]
enum ProfileCmd {
    /// Interactively create a new client profile
    New {
        /// Output file path (default: print to stdout)
        #[arg(short, long)]
        output: Option<String>,
    },
}

#[derive(Subcommand)]
enum ClientsCmd {
    /// List all authorized clients
    List,
    /// Show details for a specific client
    Show {
        /// Client ID
        id: String,
    },
    /// Create a new client
    Create {
        /// Client name
        #[arg(long)]
        name: Option<String>,
    },
    /// Delete a client
    Delete {
        /// Client ID
        id: String,
        /// Skip confirmation
        #[arg(long)]
        yes: bool,
    },
    /// Enable a client
    Enable {
        /// Client ID
        id: String,
    },
    /// Disable a client
    Disable {
        /// Client ID
        id: String,
    },
    /// Create multiple clients in batch
    BatchCreate {
        /// Number of clients to create
        #[arg(long)]
        count: u32,
        /// Name prefix for generated clients
        #[arg(long, default_value = "client-")]
        prefix: String,
        /// Management API URL (overrides global)
        #[arg(long)]
        mgmt_url: Option<String>,
        /// Management API auth token (overrides global)
        #[arg(long)]
        token: Option<String>,
    },
    /// Export all clients to a JSON file
    Export {
        /// Output file path
        #[arg(short, long, default_value = "clients.json")]
        output: String,
        /// Management API URL (overrides global)
        #[arg(long)]
        mgmt_url: Option<String>,
        /// Management API auth token (overrides global)
        #[arg(long)]
        token: Option<String>,
    },
    /// Import clients from a JSON file
    Import {
        /// Input file path
        #[arg(short, long)]
        file: String,
        /// Management API URL (overrides global)
        #[arg(long)]
        mgmt_url: Option<String>,
        /// Management API auth token (overrides global)
        #[arg(long)]
        token: Option<String>,
    },
}

#[derive(Subcommand)]
enum ConnectionsCmd {
    /// List active connections
    List,
    /// Disconnect a specific connection
    Disconnect {
        /// Session ID
        id: String,
    },
    /// Watch connections in real-time
    Watch {
        /// Refresh interval in seconds
        #[arg(long, default_value = "2")]
        interval: u64,
    },
}

#[derive(Subcommand)]
enum BandwidthCmd {
    /// Show bandwidth summary for all clients
    Summary,
    /// Show bandwidth and quota for a specific client
    Get {
        /// Client ID
        id: String,
    },
    /// Set bandwidth limits for a client
    Set {
        /// Client ID
        id: String,
        /// Upload limit in bits per second (0 = unlimited)
        #[arg(long)]
        upload: Option<u64>,
        /// Download limit in bits per second (0 = unlimited)
        #[arg(long)]
        download: Option<u64>,
    },
    /// Get or set traffic quota for a client
    Quota {
        /// Client ID
        id: String,
        /// Quota limit in bytes (omit to show current)
        #[arg(long)]
        limit: Option<u64>,
    },
}

#[derive(Subcommand)]
enum ConfigCmd {
    /// Show current server configuration
    Get,
    /// Update a configuration value
    Set {
        /// Configuration key (dotted notation, e.g., logging.level)
        key: String,
        /// New value
        value: String,
    },
    /// Show TLS configuration
    Tls,
    /// Manage configuration backups
    #[command(subcommand)]
    Backup(BackupCmd),
}

#[derive(Subcommand)]
enum BackupCmd {
    /// Create a new backup
    Create,
    /// List all backups
    List,
    /// Restore a backup
    Restore {
        /// Backup name
        name: String,
    },
    /// Show diff between backup and current config
    Diff {
        /// Backup name
        name: String,
    },
    /// Delete a backup
    Delete {
        /// Backup name
        name: String,
    },
}

#[derive(Subcommand)]
enum RoutesCmd {
    /// List all routing rules
    List,
    /// Create a new routing rule
    Create {
        /// Rule name
        #[arg(long)]
        name: String,
        /// Condition (TYPE:VALUE, e.g., DomainMatch:*.ads.*, IpCidr:10.0.0.0/8, PortRange:80-443, All)
        #[arg(long)]
        condition: String,
        /// Action: allow or block
        #[arg(long)]
        action: String,
        /// Priority (lower = higher priority)
        #[arg(long, default_value = "100")]
        priority: u32,
    },
    /// Update a routing rule
    Update {
        /// Rule ID
        id: String,
        /// New condition
        #[arg(long)]
        condition: Option<String>,
        /// New action
        #[arg(long)]
        action: Option<String>,
        /// New priority
        #[arg(long)]
        priority: Option<u32>,
        /// New name
        #[arg(long)]
        name: Option<String>,
    },
    /// Delete a routing rule
    Delete {
        /// Rule ID
        id: String,
    },
    /// Apply a predefined routing rule preset
    Setup {
        /// Preset name: block-ads, privacy, allow-all, block-all
        preset: String,
        /// Delete all existing rules before applying preset
        #[arg(long)]
        clear: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install default CryptoProvider");

    let cli = Cli::parse();
    let global_json = cli.json;
    let global_verbose = cli.verbose;
    let global_mgmt_url = cli.mgmt_url;
    let global_mgmt_token = cli.mgmt_token;
    let is_daemon_child = cli._daemon_child;
    let daemon_pid_file = cli._pid_file;

    // If verbose mode, set RUST_LOG if not already set.
    // SAFETY: This runs before the tokio runtime starts (single-threaded),
    // so env::set_var is safe here. We set it early so tracing_subscriber
    // picks it up via EnvFilter.
    if global_verbose && std::env::var("RUST_LOG").is_err() {
        unsafe { std::env::set_var("RUST_LOG", "debug") };
    }

    // If we are a daemon child, write the PID file before doing anything else
    // and install a cleanup handler so we remove it on normal exit or SIGTERM.
    if is_daemon_child {
        if let Some(ref pf) = daemon_pid_file {
            daemon::write_pid_file(Path::new(pf))?;

            // Register cleanup on Ctrl-C / SIGTERM so PID file is removed on exit
            let pid_file_cleanup = PathBuf::from(pf.as_str());
            tokio::spawn(async move {
                tokio::signal::ctrl_c()
                    .await
                    .expect("Failed to listen for ctrl_c");
                daemon::remove_pid_file(&pid_file_cleanup);
                std::process::exit(0);
            });

            #[cfg(unix)]
            {
                let pid_file_sigterm = PathBuf::from(pf.as_str());
                tokio::spawn(async move {
                    let mut sigterm =
                        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                            .expect("Failed to listen for SIGTERM");
                    sigterm.recv().await;
                    daemon::remove_pid_file(&pid_file_sigterm);
                    std::process::exit(0);
                });
            }
        }
    }

    match cli.command {
        Commands::Server {
            action,
            config,
            daemon: daemon_flag,
            pid_file,
            log_file,
        } => {
            match action {
                Some(ServerAction::Stop { pid_file: pf }) => {
                    daemon::stop_service("server", pf.as_deref().or(pid_file.as_deref()))?;
                }
                Some(ServerAction::Status { pid_file: pf }) => {
                    daemon::check_status(
                        "server",
                        pf.as_deref().or(pid_file.as_deref()),
                        global_json,
                    )?;
                }
                None => {
                    if daemon_flag && !is_daemon_child {
                        // Spawn as background daemon
                        let args = collect_args_for_daemon();
                        daemon::daemonize(
                            "server",
                            &args,
                            pid_file.as_deref(),
                            log_file.as_deref(),
                        )?;
                    } else {
                        // Run in foreground (or we ARE the daemon child)
                        let path = resolve_config(&config, "server.toml");
                        if global_verbose {
                            eprintln!("[verbose] Starting server with config: {}", path.display());
                        }
                        let path_str = path
                            .to_str()
                            .ok_or_else(|| anyhow::anyhow!("config path is not valid UTF-8"))?;
                        prisma_server::run(path_str).await?;
                    }
                }
            }
        }
        Commands::Client {
            action,
            config,
            daemon: daemon_flag,
            pid_file,
            log_file,
        } => match action {
            Some(ClientAction::Stop { pid_file: pf }) => {
                daemon::stop_service("client", pf.as_deref().or(pid_file.as_deref()))?;
            }
            Some(ClientAction::Status { pid_file: pf }) => {
                daemon::check_status("client", pf.as_deref().or(pid_file.as_deref()), global_json)?;
            }
            None => {
                if daemon_flag && !is_daemon_child {
                    let args = collect_args_for_daemon();
                    daemon::daemonize("client", &args, pid_file.as_deref(), log_file.as_deref())?;
                } else {
                    let path = resolve_config(&config, "client.toml");
                    if global_verbose {
                        eprintln!("[verbose] Starting client with config: {}", path.display());
                    }
                    let path_str = path
                        .to_str()
                        .ok_or_else(|| anyhow::anyhow!("config path is not valid UTF-8"))?;
                    prisma_client::run(path_str).await?;
                }
            }
        },
        Commands::Console {
            action,
            mgmt_url,
            token,
            port,
            bind,
            no_open,
            update,
            dir,
            daemon: daemon_flag,
            pid_file,
            log_file,
        } => {
            match action {
                Some(ConsoleAction::Stop { pid_file: pf }) => {
                    daemon::stop_service("console", pf.as_deref().or(pid_file.as_deref()))?;
                }
                Some(ConsoleAction::Status { pid_file: pf }) => {
                    daemon::check_status(
                        "console",
                        pf.as_deref().or(pid_file.as_deref()),
                        global_json,
                    )?;
                }
                None => {
                    if daemon_flag && !is_daemon_child {
                        let args = collect_args_for_daemon();
                        daemon::daemonize(
                            "console",
                            &args,
                            pid_file.as_deref(),
                            log_file.as_deref(),
                        )?;
                    } else {
                        // Auto-detect token: --token flag > PRISMA_MGMT_TOKEN env > server.toml
                        let token = token
                            .or_else(|| std::env::var("PRISMA_MGMT_TOKEN").ok())
                            .or_else(|| {
                                api_client::ApiClient::resolve(None, None, false)
                                    .ok()
                                    .and_then(|c| {
                                        let t = c.token();
                                        if t.is_empty() {
                                            None
                                        } else {
                                            Some(t.to_string())
                                        }
                                    })
                            });
                        // Auto-detect mgmt URL from server.toml if not provided
                        let mgmt_url = mgmt_url.unwrap_or_else(|| {
                            api_client::ApiClient::resolve(None, None, false)
                                .ok()
                                .map(|c| c.base_url().to_string())
                                .unwrap_or_else(|| "http://127.0.0.1:9090".to_string())
                        });
                        if global_verbose {
                            eprintln!(
                                "[verbose] Starting console on {}:{}, proxying to {}",
                                bind, port, mgmt_url
                            );
                        }
                        console::run_console(mgmt_url, token, port, bind, no_open, update, dir)
                            .await?;
                    }
                }
            }
        }

        Commands::GenKey => {
            gen_key(global_json);
        }
        Commands::Generate { what } => match what {
            GenerateCommand::Secret => {
                let mut buf = [0u8; 32];
                rand::Rng::fill(&mut rand::thread_rng(), &mut buf);
                println!("{}", prisma_core::util::hex_encode(&buf));
            }
            GenerateCommand::Uuid => {
                println!("{}", uuid::Uuid::new_v4());
            }
        },
        Commands::GenCert { output, cn } => {
            gen_cert(&output, &cn)?;
        }
        Commands::Init {
            cdn,
            server_only,
            client_only,
            force,
        } => {
            init::run_init(cdn, server_only, client_only, force)?;
        }
        Commands::Validate { config, client } => {
            let config_type = if client { "client" } else { "server" };
            validate::run_validate(&config, config_type)?;
        }
        Commands::Monitor {
            mgmt_url,
            token,
            config,
        } => {
            monitor::run_monitor(
                mgmt_url.or_else(|| global_mgmt_url.clone()),
                token.or_else(|| global_mgmt_token.clone()),
                config,
            )
            .await?;
        }
        Commands::Status { url, token } => {
            let client = api_client::ApiClient::resolve(
                url.as_deref().or(global_mgmt_url.as_deref()),
                token.as_deref().or(global_mgmt_token.as_deref()),
                global_json,
            )?;
            status::run_status(&client)?;
        }
        Commands::SpeedTest {
            server,
            duration,
            direction,
            config,
        } => {
            run_speed_test(&server, duration, &direction, &config).await?;
        }
        Commands::Version => {
            print_version(global_json);
        }
        Commands::Completions { shell } => {
            completions::generate(shell);
        }
        // --- Management API commands ---
        Commands::Clients(cmd) => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            match cmd {
                ClientsCmd::List => clients::list(&client)?,
                ClientsCmd::Show { id } => clients::show(&client, &id)?,
                ClientsCmd::Create { name } => clients::create(&client, name.as_deref())?,
                ClientsCmd::Delete { id, .. } => clients::delete(&client, &id)?,
                ClientsCmd::Enable { id } => clients::enable(&client, &id)?,
                ClientsCmd::Disable { id } => clients::disable(&client, &id)?,
                ClientsCmd::BatchCreate {
                    count,
                    prefix,
                    mgmt_url,
                    token,
                } => {
                    let api = api_client::ApiClient::resolve(
                        mgmt_url.as_deref().or(global_mgmt_url.as_deref()),
                        token.as_deref().or(global_mgmt_token.as_deref()),
                        global_json,
                    )?;
                    clients::batch_create(&api, count, &prefix)?;
                }
                ClientsCmd::Export {
                    output,
                    mgmt_url,
                    token,
                } => {
                    let api = api_client::ApiClient::resolve(
                        mgmt_url.as_deref().or(global_mgmt_url.as_deref()),
                        token.as_deref().or(global_mgmt_token.as_deref()),
                        global_json,
                    )?;
                    clients::export(&api, &output)?;
                }
                ClientsCmd::Import {
                    file,
                    mgmt_url,
                    token,
                } => {
                    let api = api_client::ApiClient::resolve(
                        mgmt_url.as_deref().or(global_mgmt_url.as_deref()),
                        token.as_deref().or(global_mgmt_token.as_deref()),
                        global_json,
                    )?;
                    clients::import(&api, &file)?;
                }
            }
        }
        Commands::Connections(cmd) => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            match cmd {
                ConnectionsCmd::List => connections::list(&client)?,
                ConnectionsCmd::Disconnect { id } => connections::disconnect(&client, &id)?,
                ConnectionsCmd::Watch { interval } => connections::watch(&client, interval)?,
            }
        }
        Commands::Metrics {
            watch,
            history,
            system,
            period,
            interval,
        } => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            if system {
                metrics::system(&client)?;
            } else if history {
                metrics::history(&client, &period)?;
            } else if watch {
                metrics::watch(&client, interval)?;
            } else {
                metrics::snapshot(&client)?;
            }
        }
        Commands::Bandwidth(cmd) => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            match cmd {
                BandwidthCmd::Summary => bandwidth::summary(&client)?,
                BandwidthCmd::Get { id } => bandwidth::get(&client, &id)?,
                BandwidthCmd::Set {
                    id,
                    upload,
                    download,
                } => bandwidth::set(&client, &id, upload, download)?,
                BandwidthCmd::Quota { id, limit } => bandwidth::quota(&client, &id, limit)?,
            }
        }
        Commands::Config(cmd) => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            match cmd {
                ConfigCmd::Get => config_ops::get_config(&client)?,
                ConfigCmd::Set { key, value } => config_ops::set_config(&client, &key, &value)?,
                ConfigCmd::Tls => config_ops::tls(&client)?,
                ConfigCmd::Backup(bcmd) => match bcmd {
                    BackupCmd::Create => config_ops::backup_create(&client)?,
                    BackupCmd::List => config_ops::backup_list(&client)?,
                    BackupCmd::Restore { name } => config_ops::backup_restore(&client, &name)?,
                    BackupCmd::Diff { name } => config_ops::backup_diff(&client, &name)?,
                    BackupCmd::Delete { name } => config_ops::backup_delete(&client, &name)?,
                },
            }
        }
        Commands::Routes(cmd) => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            match cmd {
                RoutesCmd::List => routes::list(&client)?,
                RoutesCmd::Create {
                    name,
                    condition,
                    action,
                    priority,
                } => routes::create(&client, &name, &condition, &action, priority)?,
                RoutesCmd::Update {
                    id,
                    condition,
                    action,
                    priority,
                    name,
                } => routes::update(
                    &client,
                    &id,
                    condition.as_deref(),
                    action.as_deref(),
                    priority,
                    name.as_deref(),
                )?,
                RoutesCmd::Delete { id } => routes::delete(&client, &id)?,
                RoutesCmd::Setup { preset, clear } => routes::setup(&client, &preset, clear)?,
            }
        }
        Commands::Logs { level, lines } => {
            let client = api_client::ApiClient::resolve(
                global_mgmt_url.as_deref(),
                global_mgmt_token.as_deref(),
                global_json,
            )?;
            logs::stream(&client, level.as_deref(), lines).await?;
        }
        Commands::Ping {
            config,
            server,
            count,
            interval,
        } => {
            let path = resolve_config(&config, "client.toml");
            let path_str = path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("config path is not valid UTF-8"))?;
            diagnostics::ping(path_str, server.as_deref(), count, interval).await?;
        }
        Commands::TestTransport { config } => {
            let path = resolve_config(&config, "client.toml");
            let path_str = path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("config path is not valid UTF-8"))?;
            diagnostics::test_transport(path_str).await?;
        }
        Commands::Diagnose { config } => {
            let path = resolve_config(&config, "client.toml");
            let path_str = path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("config path is not valid UTF-8"))?;
            diagnose::run(path_str).await?;
        }
        Commands::Subscription(cmd) => match cmd {
            SubscriptionCmd::Add { url, name } => subscription::add(&url, &name).await?,
            SubscriptionCmd::Update { url } => subscription::update(&url).await?,
            SubscriptionCmd::List { url } => subscription::list(&url).await?,
            SubscriptionCmd::Test { url } => subscription::test(&url).await?,
        },
        Commands::LatencyTest { url, servers } => {
            let infos: Vec<prisma_client::latency::ServerInfo> = if let Some(u) = url {
                prisma_core::subscription::fetch_subscription(&u)
                    .await?
                    .into_iter()
                    .map(|s| prisma_client::latency::ServerInfo {
                        name: s.name,
                        server_addr: s.server_addr,
                    })
                    .collect()
            } else if let Some(addrs) = servers {
                addrs
                    .split(',')
                    .map(|a| {
                        let a = a.trim().to_string();
                        prisma_client::latency::ServerInfo {
                            name: a.clone(),
                            server_addr: a,
                        }
                    })
                    .collect()
            } else {
                anyhow::bail!(
                    "Provide --url or --servers.\n\n\
                     Examples:\n  \
                     prisma latency-test --url 'https://example.com/subscribe'\n  \
                     prisma latency-test --servers '1.2.3.4:8443,5.6.7.8:8443'"
                );
            };
            println!("Testing latency to {} servers...", infos.len());
            let cfg = prisma_client::latency::LatencyTestConfig::default();
            let results: Vec<prisma_client::latency::LatencyResult> =
                prisma_client::latency::test_all_servers(&infos, &cfg).await;

            if global_json {
                let json_results: Vec<serde_json::Value> = results
                    .iter()
                    .map(|r| {
                        serde_json::json!({
                            "name": r.name,
                            "server_addr": r.server_addr,
                            "latency_ms": r.latency_ms,
                            "success": r.success,
                            "error": r.error,
                        })
                    })
                    .collect();
                println!("{}", serde_json::to_string_pretty(&json_results)?);
            } else {
                let rows: Vec<Vec<String>> = results
                    .iter()
                    .map(|r| {
                        vec![
                            r.name.clone(),
                            r.server_addr.clone(),
                            r.latency_ms
                                .map(|ms| format!("{}ms", ms))
                                .unwrap_or_else(|| "timeout".into()),
                            if r.success {
                                "OK".into()
                            } else {
                                r.error.clone().unwrap_or_else(|| "FAIL".into())
                            },
                        ]
                    })
                    .collect();
                api_client::print_table(&["Name", "Address", "Latency", "Status"], &rows);
                if let Some(best) = results.first().filter(|r| r.success) {
                    println!(
                        "\nBest: {} ({}) - {}ms",
                        best.name,
                        best.server_addr,
                        best.latency_ms.unwrap_or(0)
                    );
                }
            }
        }
        Commands::Profile(cmd) => match cmd {
            ProfileCmd::New { output } => {
                profile_wizard::run_wizard(output)?;
            }
        },
        Commands::Update { check, yes } => {
            cmd_update(check, yes, global_json);
        }
    }

    // If we are a daemon child, clean up PID file on normal exit
    if is_daemon_child {
        if let Some(ref pf) = daemon_pid_file {
            daemon::remove_pid_file(Path::new(pf));
        }
    }

    Ok(())
}

/// Collect the original CLI arguments (skipping the binary name).
/// Used when the daemon parent needs to re-exec itself with `--daemon-child`.
fn collect_args_for_daemon() -> Vec<String> {
    std::env::args()
        .skip(1) // skip the binary name
        .collect()
}

/// Resolve config file path. If the given path exists, use it directly.
/// Otherwise search standard locations: /etc/prisma/, ~/.config/prisma/.
fn resolve_config(given: &str, default_name: &str) -> PathBuf {
    let given_path = Path::new(given);
    if given_path.exists() {
        return given_path.to_path_buf();
    }

    // Only search fallback locations when the user didn't provide an explicit path
    // (i.e. they're using the clap default value).
    if given == default_name {
        let candidates: Vec<PathBuf> = if cfg!(windows) {
            // %PROGRAMDATA%\prisma\ and %USERPROFILE%\.config\prisma\
            let mut v = Vec::new();
            if let Ok(pd) = std::env::var("PROGRAMDATA") {
                v.push(PathBuf::from(pd).join("prisma").join(default_name));
            }
            if let Ok(home) = std::env::var("USERPROFILE") {
                v.push(
                    PathBuf::from(home)
                        .join(".config")
                        .join("prisma")
                        .join(default_name),
                );
            }
            v
        } else {
            let mut v = vec![PathBuf::from("/etc/prisma").join(default_name)];
            if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
                v.push(PathBuf::from(xdg).join("prisma").join(default_name));
            } else if let Ok(home) = std::env::var("HOME") {
                v.push(
                    PathBuf::from(home)
                        .join(".config")
                        .join("prisma")
                        .join(default_name),
                );
            }
            v
        };

        for candidate in &candidates {
            if candidate.exists() {
                eprintln!("Using config: {}", candidate.display());
                return candidate.clone();
            }
        }

        // Nothing found -- print helpful message and fall through to the default
        eprintln!(
            "Config file '{}' not found in current directory or standard locations:",
            default_name
        );
        eprintln!("  - ./{}", default_name);
        for c in &candidates {
            eprintln!("  - {}", c.display());
        }
        eprintln!();
        eprintln!("Run 'prisma init' to generate config files, or pass --config <path>.");
    }

    given_path.to_path_buf()
}

fn gen_key(json: bool) {
    let client_id = uuid::Uuid::new_v4();
    let mut secret = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut secret);
    let secret_hex: String = secret.iter().map(|b| format!("{:02x}", b)).collect();

    if json {
        println!(
            "{}",
            serde_json::json!({
                "client_id": client_id.to_string(),
                "auth_secret": secret_hex,
            })
        );
        return;
    }

    println!("Client ID:   {}", client_id);
    println!("Auth Secret: {}", secret_hex);
    println!();
    println!("# Add to server.toml:");
    println!("[[authorized_clients]]");
    println!("id = \"{}\"", client_id);
    println!("auth_secret = \"{}\"", secret_hex);
    println!("name = \"my-client\"");
    println!();
    println!("# Add to client.toml:");
    println!("[identity]");
    println!("client_id = \"{}\"", client_id);
    println!("auth_secret = \"{}\"", secret_hex);
}

fn gen_cert(output: &str, cn: &str) -> anyhow::Result<()> {
    let mut params = rcgen::CertificateParams::new(vec![cn.to_string()])?;
    params
        .subject_alt_names
        .push(rcgen::SanType::DnsName(cn.to_string().try_into()?));

    let key_pair = rcgen::KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;

    let cert_path = format!("{}/prisma-cert.pem", output);
    let key_path = format!("{}/prisma-key.pem", output);

    std::fs::write(&cert_path, cert.pem())?;
    std::fs::write(&key_path, key_pair.serialize_pem())?;

    println!("Certificate: {}", cert_path);
    println!("Private key: {}", key_path);

    Ok(())
}

async fn run_speed_test(
    server: &str,
    duration: u64,
    direction: &str,
    config_path: &str,
) -> anyhow::Result<()> {
    use prisma_core::config::load_client_config;
    use prisma_core::crypto::aead::AeadCipher;
    use prisma_core::protocol::codec::*;
    use prisma_core::protocol::types::*;
    use prisma_core::types::MAX_FRAME_SIZE;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let config = load_client_config(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load client config: {}", e))?;

    println!("Prisma Speed Test");
    println!("  Server:    {}", server);
    println!("  Duration:  {}s", duration);
    println!("  Direction: {}", direction);
    println!("  Client ID: {}", config.identity.client_id);
    println!();

    // Reuse the shared ProxyContext builder
    let ctx = diagnostics::build_proxy_context_pub(&config, Some(server))?;
    let client_id = ctx.client_id;
    let auth_secret = ctx.auth_secret;
    let cipher_suite = ctx.cipher_suite;

    // Connect to server
    println!("Connecting to {}...", ctx.server_addr);
    let connect_start = std::time::Instant::now();

    let transport = ctx.connect().await?;
    let rtt = connect_start.elapsed();
    println!("  Connected in {:.1}ms", rtt.as_secs_f64() * 1000.0);

    // Establish raw tunnel (handshake only, no CONNECT command)
    let tunnel = prisma_client::tunnel::establish_raw_tunnel(
        transport,
        client_id,
        auth_secret,
        cipher_suite,
        ctx.server_key_pin.as_deref(),
    )
    .await?;

    println!("  Tunnel established (v4, 1 RTT)");
    println!();

    let (mut tunnel_read, mut tunnel_write) = tokio::io::split(tunnel.stream);
    let cipher: Arc<dyn AeadCipher> = Arc::from(tunnel.cipher);
    let mut session_keys = tunnel.session_keys;

    // Run download test
    if direction == "download" || direction == "both" {
        println!("Download test ({} seconds)...", duration);

        // Send CMD_SPEED_TEST requesting download
        let frame = DataFrame {
            command: Command::SpeedTest {
                direction: 0, // download
                duration_secs: duration as u8,
                data: vec![],
            },
            flags: 0,
            stream_id: 0,
        };
        let frame_bytes = encode_data_frame(&frame);
        let nonce = session_keys.next_client_nonce();
        let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes)?;
        let len = (encrypted.len() as u16).to_be_bytes();
        tunnel_write.write_all(&len).await?;
        tunnel_write.write_all(&encrypted).await?;

        // Receive data for duration_secs and measure throughput
        let test_start = std::time::Instant::now();
        let mut total_bytes: u64 = 0;
        let mut frame_buf = vec![0u8; MAX_FRAME_SIZE];

        while test_start.elapsed().as_secs() < duration + 2 {
            let mut len_buf = [0u8; 2];
            match tokio::time::timeout(
                std::time::Duration::from_secs(3),
                tunnel_read.read_exact(&mut len_buf),
            )
            .await
            {
                Ok(Ok(_)) => {}
                _ => break,
            }
            let frame_len = u16::from_be_bytes(len_buf) as usize;
            if frame_len > MAX_FRAME_SIZE {
                break;
            }
            frame_buf.resize(frame_len, 0);
            if tunnel_read
                .read_exact(&mut frame_buf[..frame_len])
                .await
                .is_err()
            {
                break;
            }
            total_bytes += frame_len as u64 + 2;

            // Decrypt to check if it's a SpeedTest frame or Close
            if let Ok((plaintext, _)) = decrypt_frame(cipher.as_ref(), &frame_buf[..frame_len]) {
                if let Ok(f) = decode_data_frame(&plaintext) {
                    match f.command {
                        Command::SpeedTest { .. } => {
                            // Count the data payload
                        }
                        Command::Close => break,
                        _ => {}
                    }
                }
            }
        }

        let elapsed = test_start.elapsed().as_secs_f64();
        let mbps = (total_bytes as f64 * 8.0) / elapsed / 1_000_000.0;
        println!(
            "  Downloaded: {:.2} MB in {:.1}s",
            total_bytes as f64 / 1_048_576.0,
            elapsed
        );
        println!("  Speed: {:.2} Mbps", mbps);
        println!();
    }

    // Run upload test
    if direction == "upload" || direction == "both" {
        println!("Upload test ({} seconds)...", duration);

        // Send CMD_SPEED_TEST requesting upload
        let frame = DataFrame {
            command: Command::SpeedTest {
                direction: 1, // upload
                duration_secs: duration as u8,
                data: vec![],
            },
            flags: 0,
            stream_id: 0,
        };
        let frame_bytes = encode_data_frame(&frame);
        let nonce = session_keys.next_client_nonce();
        let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes)?;
        let len = (encrypted.len() as u16).to_be_bytes();
        tunnel_write.write_all(&len).await?;
        tunnel_write.write_all(&encrypted).await?;

        // Send random data for duration_secs
        let test_start = std::time::Instant::now();
        let mut total_bytes: u64 = 0;
        let random_payload = vec![0xABu8; 8192];

        while test_start.elapsed().as_secs() < duration {
            let frame = DataFrame {
                command: Command::SpeedTest {
                    direction: 1,
                    duration_secs: 0,
                    data: random_payload.clone(),
                },
                flags: 0,
                stream_id: 0,
            };
            let frame_bytes = encode_data_frame(&frame);
            let nonce = session_keys.next_client_nonce();
            let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes)?;
            let len = (encrypted.len() as u16).to_be_bytes();
            if tunnel_write.write_all(&len).await.is_err() {
                break;
            }
            if tunnel_write.write_all(&encrypted).await.is_err() {
                break;
            }
            total_bytes += encrypted.len() as u64 + 2;
        }

        let elapsed = test_start.elapsed().as_secs_f64();
        let mbps = (total_bytes as f64 * 8.0) / elapsed / 1_000_000.0;
        println!(
            "  Uploaded: {:.2} MB in {:.1}s",
            total_bytes as f64 / 1_048_576.0,
            elapsed
        );
        println!("  Speed: {:.2} Mbps", mbps);
        println!();
    }

    println!("Speed test complete.");
    Ok(())
}

fn print_version(json: bool) {
    if json {
        let version_info = serde_json::json!({
            "version": VERSION,
            "protocol_version": PROTOCOL_VERSION,
            "components": {
                "prisma-cli": VERSION,
                "prisma-core": VERSION,
                "prisma-server": VERSION,
                "prisma-client": VERSION,
                "prisma-mgmt": VERSION,
                "prisma-ffi": VERSION,
            },
            "ciphers": ["chacha20-poly1305", "aes-256-gcm"],
            "transports": ["quic", "prisma-tls", "ws", "grpc", "xhttp", "xporta"],
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&version_info).expect("static JSON")
        );
        return;
    }

    println!(
        "prisma {} (PrismaVeil Protocol v{})",
        VERSION, PROTOCOL_VERSION
    );
    println!(
        "  OS/Arch: {}/{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    println!();
    println!("Components:");
    println!("  prisma-cli     {}", VERSION);
    println!("  prisma-core    {}", VERSION);
    println!("  prisma-server  {}", VERSION);
    println!("  prisma-client  {}", VERSION);
    println!("  prisma-mgmt    {}", VERSION);
    println!("  prisma-ffi     {}", VERSION);
    println!();
    println!("Protocol features:");
    println!("  - 2-step handshake (1 RTT)");
    println!("  - 0-RTT session resumption with tickets");
    println!("  - PrismaUDP relay (CMD_UDP_ASSOCIATE/UDP_DATA)");
    println!("  - Encrypted DNS queries (CMD_DNS_QUERY/DNS_RESPONSE)");
    println!("  - Speed test (CMD_SPEED_TEST)");
    println!("  - Challenge-response verification");
    println!("  - 2-byte flags with FEC, priority, compression support");
    println!("  - Server feature negotiation bitmask");
    println!("  - Brutal/BBR/Adaptive congestion control");
    println!("  - Port hopping (QUIC, HMAC-based)");
    println!("  - Salamander v2 UDP obfuscation (nonce-based)");
    println!("  - Forward Error Correction (Reed-Solomon)");
    println!("  - Smart/Fake/Tunnel DNS modes");
    println!("  - Rule-based routing (domain/IP/port)");
    println!("  - Per-client bandwidth limits and traffic quotas");
    println!("  - XPorta transport (REST API simulation, CDN-compatible)");
    println!("  - Bucket padding (anti-encapsulated-TLS fingerprinting)");
    println!("  - Traffic shaping (chaff, jitter, coalescing)");
    println!("  - PrismaTLS (replaces REALITY, padding beacon auth)");
    println!("  - PrismaFP (browser fingerprint mimicry)");
    println!("  - Entropy camouflage (GFW exemption)");
    println!("  - TUN mode");
    println!();
    println!("Supported ciphers:");
    println!("  - chacha20-poly1305 (default)");
    println!("  - aes-256-gcm");
    println!();
    println!("Supported transports:");
    println!("  - quic      (QUIC v2, default)");
    println!("  - prisma-tls (TCP + PrismaTLS)");
    println!("  - ws        (WebSocket, CDN-compatible)");
    println!("  - grpc      (gRPC, CDN-compatible)");
    println!("  - xhttp     (HTTP-native, CDN-compatible)");
    println!("  - xporta    (REST API simulation, CDN-compatible)");
}

fn cmd_update(check_only: bool, skip_confirm: bool, json: bool) {
    use prisma_core::auto_update;

    // 1. Check for updates
    let info = match auto_update::check() {
        Ok(Some(info)) => info,
        Ok(None) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({"up_to_date": true, "version": VERSION})
                );
            } else {
                println!("Already up to date (v{})", VERSION);
            }
            return;
        }
        Err(e) => {
            eprintln!("Failed to check for updates: {}", e);
            std::process::exit(1);
        }
    };

    // 2. Print update info
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&info).expect("serialize UpdateInfo")
        );
        if check_only {
            return;
        }
    } else {
        println!("Update available: v{} -> {}", VERSION, info.version);
        if !info.changelog.is_empty() {
            println!("\nChangelog:\n{}", info.changelog);
        }
        if check_only {
            return;
        }
    }

    if info.url.is_empty() {
        eprintln!("No download URL found for this platform.");
        std::process::exit(1);
    }

    // 3. Confirm
    if !skip_confirm {
        eprint!("\nDownload and apply update? [y/N] ");
        use std::io::Write;
        std::io::stderr().flush().ok();
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).ok();
        if !input.trim().eq_ignore_ascii_case("y") {
            println!("Update cancelled.");
            return;
        }
    }

    // 4. Download
    eprintln!("Downloading {}...", info.url);
    let bytes = match auto_update::download(&info.url) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Download failed: {}", e);
            std::process::exit(1);
        }
    };

    // 5. Replace current binary
    match auto_update::self_replace(&bytes) {
        Ok(()) => {
            println!(
                "Updated to {}. Restart to use the new version.",
                info.version
            );
        }
        Err(e) => {
            eprintln!("Failed to replace binary: {}", e);
            std::process::exit(1);
        }
    }
}
