"""Apply only RaidRumble runtime credentials through kubectl stdin, never Terraform."""

import argparse
import base64
import json
from pathlib import Path
import subprocess


class SecretBundle:
    REQUIRED = {
        "TWITCH_CLIENT_ID": ("TWITCH_CLIENT_ID", "TWITCH_AUTH_CLIENT"),
        "TWITCH_CLIENT_SECRET": ("TWITCH_CLIENT_SECRET", "TWITCH_AUTH_SECRET"),
        "TWITCH_BOT_USER_ID": ("TWITCH_BOT_USER_ID",),
        "DECIONIS_API_KEY": ("DECIONIS_API_KEY",),
        "DECIONIS_ENFORCE_API_KEY": ("DECIONIS_ENFORCE_API_KEY",),
        "DECIONIS_ORG_ID": ("DECIONIS_ORG_ID",),
    }

    def __init__(self, source: Path):
        source_values = {}
        for line in source.read_text().splitlines():
            entry = line.strip()
            if not entry or entry.startswith("#") or "=" not in entry:
                continue
            key, value = entry.removeprefix("export ").split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            source_values[key.strip()] = value
        self.values = {
            key: next((source_values.get(alias) for alias in aliases if source_values.get(alias)), "")
            for key, aliases in self.REQUIRED.items()
        }
        missing = [key for key, value in self.values.items() if not value]
        if missing:
            raise ValueError("Missing runtime settings: " + ", ".join(missing))
        if source_values.get("OPENAI_API_KEY") and source_values.get("OPENAI_MODEL"):
            for key in ("OPENAI_API_KEY", "OPENAI_MODEL"):
                self.values[key] = source_values[key]

    def apply(self, kubeconfig: Path):
        manifest = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {
                "name": "raidrumble-runtime",
                "namespace": "decionis",
                "labels": {"app.kubernetes.io/name": "raidrumble"},
            },
            "type": "Opaque",
            "data": {
                key: base64.b64encode(value.encode()).decode()
                for key, value in self.values.items()
            },
        }
        result = subprocess.run(
            ["kubectl", "--kubeconfig", str(kubeconfig), "apply", "--server-side",
             "--field-manager=raidrumble", "-f", "-"],
            input=json.dumps(manifest), text=True, capture_output=True, timeout=60,
        )
        if result.returncode:
            # API validation errors may echo submitted values. Never relay that output.
            raise RuntimeError("Runtime secret apply failed; verify AKS access and target namespace.")
        print(f"Applied {len(self.values)} runtime settings to decionis/raidrumble-runtime.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=Path(".env"))
    parser.add_argument("--kubeconfig", type=Path, default=Path("artifacts/deploy/kubeconfig"))
    parser.add_argument("--apply", action="store_true", help="Apply the secret; default checks keys only.")
    options = parser.parse_args()
    bundle = SecretBundle(options.env)
    if options.apply:
        bundle.apply(options.kubeconfig)
    else:
        print(json.dumps({"ready": True, "keys": sorted(bundle.values)}))


if __name__ == "__main__":
    main()
