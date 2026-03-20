import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {translate} from '@docusaurus/Translate';

import styles from './guide.module.css';

/* =========================================================================
   Beginner's Guide — single-page layout
   ========================================================================= */

export default function GuidePage(): ReactNode {
  return (
    <Layout
      title={translate({id: 'guide.page.title', message: "Beginner's Guide"})}
      description={translate({
        id: 'guide.page.description',
        message: 'Step-by-step beginner guide for setting up Prisma Proxy from scratch',
      })}
    >
      <main className={`container ${styles.page}`}>
        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className={styles.hero}>
          <Heading as="h1" className={styles.heroTitle}>
            {translate({id: 'guide.hero.title', message: "Beginner's Guide"})}
          </Heading>
          <p className={styles.heroSubtitle}>
            {translate({
              id: 'guide.hero.subtitle',
              message: 'Everything you need to set up Prisma from scratch — no prior experience required.',
            })}
          </p>
        </div>

        {/* ── Table of Contents ───────────────────────────────────── */}
        <nav className={styles.toc}>
          <Heading as="h2" className={styles.tocTitle}>
            {translate({id: 'guide.toc', message: 'Table of Contents'})}
          </Heading>
          <ol className={styles.tocList}>
            <li><a href="#what-is-prisma">{translate({id: 'guide.toc.what', message: 'What is Prisma?'})}</a></li>
            <li><a href="#understanding-the-basics">{translate({id: 'guide.toc.basics', message: 'Understanding the Basics'})}</a></li>
            <li><a href="#how-prisma-works">{translate({id: 'guide.toc.how', message: 'How Prisma Works'})}</a></li>
            <li><a href="#preparation">{translate({id: 'guide.toc.prepare', message: 'Preparation'})}</a></li>
            <li><a href="#installing-the-server">{translate({id: 'guide.toc.installServer', message: 'Installing the Server'})}</a></li>
            <li><a href="#configuring-the-server">{translate({id: 'guide.toc.configServer', message: 'Configuring the Server'})}</a></li>
            <li><a href="#installing-the-client">{translate({id: 'guide.toc.installClient', message: 'Installing the Client'})}</a></li>
            <li><a href="#configuring-the-client">{translate({id: 'guide.toc.configClient', message: 'Configuring the Client'})}</a></li>
            <li><a href="#your-first-connection">{translate({id: 'guide.toc.firstConn', message: 'Your First Connection'})}</a></li>
            <li><a href="#going-further">{translate({id: 'guide.toc.further', message: 'Going Further'})}</a></li>
          </ol>
        </nav>

        {/* ================================================================
            Section 1 — What is Prisma?
            ================================================================ */}
        <section className={styles.section} id="what-is-prisma">
          <Heading as="h2">
            {translate({id: 'guide.s1.title', message: 'What is Prisma?'})}
          </Heading>

          <p>
            {translate({
              id: 'guide.s1.p1',
              message: 'Prisma is a tool that creates an encrypted tunnel between your computer and a server somewhere on the internet. All your internet traffic travels through this tunnel, so nobody in between — not your ISP, not your school or office network, not anyone — can see what you are doing online.',
            })}
          </p>

          <blockquote>
            {translate({
              id: 'guide.s1.analogy',
              message: 'Imagine you are sending a letter to a friend, but you don\'t want the mailman to read it. So you put your letter inside a locked box, and only your friend has the key. That is essentially what Prisma does with your internet traffic.',
            })}
          </blockquote>

          <Heading as="h3">
            {translate({id: 'guide.s1.why.title', message: 'Why would you need Prisma?'})}
          </Heading>
          <ul>
            <li><strong>{translate({id: 'guide.s1.why.privacy.label', message: 'Privacy'})}</strong> — {translate({id: 'guide.s1.why.privacy', message: 'Keep your browsing activity private from your internet provider'})}</li>
            <li><strong>{translate({id: 'guide.s1.why.security.label', message: 'Security'})}</strong> — {translate({id: 'guide.s1.why.security', message: 'Protect your data on public Wi-Fi (coffee shops, airports, hotels)'})}</li>
            <li><strong>{translate({id: 'guide.s1.why.access.label', message: 'Access'})}</strong> — {translate({id: 'guide.s1.why.access', message: 'Reach websites and services that might be blocked on your network'})}</li>
            <li><strong>{translate({id: 'guide.s1.why.freedom.label', message: 'Freedom'})}</strong> — {translate({id: 'guide.s1.why.freedom', message: 'Bypass internet censorship and filtering'})}</li>
          </ul>

          <div className={styles.prereqBox}>
            <Heading as="h3">
              {translate({id: 'guide.s1.prereq.title', message: 'Prerequisites'})}
            </Heading>
            <p>{translate({id: 'guide.s1.prereq.p', message: 'You only need two things:'})}</p>
            <ol>
              <li><strong>{translate({id: 'guide.s1.prereq.computer', message: 'A computer'})}</strong> — Windows, macOS, or Linux</li>
              <li><strong>{translate({id: 'guide.s1.prereq.internet', message: 'An internet connection'})}</strong></li>
            </ol>
            <p>{translate({id: 'guide.s1.prereq.note', message: 'This guide assumes zero prior knowledge about networking, servers, or the command line. Every concept is explained from the ground up.'})}</p>
          </div>
        </section>

        {/* ================================================================
            Section 2 — Understanding the Basics
            ================================================================ */}
        <section className={styles.section} id="understanding-the-basics">
          <Heading as="h2">
            {translate({id: 'guide.s2.title', message: 'Understanding the Basics'})}
          </Heading>

          <p>
            {translate({
              id: 'guide.s2.intro',
              message: 'Before we set up Prisma, let\'s understand some fundamental concepts about how the internet works.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s2.ip.title', message: 'IP Addresses & Domain Names'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s2.ip.p',
              message: 'Every device on the internet has a unique IP address (e.g. 203.0.113.45). Domain names like "google.com" are human-friendly aliases — DNS translates them into IP addresses behind the scenes.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s2.ports.title', message: 'Ports & Protocols'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s2.ports.p',
              message: 'A port is like an apartment number inside a building (the server). Common ports: 80 (HTTP), 443 (HTTPS), 22 (SSH), 1080 (SOCKS5). A protocol is the language computers use to talk — TCP guarantees delivery, UDP is faster but best-effort.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s2.https.title', message: 'HTTPS & Encryption'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s2.https.p',
              message: 'HTTPS encrypts the data between your browser and a website, but your ISP can still see which domains you visit. Prisma hides even that — your ISP only sees encrypted data going to a single IP address.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s2.proxy.title', message: 'What is a Proxy?'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s2.proxy.p',
              message: 'A proxy is a middleman between your computer and the internet. Instead of connecting directly to a website, your computer connects to the proxy, and the proxy connects to the website for you. The website sees the proxy\'s IP address, not yours.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s2.dpi.title', message: 'Firewalls & DPI'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s2.dpi.p',
              message: 'A firewall monitors network traffic. DPI (Deep Packet Inspection) looks inside packets to classify traffic types. Some networks use DPI to block VPNs, throttle traffic, or censor websites. Prisma is designed to look like normal web traffic to these systems.',
            })}
          </p>
        </section>

        {/* ================================================================
            Section 3 — How Prisma Works
            ================================================================ */}
        <section className={styles.section} id="how-prisma-works">
          <Heading as="h2">
            {translate({id: 'guide.s3.title', message: 'How Prisma Works'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s3.arch.title', message: 'Client and Server Architecture'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s3.arch.p',
              message: 'Prisma has two main parts: the Client (runs on your computer, encrypts traffic) and the Server (runs on a remote VPS, decrypts and forwards traffic). When you browse the web, traffic flows: Browser -> Prisma Client -> Encrypted Tunnel -> Prisma Server -> Website.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s3.protocol.title', message: 'The PrismaVeil Protocol'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s3.protocol.p',
              message: 'PrismaVeil (v5) is Prisma\'s custom encryption protocol. It features a 1-RTT handshake (0-RTT on reconnection), ChaCha20-Poly1305 or AES-256-GCM encryption, a 1024-bit anti-replay sliding window, and post-quantum key exchange readiness.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s3.transports.title', message: 'Transport Types'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s3.transports.intro',
              message: 'A transport is how encrypted data travels between client and server. Prisma supports nine transports:',
            })}
          </p>

          <div className={styles.transportGrid}>
            <div className={styles.transportCard}>
              <strong>QUIC</strong>
              <span>{translate({id: 'guide.s3.t.quic', message: 'Fastest option. Multiplexed UDP streams with built-in TLS 1.3. Recommended default.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>TCP</strong>
              <span>{translate({id: 'guide.s3.t.tcp', message: 'Reliable fallback when UDP is blocked. Works almost everywhere.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>WebSocket</strong>
              <span>{translate({id: 'guide.s3.t.ws', message: 'CDN-friendly. Hides your server behind Cloudflare.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>gRPC</strong>
              <span>{translate({id: 'guide.s3.t.grpc', message: 'Looks like enterprise API traffic. Works behind CDN.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>XHTTP</strong>
              <span>{translate({id: 'guide.s3.t.xhttp', message: 'Plain HTTP/2 POST streams. No special upgrade headers.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>XPorta</strong>
              <span>{translate({id: 'guide.s3.t.xporta', message: 'Maximum stealth. Fragments data into REST API-style requests.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>ShadowTLS v3</strong>
              <span>{translate({id: 'guide.s3.t.shadowtls', message: 'Mimics a real TLS handshake to a cover server for protocol-level stealth.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>SSH</strong>
              <span>{translate({id: 'guide.s3.t.ssh', message: 'Tunnels through standard SSH connections. Almost never blocked.'})}</span>
            </div>
            <div className={styles.transportCard}>
              <strong>WireGuard</strong>
              <span>{translate({id: 'guide.s3.t.wireguard', message: 'Uses WireGuard protocol for kernel-level performance and minimal overhead.'})}</span>
            </div>
          </div>

          <div className={styles.tipBox}>
            <strong>{translate({id: 'guide.s3.tip.label', message: 'Quick decision:'})}</strong>{' '}
            {translate({
              id: 'guide.s3.tip.text',
              message: 'Start with QUIC. If UDP is blocked, try TCP. If you need CDN protection, use WebSocket. For maximum stealth, use XPorta or ShadowTLS v3.',
            })}
          </div>

          <Heading as="h3">
            {translate({id: 'guide.s3.antidetect.title', message: 'Anti-Detection Features'})}
          </Heading>
          <div className={styles.featureTable}>
            <table>
              <thead>
                <tr>
                  <th>{translate({id: 'guide.s3.antidetect.threat', message: 'Threat'})}</th>
                  <th>{translate({id: 'guide.s3.antidetect.defense', message: 'How Prisma Handles It'})}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>{translate({id: 'guide.s3.ad.isp', message: 'ISP reading traffic'})}</td><td>{translate({id: 'guide.s3.ad.isp.d', message: 'All traffic encrypted with ChaCha20 / AES-256'})}</td></tr>
                <tr><td>{translate({id: 'guide.s3.ad.port', message: 'Firewall blocking proxy ports'})}</td><td>{translate({id: 'guide.s3.ad.port.d', message: 'Runs on port 443 (same as HTTPS)'})}</td></tr>
                <tr><td>{translate({id: 'guide.s3.ad.dpi', message: 'DPI detecting proxy protocols'})}</td><td>{translate({id: 'guide.s3.ad.dpi.d', message: 'Traffic looks like random data or normal HTTPS'})}</td></tr>
                <tr><td>{translate({id: 'guide.s3.ad.pattern', message: 'Traffic pattern analysis'})}</td><td>{translate({id: 'guide.s3.ad.pattern.d', message: 'Padding, timing jitter, and chaff injection'})}</td></tr>
                <tr><td>{translate({id: 'guide.s3.ad.probe', message: 'Active probing'})}</td><td>{translate({id: 'guide.s3.ad.probe.d', message: 'Camouflage mode shows a real website to probers'})}</td></tr>
                <tr><td>{translate({id: 'guide.s3.ad.replay', message: 'Replay attacks'})}</td><td>{translate({id: 'guide.s3.ad.replay.d', message: '1024-bit sliding window prevents replay'})}</td></tr>
                <tr><td>{translate({id: 'guide.s3.ad.ipblock', message: 'Server IP blocked'})}</td><td>{translate({id: 'guide.s3.ad.ipblock.d', message: 'CDN transports (WS, gRPC, XHTTP, XPorta) hide the IP'})}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ================================================================
            Section 4 — Preparation
            ================================================================ */}
        <section className={styles.section} id="preparation">
          <Heading as="h2">
            {translate({id: 'guide.s4.title', message: 'Preparation'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s4.need.title', message: 'What You Need'})}
          </Heading>
          <ol>
            <li><strong>{translate({id: 'guide.s4.need.local', message: 'A local computer'})}</strong> — {translate({id: 'guide.s4.need.local.d', message: 'Your everyday device. The Prisma Client runs here.'})}</li>
            <li><strong>{translate({id: 'guide.s4.need.vps', message: 'A remote server (VPS)'})}</strong> — {translate({id: 'guide.s4.need.vps.d', message: 'A rented server in a data center. The Prisma Server runs here. A $5/month VPS with 512 MB RAM is more than enough.'})}</li>
          </ol>

          <Heading as="h3">
            {translate({id: 'guide.s4.ssh.title', message: 'Connecting via SSH'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s4.ssh.p',
              message: 'SSH lets you control your server remotely. Open a terminal (Terminal on macOS/Linux, Windows Terminal on Windows) and run:',
            })}
          </p>
          <pre className={styles.codeBlock}><code>ssh root@YOUR-SERVER-IP</code></pre>
          <p>
            {translate({
              id: 'guide.s4.ssh.accept',
              message: 'The first time you connect, type "yes" to accept the server fingerprint, then enter your password.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s4.terminal.title', message: 'Essential Terminal Commands'})}
          </Heading>
          <div className={styles.featureTable}>
            <table>
              <thead>
                <tr>
                  <th>{translate({id: 'guide.s4.terminal.cmd', message: 'Command'})}</th>
                  <th>{translate({id: 'guide.s4.terminal.what', message: 'What It Does'})}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code>ls</code></td><td>{translate({id: 'guide.s4.t.ls', message: 'List files in the current directory'})}</td></tr>
                <tr><td><code>cd /path</code></td><td>{translate({id: 'guide.s4.t.cd', message: 'Change directory'})}</td></tr>
                <tr><td><code>cat file</code></td><td>{translate({id: 'guide.s4.t.cat', message: 'Display file contents'})}</td></tr>
                <tr><td><code>nano file</code></td><td>{translate({id: 'guide.s4.t.nano', message: 'Edit a file (Ctrl+O to save, Ctrl+X to exit)'})}</td></tr>
                <tr><td><code>mkdir dir</code></td><td>{translate({id: 'guide.s4.t.mkdir', message: 'Create a directory'})}</td></tr>
                <tr><td><code>sudo cmd</code></td><td>{translate({id: 'guide.s4.t.sudo', message: 'Run a command as administrator'})}</td></tr>
                <tr><td><code>systemctl start/stop/status svc</code></td><td>{translate({id: 'guide.s4.t.systemctl', message: 'Manage system services'})}</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">
            {translate({id: 'guide.s4.update.title', message: 'Update Your Server'})}
          </Heading>
          <pre className={styles.codeBlock}><code>sudo apt update && sudo apt upgrade -y</code></pre>
        </section>

        {/* ================================================================
            Section 5 — Installing the Server
            ================================================================ */}
        <section className={styles.section} id="installing-the-server">
          <Heading as="h2">
            {translate({id: 'guide.s5.title', message: 'Installing the Server'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s5.oneline.title', message: 'Method 1: One-Line Install (Recommended)'})}
          </Heading>
          <pre className={styles.codeBlock}><code>curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash</code></pre>
          <p>
            {translate({
              id: 'guide.s5.oneline.setup',
              message: 'Add --setup to also generate credentials, TLS certificates, and example config files:',
            })}
          </p>
          <pre className={styles.codeBlock}><code>curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --setup</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s5.docker.title', message: 'Method 2: Docker'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`docker run -d \\
  --name prisma-server \\
  --restart unless-stopped \\
  -v /etc/prisma:/config \\
  -p 8443:8443/tcp \\
  -p 8443:8443/udp \\
  ghcr.io/yamimega/prisma server -c /config/server.toml`}</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s5.source.title', message: 'Method 3: Build from Source'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
git clone https://github.com/Yamimega/prisma.git && cd prisma
cargo build --release
sudo cp target/release/prisma /usr/local/bin/`}</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s5.verify.title', message: 'Verify Installation'})}
          </Heading>
          <pre className={styles.codeBlock}><code>prisma --version</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s5.firewall.title', message: 'Open Firewall Ports'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`sudo ufw allow 8443/tcp
sudo ufw allow 8443/udp`}</code></pre>
        </section>

        {/* ================================================================
            Section 6 — Configuring the Server
            ================================================================ */}
        <section className={styles.section} id="configuring-the-server">
          <Heading as="h2">
            {translate({id: 'guide.s6.title', message: 'Configuring the Server'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s6.genkey.title', message: 'Step 1: Generate Credentials'})}
          </Heading>
          <pre className={styles.codeBlock}><code>prisma gen-key</code></pre>
          <p>
            {translate({
              id: 'guide.s6.genkey.note',
              message: 'This outputs a Client ID (UUID) and Auth Secret (64 hex characters). Save both — you will need them for both the server and client configuration.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s6.cert.title', message: 'Step 2: Generate TLS Certificate'})}
          </Heading>
          <pre className={styles.codeBlock}><code>prisma gen-cert --output /etc/prisma --cn prisma-server</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s6.config.title', message: 'Step 3: Write the Server Config'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`sudo nano /etc/prisma/server.toml`}</code></pre>
          <pre className={styles.codeBlock}><code>{`# Prisma Server Configuration
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

[tls]
cert_path = "/etc/prisma/prisma-cert.pem"
key_path = "/etc/prisma/prisma-key.pem"

[[authorized_clients]]
id = "PASTE-YOUR-CLIENT-ID-HERE"
auth_secret = "PASTE-YOUR-AUTH-SECRET-HERE"
name = "my-first-client"

[logging]
level = "info"
format = "pretty"

[performance]
max_connections = 1024
connection_timeout_secs = 300

[padding]
min = 0
max = 256`}</code></pre>

          <div className={styles.warningBox}>
            {translate({
              id: 'guide.s6.config.warning',
              message: 'Replace PASTE-YOUR-CLIENT-ID-HERE and PASTE-YOUR-AUTH-SECRET-HERE with the actual values from prisma gen-key. The credentials must match exactly between server and client.',
            })}
          </div>

          <Heading as="h3">
            {translate({id: 'guide.s6.validate.title', message: 'Step 4: Validate & Test'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`prisma validate -c /etc/prisma/server.toml
prisma server -c /etc/prisma/server.toml`}</code></pre>
          <p>
            {translate({
              id: 'guide.s6.validate.note',
              message: 'You should see "Server ready!" in the output. Press Ctrl+C to stop for now — we will set up a system service later.',
            })}
          </p>
        </section>

        {/* ================================================================
            Section 7 — Installing the Client
            ================================================================ */}
        <section className={styles.section} id="installing-the-client">
          <Heading as="h2">
            {translate({id: 'guide.s7.title', message: 'Installing the Client'})}
          </Heading>

          <div className={styles.featureTable}>
            <table>
              <thead>
                <tr>
                  <th>{translate({id: 'guide.s7.client', message: 'Client'})}</th>
                  <th>{translate({id: 'guide.s7.bestfor', message: 'Best For'})}</th>
                  <th>{translate({id: 'guide.s7.platforms', message: 'Platforms'})}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><strong>prisma-gui</strong></td><td>{translate({id: 'guide.s7.gui.for', message: 'Most users — point-and-click interface'})}</td><td>Windows, macOS, Linux</td></tr>
                <tr><td><strong>prisma CLI</strong></td><td>{translate({id: 'guide.s7.cli.for', message: 'Power users, servers, automation'})}</td><td>Windows, macOS, Linux, FreeBSD</td></tr>
                <tr><td><strong>Android App</strong></td><td>{translate({id: 'guide.s7.android.for', message: 'Native app (Kotlin + JNI) with TUN, per-app proxy, subscriptions'})}</td><td>Android 7.0+</td></tr>
                <tr><td><strong>iOS App</strong></td><td>{translate({id: 'guide.s7.ios.for', message: 'Native app (Swift + xcframework) with Network Extension'})}</td><td>iOS 15.0+</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">
            {translate({id: 'guide.s7.gui.title', message: 'prisma-gui (Desktop App)'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s7.gui.p',
              message: 'Download the latest release from the GitHub Releases page. On Windows, run the .exe installer. On macOS, open the .dmg and drag to Applications. On Linux, install the .deb package or run the .AppImage.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s7.cli.title', message: 'prisma CLI'})}
          </Heading>
          <p>{translate({id: 'guide.s7.cli.linux', message: 'Linux / macOS:'})}</p>
          <pre className={styles.codeBlock}><code>curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash</code></pre>
          <p>{translate({id: 'guide.s7.cli.win', message: 'Windows (PowerShell):'})}</p>
          <pre className={styles.codeBlock}><code>irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1 | iex</code></pre>
        </section>

        {/* ================================================================
            Section 8 — Configuring the Client
            ================================================================ */}
        <section className={styles.section} id="configuring-the-client">
          <Heading as="h2">
            {translate({id: 'guide.s8.title', message: 'Configuring the Client'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s8.gui.title', message: 'Using prisma-gui'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s8.gui.p',
              message: 'Open the app, click "New Profile", fill in your server address, Client ID, Auth Secret, and select QUIC transport. Enable "Skip Certificate Verify" for self-signed certificates. You can also import configurations via subscription URL or QR code.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s8.cli.title', message: 'Using the CLI'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`# client.toml
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"
server_addr = "YOUR-SERVER-IP:8443"
cipher_suite = "chacha20-poly1305"
transport = "quic"
skip_cert_verify = true

[identity]
client_id = "YOUR-CLIENT-ID"
auth_secret = "YOUR-AUTH-SECRET"

[logging]
level = "info"
format = "pretty"`}</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s8.browser.title', message: 'Browser Proxy Setup'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s8.browser.firefox',
              message: 'Firefox: Settings > Network Settings > Manual proxy > SOCKS Host: 127.0.0.1, Port: 1080, SOCKS v5. Check "Proxy DNS when using SOCKS v5".',
            })}
          </p>
          <p>
            {translate({
              id: 'guide.s8.browser.chrome',
              message: 'Chrome/Edge: Install the SwitchyOmega extension. Create a SOCKS5 profile pointing to 127.0.0.1:1080.',
            })}
          </p>
        </section>

        {/* ================================================================
            Section 9 — Your First Connection
            ================================================================ */}
        <section className={styles.section} id="your-first-connection">
          <Heading as="h2">
            {translate({id: 'guide.s9.title', message: 'Your First Connection'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s9.checklist.title', message: 'Pre-Flight Checklist'})}
          </Heading>
          <ul className={styles.checklist}>
            <li>{translate({id: 'guide.s9.check.1', message: 'Server: Prisma installed and config validated'})}</li>
            <li>{translate({id: 'guide.s9.check.2', message: 'Server: Firewall port 8443 open (TCP and UDP)'})}</li>
            <li>{translate({id: 'guide.s9.check.3', message: 'Client: Prisma installed (GUI or CLI)'})}</li>
            <li>{translate({id: 'guide.s9.check.4', message: 'Client: Credentials match between server and client'})}</li>
          </ul>

          <Heading as="h3">
            {translate({id: 'guide.s9.start.title', message: 'Start Server & Client'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`# On the server (via SSH):
prisma server -c /etc/prisma/server.toml

# On your local computer:
prisma client -c ~/client.toml`}</code></pre>
          <p>
            {translate({
              id: 'guide.s9.start.success',
              message: 'The client should display "Connected! Handshake completed". On the server, you should see "New client connected".',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s9.verify.title', message: 'Verify It Works'})}
          </Heading>
          <pre className={styles.codeBlock}><code>curl --socks5 127.0.0.1:1080 https://httpbin.org/ip</code></pre>
          <p>
            {translate({
              id: 'guide.s9.verify.note',
              message: 'The IP address in the response should be your server\'s IP, not your local IP. If it matches, congratulations — Prisma is working!',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s9.trouble.title', message: 'Common Issues'})}
          </Heading>
          <div className={styles.featureTable}>
            <table>
              <thead>
                <tr>
                  <th>{translate({id: 'guide.s9.trouble.problem', message: 'Problem'})}</th>
                  <th>{translate({id: 'guide.s9.trouble.solution', message: 'Solution'})}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>{translate({id: 'guide.s9.t.refused', message: 'Connection refused / timed out'})}</td><td>{translate({id: 'guide.s9.t.refused.s', message: 'Check server is running, firewall is open, IP and port are correct'})}</td></tr>
                <tr><td>{translate({id: 'guide.s9.t.auth', message: 'Authentication failed'})}</td><td>{translate({id: 'guide.s9.t.auth.s', message: 'Credentials must match exactly between server and client configs'})}</td></tr>
                <tr><td>{translate({id: 'guide.s9.t.tls', message: 'TLS handshake failed'})}</td><td>{translate({id: 'guide.s9.t.tls.s', message: 'Set skip_cert_verify = true for self-signed certificates'})}</td></tr>
                <tr><td>{translate({id: 'guide.s9.t.addr', message: 'Address already in use'})}</td><td>{translate({id: 'guide.s9.t.addr.s', message: 'Stop the other program using port 1080, or change the port in config'})}</td></tr>
                <tr><td>{translate({id: 'guide.s9.t.slow', message: 'Very slow connection'})}</td><td>{translate({id: 'guide.s9.t.slow.s', message: 'Try a different transport (TCP vs QUIC), check server location and load'})}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ================================================================
            Section 10 — Going Further
            ================================================================ */}
        <section className={styles.section} id="going-further">
          <Heading as="h2">
            {translate({id: 'guide.s10.title', message: 'Going Further'})}
          </Heading>

          <Heading as="h3">
            {translate({id: 'guide.s10.systemd.title', message: 'Run as a System Service'})}
          </Heading>
          <pre className={styles.codeBlock}><code>{`# Create the service file
sudo nano /etc/systemd/system/prisma-server.service

# Content:
[Unit]
Description=Prisma Proxy Server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/prisma server -c /etc/prisma/server.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target`}</code></pre>
          <pre className={styles.codeBlock}><code>{`sudo systemctl daemon-reload
sudo systemctl enable --now prisma-server`}</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s10.routing.title', message: 'Routing Rules (Split Tunneling)'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.routing.p',
              message: 'Add routing rules to your client.toml to control which traffic goes through the proxy and which connects directly. Prisma supports ACL files, rule providers (remote rule lists), and proxy groups for load balancing and failover.',
            })}
          </p>
          <pre className={styles.codeBlock}><code>{`[routing]
geoip_path = "/etc/prisma/geoip.dat"

[[routing.rules]]
type = "geoip"
value = "private"
action = "direct"

[[routing.rules]]
type = "domain-keyword"
value = "ads"
action = "block"

[[routing.rules]]
type = "all"
action = "proxy"`}</code></pre>

          <Heading as="h3">
            {translate({id: 'guide.s10.subscription.title', message: 'Subscription Management'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.subscription.p',
              message: 'Prisma supports multi-protocol subscription import. You can import server configurations from subscription URLs that contain Shadowsocks (SS), VMess, Trojan, or VLESS links. The GUI and CLI both support one-click subscription import and auto-update.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.proxyGroups.title', message: 'Proxy Groups'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.proxyGroups.p',
              message: 'Use multiple servers with automatic selection strategies. Proxy group types: Select (manual), AutoUrl (latency-based auto-pick), Fallback (first available), and LoadBalance (round-robin or random). Configure in client.toml with [[proxy_groups]] sections.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.ruleProviders.title', message: 'Rule Providers'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.ruleProviders.p',
              message: 'Load routing rules from remote URLs with auto-refresh. Rule providers keep your config clean and rules up-to-date. Support domain lists, IP CIDR lists, and mixed formats.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.acl.title', message: 'Per-Client ACLs'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.acl.p',
              message: 'Access Control Lists let you restrict which destinations each client can access on the server side. Use domain, IP, and port matchers with allow/deny policies. Manage via config or the REST API.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.portForward.title', message: 'Port Forwarding'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.portForward.p',
              message: 'Expose local services through the encrypted tunnel. The client registers port forwards with the server, and inbound connections to the server port are relayed back to your local machine.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.hotReload.title', message: 'Hot Reload & Daemon Mode'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.hotReload.p',
              message: 'Enable config_watch = true for automatic config reloading when the file changes. Use --daemon flag for built-in daemon mode. Session ticket keys rotate automatically (configurable via ticket_rotation_hours) for forward secrecy.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.cdn.title', message: 'Cloudflare CDN Setup'})}
          </Heading>
          <p>
            {translate({
              id: 'guide.s10.cdn.p',
              message: 'Hide your server behind Cloudflare for extra stealth. Point a domain to your server in Cloudflare DNS, enable the proxy (orange cloud), and configure Prisma to use WebSocket or XPorta transport. Observers only see traffic going to Cloudflare.',
            })}
          </p>

          <Heading as="h3">
            {translate({id: 'guide.s10.perf.title', message: 'Performance Tips'})}
          </Heading>
          <ul>
            <li>{translate({id: 'guide.s10.perf.cipher', message: 'Use AES-256-GCM on desktop CPUs with hardware AES; ChaCha20-Poly1305 on mobile/ARM'})}</li>
            <li>{translate({id: 'guide.s10.perf.bbr', message: 'Set congestion mode to "bbr" for optimal throughput'})}</li>
            <li>{translate({id: 'guide.s10.perf.xmux', message: 'Use XMUX connection pooling for CDN transports to reduce handshake overhead'})}</li>
            <li>{translate({id: 'guide.s10.perf.iouring', message: 'On Linux, Prisma supports io_uring for high-throughput zero-copy I/O'})}</li>
            <li>{translate({id: 'guide.s10.perf.daemon', message: 'Use --daemon flag for built-in daemon mode without systemd'})}</li>
          </ul>

          <Heading as="h3">
            {translate({id: 'guide.s10.security.title', message: 'Security Best Practices'})}
          </Heading>
          <ul>
            <li>{translate({id: 'guide.s10.sec.genkey', message: 'Always use prisma gen-key for credentials — never make up your own'})}</li>
            <li>{translate({id: 'guide.s10.sec.letsencrypt', message: 'Use Let\'s Encrypt certificates for production deployments'})}</li>
            <li>{translate({id: 'guide.s10.sec.unique', message: 'Use unique credentials per client device for easy revocation'})}</li>
            <li>{translate({id: 'guide.s10.sec.mgmt', message: 'Bind the management API to 127.0.0.1 and use SSH tunneling to access it'})}</li>
            <li>{translate({id: 'guide.s10.sec.update', message: 'Keep Prisma updated — updates include security fixes'})}</li>
            <li>{translate({id: 'guide.s10.sec.acl', message: 'Use per-client ACLs to restrict access for shared or untrusted devices'})}</li>
            <li>{translate({id: 'guide.s10.sec.ticketRotation', message: 'Configure ticket_rotation_hours for session ticket key rotation (default: 6 hours)'})}</li>
          </ul>

          <Heading as="h3">
            {translate({id: 'guide.s10.next.title', message: 'Further Reading'})}
          </Heading>
          <ul>
            <li><a href="/prisma/docs/configuration/server">{translate({id: 'guide.s10.next.serverRef', message: 'Server Configuration Reference'})}</a></li>
            <li><a href="/prisma/docs/configuration/client">{translate({id: 'guide.s10.next.clientRef', message: 'Client Configuration Reference'})}</a></li>
            <li><a href="/prisma/docs/deployment/config-examples">{translate({id: 'guide.s10.next.examples', message: 'Configuration Examples'})}</a></li>
            <li><a href="/prisma/docs/security/prismaveil-protocol">{translate({id: 'guide.s10.next.protocol', message: 'PrismaVeil Protocol Deep Dive'})}</a></li>
            <li><a href="/prisma/docs/features/management-api">{translate({id: 'guide.s10.next.api', message: 'Management API Reference'})}</a></li>
          </ul>
        </section>
      </main>
    </Layout>
  );
}
