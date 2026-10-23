// base45.js — RFC 9285 Base45 编解码
// 字符集 45 个可打印 ASCII（jsQR 文本模式无损）。编码规则（严格 RFC 9285）：
//   每 2 字节 [a,b]，n=a*256+b (0..65535) → 3 字符：n%45, floor(n/45)%45, floor(n/45/45)
//   末尾若剩 1 字节 a (0..255)     → 2 字符：a%45, floor(a/45)
// 故解码可从字符串长度无歧义还原字节数（len%3===2 表示末尾有个单字节组）。
//
// 收益：QR Byte 模式下约 2.25 字符/2字节 → 膨胀约 +12.5%（Base64 是 +33%），
// 同样容量的 QR 能多装约 18% 的帧字节（1.333/1.125≈1.185）。

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const BASE = 45;

const DECODE_TABLE = (() => {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function encodeBase45(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < u8.length; i += 2) {
    if (i + 1 < u8.length) {
      const n = u8[i] * 256 + u8[i + 1];
      const c = n % BASE;
      const d = Math.floor(n / BASE) % BASE;
      const e = Math.floor(n / (BASE * BASE));
      out += ALPHABET[c] + ALPHABET[d] + ALPHABET[e];
    } else {
      const n = u8[i];
      out += ALPHABET[n % BASE] + ALPHABET[Math.floor(n / BASE)];
    }
  }
  return out;
}

export function decodeBase45(str) {
  if (typeof str !== "string") throw new Error("Base45 输入必须是字符串");
  const rem = str.length % 3;
  if (rem === 1) throw new Error("Base45 长度非法（余 1）");

  // 字节数：整组 3 字符→2 字节；若末尾余 2 字符→再 +1 字节
  const whole = Math.floor(str.length / 3);
  const hasTail = rem === 2;
  const out = new Uint8Array(whole * 2 + (hasTail ? 1 : 0));
  let o = 0, i = 0;

  for (let g = 0; g < whole; g++) {
    const c = val(str, i++);
    const d = val(str, i++);
    const e = val(str, i++);
    const n = c + d * BASE + e * BASE * BASE;
    if (n > 65535) throw new Error("Base45 双字节组溢出");
    out[o++] = Math.floor(n / 256);
    out[o++] = n % 256;
  }
  if (hasTail) {
    const c = val(str, i++);
    const d = val(str, i++);
    const n = c + d * BASE;
    if (n > 255) throw new Error("Base45 单字节组溢出");
    out[o++] = n;
  }
  return out;
}

function val(str, i) {
  const code = str.charCodeAt(i);
  const v = code < 256 ? DECODE_TABLE[code] : -1;
  if (v < 0) throw new Error("Base45 含非法字符");
  return v;
}
