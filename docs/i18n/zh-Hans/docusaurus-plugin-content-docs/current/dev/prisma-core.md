---
title: prisma-core 参考
---

# prisma-core 参考

共享基础库，提供加密、PrismaVeil v5 协议、配置解析、路由、DNS、多路复用、访问控制等。

## 模块列表

| 模块 | 用途 |
|------|------|
| `crypto` | AEAD、KDF、ECDH、PQ-KEM、填充、票据密钥环 |
| `protocol` | 握手、编解码、帧类型、防重放 |
| `config` | 客户端/服务端配置解析、验证 |
| `router` | 基于规则的路由引擎 |
| `dns` | DNS 模式、DoH、Fake IP |
| `mux` | XMUX 流多路复用 |
| `types` | 协议常量、CipherSuite、ClientId |
| `bandwidth` | 速率限制、流量配额 |

详细内容请参阅英文版本。
