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

历史密钥以明文保存在当前浏览器的 `localStorage`。二维码和直链包含完整密钥，
直链密钥还可能进入浏览器历史、CDN 或服务器日志。请仅在可信设备使用，不要公开分享。

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
