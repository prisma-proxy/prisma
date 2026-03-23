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

### URI 导入

| 函数 | 描述 |
|------|------|
| `prisma_import_uri(uri) -> *mut c_char` | 导入单个 URI（需释放） |
| `prisma_import_batch(text) -> *mut c_char` | 批量导入 URI（需释放） |

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

## 线程安全说明

- `PrismaClient` 使用内部 `Arc<Mutex<...>>` 保护所有可变状态
- 回调从任意 Tokio 工作线程调用
- `ffi_catch!` 宏包装每个 `extern "C"` 函数以防止 panic 越过 FFI 边界
- 全局静态变量使用 `once_cell::sync::Lazy` 进行线程安全初始化
