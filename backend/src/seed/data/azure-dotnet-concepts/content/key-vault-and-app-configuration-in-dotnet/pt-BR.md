---
version: 1.0
updatedAt: 2026-11-20
title: "Key Vault e App Configuration no .NET"
summary: SecretClient contra um dublê local do Key Vault (versões, 401, 404, 403), AddAzureKeyVault como provider de configuração (mapeamento de -- para :, KeyVaultSecretManager, ReloadInterval), App Configuration com Select, rótulos, sentinela, RegisterAll e middleware, referências a Key Vault, feature flags, RBAC contra access policies e limites, tudo medido num servidor falso escrito em C# (não é o serviço real).
---
## Objective

Uma aplicação .NET no Azure costuma ler dois tipos de configuração externa: segredos (uma senha de banco, uma chave de API) e configuração comum (uma feature flag, um timeout, uma mensagem). O Azure separa os dois em dois serviços com duas integrações .NET: o Key Vault, lido por `SecretClient` ou como provider de `IConfiguration`, e o App Configuration, um provider de configuração com modelo próprio de refresh, que também pode apontar para o Key Vault. Esta lição mede como esses clientes se comportam na rede: chamadas do `SecretClient`, o mapeamento de `--` para `:` no nome, o `ReloadInterval`, `Select` com filtro de chave e rótulo, refresh por sentinela, o middleware, referências a Key Vault, feature flags e os modos de falha. Aqui não há assinatura do Azure nem emulador oficial de nenhum dos dois serviços, então toda medição é contra um dublê dos dois data planes que escrevi em C# (Kestrel, certificado autoassinado, cerca de 150 linhas, `Fake.cs` no laboratório). Ele responde o mínimo de REST que os SDKs reais pedem. É um dublê de teste, não o Azure: prova o que o código do cliente faz, não o que os serviços devolvem. Tudo o que exige o serviço real (aplicação de RBAC, soft delete, purge protection, throttling real, texto de erro real) é só documentação e está marcado. O lado da identidade (`DefaultAzureCredential`, managed identity, workload identity) está na [lição de credenciais](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential) e na [lição de segredos e identidades gerenciadas](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity), que mediu o Key Vault no emulador Lowkey Vault; esta vai além no lado da configuração e no App Configuration.
Versões (NuGet, conferidas em 2026-11-20): `Azure.Security.KeyVault.Secrets` 4.12.0 (existe a 4.13.0-beta.1), `Azure.Security.KeyVault.Keys` 4.10.2, `Azure.Security.KeyVault.Certificates` 4.10.0 (as duas últimas só construídas, não exercitadas), `Azure.Extensions.AspNetCore.Configuration.Secrets` 1.5.2, `Microsoft.Extensions.Configuration.AzureAppConfiguration` 8.6.1 (existe a 8.7.0-preview), `Microsoft.Azure.AppConfiguration.AspNetCore` 8.6.1, `Microsoft.FeatureManagement.AspNetCore` 4.8.0, `Azure.Core` 1.64.0, TFM `net10.0`, SDK 10.0.100, runtime 10.0.0, Apple M4 Max, macOS 27.2.1. Os tempos são dessa máquina.

## Use Cases

- Tirar uma connection string ou chave de API do `appsettings.json` e colocá-la num cofre que a aplicação lê por identidade.
- Centralizar configurações que não são segredo e feature flags de vários serviços, com rótulos por ambiente, e mudá-las sem deploy.
- Depurar "mudei o valor no portal mas minha aplicação ainda mostra o antigo" ou "o segredo rotacionou e a aplicação quebrou".
- Revisar as permissões que uma aplicação precisa (papel RBAC por serviço) e quanto tráfego as configurações de refresh geram.

## Deep Dive

### Segredo, chave ou certificado

O Key Vault guarda três tipos de objeto, cada um com seu pacote de cliente (`Azure.Security.KeyVault.Secrets`, `.Keys`, `.Certificates`):

