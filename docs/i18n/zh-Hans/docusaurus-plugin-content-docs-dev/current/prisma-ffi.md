# prisma-ffi 参考

`prisma-ffi` 是用于 Prisma GUI (Tauri/React) 和移动端客户端 (Android/iOS) 的 C FFI 共享库 crate。暴露安全的 C ABI 接口，用于生命周期管理、连接控制、配置文件管理、QR 码处理、系统代理设置、自动更新、分应用代理、代理组、端口转发、速度测试和移动端生命周期事件。

**路径：** `crates/prisma-ffi/src/`

---

## 安全契约

- 传入的所有指针必须在调用期间有效
- 字符串为 null 终止的 UTF-8 (`*const c_char`)
- 返回 `*mut c_char` 的函数需要调用者使用 `prisma_free_string()` 释放
- `prisma_version()` 的返回值是静态的 -- 不要释放
- 所有 `extern "C"` 函数在 FFI 边界捕获 panic 以防止未定义行为

---

## 错误码

| 常量 | 值 | 描述 |
|------|-----|------|
| `PRISMA_OK` | `0` | 成功 |
| `PRISMA_ERR_INVALID_CONFIG` | `1` | 配置或输入无效 |
| `PRISMA_ERR_ALREADY_CONNECTED` | `2` | 已连接 |
| `PRISMA_ERR_NOT_CONNECTED` | `3` | 未连接 |
| `PRISMA_ERR_PERMISSION_DENIED` | `4` | 操作系统权限被拒绝 |
| `PRISMA_ERR_INTERNAL` | `5` | 内部错误 |
| `PRISMA_ERR_NULL_POINTER` | `6` | 传入了空指针 |

---

## 状态码

| 常量 | 值 | 描述 |
|------|-----|------|
| `PRISMA_STATUS_DISCONNECTED` | `0` | 未连接 |
| `PRISMA_STATUS_CONNECTING` | `1` | 连接中 |
| `PRISMA_STATUS_CONNECTED` | `2` | 已连接 |
| `PRISMA_STATUS_ERROR` | `3` | 错误状态 |

---

## 代理模式标志（位字段）

| 常量 | 值 | 描述 |
|------|-----|------|
| `PRISMA_MODE_SOCKS5` | `0x01` | SOCKS5 代理 |
| `PRISMA_MODE_SYSTEM_PROXY` | `0x02` | 设置系统代理 |
| `PRISMA_MODE_TUN` | `0x04` | TUN 透明代理 |
| `PRISMA_MODE_PER_APP` | `0x08` | 分应用代理 |

---

## 导出函数

### 生命周期管理

| 函数 | 描述 |
|------|------|
| `prisma_create() -> *mut PrismaClient` | 创建客户端句柄 |
| `prisma_destroy(handle)` | 销毁客户端句柄 |
| `prisma_version() -> *const c_char` | 获取版本字符串（静态，不要释放） |
| `prisma_free_string(s)` | 释放 prisma_* 函数返回的字符串 |

### 连接控制

| 函数 | 描述 |
|------|------|
| `prisma_connect(handle, config_json, modes) -> c_int` | 使用配置 JSON 和模式标志连接 |
| `prisma_disconnect(handle) -> c_int` | 断开当前会话 |
| `prisma_get_status(handle) -> c_int` | 获取连接状态 |
| `prisma_get_stats_json(handle) -> *mut c_char` | 获取统计信息 JSON（需释放） |
| `prisma_set_callback(handle, callback, userdata)` | 注册事件回调 |

### 配置文件管理

| 函数 | 描述 |
|------|------|
| `prisma_profiles_list_json() -> *mut c_char` | 列出所有配置文件（需释放） |
| `prisma_profile_save(json) -> c_int` | 保存配置文件 |
| `prisma_profile_delete(id) -> c_int` | 删除配置文件 |
| `prisma_import_subscription(url) -> *mut c_char` | 导入订阅（需释放） |
| `prisma_refresh_subscriptions() -> *mut c_char` | 刷新所有订阅（需释放） |

### QR 码和分享

| 函数 | 描述 |
|------|------|
| `prisma_profile_to_qr_svg(json) -> *mut c_char` | 生成 QR SVG（需释放） |
| `prisma_profile_from_qr(data, out_json) -> c_int` | 解码 QR 数据 |
| `prisma_profile_to_uri(json) -> *mut c_char` | 生成 prisma:// URI（需释放） |
| `prisma_profile_config_to_toml(json) -> *mut c_char` | 转换为 TOML（需释放） |

