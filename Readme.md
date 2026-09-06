# Rulio 2FA

纯静态的 TOTP 验证码工具，所有验证码计算、二维码生成和二维码识别均在浏览器本地完成。

在线地址：[https://2fa.rulio.sryze.cc](https://2fa.rulio.sryze.cc)

## 功能

- Base32 密钥生成 TOTP，支持 SHA1、SHA256、SHA512 和自定义位数、周期。
- 生成、下载验证器二维码；从二维码图片提取密钥和账号信息。
- `/2fa/密钥` 简洁直链页面，点击验证码即可复制。
- 本地历史记录，支持服务名称、账号 ID、备注、再次取码和删除。
- 不需要后端或数据库，可部署到 Cloudflare Pages、Nginx 等静态托管。
- `no-store`、CSP、Permissions Policy 和禁止嵌入等安全响应头。

## 安全提示

历史使用设备内非导出密钥进行 AES-256-GCM 加密，密文保存在 `localStorage`，
设备密钥保存在 IndexedDB 并自动解锁。二维码和直链仍包含完整密钥，
直链密钥还可能进入浏览器历史、CDN 或服务器日志。请仅在可信设备使用，不要公开分享。

这种免密码方案可避免在 `localStorage` 和其备份中直接暴露明文，但无法防御同源恶意脚本、
可读取页面的浏览器扩展、恶意软件或已被控制的浏览器配置文件。清除站点数据或丢失 IndexedDB
设备密钥后，加密历史无法恢复。

## 开发

需要 Node.js 22 或以上。

```sh
npm ci
npm test
npm run build
npm start
```

浏览器回归测试：

```sh
npx playwright install chromium
npm run test:browser
```

构建结果位于 `dist`。详细功能、链接格式和部署说明见
[README.zh-CN.md](README.zh-CN.md)。

## 来源与许可证

本项目基于 [jaden/totp-generator](https://github.com/jaden/totp-generator) 修改，
保留原项目的 GPL-3.0 许可证和作者署名。详见 [LICENSE](LICENSE)。
