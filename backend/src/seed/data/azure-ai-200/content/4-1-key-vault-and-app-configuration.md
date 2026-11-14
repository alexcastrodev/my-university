---
version: 1.0
updatedAt: 2026-11-14
---
# Securing Solutions: Azure Key Vault and Azure App Configuration

> Exam domain: **Secure, monitor, and troubleshoot Azure solutions (20-25%)**, skill group *Implement secure Azure solutions*.

---

## Which service holds what

| Data | Service |
|------|---------|
| Passwords, API keys, connection strings, certificates, encryption keys | **Azure Key Vault** |
| Non-secret settings, feature flags, per-environment values | **Azure App Configuration** |
| A pointer from a setting to a secret | An App Configuration **Key Vault reference** |

Never put a secret in source code, in an image, or in a plain app setting. Put it in Key Vault and let the app read it with a **managed identity**.

---

## Key Vault: secrets, retrieval and RBAC

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

client = SecretClient(
    vault_url="https://kv-shop.vault.azure.net/",
    credential=DefaultAzureCredential(),     # managed identity in Azure, your sign-in locally
)

secret = client.get_secret("db-password")            # the LATEST version
old    = client.get_secret("db-password", "a1b2...")  # one specific version
print(secret.properties.version, secret.properties.expires_on)

client.set_secret("db-password", new_value)           # creates a NEW version, never overwrites
```

- Every `set_secret` creates a **new version**. Secrets are identified by `https://<vault>.vault.azure.net/secrets/<name>/<version>`. Leaving out the version means **latest**.
- The identity used must be authorized. Use the **Azure RBAC** permission model (the recommended one):

| Role | Allows |
|------|--------|
| **Key Vault Secrets User** | Read secret values. Give this to applications |
| **Key Vault Secrets Officer** | Manage secrets (create, update, delete) |
| **Key Vault Crypto Officer** | Manage keys, including the rotation policy |
| **Key Vault Contributor** | Manage the vault itself (control plane), **not** the data |

- **Soft delete** is always on (retention 7 to 90 days, default 90 days). **Purge protection** stops anyone, even an owner, from purging a deleted vault or object before the retention period ends.
- Set an **expiration date** on secrets (`expires_on`) so you can be warned before they lapse.

### Rotation

| Asset | How rotation works |
|-------|--------------------|
| **Keys** | Built-in **rotation policy**: rotate a time after creation or before expiry, plus a notification time. Minimum interval is **7 days** from creation and 7 days from expiry. On-demand: `az keyvault key rotate` |
| **Secrets** | You implement it. A common design is: an **Event Grid** event `Microsoft.KeyVault.SecretNearExpiry` triggers a **Function** that creates the new credential in the target system and stores it as a **new secret version** |
| **Certificates** | Key Vault can auto-renew from a configured issuer |

Key Vault emits these Event Grid events: `SecretNewVersionCreated`, `SecretNearExpiry`, `SecretExpired` (and equivalents for keys and certificates).

Key rotation creates a **new key version**. Services must reference the **versionless** key URI to pick up the newest version. Rotating a key re-wraps data encryption keys, it does not re-encrypt your data, so keep older versions enabled until the re-wrap is finished.

Apps that use a **Key Vault reference without a version** (App Service, Functions) pick up the new secret version automatically after rotation. A reference that pins a version never changes until you edit it.

---

## App Configuration

App Configuration stores **key-values**. It is not for secrets.

| Part | Details |
|------|---------|
| **Key** | A case-sensitive unicode string. Use a hierarchy with a delimiter: `Shop:Search:TopK`. Can't contain `%`, can't be `.` or `..` |
| **Label** | Optional. The same key with different labels forms different key-values, for example `Test`, `Staging`, `Production` or a build number. No label is the **null label** (`\0`, URL encoded `%00`) |
| **Value** | A unicode string |
| **Content type** | Optional media type that tells the app how to read the value (JSON, **feature flag**, **Key Vault reference**) |
| **Size limit** | **10 KB** combined for a key-value (key, value and attributes) |

A key plus a label identifies one key-value. Querying supports patterns such as `key=Shop:*` and label lists of up to five values.

### Feature flags and Key Vault references

- **Feature flags** are stored as key-values with a special key prefix and content type, and the provider libraries understand them.
- A **Key Vault reference** is a key-value whose value is the URI of a secret. The provider resolves it by calling Key Vault **with your app's identity**. App Configuration never stores the secret.

### Load and refresh in Python

```python
from azure.appconfiguration.provider import load, SettingSelector, WatchKey
from azure.identity import DefaultAzureCredential

cred = DefaultAzureCredential()
config = load(
    endpoint="https://shop-config.azconfig.io",
    credential=cred,
    selects=[SettingSelector(key_filter="Shop:*", label_filter="Production")],
    refresh_on=[WatchKey("Shop:Sentinel")],     # only reload everything when this key changes
    refresh_interval=30,                        # seconds, 30 is the default
    keyvault_credential=cred,                   # resolves Key Vault references
)

top_k = int(config["Shop:Search:TopK"])
config.refresh()                                # call periodically (for example per request)
```

The **sentinel key** pattern: instead of watching every key, you update one `Sentinel` key *after* changing a set of settings. The app sees one change and reloads the whole set consistently.

App Configuration access roles: **App Configuration Data Reader** (apps) and **App Configuration Data Owner** (administration).

---

## Putting the pieces together

```text
 App (managed identity)
   |-- reads  App Configuration ──> non-secret settings, feature flags
   |                                  `-- a Key Vault reference ─┐
   `-- reads  Key Vault          <────────────────────────────────┘
                (Key Vault Secrets User)
```

One identity, no secrets in code or pipelines, a clear separation: settings in App Configuration, secrets in Key Vault.

---

## Quick check

1. Which role should the application get to read secrets? **Key Vault Secrets User.**
2. A database password rotates every 30 days. **Event Grid `SecretNearExpiry` event, a Function creates a new secret version, apps reference the secret versionless.**
3. Same key, different value in Staging and Production. **Use labels.**
4. Reload many settings atomically. **Sentinel key with `refresh_on`.**

---

## Official documentation

- [Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/)
- [Configure key auto-rotation](https://learn.microsoft.com/en-us/azure/key-vault/keys/how-to-configure-key-rotation)
- [App Configuration key-values](https://learn.microsoft.com/en-us/azure/azure-app-configuration/concept-key-value)