- Um **segredo** é um valor opaco que você lê de volta (senha, token, connection string). O `SecretClient` é o que as aplicações usam.
- Uma **chave** é material criptográfico que o serviço usa por você: assinar, verificar, empacotar, desempacotar, cifrar e decifrar pelo `CryptographyClient`, de modo que a chave privada não sai do serviço (documentação).
- Um **certificado** é uma chave mais um segredo mais ciclo de vida (emissor, renovação). Ler a metade segredo de um certificado devolve a chave privada, e por isso a descrição do papel `Key Vault Secrets User` diz "including secret portion of a certificate with private key" (rbac-guide, 2026-06-16).

Configuração comum não é segredo: vai para o App Configuration, cujo FAQ (2026-08-28) diz que o Key Vault "still the best place for storing application secrets" e que os dois "should be used side by side". Um key-value ali tem limite de 10 KB, contando os atributos.

### `SecretClient` na rede (cofre falso, medido)

```csharp
var client = new SecretClient(vaultUri, credential, options);
await client.SetSecretAsync("Db--Password", "pw-1");
await client.SetSecretAsync("Db--Password", "pw-2");
KeyVaultSecret s = (await client.GetSecretAsync("Db--Password")).Value;   // última versão
```

```text
PUT /secrets/Db--Password?api-version=2026-04-01  (no Authorization)   <- o SDK primeiro manda sem token e lê o desafio 401
PUT /secrets/Db--Password?api-version=2026-04-01                       <- depois pede a credencial uma vez, escopo https://vault.azure.net/.default
latest: Name=Db--Password Value=pw-2 Version=dae22229 Enabled=True Id=https://localhost:7040/secrets/Db--Password/dae22229fbd2...
GetPropertiesOfSecretVersionsAsync: 95a8d028 -> pw-1, dae22229 -> pw-2    (uma versão fixada continua legível)
GetPropertiesOfSecretsAsync lista só nomes: SecretProperties não tem Value
pedidos de token depois de cerca de 8 chamadas: 1 (o resultado da credencial foi cacheado)
```

Cada `SetSecretAsync` cria uma versão nova, nunca sobrescreve, e `GetSecretAsync(name)` sem versão significa a mais recente. A versão de serviço padrão que o cliente 4.12.0 enviou aqui foi `2026-04-01`. Uma credencial de token recusa HTTP puro: `InvalidOperationException: Bearer token authentication is not permitted for non TLS protected (https) endpoints.` O dublê tem certificado autoassinado, então o laboratório passa um `HttpClientTransport` que confia só naquele thumbprint e liga `DisableChallengeResourceVerification = true`. Os dois são só para dublês de teste: o cofre real tem certificado público e você nunca desliga isso.

As falhas chegam como `RequestFailedException` com `Status`, `ErrorCode` e o corpo. Contra o dublê:

```text
GetSecretAsync("Nope")  -> Status=404 ErrorCode=SecretNotFound   "A secret with (name/id) Nope was not found in this key vault. ..."
papel leitor chama Set  -> Status=403 ErrorCode=Forbidden        inner code ForbiddenByRbac, "Caller is not authorized to perform action on resource. Action: 'Microsoft.KeyVault/vaults/secrets/setSecret/action' ..."
cofre com access policy -> Status=403 ErrorCode=Forbidden        inner code AccessDenied, "The user, group or application 'appid=...;oid=...' does not have secrets get permission on key vault ..."
```

Cada uma foi enviada exatamente uma vez (sem retry em 403 nem em 404). Os textos das mensagens são do MEU dublê, modelados em textos citados em threads públicas de suporte, não copiados de uma página oficial: o texto real pode diferir, então capture por `Status` (e `ErrorCode`), não pela mensagem. A leitura prática dos dois formatos de 403 (documentação mais essas threads): `ForbiddenByRbac` significa que o cofre usa Azure RBAC e o chamador não tem papel de data plane naquele escopo; `AccessDenied` significa um cofre no modelo de access policy. A aplicação real de RBAC, e o atraso até uma atribuição nova de papel valer (o rbac-guide manda esperar vários minutos), são só documentação.

### `AddAzureKeyVault` como provider de configuração (medido)

```csharp
builder.Configuration.AddAzureKeyVault(client, new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromSeconds(1) });
// no Azure: AddAzureKeyVault(new Uri(url), new ManagedIdentityCredential(...))
```

