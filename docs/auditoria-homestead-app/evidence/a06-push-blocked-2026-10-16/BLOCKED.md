# A06 physical push — BLOCKED (2026-10-16)

## Exact blocker

`adb devices -l` lists **no attached devices**.

`
List of devices attached
`

ADB binary present: `C:\Users\irvin\AppData\Local\Android\Sdk\platform-tools\adb.exe`

## Ruled out (not yet reached)

| Candidate | Status |
| --- | --- |
| Device disconnected / not attached | **ROOT CAUSE** — empty device list |
| ADB authorization pending | N/A — no serial appears even as `unauthorized` |
| Firebase / google-services | Not reached |
| Operator credentials / FCM token | Not reached |
| Network to FCM | Not reached |

## Action required (physical)

1. Connect the authorized test phone by USB (serial historically `R8YYA17KR3V` if available).
2. Enable USB debugging; accept the RSA fingerprint prompt.
3. Confirm `adb devices` shows `device` (not `unauthorized` / empty).
4. Re-run A06 cases against isolated Control + dry/isolated push path only.

Production customers/appointments must not be mutated.
