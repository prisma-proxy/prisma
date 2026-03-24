---
title: prisma-client 参考
---

# prisma-client 参考

客户端库 crate。提供 SOCKS5/HTTP 代理、传输选择、TUN 模式、连接池、DNS 解析等。

## 客户端架构

```mermaid
flowchart LR
    S5[SOCKS5 Inbound] --> TS[Transport Selector]
    HTTP[HTTP Proxy] --> TS
    TUN[TUN Device] --> TS
    TS --> |QUIC| Q[QUIC Transport]
    TS --> |WS| WS[WebSocket]
    TS --> |gRPC| G[gRPC]
    TS --> |XHTTP| XH[XHTTP]
    TS --> |XPorta| XP[XPorta]
    TS --> |WireGuard| WG[WireGuard]
    Q --> ENC[PrismaVeil v5 Encryption]
    WS --> ENC
    G --> ENC
    XH --> ENC
    XP --> ENC
    WG --> ENC
    ENC --> SRV[Prisma Server]
```

## 传输选择

QUIC、PrismaTLS、WebSocket、gRPC、XHTTP、XPorta、SSH、WireGuard

## TUN 模式

支持分应用过滤：`{"mode": "include", "apps": ["Firefox"]}`

详细内容请参阅英文版本。
