# Azure deployment

RaidRumble targets **https://raids.decionis.com** on the existing **Central US** AKS cluster. The deployment follows the SwarmPay Azure target: cluster `decionis-aks`, resource group `decionis-rg`, namespace `decionis`, registry `decionisacr.azurecr.io`, ingress `decionis-nginx`, DNS-01 issuer `letsencrypt-prod`, and storage class `decionis-zrs`.

Terraform in [`infra/azure`](../infra/azure) manages only RaidRumble's Deployment, Service, ConfigMap, NetworkPolicy, persistent volume claim, Ingress and `raids` DNS record. It does not manage or change the cluster, namespace, registry, shared ingress, issuer or SwarmPay resources. Its separate remote state key is `raidrumble.tfstate` in the existing platform `tfstate` container. The deployment operator's Azure CLI identity retrieves the backend account key through ARM; no key is written into source configuration.

The app runs one non-root Node 22 Linux container, with a read-only root filesystem, writable temporary directory and an **8 GiB** persistent Azure disk at `/app/data`. SQLite, settings and salted regular-history records survive pod replacement. A Recreate rollout prevents two match runners from owning the same channel. OAuth/browser sessions, live matches and Warlord links are in memory: reconnect Twitch after a process restart.

## Build and release

Use an authenticated Azure CLI, Terraform 1.5+, `kubectl`, `kubelogin`, Python 3, and the repository's pinned pnpm version. Keep the local kubeconfig and plans under ignored `artifacts/deploy/`.

```sh
mkdir -p artifacts/deploy
chmod 700 artifacts/deploy
az aks get-credentials -g decionis-rg -n decionis-aks --file artifacts/deploy/kubeconfig --format exec
kubelogin convert-kubeconfig --kubeconfig artifacts/deploy/kubeconfig -l azurecli
pnpm test
pnpm build
pnpm lint
pnpm format:check
az acr build --registry decionisacr --image raidrumble:<sourcecommit> --platform linux/amd64 --file Dockerfile .
az acr repository show --name decionisacr --image raidrumble:<sourcecommit> --query digest -o tsv
python3 tools/deploy/secret.py
python3 tools/deploy/secret.py --apply
terraform -chdir=infra/azure init
terraform -chdir=infra/azure validate
terraform -chdir=infra/azure plan -var='image=decionisacr.azurecr.io/raidrumble@sha256:<digest>' -out=../../artifacts/deploy/release.tfplan
terraform -chdir=infra/azure apply ../../artifacts/deploy/release.tfplan
kubectl --kubeconfig artifacts/deploy/kubeconfig -n decionis rollout status deployment/raidrumble
curl --fail https://raids.decionis.com/health
```

Replace the commit and digest placeholders with the source revision and ACR result. Review the saved plan before applying it. The image variable accepts only an immutable RaidRumble digest. The Docker build compiles native SQLite on Linux and verifies that it opens a database; developer native modules never enter the image. Both frontend builds use the current HTTPS origin in production, with separate asset prefixes.

[`secret.py`](../tools/deploy/secret.py) checks the root `.env` by default and prints key names only. `--apply` sends a narrow allowlist of Twitch application/bot configuration and Decionis runtime credentials through kubectl stdin. Authority policy keys and proxy tenant keys are excluded. Optional OpenAI configuration is included only when both its key and model are provided. Secrets stay out of Terraform, images and Git; Kubernetes stores the runtime Secret separately. Rotate that Secret and perform a planned rollout when credentials change.

The runtime uses the existing enforcement configuration: `POLICY_GATE=decionis`, `DECIONIS_MODE=ENFORCEMENT`, and the authority at `https://api.decionis.com`. The public preview always uses local policy and authored content; it makes no paid generation calls and writes no persistent channel history, settings or match results.

## Twitch and public access

Register **https://raids.decionis.com/auth/twitch/callback** in the existing Twitch application's OAuth redirect list while preserving its development callbacks. `PUBLIC_BASE_URL`, `DASHBOARD_URL` and `OVERLAY_URL` all use the bare HTTPS origin. The callback route is served directly by Fastify. Ingress access logging is disabled so authorization query strings are not recorded.

Connect the host first, then the configured bot from the same browser. A standard account should have four ready host subscriptions and one `channel.chat.message` subscription. Token presence alone does not prove EventSub readiness. Verify the dashboard readiness flags and an authorized incoming chat event before claiming live integration.

The anonymous **Launch Test Raid** control reserves a shared, authored preview for one browser using a four-minute secure cookie. Other visitors can watch. Only its current controller can reset or accept the preview; shared settings and saved trust stay fixed. HTTP, OAuth admission and read-only WebSocket connections are bounded. OBS connections may omit an Origin header; browser mutations must originate at the hosted site.

The NetworkPolicy admits application traffic only from the established ingress pods and allows outbound DNS and public HTTPS. The server trusts that one ingress hop. Service and liveness/readiness probes use port 3000; the public ingress redirects HTTP to HTTPS and supports persistent WebSocket connections.

## Recovery

The persistent claim has Terraform `prevent_destroy`. Keep the claim when replacing the app. For rollback, plan and apply a previously verified image digest; then reconnect host and bot because a rollout ends in-memory sessions and matches. Schedule rollouts between streams.

Use SQLite's online backup API before downloading or archiving live data; copying only the open main database can omit its WAL. Back up the resulting consistent database together with `settings.json`. Keep backups private and outside the serving asset roots. This deployment provides persistent disk storage; it does not configure an off-cluster backup service or multiple active replicas.
