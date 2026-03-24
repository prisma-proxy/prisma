---
title: prisma-server 参考
---

# prisma-server 参考

服务端二进制 crate。通过多种传输协议接受客户端加密连接，认证并中继流量。

## 监听器类型

TCP、QUIC、CDN (WS/gRPC/XHTTP/XPorta)、SSH、WireGuard

## 热重载

支持 SIGHUP 信号、管理 API、文件监控三种触发方式。

详细内容请参阅英文版本。