Nomes de segredo não aceitam `:`, então o manager padrão do provider troca `--` pelo delimitador de configuração. Segredos criados: `Db--Password`, `Db--Host`, `Api--Key`, um `Old--Secret` DESABILITADO e `app1-Smtp--Password`, com a variável de ambiente `Db__Password=from-env` adicionada antes da fonte do cofre:

```text
Db:Password=pw-1  Db:Host=db.internal  Api:Key=key-1  Old:Secret=(null)  app1-Smtp:Password=smtp-1
GetDebugView: Password=pw-1 (AzureKeyVaultConfigurationProvider)         <- a fonte do cofre, adicionada por último, venceu a variável de ambiente
pedidos no startup: 1 list, depois 1 GET por segredo HABILITADO (nenhum para Old--Secret)
```

O provider precisa das permissões `list` e `get` em segredos, e o custo de startup é um pedido por segredo. Um `KeyVaultSecretManager` próprio decide quais segredos carregam (`Load`) e como os nomes mapeiam (`GetKey`). O exemplo de prefixo da documentação, para uma aplicação que carrega só os próprios segredos:

```csharp
class PrefixManager(string prefix) : KeyVaultSecretManager {
    public override bool Load(SecretProperties p) => p.Name.StartsWith(prefix + "-");
    public override string GetKey(KeyVaultSecret s) => s.Name[(prefix.Length + 1)..].Replace("--", ConfigurationPath.KeyDelimiter);
}
```

Com `PrefixManager("app1")`: `Smtp:Password=smtp-1`, `Db:Host=(null)`, e o dublê viu um list e um GET (só o segredo que casa é buscado). Prefixo é um jeito de dividir um cofre entre aplicações, mas o rbac-guide recomenda "a vault per application per environment" com papéis no escopo do cofre, porque atribuição por segredo não isola equipes (o FAQ dele diz isso).

O `ReloadInterval` padrão é `null`: sem reload. Com 1 segundo:

```text
3,2 s sem mudança:         3 pedidos, todos GET /secrets (a listagem), nenhum GET de segredo, 0 callbacks de mudança
Db--Password rotacionado:  1 list + 1 GET /secrets/Db--Password, Db:Password=pw-2-rotated, 1 callback de mudança
```

Cada intervalo custa um pedido de listagem, e só o segredo cujos metadados mudaram é buscado de novo. É o mesmo reload que a [outra lição](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) mediu com `IOptionsMonitor<T>.OnChange` e com a resolução de um segundo do `UpdatedOn`, que pode esconder duas escritas no mesmo segundo. O startup com 403 lança `RequestFailedException` em `Build()`, então a aplicação não sobe.

### Por que ler uma vez no startup é um risco

O provider carrega no startup e, por padrão, nunca mais, então um segredo rotacionado fica na memória até o processo reiniciar. Ler com `SecretClient` uma vez para uma string `static` tem o mesmo problema. A falha não aparece na hora da rotação, e sim depois: a credencial antiga é revogada após a janela de sobreposição e a aplicação começa a falhar autenticação num momento qualquer. A página de throttling do Key Vault (2026-07-15) manda guardar segredos em memória e "re-read from Azure Key Vault only when the cached copy stops working (for example, because it got rotated at the source)". Os dois formatos bons: um `ReloadInterval` curto junto com `IOptionsMonitor<T>` (nunca `IOptions<T>` num singleton, veja a [lição de configuração](/dotnet-concepts/configuration-and-the-options-pattern)), ou um retry em falha de autenticação que lê o segredo de novo uma vez. Um esquema de rotação também precisa manter dois segredos válidos durante uma janela.

### App Configuration: `Select`, rótulos e JSON (medido)

```csharp
builder.Configuration.AddAzureAppConfiguration(o => {
    o.Connect(new Uri(endpoint), new DefaultAzureCredential())
     .Select("TestApp:*")            // sem rótulo (o filtro de rótulo padrão é o rótulo nulo)
     .Select("TestApp:*", "Prod")    // o Select mais tarde vence nas chaves que se sobrepõem
     .TrimKeyPrefix("TestApp:");
});
```

Chaves criadas: `TestApp:Settings:Message=base`, a mesma chave com rótulo `Prod` e valor `from-Prod`, `TestApp:Settings:Color`, `Other:Thing` e `TestApp:Json` com content type `application/json`:

