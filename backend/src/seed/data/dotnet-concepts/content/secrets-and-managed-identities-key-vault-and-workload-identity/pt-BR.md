---
version: 1.0
updatedAt: 2026-11-19
title: "Segredos e identidades gerenciadas: Key Vault e workload identity"
summary: Da escada de configuração (appsettings, user-secrets, variáveis de ambiente) à cadeia do DefaultAzureCredential, ManagedIdentityCredential contra um endpoint de identidade falso (cache, retries, 429), WorkloadIdentityCredential contra um token endpoint falso que valida o client_assertion, Key Vault no emulador Lowkey Vault (versões, soft delete, provider de configuração, rotação, cofre fora do ar) e uma tabela de onde o segredo mora.
---
## Objective

Uma aplicação .NET precisa de segredos (senha de banco, chave de API de terceiros) e, no Azure, de um jeito de provar quem ela é para obtê-los. O objetivo é terminar sem segredo no repositório e, idealmente, sem nenhum para o bootstrap. Esta lição mede a escada de `appsettings.json` até user-secrets e variáveis de ambiente, depois o lado do Azure.Identity: a cadeia do `DefaultAzureCredential` e por que a doc manda tirá-la de produção, o `ManagedIdentityCredential` contra um endpoint de identidade do App Service falso que eu escrevi (pedido de token, cache, retries, 429), o `WorkloadIdentityCredential` contra um token endpoint falso que valida o JWT do `client_assertion`, e o Key Vault pelo emulador Lowkey Vault (versões de segredo, soft delete, o provider de configuração, rotação, cofre fora do ar). Não existe tenant Azure aqui: Entra real, RBAC real e o serviço real de identidade gerenciada são "docs only" e estão rotulados. O princípio do "secret zero" está na [lição de workload identity](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe); esta é a parte .NET.
Versões (NuGet, conferidas em 2026-11-19): `Azure.Identity` 1.21.0, `Azure.Security.KeyVault.Secrets` 4.12.0 (existe a 4.13.0-beta.1), `Azure.Extensions.AspNetCore.Configuration.Secrets` 1.5.2, `Azure.Security.KeyVault.Keys` 4.10.2 (só no projeto, não exercitada), `Azure.Core` 1.64.0, `Microsoft.Identity.Client` 4.90.0, `Microsoft.Extensions.Hosting` 10.0.15, Lowkey Vault 7.4.0 (`nagyesta/lowkey-vault:7.4.0-ubi10-minimal`, a variante arm64), Node 22.23.4, TFM `net10.0`, SDK 10.0.100.

## Use Cases

- Tirar uma connection string ou chave de API do `appsettings.json` e de uma variável de CI.
- Decidir entre `DefaultAzureCredential`, uma credencial específica e um `ChainedTokenCredential`.
- Ler segredos do Key Vault para o `IConfiguration` e sobreviver a uma rotação.
- Depurar o "funciona no meu notebook, mas dá `CredentialUnavailableException` no cluster".

## Deep Dive

### A escada, medida

Um projeto web de brinquedo com `Payments:ApiKey` num `appsettings.json` commitado e um `UserSecretsId`. O `GetDebugView()` mostra qual provider forneceu o valor:

```text
Development, nada mais      ApiKey=COMMITTED-IN-REPO (JsonConfigurationProvider for 'appsettings.json')
dotnet user-secrets set "Payments:ApiKey" "from-user-secrets"
Development + user-secrets  ApiKey=from-user-secrets (JsonConfigurationProvider for 'secrets.json')
Production  + user-secrets  ApiKey=COMMITTED-IN-REPO   (o arquivo de secrets nem é carregado)
Development + Payments__ApiKey=from-env          ->  from-env (EnvironmentVariablesConfigurationProvider)
... mais --Payments:ApiKey=from-cli              ->  from-cli (CommandLineConfigurationProvider)
```

É a precedência da [lição de configuração](configuration-and-the-options-pattern) (JSON, depois user-secrets só em Development, depois ambiente, depois linha de comando), agora observada. No disco o segredo fica em `~/.microsoft/usersecrets/<UserSecretsId>/secrets.json`, modo `-rw-------`, e o conteúdo é JSON em texto puro. User-secrets tira o valor do git; não é criptografia e não serve para produção. Os degraus:

