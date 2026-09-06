// Modified from jaden/totp-generator, September 2026. See LICENSE.
import QRCode from 'qrcode';
import { createElement, ShieldCheck, KeyRound, Eye, EyeOff, Trash2, SlidersHorizontal, ChevronDown, ChevronUp, Copy, QrCode, Link, LockKeyhole, Check, X, Download, ArrowRight, ScanLine, Pencil } from 'lucide';
import { normalizeSecret, validateOptions, makeTotp, timeRemaining, parseLink, makeLink, makeDirectLink, parseQr } from './core.mjs';
import { readQrFile } from './read-qr.mjs';
import { HISTORY_KEY, historyId, readHistory, rememberHistory, updateHistoryDetails } from './history.mjs';
import { VAULT_KEY, getOrCreateDeviceKey, encryptVault, decryptVault, deleteDeviceKey } from './vault.mjs';

const icons = { ShieldCheck, KeyRound, Eye, EyeOff, Trash2, SlidersHorizontal, ChevronDown, ChevronUp, Copy, QrCode, Link, LockKeyhole, Check, X, Download, ArrowRight, ScanLine, Pencil };
let activeTotp = null;
let interval;
let noticeTimer;
let qrRevision = 0;
let importRevision = 0;
let lastHref = '';
let vaultLoadPromise;

