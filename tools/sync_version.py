#!/usr/bin/env python3
"""把 VERSION 里的版本号同步到所有面向用户的文件。

版本号唯一来源：仓库根目录 VERSION（纯文本一行，如 v0.1.0）。
同步目标：
  - src/sender.html / src/receiver.html 的 __APP_VERSION__ 占位符
  - src/manifest.webmanifest 的 "version" 字段
  - src/sw.js 的缓存名（版本变 → 旧缓存自动失效，PWA 强制更新）

注意：standalone 单文件不在本脚本范围内——它由
build_standalone_sender.py 从 src/ 构建，会自动继承同步后的版本号。

用法：python3 tools/sync_version.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

PLACEHOLDER = "__APP_VERSION__"


def main() -> int:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?", version):
        print(f"✗ VERSION 内容不合法：{version!r}（应为 vMAJOR.MINOR.PATCH）")
        return 1

    changed: list[str] = []

    # 1) 两个 HTML 页：写入版本号（首次替换占位符，之后按 vX.Y.Z 模式原地更新）
    ver_re = re.compile(r"(data-app-version>\s*)(v\d+\.\d+\.\d+|__APP_VERSION__)(\s*</span>)")
    for name in ("sender.html", "receiver.html"):
        p = SRC / name
        text = p.read_text(encoding="utf-8")
        new_text, n = ver_re.subn(rf"\g<1>{version}\g<3>", text)
        if n == 0:
            print(f"! {name} 中没有版本占位/标记，跳过")
            continue
        p.write_text(new_text, encoding="utf-8")
        changed.append(f"src/{name}")

    # 2) manifest：写 version 字段（保留原有格式与缩进）
    mf = SRC / "manifest.webmanifest"
    mf_text = mf.read_text(encoding="utf-8")
    manifest = json.loads(mf_text)
    manifest = {**manifest, "version": version}  # 直接覆盖，避免旧值展开后反盖新值
    mf.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    changed.append("src/manifest.webmanifest")

    # 3) sw.js：缓存名随版本变化
    sw = SRC / "sw.js"
    sw_text = sw.read_text(encoding="utf-8")
    new_sw, n = re.subn(
        r'airscan-qr-pro-v[0-9A-Za-z.]+',
        f"airscan-qr-pro-{version}",
        sw_text,
    )
    if n == 0:
        print("! sw.js 未找到缓存名，跳过")
    else:
        sw.write_text(new_sw, encoding="utf-8")
        changed.append("src/sw.js")

    print(f"✓ 已同步 {version} → {', '.join(changed)}")
    print("  下一步：python3 tools/build_standalone_sender.py 重建离线单文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