1. `appsettings.json` no git: antipadrão para qualquer segredo, porque fica para sempre no histórico.
2. User-secrets: só desenvolvimento, por usuário, texto puro no perfil.
3. Variáveis de ambiente: boas para o processo, mas visíveis a quem lê `/proc/<pid>/environ` ou um dump de crash, e definidas por quem escreve o deploy.
4. Um cofre gerenciado (Key Vault): central, auditado, versionado, acesso por identidade. A app ainda precisa de uma identidade para pedir.
5. Workload identity: a plataforma prova quem a app é, então nada é guardado para o bootstrap.

### TokenCredential e a cadeia do DefaultAzureCredential

Todo cliente do Azure SDK recebe um `TokenCredential`, cujo trabalho é `GetTokenAsync(TokenRequestContext)` devolvendo um `AccessToken` (token, `ExpiresOn`, `RefreshOn`). O `DefaultAzureCredential` é um `ChainedTokenCredential` pré-configurado que tenta credenciais em ordem até uma responder. A doc (conferida em 2026-11-19) lista: Environment, Workload Identity, Managed Identity, Visual Studio, Visual Studio Code, Azure CLI, Azure PowerShell, Azure Developer CLI, Interactive browser (desligado por padrão), Broker. O `AzureEventSourceListener` na fonte `Azure-Identity` mostra o percurso real. Nesta máquina, sem login em nada:

```text
EnvironmentCredential ... WorkloadIdentityCredential ... ManagedIdentityCredential (source selected: DefaultToImds)
VisualStudioCredential ... AzureCliCredential ... AzurePowerShellCredential ... AzureDeveloperCliCredential
DefaultAzureCredential: CredentialUnavailableException after 2315 ms
```

Sete credenciais foram tentadas (as do Visual Studio Code e do Broker exigem `Azure.Identity.Broker` e não apareceram). Com `IDENTITY_ENDPOINT` definido, parou na terceira: `DefaultAzureCredential credential selected: Azure.Identity.ManagedIdentityCredential`, 91 ms. `AZURE_TOKEN_CREDENTIALS` estreita a cadeia, medido:

```text
=prod                       Environment, WorkloadIdentity, ManagedIdentity           (CredentialUnavailable em 1045 ms)
=dev                        VisualStudio, AzureCli, AzurePowerShell, AzureDeveloperCli (280 ms)
=ManagedIdentityCredential  só ManagedIdentity (e não respondeu em 100 s: veja os retries abaixo)
=bogus                      InvalidOperationException: Invalid value ... Valid values are 'dev', 'prod', 'visualstudiocredential', ...
```

A doc diz que nomes de credencial individual exigem Azure.Identity 1.15.0 ou superior. Por que a doc manda trocar o `DefaultAzureCredential` depois do deploy: falhas são difíceis de atribuir (é preciso log para ver qual elo rodou), elos que falham custam tempo (o acima gastou a maior parte dos 2,3 s em sondagens) e o comportamento depende de variáveis de ambiente que qualquer um pode definir na máquina inteira ("unpredictable behavior"). A forma recomendada em produção é uma credencial específica, escolhida por ambiente:

```csharp
TokenCredential credential = builder.Environment.IsDevelopment()
    ? new ChainedTokenCredential(new AzureCliCredential(), new VisualStudioCredential())
    : new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(clientId)); // ou WorkloadIdentityCredential
```

### Identidade gerenciada e seu token endpoint (IMDS falso, medido)

Uma identidade gerenciada é um service principal do Entra cujas credenciais a plataforma guarda. System-assigned: presa a um recurso e apagada com ele. User-assigned: um recurso separado que você anexa a vários (o que você quer quando várias apps ou slots compartilham as mesmas permissões). A app obtém tokens de um endpoint local. No App Service e Functions o contrato (docs) são duas variáveis de ambiente, `IDENTITY_ENDPOINT` e `IDENTITY_HEADER` (rotacionada pela plataforma para mitigar SSRF), e `GET {IDENTITY_ENDPOINT}?resource=...&api-version=2019-08-01` com o header `X-IDENTITY-HEADER`; `client_id`, `principal_id` ou `mi_res_id` opcionais escolhem uma user-assigned. Numa VM o endpoint é o IMDS, `http://169.254.169.254/metadata/identity/oauth2/token` (docs only). Escrevi a versão App Service em 25 linhas de Node na porta 6780 (ela loga cada pedido e pode responder 200, 429, 500 ou nunca) e apontei o SDK real para ela:

```csharp
var mi = new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned);
var t  = await mi.GetTokenAsync(new TokenRequestContext(["https://vault.azure.net/.default"]), default);
```