```text
Json:a = 1   Json:b:c = 2   Settings:Color = white   Settings:Message = from-Prod      (Other:Thing não carregou)
pedidos: GET /kv?...&key=TestApp%3A%2A&label=%00      GET /kv?...&key=TestApp%3A%2A&label=Prod       (um por Select)
```

Rótulos: sem filtro de rótulo só carregam os valores de rótulo nulo (`label=%00`), e o quickstart diz que carrega "all key-values that have no label". Um content type JSON é achatado em chaves. O conselho do FAQ para ambientes: um store separado por ambiente quando você precisa de isolamento de permissão, rótulos só quando não precisa. O provider tem `Map` para reescrever chaves (por exemplo `__` para `:`), `SelectSnapshot` e filtros de tag (só documentação). Falha de startup, store inacessível com `Timeout = 3 s` (uma execução de cada):

```text
padrão             TimeoutException: The provider timed out while attempting to load.   (lançada após 5,0 s)
optional: true     construído após 3,0 s, configuration["TestApp:Settings:Message"] é null
```

`AddAzureAppConfiguration(..., optional: true)` deixa a aplicação subir sem o store e sem nada dele: decida isso de propósito, porque um valor vazio é um bug pior que uma queda para a maioria das configurações. Não investiguei por que a variante que lança demorou mais que o timeout. Como no Key Vault, autenticação bearer sobre `http://` lança a mesma `InvalidOperationException`.

### Refresh: sentinela, `RegisterAll` e o middleware (medido)

Key-values não são observados a menos que você diga ("Key-values are not automatically registered for refresh monitoring", referência do provider, 2026-08-28). Dois jeitos:

```csharp
o.ConfigureRefresh(r => r.Register("Sentinel", refreshAll: true).SetRefreshInterval(TimeSpan.FromSeconds(1)));  // observa uma chave
o.ConfigureRefresh(r => r.RegisterAll().SetRefreshInterval(TimeSpan.FromSeconds(1)));                          // observa todas as chaves selecionadas
```

O provider nunca faz refresh sozinho: seu código chama `IConfigurationRefresher.TryRefreshAsync()`, ou `app.UseAzureAppConfiguration()` chama a cada requisição. Execução com sentinela, intervalo de 1 s:

```text
carga                                GET /kv?key=TestApp:*   +   GET /kv/Sentinel
TryRefreshAsync dentro do intervalo  nenhum pedido
após 1,1 s, sem mudança              GET /kv/Sentinel  If-None-Match="de6e6e84..."        (pedido condicional, o etag)
mudei TestApp:A, sentinela não       o mesmo GET /kv/Sentinel, A continua a1               <- a sentinela esconde a mudança
sentinela alterada                   GET /kv/Sentinel, depois o GET /kv?key=TestApp:* completo, A=a2
RegisterAll, sem mudança             GET /kv?key=TestApp:*  If-None-Match="30d9cf67..."   (um pedido condicional para a página toda)
RegisterAll, B mudou                 o mesmo pedido condicional, depois um incondicional, B=b2
```

A sentinela torna atômica a mudança de várias chaves (escreve tudo, altera a sentinela por último, a aplicação recarrega uma vez) e mantém o polling em um pedido minúsculo. O custo é que uma mudança sem alterar a sentinela fica invisível. `SetRefreshInterval` abaixo de um segundo lança `ArgumentOutOfRangeException: The refresh interval cannot be less than 1000 milliseconds`; o padrão é 30 segundos (documentação). A conta de cota do FAQ diz que verificações frequentes sem mudança, na maioria, não contam contra a cota horária de um store Standard.

Quando o store responde 429 (meu dublê: 429 mais `retry-after-ms: 500` em tudo):

```text
TryRefreshAsync devolveu False após 2,3 s, 3 pedidos, a configuração manteve o último valor (A=a2)
store saudável de novo, intervalo de 1 s: o valor novo (a3) só apareceu após 31 s e 28 chamadas de TryRefreshAsync
```

