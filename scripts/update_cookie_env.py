#!/usr/bin/env python3
"""Update QZONE_COOKIE_STRING and QZONE_COOKIE in .env from stdin (one line)."""
import sys

cookie = sys.stdin.read().strip()
if not cookie:
    sys.exit(1)
env_path = "/opt/onebot-qzone/.env"
with open(env_path, "r") as f:
    lines = f.readlines()
out = []
for line in lines:
    if line.startswith("QZONE_COOKIE_STRING="):
        out.append("QZONE_COOKIE_STRING=" + cookie + "\n")
    elif line.startswith("QZONE_COOKIE="):
        out.append("QZONE_COOKIE=" + cookie + "\n")
    else:
        out.append(line)
with open(env_path, "w") as f:
    f.writelines(out)
print("Updated QZONE_COOKIE_STRING and QZONE_COOKIE in", env_path)