```text
GET /MSI/token?api-version=2019-08-01&resource=https%3A%2F%2Fvault.azure.net   X-IDENTITY-HEADER=rotating-secret-1
system-assigned #1: expiresIn=24.0h refreshOn=12.0h in 58 ms     (o falso devolve tokens de 24 h)
system-assigned #2: in 2 ms                                      (sem segundo pedido: cache)
user-assigned:   ...&client_id=11111111-2222-3333-4444-555555555555
novo scope storage.azure.com: um terceiro pedido, resource=https%3A%2F%2Fstorage.azure.com
IDENTITY_HEADER errado: 400 do meu endpoint, AuthenticationFailedException em 68 ms, um pedido, sem retry
```

O sufixo `.default` é removido (a API de identidade gerenciada recebe um resource, não um scope), o cache é por identidade e scope, e o `RefreshOn` é metade da vida. Clientes criados pelo Azure SDK renovam pelo `RefreshOn` sozinhos; código que chama uma credencial direto deve chamar `GetTokenAsync` a cada uso e deixar o cache decidir, nunca guardar a string. Agora as falhas, com o modo trocado pelo script de teste:

```text
modo 429 (Retry-After: 1)   6 pedidos em +0, 1.0, 2.0, 3.7, 7.4, 16.6 s, depois "Error Code: too_many_requests" aos 16,7 s
modo 500                    6 pedidos em 23 s ... "Error Code: boom"
modo flaky (429 duas vezes) 3 pedidos, token devolvido após 2,1 s
modo slow (nunca responde)  NetworkTimeout=2s: 6 pedidos em 18,8 s, depois "Retry failed after 6 tries"
```

A página do Learn descreve um "modo resiliente" do `ManagedIdentityCredential` (0,8 s inicial, até cinco retries, backoff), o que bate com seis tentativas. O que não bate: configurei `Retry = { MaxRetries = 3 }` e `MaxRetries = 0` e continuei vendo seis pedidos contra a fonte App Service no 1.21.0, então trate essa opção como não comprovada para essa fonte. O ponto prático permanece: um endpoint de identidade com falha bloqueia o primeiro pedido de token por 20 segundos ou mais, e uma inicialização que lê o Key Vault trava esse tempo. Dentro da cadeia é o contrário: o `DefaultAzureCredential` sem `AZURE_TOKEN_CREDENTIALS=ManagedIdentityCredential` roda em "fail fast", sem retries, por isso um notebook falha em 1 a 2 segundos, enquanto um `ManagedIdentityCredential` sozinho contra um IMDS ausente ficou mais de 100 s aqui.

### Workload identity federation (token endpoint falso, medido)

Kubernetes (AKS), GitHub Actions e outros emissores OIDC podem ser confiados por um app registration do Entra ou uma identidade user-assigned por meio de uma federated credential (issuer, subject, audience). A workload apresenta o JWT do próprio emissor como `client_assertion`; não existe client secret. O fluxo medido: o `mktoken.mjs` faz o papel do kubelet e grava num arquivo um JWT de vida curta assinado por uma chave falsa de cluster (`iss`, `sub=system:serviceaccount:default:orders`, `aud=api://AzureADTokenExchange`, 1 h). O `sts.mjs` (HTTPS, porta 6783, autoassinado) é um token endpoint que implementa só `client_credentials` com `client_assertion`, verifica assinatura, issuer, subject, audience e validade, e devolve um access token. O lado do SDK:

```csharp
var cred = new WorkloadIdentityCredential(new WorkloadIdentityCredentialOptions {
    TenantId = "tenant-1111", ClientId = "app-2222", TokenFilePath = "token-good",
    AuthorityHost = new Uri("https://localhost:6783"), DisableInstanceDiscovery = true });
```

```text
POST /tenant-1111/oauth2/v2.0/token grant_type=client_credentials scope=api://my-api/.default client_id=app-2222 assertion_type=jwt-bearer secret=none
  -> assertion OK iss=https://oidc.cluster.example sub=system:serviceaccount:default:orders aud=api://AzureADTokenExchange exp-in=3586s
explicit options #1: OK expiresIn=60min 103 ms     #2: OK 2 ms (cache)
```

