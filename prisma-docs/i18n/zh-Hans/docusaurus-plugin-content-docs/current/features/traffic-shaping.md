---
sidebar_position: 10
---

# 流量整形 (Traffic Shaping)

PrismaVeil v5 包含针对封装 TLS 指纹识别 (Fingerprinting) 的流量整形 (Traffic Shaping) 防御机制，相关研究发表于 USENIX Security 2024。这些防御措施可防止审查者通过分析数据包大小分布和时序模式来识别代理流量。

## 桶填充 (Bucket Padding)

将每个帧填充到固定桶集合中最近的尺寸。这消除了基于大小对内层 TLS 握手进行分类的可能性。

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
```

如果不使用桶填充，内层 TLS ClientHello（约 512 字节）的大小即使经过外层加密仍然可见，审查者可以据此检测 TLS 嵌套 TLS 的模式。

## 杂音注入 (Chaff Injection)

在空闲期间发送虚假帧以维持背景流量噪声。杂音帧使用 `FLAG_CHAFF` 标记，接收方会直接丢弃。

```toml
[traffic_shaping]
chaff_interval_ms = 500   # 空闲时每 500ms 发送一次杂音帧
```

## 时序抖动 (Timing Jitter)

为握手 (Handshake) 阶段的帧添加随机延迟，打破可能暴露内层协议的时序模式。

```toml
[traffic_shaping]
timing_jitter_ms = 30   # 最多 30ms 的随机延迟
```

## 帧合并 (Frame Coalescing)

在一个时间窗口内缓冲小帧并将其合并为较大的帧。这隐藏了内层 TLS 握手消息的数据包大小特征。

```toml
[traffic_shaping]
coalesce_window_ms = 5   # 缓冲最多 5ms
```

## 推荐配置

最大化反指纹识别保护：

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
timing_jitter_ms = 30
chaff_interval_ms = 500
coalesce_window_ms = 5
```

对性能敏感的部署（最小开销）：

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [512, 1024, 4096, 16384]
```

## 性能影响

- 桶填充 (Bucket Padding)：带宽 (Bandwidth) 开销低于 5%
- 杂音注入 (Chaff Injection)：约每 500ms 一个小帧（可忽略不计）
- 时序抖动 (Timing Jitter)：仅在握手阶段增加不超过 50ms 的延迟 (Latency)
- 帧合并 (Frame Coalescing)：小帧增加不超过 5ms 的延迟