const app = Vue.createApp({
  data: () => ({
    secret: '', revealed: false, digits: 6, period: 30, algorithm: 'SHA1',
    token: '', remaining: 0, error: '', advanced: false, notice: '',
    issuer: '', account: '', qrImage: '', qrError: '', importError: '', importing: false,
    historyEntries: [], historyError: '', historyRevealed: false, saveHistory: true,
    editingHistoryId: '', editIssuerDraft: '', editAccountDraft: '', noteDraft: '', editHistoryError: '',
    vaultKey: null, vaultReady: false,
    directMode: location.pathname.startsWith('/2fa/'),
  }),
  computed: {
    displayToken() {
      if (!this.token) return '--- ---';
      const split = Math.ceil(this.token.length / 2);
      return this.token.slice(0, split) + ' ' + this.token.slice(split);
    },
  },
  async mounted() {
    vaultLoadPromise = this.loadHistory();
    await vaultLoadPromise;
    this.loadLink();
    window.addEventListener('storage', this.syncHistory);
    interval = setInterval(this.update, 250);
    window.addEventListener('hashchange', this.loadLink);
    window.addEventListener('popstate', this.loadLink);
    document.addEventListener('visibilitychange', this.update);
  },
  beforeUnmount() {
    clearInterval(interval);
    clearTimeout(noticeTimer);
    window.removeEventListener('hashchange', this.loadLink);
    window.removeEventListener('popstate', this.loadLink);
    document.removeEventListener('visibilitychange', this.update);
    window.removeEventListener('storage', this.syncHistory);
  },
  methods: {
    historyId,
    editNote(entry) {
      this.editingHistoryId = historyId(entry);
      this.editIssuerDraft = entry.issuer || '';
      this.editAccountDraft = entry.account || '';
      this.noteDraft = entry.note || '';
      this.editHistoryError = '';
      this.$refs.noteDialog.showModal();
      this.$nextTick(() => this.$refs.editIssuerInput.focus());
    },
    async saveHistoryDetails() {
      try {
        const entries = await this.readEncryptedHistory();
        const updated = updateHistoryDetails(entries, this.editingHistoryId, {
          issuer: this.editIssuerDraft,
          account: this.editAccountDraft,
          note: this.noteDraft,
        });
        if (!updated) {
          this.editHistoryError = '这条记录已被删除，请关闭后重新选择。';
          return;
        }
        if (!await this.persistHistory(updated)) {
          this.editHistoryError = this.historyError;
          return;
        }
        if (this.token && historyId(this) === this.editingHistoryId) {
          const saved = updated.find(entry => historyId(entry) === this.editingHistoryId);
          this.issuer = saved.issuer;
          this.account = saved.account;
        }
        this.$refs.noteDialog.close();
        this.showNotice('历史信息已保存');
      } catch {
        this.editHistoryError = '历史信息保存失败，请检查浏览器存储权限后重试。';
      }
    },
    historyDate(entry) {
      return new Date(entry.usedAt).toLocaleString('zh-CN', { hour12: false });
    },
    maskedHistorySecret(entry) {
      return this.historyRevealed ? entry.secret : (entry.secret.length > 8 ? entry.secret.slice(0, 4) + ' •••• ' + entry.secret.slice(-4) : '••••••••');
    },
    async loadHistory() {
      if (this.directMode) {
        this.vaultReady = true;
        return;
      }
      try {
        this.vaultKey = await getOrCreateDeviceKey();
        const encrypted = localStorage.getItem(VAULT_KEY);
        if (encrypted) {
          this.historyEntries = await decryptVault(encrypted, this.vaultKey);
        } else {
          const legacy = readHistory(localStorage);
          this.historyEntries = legacy;
          if (legacy.length) {
            localStorage.setItem(VAULT_KEY, await encryptVault(legacy, this.vaultKey));
            localStorage.removeItem(HISTORY_KEY);
          }
        }
        this.historyError = '';
      } catch {
        this.historyEntries = [];
        this.historyError = '无法解锁加密历史。数据可能已损坏，或此浏览器不支持安全存储。';
      } finally {
        this.vaultReady = true;
      }
    },
    async syncHistory(event) {
      if (event.key === VAULT_KEY || event.key === HISTORY_KEY || event.key === null) await this.loadHistory();
    },
    async readEncryptedHistory() {
      this.vaultKey ||= await getOrCreateDeviceKey();
      const raw = localStorage.getItem(VAULT_KEY);
      return raw ? decryptVault(raw, this.vaultKey) : [];
    },
    async persistHistory(entries) {
      try {
        this.vaultKey ||= await getOrCreateDeviceKey();
        if (entries.length) localStorage.setItem(VAULT_KEY, await encryptVault(entries, this.vaultKey));
        else localStorage.removeItem(VAULT_KEY);
        localStorage.removeItem(HISTORY_KEY);
        this.historyEntries = entries;
        this.historyError = '';
        return true;
      } catch {
        this.historyError = '加密历史保存或删除失败，请检查浏览器安全存储权限及空间。';
        return false;
      }
    },
    async rememberCurrent() {
      if (this.directMode || !this.saveHistory || !this.token) return;
      try {
        if (!this.vaultReady && vaultLoadPromise) await vaultLoadPromise;
        const entries = await this.readEncryptedHistory();
        await this.persistHistory(rememberHistory(entries, this));
      } catch {
        this.historyError = '无法加密保存历史，请检查浏览器安全存储权限及空间。';
      }
    },
    reuseHistory(entry) {
      this.invalidate();
      this.secret = entry.secret;
      this.issuer = entry.issuer;
      this.account = entry.account;
      Object.assign(this, validateOptions(entry));
      this.revealed = false;
      this.advanced = this.digits !== 6 || this.period !== 30 || this.algorithm !== 'SHA1';
      this.generate();
      document.getElementById('secret').focus();
      document.querySelector('main').scrollIntoView({ behavior: 'smooth' });
    },
    async deleteHistory(entry) {
      try {
        const entries = await this.readEncryptedHistory();
        await this.persistHistory(entries.filter(row => historyId(row) !== historyId(entry)));
      } catch {
        this.historyError = '删除失败，请检查浏览器存储权限，或清空损坏的记录。';
      }
    },
    async clearHistory() {
      try {
        localStorage.removeItem(VAULT_KEY);
        localStorage.removeItem(HISTORY_KEY);
        await deleteDeviceKey();
        this.vaultKey = null;
        this.historyEntries = [];
        this.historyError = '';
        this.historyRevealed = false;
        this.$refs.clearHistoryDialog.close();
        this.showNotice('本地历史已清空');
      } catch {
        this.historyError = '加密历史删除失败，请检查浏览器存储权限。';
      }
    },
    options() { return validateOptions(this); },
    invalidate() {
      this.invalidateStateOnly();
      this.issuer = '';
      this.account = '';
      this.removeUrlSecret();
    },
    removeUrlSecret() {
      const url = new URL(location.href);
      url.hash = '';
      url.search = '';
      if (url.pathname.startsWith('/2fa/')) url.pathname = '/';
      history.replaceState(null, '', url);
      lastHref = location.href;
    },
    clear() {
      this.invalidate();
      this.secret = '';
      this.revealed = false;
      this.issuer = '';
      this.account = '';
      this.notice = '';
      document.getElementById('secret').focus();
    },
    async generate() {
      this.error = '';
      this.token = '';
      activeTotp = null;
      try {
        this.secret = normalizeSecret(this.secret);
        activeTotp = makeTotp(this.secret, this.options());
        this.update();
        await this.rememberCurrent();
      } catch (error) {
        this.error = error.message;
      }
    },
    update() {
      if (!activeTotp) return;
      const timestamp = Date.now();
      this.token = activeTotp.generate({ timestamp });
      this.remaining = timeRemaining(timestamp, activeTotp.period);
    },
    loadLink() {
      // A fragment navigation can emit both popstate and hashchange.
      if (location.href === lastHref) return;
      this.directMode = location.pathname.startsWith('/2fa/');
      this.invalidateStateOnly();
      this.issuer = '';
      this.account = '';
      try {
        const { secret, options } = parseLink(location.href);
        this.secret = secret;
        Object.assign(this, options);
        this.advanced = options.digits !== 6 || options.period !== 30 || options.algorithm !== 'SHA1';
        if (secret) {
          this.generate();
          if (this.token && !this.directMode) history.replaceState(null, '', makeLink(location.href, this.secret, options));
          else if (!this.token && !this.directMode) this.removeUrlSecret();
        } else if (this.directMode) {
          this.error = '取码链接缺少密钥。';
        }
      } catch {
        this.secret = '';
        this.error = '取码链接无效，请检查密钥、编码和参数。';
        if (!this.directMode) this.removeUrlSecret();
      }
      lastHref = location.href;
    },
    invalidateStateOnly() {
      importRevision++;
      this.importing = false;
      this.importError = '';
      activeTotp = null;
      this.token = '';
      this.remaining = 0;
      this.error = '';
      this.qrImage = '';
      this.qrError = '';
      qrRevision++;
      if (this.$refs.qrDialog.open) this.$refs.qrDialog.close();
    },
    async copy(text, message) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const input = document.createElement('textarea');
          input.value = text;
          input.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(input);
          input.select();
          let copied;
          try { copied = document.execCommand('copy'); } finally { input.remove(); }
          if (!copied) throw new Error('copy failed');
        }
        this.showNotice(message);
      } catch {
        this.showNotice('复制失败，请允许浏览器访问剪贴板后重试。');
      }
    },
    copyToken() {
      this.update();
      if (this.token) this.copy(this.token, '验证码已复制');
    },
    copySecret() {
      try { this.copy(normalizeSecret(this.secret), '密钥已复制，请妥善保管'); }
      catch (error) { this.error = error.message; }
    },
    async importQr(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const revision = ++importRevision;
      this.importing = true;
      this.importError = '';
      try {
        const parsed = parseQr(await readQrFile(file));
        if (revision !== importRevision) return;
        this.invalidate();
        this.secret = parsed.secret;
        this.issuer = parsed.issuer;
        this.account = parsed.account;
        this.revealed = false;
        Object.assign(this, parsed.options);
        this.advanced = this.digits !== 6 || this.period !== 30 || this.algorithm !== 'SHA1';
        this.generate();
        this.showNotice('二维码密钥已提取');
      } catch (error) {
        if (revision === importRevision) this.importError = error.message;
      } finally {
        if (revision === importRevision) this.importing = false;
      }
    },
    copyLink() {
      if (this.token) this.copy(makeDirectLink(location.href, this.secret, this.options()), '取码链接已复制，请勿公开分享');
    },
    showNotice(message) {
      clearTimeout(noticeTimer);
      this.notice = message;
      noticeTimer = setTimeout(() => { this.notice = ''; }, 3500);
    },
    openQr() {
      if (!this.token) return;
      this.$refs.qrDialog.showModal();
      this.refreshQr();
    },
    async refreshQr() {
      const revision = ++qrRevision;
      this.qrImage = '';
      this.qrError = '';
      try {
        const uri = makeTotp(this.secret, this.options(), this.issuer, this.account).toString();
        const image = await QRCode.toDataURL(uri, { width: 640, margin: 4, errorCorrectionLevel: 'M' });
        if (revision === qrRevision && this.$refs.qrDialog.open) this.qrImage = image;
      } catch {
        if (revision === qrRevision) this.qrError = '二维码生成失败，请检查密钥或缩短账号名称。';
      }
    },
    closeOnBackdrop(event) {
      const rect = this.$refs.qrDialog.getBoundingClientRect();
      if (event.target === this.$refs.qrDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) {
        this.$refs.qrDialog.close();
      }
    },
  },
});
app.component('icon', {
  props: ['name'],
  render() {
    return Vue.h('span', {
      class: 'icon', 'aria-hidden': 'true',
      innerHTML: createElement(icons[this.name]).outerHTML,
    });
  },
});
app.mount('#app');