Funcionou igual sem opções, com as quatro variáveis que o webhook do AKS injeta: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_FEDERATED_TOKEN_FILE`, `AZURE_AUTHORITY_HOST`. As falhas, cada uma com a linha do log do STS (a mensagem do SDK é só "ClientAssertionCredential authentication failed"; o motivo está no servidor, e cada chamada bate de novo no STS porque falhas não são cacheadas):

```text
sub de outra ServiceAccount   401 AADSTS70021 no federated identity credential matches subject ...:billing
audience api://other          401 AADSTS700212 audience mismatch
assertion expirada            401 AADSTS700024 assertion expired
outro issuer                  401 AADSTS700211 issuer not trusted: https://evil.example
arquivo de token ausente      "Could not find file ..." (no cliente, nada foi enviado)
sem DisableInstanceDiscovery  sem resposta em 60 s e o STS não viu nenhum pedido (instance discovery para um host que não é da Microsoft)
```

A segurança está na comparação do subject da federated credential, exatamente como na lição das condições de confiança do GitHub: um subject frouxo deixa outra workload entrar. Os códigos acima são do meu falso, modelados sobre nomes AADSTS reais (docs only: o texto do serviço real pode diferir). O arquivo é relido quando uma nova assertion é necessária (o kubelet o renova); não testei a rotação do arquivo. Entra real, o webhook do AKS e `AZURE_AUTHORITY_HOST` para nuvens soberanas são docs only.

### Key Vault: segredos, chaves, certificados (docs) e o emulador (medido)

O Key Vault guarda três tipos de objeto: segredos (valores opacos que você lê de volta), chaves (RSA, EC; o serviço assina, verifica, empacota e desempacota para que a chave privada fique lá dentro, docs) e certificados (chave e segredo mais ciclo de vida). Toda mudança cria uma versão. Objetos apagados passam por soft delete: ligado por padrão, não dá para desligar, retenção de 7 a 90 dias (90 por padrão). A purge protection impede o purge dentro da retenção. A autorização do data plane é Azure RBAC ou as access policies legadas (docs only).

O Lowkey Vault é um emulador, não o Azure: modela a API de data plane e ignora o valor do token (o README diz que as credenciais só são checadas quanto à presença), então não dá para testar permissão. Ele serve HTTPS com certificado próprio (aqui `--server.port=6781`, metadata em HTTP 6782, via `docker run`). Duas coisas que o SDK exigiu, em ordem:

```text
padrões                        RequestFailedException: The SSL connection could not be established
confiar no cert do emulador    InvalidOperationException: The challenge resource 'localhost' does not match the requested domain.
  (callback do HttpClientHandler     Set DisableChallengeResourceVerification to true in your client options
   comparando o thumbprint do
   cert de /metadata/default-cert/lowkey-vault.p12, senha "changeit")
+ DisableChallengeResourceVerification = true        OK
```

Um pedido sem header `Authorization` recebe `401` e `WWW-Authenticate: Bearer resource="https://localhost:6781", authorization_uri=...`, o desafio que o SDK responde pedindo um token à credencial. As duas configurações são só para emuladores: nunca desligue a validação de certificado nem a verificação do desafio contra o cofre real. Com isso:

```csharp
var client = new SecretClient(vault, credential, options);       // options: Transport, DisableChallengeResourceVerification
await client.SetSecretAsync("Db--Password", "pw-1");  await client.SetSecretAsync("Db--Password", "pw-2");
await foreach (var v in client.GetPropertiesOfSecretVersionsAsync("Db--Password"))
    Console.WriteLine($"{v.Version[..8]} {(await client.GetSecretAsync("Db--Password", v.Version)).Value.Value}");