### 系统代理

| 函数 | 描述 |
|------|------|
| `prisma_set_system_proxy(host, port) -> c_int` | 设置系统代理 |
| `prisma_clear_system_proxy() -> c_int` | 清除系统代理 |

### 自动更新

| 函数 | 描述 |
|------|------|
| `prisma_check_update_json() -> *mut c_char` | 检查更新（需释放） |
| `prisma_apply_update(url, sha256) -> c_int` | 下载并应用更新 |

### Ping 和速度测试

| 函数 | 描述 |
|------|------|
| `prisma_ping(addr) -> *mut c_char` | TCP 连接延迟测量（需释放） |
| `prisma_speed_test(handle, server, secs, dir) -> c_int` | 运行速度测试（非阻塞） |

### 分应用代理

| 函数 | 描述 |
|------|------|
| `prisma_set_per_app_filter(json) -> c_int` | 设置分应用过滤器 |
| `prisma_get_per_app_filter() -> *mut c_char` | 获取当前过滤器（需释放） |
| `prisma_get_running_apps() -> *mut c_char` | 获取运行中的应用列表（需释放） |

### 代理组

| 函数 | 描述 |
|------|------|
| `prisma_proxy_groups_init(json) -> c_int` | 初始化代理组 |
| `prisma_proxy_groups_list() -> *mut c_char` | 列出代理组（需释放） |
| `prisma_proxy_group_select(group, server) -> c_int` | 选择服务器 |
| `prisma_proxy_group_test(group) -> *mut c_char` | 测试延迟（需释放） |

### 端口转发

| 函数 | 描述 |
|------|------|
| `prisma_port_forwards_list(handle) -> *mut c_char` | 列出端口转发（需释放） |
| `prisma_port_forward_add(handle, json) -> c_int` | 动态添加端口转发 |
| `prisma_port_forward_remove(handle, port) -> c_int` | 动态删除端口转发 |

### 移动端生命周期

| 函数 | 描述 |
|------|------|
| `prisma_get_network_type(handle) -> c_int` | 获取网络类型 |
| `prisma_on_network_change(handle, type) -> c_int` | 通知网络变更 |
| `prisma_on_memory_warning(handle) -> c_int` | 通知内存警告 |
| `prisma_on_background(handle) -> c_int` | 通知进入后台 |
| `prisma_on_foreground(handle) -> c_int` | 通知回到前台 |
| `prisma_get_traffic_stats(handle) -> *mut c_char` | 获取流量统计（需释放） |

---

---

## 新模块 (v2.0.0)

### 连接管理器

`connection` 模块管理 FFI 层代理连接的生命周期：

| 状态码 | 值 | 含义 |
|--------|-----|------|
| `STATUS_DISCONNECTED` | `0` | 未连接 |
| `STATUS_CONNECTING` | `1` | 连接进行中 |
| `STATUS_CONNECTED` | `2` | 已连接并中继 |

**核心方法：**

- `begin_connect(socks5_addr)` -- 转换为 CONNECTING 状态，重置计数器，返回停止接收器
- `mark_connected()` -- 转换为 CONNECTED 状态
- `disconnect()` -- 发送停止信号，转换为 DISCONNECTED 状态
- `add_bytes_up(n)` / `add_bytes_down(n)` -- 线程安全的原子字节计数器
- `get_stats_json()` -- 返回包含字节数、速度（自上次调用以来的增量）和运行时间的 JSON

**统计 JSON 格式：**

```json
{
  "type": "stats",
  "bytes_up": 102400,
  "bytes_down": 204800,
  "speed_up_bps": 8192,
  "speed_down_bps": 16384,
  "uptime_secs": 60
}
```

速度以自上次调用以来的字节增量计算，转换为 bits/sec。设计为由统计轮询器每秒轮询一次。

### 统计轮询器

`stats_poller` 模块运行后台 tokio 任务，每秒轮询连接管理器并通过 C 回调发送统计 JSON：

```rust
pub type StatsCallback = unsafe extern "C" fn(
    event_json: *const c_char,
    userdata: *mut c_void,
);

StatsPoller::start(connection, callback, userdata) -> StatsPoller
```

轮询器在 drop 时或调用 `stop()` 时自动停止。`userdata` 指针原样传递给回调。

### 自动更新

`auto_update` 模块通过 GitHub Releases API 检查更新：