Um refresh que falha mantém o cache, como a documentação diz, e o provider espera antes de tentar de novo: aqui foram cerca de 31 s mesmo com intervalo de 1 s (o motivo não está documentado no que li, então trate os 31 s como desta execução). Não ajuste o intervalo para reagir mais rápido do que suas quedas se recuperam.

O middleware (`Microsoft.Azure.AppConfiguration.AspNetCore`), com `AddAzureAppConfiguration()` nos serviços, `app.UseAzureAppConfiguration()` cedo no pipeline, `IOptionsSnapshot<Settings>` no handler e intervalo de 2 s. O store muda (mensagem para `hello v2`, flag `Beta` ligada):

```text
imediatamente                     /msg -> hello v1    /beta -> 404
após 2,2 s, PRIMEIRA requisição   /msg -> hello v1    /beta -> 404      <- essa requisição disparou o refresh e ainda viu o valor antigo
a PRÓXIMA requisição              /msg -> hello v2    /beta -> 200 beta page    /flag -> True
```

O refresh é iniciado por uma requisição mas não a atrasa, então uma mudança chega aos clientes uma requisição depois do intervalo. Em serviços de background não há requisições, então injete `IConfigurationRefresherProvider` e chame `TryRefreshAsync` no loop (só documentação).

### Referências a Key Vault (medido com o dublê)

Um key-value com content type `application/vnd.microsoft.appconfig.keyvaultref+json` guarda `{"uri":"https://<vault>/secrets/<name>"}`. O provider resolve com a identidade da APLICAÇÃO, então ela precisa de `Key Vault Secrets User` no cofre e o App Configuration nunca guarda o segredo:

```csharp
o.ConfigureKeyVault(kv => kv.Register(secretClient));      // ou kv.SetCredential(credential), ou kv.SetSecretResolver(...)
```

```text
sem ConfigureKeyVault   KeyVaultReferenceException: No key vault credential or secret resolver callback configured, and no matching secret client could be found. ... Key:'TestApp:Db:Password' ... SecretIdentifier:'https://localhost:7040/secrets/Db--Password'
com Register(client)    Db:Password = pw-1  (o cofre falso viu GET /secrets/Db--Password vindo do provider)
```

Uma referência sem configuração derruba o start. A rotação é a armadilha. Depois de gravar `pw-2-rotated` no cofre e passar um tick de refresh, o valor continuou `pw-1`. Depois de alterar a sentinela com `refreshAll`, os key-values recarregaram e o valor CONTINUOU `pw-1`: o dublê não viu pedido de segredo. O key-value da referência em si não tinha mudado, então o segredo resolvido foi mantido. Só `SetSecretRefreshInterval` lê de novo:

```text
kv.SetSecretRefreshInterval(TimeSpan.FromSeconds(5))  -> ArgumentOutOfRangeException: The secret refresh interval cannot be less than 60000 milliseconds.
kv.SetSecretRefreshInterval(TimeSpan.FromMinutes(1)), rotacionado em t=0, TryRefreshAsync a cada 2,1 s:  visto como pw-3-rotated após 61 s
```

O segredo só foi buscado de novo depois do minuto, durante uma chamada de refresh (a documentação diz que a chamada de refresh também é necessária). Então uma referência a Key Vault sem `SetSecretRefreshInterval` é uma leitura só no startup, o mesmo risco acima. O mínimo é um minuto "to prevent excessive secret reloads which may induce Key Vault throttling".

### Feature flags vindas do store (medido)

`o.UseFeatureFlags(f => f.SetRefreshInterval(...))` carrega as chaves sob `.appconfig.featureflag/` (pedido `key=.appconfig.featureflag%2F*`), e as flags fazem refresh no próprio intervalo, sem `ConfigureRefresh` ("Different from key-values, feature flags are automatically registered for refresh", documentação; padrão 30 s). `AddFeatureManagement()` mais `IFeatureManager` e `.WithFeatureGate("Beta")` num endpoint de minimal API, ou `[FeatureGate]` no MVC, são a mesma API da [lição de feature flags](/dotnet-concepts/feature-flags-with-microsoft-featuremanagement) (4.8.0): a biblioteca lê as flags de `IConfiguration`, o store é só mais uma fonte. Na execução acima a flag virou na mesma fronteira de requisição que a mensagem: `/beta` foi de 404 para 200 e `/flag` de `False` para `True`. Telemetria, variantes e targeting são só documentação aqui.