```

```text
latest: pw-2    versões: 3c5e595a=pw-1  bec7338f=pw-2     (uma versão fixada continua legível)
GetPropertiesOfSecretsAsync lista só nomes, sem valores
StartDeleteSecretAsync("Api--Key"): scheduledPurge=2027-02-17 (90 dias) recoveryId=/deletedsecrets/Api--Key
GetSecretAsync após apagar: 404     StartRecoverDeletedSecretAsync: valor de volta
```

### O provider de configuração e a rotação

```csharp
builder.Configuration.AddAzureKeyVault(client, new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromSeconds(3) });
// ou, no Azure: AddAzureKeyVault(new Uri(url), new ManagedIdentityCredential(...))
```

Nomes de segredo aceitam só letras, dígitos e `-`, então `Db--Password` vira `Db:Password` (um `KeyVaultSecretManager` próprio pode mudar o mapeamento ou carregar um subconjunto por prefixo: docs only). O provider foi adicionado depois da fonte em memória, então ele vence:

```text
Db:Password=pw-2  Db:Host=from-memory  Api:Key=key-1
debugview: Password=pw-2 (AzureKeyVaultConfigurationProvider)   Host=from-memory (MemoryConfigurationProvider)
```

Ele carrega na inicialização (bloqueia o build) e depois a cada `ReloadInterval` (padrão: nunca). Rotacionei `Db--Password` para `pw-3-rotated` com o host rodando: com a escrita 2 segundos depois do carregamento, a configuração mudou em 1,0 s, o `IOptionsMonitor<T>.OnChange` disparou e o `CurrentValue` trouxe o valor novo. Escrever no mesmo segundo do carregamento inicial nunca foi visto em 20 s. Minha leitura: o provider compara `UpdatedOn`, que tem resolução de um segundo, então duas escritas no mesmo segundo parecem iguais. Um job de rotação que escreve duas vezes em um segundo pode perder a segunda escrita. Falha do cofre:

```text
cofre parado com a app rodando (reload a cada 2 s): após 6 s Db:Password continua pw-1, processo vivo
inicialização com o cofre fora: AggregateException: Retry failed after 2 tries ... (Connection refused (localhost:6781))
```

Um reload que falha mantém o último valor em silêncio (logue você mesmo se precisar saber), e uma inicialização que falha não sobe. Ambos medidos contra o emulador com o retry do cliente em 1.

### Rotação sem downtime

Duas regras. O consumidor precisa tolerar dois segredos válidos ao mesmo tempo: o provedor emite um novo enquanto o antigo ainda é aceito por uma janela, depois o antigo é revogado (usuários de banco `app_a` e `app_b` alternados, duas chaves de API, app registration do Entra com dois client secrets). E o consumidor precisa reler: `IOptionsMonitor<T>` para options, e para o que guarda o segredo dentro de uma conexão (um header de `HttpClient`, um pool de conexões) reconstrua no `OnChange`, por exemplo com um `HttpClient` nomeado cujo handler é criado a partir do `CurrentValue` ou um `IHttpClientFactory` com `SetHandlerLifetime`. `IOptions<T>` e `IOptionsSnapshot<T>` em singletons mantêm o valor antigo. Um teste de rotação que só reinicia a app não prova nada disso.

### Sem vazar

- Nunca logue um segredo nem um objeto de options inteiro. Em log estruturado, o `Microsoft.Extensions.Compliance.Redaction` com `[LogProperties]` e uma classificação de dados troca valores classificados antes de chegarem ao destino (docs only, não executado aqui).
- `SecureString`: a Microsoft recomenda não usar em código novo no .NET (Core) (analisador DE0001), porque não é um conceito do SO nem no Windows e a string em claro aparece na memória de qualquer forma. Trate a memória como confiável e foque em tempo de vida e higiene de log.
- Dumps de configuração e páginas de health: o `GetDebugView()` imprime valores; não o exponha.

### Além do Azure (só o princípio, docs only)

O HashiCorp Vault é source-available: o LICENSE do repositório (conferido em 2026-11-19) é a Business Source License 1.1 a partir da versão 1.15.0, licenciante IBM, com um additional use grant que proíbe produto concorrente hospedado ou embutido. O OpenBao é o fork da comunidade, hospedado na OpenSSF da Linux Foundation, com licença aprovada pela OSI. Ambos oferecem segredos dinâmicos, leases e vários métodos de autenticação (Kubernetes, JWT/OIDC, IAM de nuvem), o que o Key Vault, um armazém com versões, não oferece. AWS Secrets Manager e Parameter Store, e o GCP Secret Manager, são a mesma ideia com o IAM da respectiva nuvem e rotação gerenciada. Kubernetes Secrets são base64, não criptografia: veja a [lição de Kubernetes Secrets](/kubernetes-concepts/kubernetes-secrets-fundamentals); para não colocá-los no git use o External Secrets Operator (sincroniza de um cofre para um Secret) ou o Secrets Store CSI driver (monta objetos do cofre como arquivos no pod).

### Segredos no CI

Não guarde uma chave de nuvem como segredo de pipeline. O GitHub Actions pode pedir um token OIDC e trocá-lo por uma federated credential, o mesmo mecanismo da workload identity acima, com a condição de confiança medida na [lição de workload identity](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe). O lado do pipeline está na lição de CI/CD para .NET.

### Onde o segredo mora

| Onde | Quem lê | Rotação | O que vaza | Quando usar |
|---|---|---|---|---|
| `appsettings.json` no git | quem tem o repositório | um commit, o histórico fica | clones, forks, logs de CI | nunca para segredos |
| User-secrets | seu usuário, `secrets.json` em claro | à mão | backup de disco, perfil compartilhado | só desenvolvimento |
| Variável de ambiente | o processo, root, dumps de crash | redeploy | `/proc`, dumps, `docker inspect`, logs | poucos valores, injetados pela plataforma |
| Key Vault por `SecretClient` ou provider | a identidade da app (RBAC) | nova versão, `ReloadInterval` | role ampla demais, valores logados | apps Azure com segredos que não dá para eliminar |
| Identidade gerenciada | a plataforma para a app | automática, horas | SSRF ao endpoint, identidade compartilhada | qualquer chamada Azure que aceite Entra |
| Workload identity federation | o arquivo JWT do emissor | automática, minutos a horas | subject da federação frouxo | AKS, GitHub, multi-cloud |
| Vault/OpenBao | a app pelo seu método de auth | leases, segredos dinâmicos | root token, policy ampla | multi-cloud ou credenciais dinâmicas de banco |

## Trade-offs

- **O `DefaultAzureCredential` é conveniente e discutível.** Uma linha funciona no notebook e no Azure, mas a cadeia levou 2,3 s para falhar e esconde qual credencial venceu. Use em desenvolvimento, uma credencial nomeada em produção, `AZURE_TOKEN_CREDENTIALS=prod` como meio-termo barato.
- **Identidade gerenciada resiliente pode travar a inicialização.** Seis tentativas em cerca de 17 a 25 s quando o endpoint falha. Fail fast em desenvolvimento e, em produção, defina um timeout de inicialização em vez de supor um erro rápido.
- **Reload do provider significa consistência eventual.** Entre a escrita e o próximo `ReloadInterval` duas instâncias têm valores diferentes, e um reload que falha mantém o antigo em silêncio.
  ```csharp
  mon.OnChange(o => log.LogInformation("db credential reloaded")); // nunca logue o.Password
  ```
- **O Key Vault é uma dependência de runtime.** O provider bloqueia a inicialização se o cofre estiver fora; decida se quer que a app se recuse a subir ou carregue o cofre em segundo plano.
- **Emuladores provam o código do cliente, não as permissões.** O Lowkey Vault ignorou o token, então erros de RBAC (403 `Forbidden`) não foram testados aqui; teste numa assinatura real.
- **A federação move a confiança.** Não há segredo para roubar, mas um match errado de subject ou issuer é uma porta de entrada, e os arquivos que o kubelet grava são legíveis por todo o pod.

## Documentation Links

- [Authenticate .NET apps to Azure services, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/) (doc)
- [Credential chains in the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/credential-chains) (doc)
- [Authentication best practices with the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/best-practices) (doc)
- [What are managed identities for Azure resources, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) (doc)
- [Managed identities in App Service (REST endpoint reference), Microsoft Learn](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity) (doc)
- [Workload identity federation, Microsoft Learn](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) (doc)
- [Use Microsoft Entra Workload ID with AKS, Microsoft Learn](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview) (doc)
- [WorkloadIdentityCredential class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.workloadidentitycredential) (doc)
- [Azure Key Vault overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) (doc)
- [Soft-delete and purge protection, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview) (doc)
- [Azure RBAC for Key Vault data plane, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) (doc)
- [AzureKeyVaultConfigurationOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.extensions.aspnetcore.configuration.secrets.azurekeyvaultconfigurationoptions) (doc)
- [Safe storage of app secrets in development, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
- [SecureString class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.securestring) (doc)
- [Lowkey Vault, GitHub](https://github.com/nagyesta/lowkey-vault) (doc)
- [Vault documentation, HashiCorp](https://developer.hashicorp.com/vault/docs) (doc)
- [OpenBao documentation, OpenBao](https://openbao.org/docs/) (doc)
- [What is AWS Secrets Manager, AWS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) (doc)
- [Secret Manager overview, Google Cloud](https://cloud.google.com/secret-manager/docs/overview) (doc)
- [Secrets, Kubernetes](https://kubernetes.io/docs/concepts/configuration/secret/) (doc)
- [External Secrets Operator](https://external-secrets.io/latest/) (doc)
- [Secrets Store CSI Driver, Kubernetes SIGs](https://secrets-store-csi-driver.sigs.k8s.io/) (doc)