- **`check()`** -- 返回 `Option<UpdateInfo>`，包含版本、下载 URL 和更新日志
- **`apply(download_url, expected_sha256)`** -- 下载二进制文件，验证 SHA-256 哈希，保存到临时目录

平台检测自动进行：模块为 Windows、macOS、Linux、Android 和 iOS 选择正确的资产后缀。

### GeoIP 模块

`geo` 模块提供 IP 到国家的解析，用于 GUI 服务器位置显示：

- **`init(db_path)`** -- 加载 MaxMind GeoLite2-Country 数据库文件
- **`lookup_country(ip)`** -- 返回 `CountryInfo { code, name, cidrs }`
- **`lookup_country_code(ip)`** -- 便捷函数，仅返回 ISO alpha-2 国家代码
- **`country_cidrs(country_code)`** -- 返回指定国家的 CIDR 块
- **`is_initialized()`** -- 检查数据库是否已加载

### 运行时模块

`runtime` 模块为 FFI 消费者提供托管的 tokio 运行时：

```rust
let rt = PrismaRuntime::new()?;  // 多线程，线程名 "prisma-ffi"
rt.spawn(async { ... });          // 非阻塞派生
rt.block_on(async { ... });       // 阻塞式（用于 FFI 入口点）
rt.handle();                      // 获取 Handle 用于从其他上下文派生
```

在移动端，宿主应用创建 `PrismaRuntime` 来运行异步操作，不干扰 UI 线程。

### iOS 绑定

`ios` 模块提供 iOS 特定的 C 函数用于 Swift 互操作：

| 函数 | 描述 |
|------|------|
| `prisma_ios_prepare_tunnel_config(json)` | 为 VPN 隧道配置填充默认值（MTU、DNS、路由） |
| `prisma_ios_get_tun_fd()` | 获取 TUN 文件描述符 |
| `prisma_ios_set_tun_fd(fd)` | 从 NEPacketTunnelProvider 设置 TUN fd |
| `prisma_ios_get_data_dir()` | 获取 `~/Documents/Prisma` 路径 |
| `prisma_ios_vpn_permission_status()` | 获取缓存的 VPN 权限状态（1=已授权，0=已拒绝，-1=未知） |
| `prisma_ios_set_vpn_permission(granted)` | 从 Swift 缓存 VPN 权限状态 |
| `prisma_ios_get_info()` | 获取 iOS 配置 JSON（端口、tun_fd、vpn_permission、version） |

### Android JNI 绑定

`android` 模块为 `com.prisma.core.PrismaCore` 提供 JNI 入口点：

| JNI 方法 | 映射到 |
|----------|--------|
| `nativeInit(configJson)` | `prisma_init()` |
| `nativeStart()` | `prisma_start()` |
| `nativeStop()` | `prisma_stop()` |
| `nativeDestroy()` | `prisma_destroy()` |
| `nativeGetStatus()` | `prisma_get_status()` |
| `nativeProfilesList()` | `prisma_list_profiles()` |
| `nativeProfileSave(json)` | `prisma_save_profile()` |
| `nativeProfileDelete(id)` | `prisma_delete_profile()` |
| `nativeImportProfile(url)` | `prisma_import_profile()` |
| `nativeOnNetworkChange(type)` | 网络类型更新（0=断开，1=WiFi，2=蜂窝，3=以太网） |
| `nativeOnMemoryWarning()` | 低内存时释放缓存 |
| `nativeOnBackground()` | 应用进入后台 |
| `nativeOnForeground()` | 应用回到前台 |
| `nativeSetSystemProxy(host, port)` | `prisma_set_system_proxy()` |
| `nativeClearSystemProxy()` | `prisma_clear_system_proxy()` |
| `nativeVersion()` | 获取版本字符串 |
| `nativeProfileToQr(json)` | 生成 QR SVG |
| `nativeCheckUpdate()` | 检查更新 |

**v2.0.0 架构说明：** Android 模块使用全局单例（通过 `prisma_init` / `prisma_start` / `prisma_stop`），而非逐句柄的指针方式。JNI 方法直接委托给全局 FFI 函数。

---

## 线程安全说明

- 使用内部 `OnceLock<Mutex<...>>` 保护所有可变状态
- 回调从任意 Tokio 工作线程调用
- `std::panic::catch_unwind` 包装每个 `extern "C"` 函数以捕获 panic
- 全局静态变量使用 `OnceLock` 进行线程安全初始化
- iOS 原子变量使用 `AtomicI32` 配合 `SeqCst` 排序确保跨线程可见性