### Permissões: RBAC contra access policies (só documentação, com datas)

Papéis de data plane para aplicações (rbac-guide, 2026-06-16; quickstart do App Configuration, atualizado em 2026-06-30):

| Necessidade | Papel | Escopo |
|---|---|---|
| Ler valores de segredo (`SecretClient`, provider, referências a Key Vault) | `Key Vault Secrets User` | o cofre |
| Criar e rotacionar segredos num job | `Key Vault Secrets Officer` | o cofre |
| Ler key-values e feature flags | `App Configuration Data Reader` | o store |
| Gerenciar o recurso do cofre, não os dados | `Key Vault Contributor` (só control plane) | grupo de recursos ou cofre |

Um detalhe da mesma página: quem tem `Contributor` no control plane pode se dar acesso ao data plane por uma access policy, então restrinja quem o tem. O modelo: access policies são a lista de permissões por principal, mais antiga e no nível do cofre; o Azure RBAC é o recomendado. A `API version 2026-02-01 and later` torna o RBAC o padrão só para cofres NOVOS (access-control-default, 2026-09-16): cofres existentes mantêm o modelo, e os dois modelos continuam suportados. Trocar um cofre para RBAC invalida as access policies dele, então atribua os papéis primeiro. À parte, "All Key Vault control plane API versions before 2026-02-01 retire on February 27, 2027" (mesma página), o que diz respeito a templates e versões da CLI (Azure CLI 2.90.0 ou superior), não ao seu código com `SecretClient`.

### Cache, throttling e limites (só documentação)

Key Vault (service-limits, 2026-11-17): 4.000 transações por 10 segundos por cofre por região para as operações de segredo "all other" e 300 para criação de segredo, com um limite por assinatura de cinco vezes isso, e `429` acima. A página de throttling manda respeitar backoff exponencial, guardar em memória, evitar retry imediato e usar um cofre por domínio de segurança ou disponibilidade. O exemplo dela configura `SecretClientOptions.Retry` (`Delay` 2 s, `MaxDelay` 16 s, `MaxRetries` 5, `Mode = Exponential`), e o tutorial do Key Vault usa o mesmo bloco. App Configuration (FAQ, 2026-08-28) limita por tier: Free 1.000 requisições por dia, Developer 6.000 por hora, Standard 30.000 por hora, Premium sem cota de requisições, com limites de vazão em requisições por segundo e `429` mais o header `retry-after-ms`. A estimativa dele para 50 instâncias consultando uma sentinela a cada 30 s é 6.000 requisições por hora, a maioria sem mudança e sem contar na cota Standard. Os providers "have built-in retry and caching": use-os em vez de um cliente escrito à mão.

### Segredos em desenvolvimento e no Kubernetes

Não ponha segredo no `appsettings.json`: o arquivo vai para o git (veja a [escada de user-secrets](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) medida na outra lição). Os próprios quickstarts guardam em user-secrets só o ENDPOINT do store (`dotnet user-secrets set Endpoints:AppConfiguration "<endpoint>"`) e autenticam com uma identidade, então nada secreto é necessário para chegar aos segredos. No Kubernetes a aplicação lê os mesmos stores com workload identity (veja a [lição de workload identity](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe)); outro caminho é o Secrets Store CSI driver, que monta objetos do cofre como arquivos no pod (não executado aqui, citado na outra lição), e o lado Kubernetes dos Secrets está em [Kubernetes Secrets Fundamentals](/kubernetes-concepts/kubernetes-secrets-fundamentals) e [Secrets as Environment Variables vs Mounted Files](/kubernetes-concepts/secrets-as-env-vars-vs-mounted-files). Com arquivo montado ou variável de ambiente você perde o reload dentro do processo, a menos que a aplicação observe o arquivo.

### Livro vs hoje

