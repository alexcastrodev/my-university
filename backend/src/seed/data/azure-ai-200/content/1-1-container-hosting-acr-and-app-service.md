---
version: 1.0
updatedAt: 2026-11-14
---
# Container Hosting: Azure Container Registry, ACR Tasks and App Service

> Exam domain: **Develop containerized solutions on Azure (20-25%)**, skill group *Implement container application hosting*.

---

## The three jobs in this skill group

| Job | Service | Verb on the exam |
|-----|---------|------------------|
| Build, store, version and manage images | Azure Container Registry (ACR) | build, tag, lock, pull with an identity |
| Build and run images in the cloud | ACR Tasks | `az acr build`, trigger on commit or base image update |
| Run one container as a web app | Azure App Service (Web App for Containers) | configure environment variables and secrets |

---

## Registry vocabulary

```text
myregistry.azurecr.io/shop/orders-api:1.4.2
|______ registry ____| |_ repository _| |_tag_|

myregistry.azurecr.io/shop/orders-api@sha256:9f86d0...
                                      |____ digest ____|
```

- A **tag** is a mutable pointer. Pushing `orders-api:1.4.2` twice moves the tag to the new image.
- A **digest** is the content hash of the manifest. It never changes, so it is the only way to pin exactly one image.
- Do not deploy `latest` to production. Tag with a version **and** the commit SHA, and deploy by version or digest.

Lock an image so nobody overwrites or deletes it:

```bash
az acr repository update \
  --name myregistry --image shop/orders-api:1.4.2 \
  --write-enabled false --delete-enabled false
```

### Pricing tiers

ACR has **Basic**, **Standard** and **Premium** SKUs. Features such as geo-replication, private endpoints and customer-managed keys are Premium features. If a question says "replicate the registry to several regions" or "pull over a private endpoint", the answer is Premium.

### How callers authenticate

| Caller | Recommended identity | Role |
|--------|----------------------|------|
| App Service, Container Apps, AKS pulling images | Managed identity | `AcrPull` |
| CI pipeline pushing images | Service principal or workload identity | `AcrPush` |
| A developer at a terminal | `az acr login` with their Microsoft Entra account | `AcrPush` / `AcrPull` |

The **admin user** (a shared username and password) exists, but it is the answer only when no identity-based option is possible. Questions about "least privilege" or "no stored credentials" want the managed identity plus `AcrPull`.

---

## ACR Tasks: build in the registry, not on your laptop

A **quick task** builds an image inside Azure and pushes it in one command. No local Docker daemon is needed:

```bash
az acr build --registry myregistry --image shop/orders-api:{{.Run.ID}} .
```

`{{.Run.ID}}` is a task run variable, handy for unique tags. For a Python service the context folder holds a normal Dockerfile:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["gunicorn", "-b", "0.0.0.0:8000", "app:app"]
```

### Automatically triggered tasks

You create a task once with `az acr task create`, and it runs on triggers:

| Trigger | When it fires |
|---------|---------------|
| **Source code update** | A commit or pull request lands in the Git repository the task watches |
| **Base image update** | The base image named in the `FROM` line gets a new version, so your image is rebuilt and picks up the patch |
| **Timer** | A cron schedule, for example a nightly rebuild |

```bash
az acr task create \
  --registry myregistry --name build-orders \
  --image shop/orders-api:{{.Run.ID}} \
  --context https://github.com/contoso/orders.git#main \
  --file Dockerfile \
  --git-access-token $GIT_PAT
```

### Multi-step tasks

When one `docker build` is not enough (build, test, then push), describe the steps in YAML and run them with `az acr run` or attach the file to a task:

```yaml
# acr-task.yaml
version: v1.1.0
steps:
  - build: -t $Registry/shop/orders-api:$ID .
  - cmd: $Registry/shop/orders-api:$ID pytest -q
  - push:
      - $Registry/shop/orders-api:$ID
```

```bash
az acr run --registry myregistry --file acr-task.yaml .
```

---

## App Service for containers

**Web App for Containers** runs **one** container on an App Service plan. The image can come from ACR, Docker Hub or another registry.

```bash
az webapp create \
  --resource-group rg-shop --plan plan-linux \
  --name orders-web \
  --container-image-name myregistry.azurecr.io/shop/orders-api:1.4.2
```

### Configuration and secrets

**App settings** are injected into the container as **environment variables**. That is how you supply configuration.

```bash
az webapp config appsettings set \
  --resource-group rg-shop --name orders-web \
  --settings WEBSITES_PORT=8000 LOG_LEVEL=info \
             DB_PASSWORD="@Microsoft.KeyVault(SecretUri=https://kv-shop.vault.azure.net/secrets/db-password/)"
```

Things the exam likes to test:

- `WEBSITES_PORT` tells App Service which port your container listens on when it is not the default.
- A **Key Vault reference** (`@Microsoft.KeyVault(...)`) keeps the secret out of the app setting itself. It needs a **managed identity** on the web app with permission to read secrets in that vault. Without a version in the reference, the app picks up new secret versions automatically after a rotation.
- A **deployment slot setting** ("slot sticky") stays with the slot during a swap. A normal app setting moves with the code.
- To pull from ACR without credentials, give the web app a managed identity and grant it `AcrPull`.
- **Continuous deployment** uses a webhook from the registry, so pushing a new tag can restart the app with the new image.

---

## Quick check

1. Which ACR feature rebuilds your image when `python:3.12-slim` is patched? **A base image update trigger on an ACR task.**
2. How do you stop `orders-api:1.4.2` from being overwritten? **Set `--write-enabled false` on that image.**
3. How does a container in App Service read a database password without storing it in plain text? **A Key Vault reference in an app setting, resolved by a managed identity.**

---

## Official documentation

- [Azure Container Registry](https://learn.microsoft.com/en-us/azure/container-registry/)
- [Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/)
- [Exam AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200)
