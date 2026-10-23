#!/usr/bin/env python3
"""把 src/ 打包成单文件、可双击离线运行的发送端 HTML（给物理隔离内网用）。

为什么需要：src/sender.html 用 ES Module，file:// 双击时浏览器会因 CORS 拒绝
加载本地模块；隔离内网又起不了 http 服务。本脚本把 qrcode 库与所有依赖模块
内联进一个自包含 HTML，零外部请求，U盘拷入双击即用。

用法：python3 tools/build_standalone_sender.py
产物：release/airscan-sender-standalone.html
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "release"

# 业务模块依赖顺序（被依赖的在前）
MODULES = ["protocol.js", "compressor.js", "lt-code.js", "matrix.js", "packet.js", "wire-codec.js"]


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def inline_modules() -> str:
    """把 ES Module 源码转成普通脚本：去掉 import/export，按依赖顺序拼接。

    浏览器 file:// 下无需 module；函数用全局声明即可。简单稳妥地剥离 ESM 语法。
    """
    parts = []
    for name in MODULES:
        code = read(SRC / "js" / name)
        # 去掉 import 行（依赖通过同作用域拼接获得）
        code = re.sub(r"^import\s+[^;]+;\s*$", "", code, flags=re.M)
        # export const/function/class/async function → 去掉 export 关键字
        code = re.sub(r"^\s*export\s+(const|let|function|class|async)", r"\1", code,
                      flags=re.M)
        code = re.sub(r"^\s*export\s+default\s+", "", code, flags=re.M)
        # export { a, b } 形式；含重导出 export { x } from "..." 一并整行删除
        code = re.sub(r"^\s*export\s*\{[^}]*\}(?:\s+from\s+[^;]+)?;?\s*$", "",
                      code, flags=re.M)
        parts.append(f"/* ===== {name} ===== */\n{code}")
    return "\n".join(parts)


def build() -> None:
    html = read(SRC / "sender.html")

    # 1) 用内联的 qrcode 库替换 <script src="../vendor/qrcode.js"></script>
    qrcode = read(SRC / "vendor" / "qrcode.js")
    html = html.replace(
        '<script src="../vendor/qrcode.js"></script>',
        "<script>\n" + qrcode + "\n</script>",
    )

    # 2) 把 <script type="module"> ... </script> 的 import 去掉、模块代码前置
    module_code = inline_modules()

    def replace_module(m: re.Match) -> str:
        body = m.group(1)
        # 去掉业务代码里的 import 行（已在 module_code 内联）
        body = re.sub(r"^\s*import\s+[^;]+;\s*$", "", body, flags=re.M)
        return "<script>\n" + module_code + "\n/* ===== sender page ===== */\n" + body + "\n</script>"

    html = re.sub(
        r'<script type="module">([\s\S]*?)</script>',
        replace_module,
        html,
        count=1,
    )

    # 3) 去掉 PWA/manifest 等需要 http 上下文、单文件用不到的引用
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="icon"[^>]*>', "", html)

    OUT.mkdir(exist_ok=True)
    target = OUT / "airscan-sender-standalone.html"
    target.write_text(html, encoding="utf-8")
    print(f"已生成 {target}（{target.stat().st_size // 1024} KB），可双击离线运行")

    # 同步一份到 src/ 作为站点下载入口（nginx 用 attachment 头让浏览器直接下载）
    site_copy = SRC / "airscan-sender-standalone.html"
    site_copy.write_text(html, encoding="utf-8")
    print(f"已同步站点下载副本 {site_copy}")


if __name__ == "__main__":
    build()