- `Microsoft.Azure.KeyVault` (3.0.x, última publicação em 2020-02-03) é o cliente antigo, com um callback de token que, nos exemplos da época, usava ADAL (`Microsoft.IdentityModel.Clients.ActiveDirectory`; de memória, não reconferido em documentação aqui). O NuGet o marca como deprecated (motivo "Legacy", mensagem "obsolete as of 3/31/2023 and is no longer maintained or monitored") com `Azure.Security.KeyVault.Secrets`, `.Keys` e `.Certificates` como substitutos. O pacote ADAL também está deprecated em favor de `Microsoft.Identity.Client` (conferido no registro do NuGet, 2026-11-20). Hoje: `SecretClient` mais um `TokenCredential` do `Azure.Identity`.
- `Microsoft.Extensions.Configuration.AzureKeyVault` 3.1.x (última publicação em 2022-04-11) está deprecated em favor de `Azure.Extensions.AspNetCore.Configuration.Secrets` (a extensão `AddAzureKeyVault` usada aqui).
- Material antigo monta o cliente do cofre em `ConfigureAppConfiguration` do `Program.Main` e configura access policies por principal. Hoje: `builder.Configuration`, uma managed identity e o Azure RBAC como modelo padrão de cofres novos (API 2026-02-01).
- O quickstart do App Configuration ainda instala `Microsoft.Azure.AppConfiguration.AspNetCore`, enquanto a referência do provider instala `Microsoft.Extensions.Configuration.AzureAppConfiguration`: o primeiro acrescenta o middleware sobre o segundo, os dois em 8.6.1 aqui.

## Trade-offs

- **O provider é um retrato, a menos que você o recarregue.** `AddAzureKeyVault` sem `ReloadInterval` e uma referência a Key Vault sem `SetSecretRefreshInterval` leem uma vez. Uma rotação quebra a aplicação depois, não na hora da rotação.
  ```csharp
  builder.Configuration.AddAzureKeyVault(uri, credential, new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromMinutes(5) });
  ```
- **Uma sentinela é consistente e frágil.** Um pedido pequeno e um reload atômico, mas uma mudança sem alterar a sentinela fica invisível. `RegisterAll` não tem essa armadilha e custa um pedido condicional para a página toda.
- **O refresh do middleware chega uma requisição atrasado.** A requisição que inicia o refresh vê o valor antigo. Serve para configuração, surpreende num teste que muda uma flag e confere na hora.
- **`optional: true` troca uma queda por um padrão silencioso.** A aplicação sobe sem o store e toda chave some. Prefira falhar, a menos que cada configuração tenha um padrão seguro.
- **Papéis por segredo não isolam equipes.** Use um cofre por aplicação e ambiente com papéis no escopo do cofre; prefixos num cofre compartilhado são nomenclatura, não segurança.
- **Dois stores, dois conjuntos de permissão.** Um key-value do App Configuration com referência a Key Vault exige que a aplicação tenha `App Configuration Data Reader` e `Key Vault Secrets User`; faltando um, falha no startup (a referência) ou depois (o papel).
- **Um dublê prova o comportamento do cliente, não o serviço.** Os textos de 403 e 404, o atraso real do RBAC e o formato real do 429 são só documentação aqui: teste permissões numa assinatura real.

## Documentation Links

- [Quickstart: Azure App Configuration with ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/quickstart-aspnet-core-app) (doc)
- [.NET configuration provider reference, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/reference-dotnet-provider) (doc)
- [Azure App Configuration FAQ, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/faq) (doc)
- [Tutorial: use Azure Key Vault with an Azure web app in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/tutorial-net-create-vault-azure-web-app) (doc)
- [Azure Key Vault configuration provider, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/key-vault-configuration) (doc)
- [Grant permission to applications to access a key vault using Azure RBAC, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) (doc)
- [Plan for Azure RBAC as the default access control model in Key Vault, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/access-control-default) (doc)
- [Azure Key Vault service limits, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/service-limits) (doc)
- [Azure Key Vault throttling guidance, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/overview-throttling) (doc)
- [Azure Key Vault secret client library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/security.keyvault.secrets-readme) (doc)
- [Feature management overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-overview) (doc)
- [Use Key Vault references in an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-key-vault-references-dotnet-core) (doc)
- [Migration guide from Microsoft.Azure.KeyVault, Azure SDK for .NET](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/keyvault/Azure.Security.KeyVault.Secrets/MigrationGuide.md) (doc)
