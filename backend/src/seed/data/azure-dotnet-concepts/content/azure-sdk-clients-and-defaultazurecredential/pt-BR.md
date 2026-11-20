---
version: 1.0
updatedAt: 2026-11-20
title: "Clientes do Azure SDK e DefaultAzureCredential"
summary: O padrão de cliente das bibliotecas Azure.* (endpoint, TokenCredential, ClientOptions, Response<T>, Pageable, RequestFailedException e a política de retry com os valores padrão) medido contra um serviço HTTPS falso, e o DefaultAzureCredential offline no Azure.Identity 1.21.0 (a ordem real da cadeia, a mensagem agregada, o tempo de falha, AZURE_TOKEN_CREDENTIALS, o EnvironmentCredential que vence em silêncio), mais AddAzureClients, o log do AzureEventSourceListener e os pacotes Microsoft.Azure.* legados.
---
## Objective

Toda biblioteca `Azure.*` para .NET (Blobs, Service Bus, Key Vault, App Configuration, Cosmos) segue o mesmo desenho: um cliente construído a partir de um endpoint, de um `TokenCredential` e de uma subclasse de `ClientOptions`, um pipeline HTTP com política de retry e política de bearer token, `Response<T>` para resultados únicos, `Pageable<T>` para listas e `RequestFailedException` para erros. Aprendeu a forma uma vez, todo serviço fica familiar. A outra metade é a identidade: `DefaultAzureCredential` é a linha única que funciona no notebook e no Azure, e também a linha que a documentação da Microsoft manda tirar antes da produção. Esta lição mede as duas coisas. Aqui não existe tenant do Azure, então escrevi em C# um pequeno serviço HTTPS falso e uma autoridade Entra falsa, montei um cliente no formato do próprio SDK contra eles e rodei o `Azure.Identity` 1.21.0 de verdade, offline, para ver a ordem real da cadeia, as mensagens reais e o custo real de falhar. Tudo que exige um tenant real (token real, identidade gerenciada, login de desenvolvedor, nuvens soberanas) está marcado como docs only. A mecânica de OAuth e de identidade gerenciada mora em outras lições; esta é o lado do SDK.
Versões (NuGet, resolvidas em 2026-11-20): `Azure.Identity` 1.21.0 (MSAL 4.92.0 por dentro), `Azure.Core` 1.65.0, `Microsoft.Extensions.Azure` 1.14.1, `Azure.Storage.Blobs` 12.30.1 (só para registrar um cliente), `Microsoft.Extensions.Hosting` 10.0.15, TFM `net10.0`, SDK 10.0.100, um Apple M4 Max com macOS 27.2 (os tempos são dele).

## Use Cases

- Escrever um serviço que fala com o Azure sem connection string nem chave na configuração.
- Ler uma `CredentialUnavailableException` que lista nove credenciais e saber qual delas você precisava.
- Registrar clientes Azure com `AddAzureClients`, com retry por cliente e clientes nomeados.
- Decidir quando `DefaultAzureCredential` serve (desenvolvimento) e o que o substitui em produção.
- Depurar uma chamada ao Azure pelo log do fio (request id, retries, `Authorization` ocultado).

## Deep Dive

### A forma de um cliente do Azure SDK (medido contra um serviço falso)

As diretrizes de design do Azure SDK fixam o padrão e o `Azure.Core` entrega as peças: `ClientOptions` (retry, transporte, diagnóstico), `HttpPipelineBuilder` (monta o pipeline), `BearerTokenAuthenticationPolicy` (pede o token à credencial), `Response<T>`, `Page<T>` e `AsyncPageable<T>`. Um cliente reduzido, meu, na mesma forma das bibliotecas reais:

```csharp
public class WidgetClientOptions : ClientOptions { public enum ServiceVersion { V2026_01 = 1 } /* ... */ }
public class WidgetClient
{
    readonly HttpPipeline _pipeline; readonly Uri _endpoint;
    protected WidgetClient() { }                                   // para mock, como mandam as diretrizes
    public WidgetClient(Uri endpoint, TokenCredential credential, WidgetClientOptions? options = null)
    {
        options ??= new(); _endpoint = endpoint;
        _pipeline = HttpPipelineBuilder.Build(options, new BearerTokenAuthenticationPolicy(credential, "https://widgets.example/.default"));
    }
    public virtual async Task<Response<Widget>> GetWidgetAsync(string id, CancellationToken ct = default) { /* envia, depois */
        if (msg.Response.IsError) throw new RequestFailedException(msg.Response);
        return Response.FromValue(widget, msg.Response); }
    public virtual AsyncPageable<Widget> GetWidgetsAsync(CancellationToken ct = default) => new WidgetPager(this, ct);
}
```

As bibliotecas reais passam também por `ClientDiagnostics`, que é `internal` no `Azure.Core` (meu primeiro build falhou com CS0122 nele), então o exemplo o dispensa. O serviço falso (Kestrel, porta 6990, certificado autoassinado que o transporte do laboratório aceita, só laboratório) registra cada requisição. Uma execução do cliente:

```text
  [fake] GetTokenAsync #1 scopes=[https://widgets.example/.default] tenant=null claims=null
Value=Widget { Id = 1, Name = widget-1 }  status=200  x-ms-request-id present=True
token calls after 3 requests: 1
widget-1 widget-2 widget-3 widget-4 widget-5
page of 2, continuation=?skip=2     page of 2, continuation=?skip=4     page of 1, continuation=null
http endpoint: InvalidOperationException: Bearer token authentication is not permitted for non TLS protected (https) endpoints.
```

O que isso mostra. A política pediu o token à credencial uma única vez para três requisições: o pipeline guarda o token até perto da expiração (a margem exata de renovação não foi medida), então a credencial não é chamada a cada requisição. `Response<T>` carrega o valor e `GetRawResponse()` (status, cabeçalhos, o `x-ms-request-id` do serviço). `await foreach` sobre um `AsyncPageable<T>` achata as páginas; `.AsPages()` as expõe com um `ContinuationToken`, para parar e retomar. A política de bearer recusa HTTP puro antes de enviar qualquer coisa. Um erro vira `RequestFailedException`, a mensagem completa de um 404 do serviço falso:

```text
No widget with id 404.
Status: 404 (Not Found)
ErrorCode: WidgetNotFound
Content: {"error":{"code":"WidgetNotFound","message":"No widget with id 404."}}
Headers: Date, Server, Transfer-Encoding, x-ms-request-id: 83ad0cd1-..., Content-Type
```

`Status` e `ErrorCode` são propriedades, e o `x-ms-request-id` é o valor para citar ao suporte do Azure. Capture por `Status` ou `ErrorCode`, nunca pelo texto da mensagem. Os clientes são thread-safe e feitos para viver como singletons (as diretrizes dizem isso; aqui só uma thread foi exercitada).

### Retry: a política que você recebe sem pedir

Padrões de `ClientOptions.Retry`, lidos do objeto de opções: `Mode=Exponential`, `MaxRetries=3`, `Delay=0,8 s`, `MaxDelay=1 min`, `NetworkTimeout=100 s`. Contra o serviço falso (o log mostra todas as tentativas reutilizando um único `x-ms-client-request-id`):

```text
400 (bad request)                         1 requisição, sem retry, 0,1 s
503, 503, depois 200, padrões             3 requisições em +0, +0,85, +2,5 s: OK em 2,6 s
429 com Retry-After: 2, padrões           esperou 2,0 s e deu OK (o cabeçalho vence o backoff)
503 para sempre, padrões                  4 requisições em +0, +0,7, +2,4, +5,1 s, depois RequestFailedException aos 5,1 s
503 para sempre, MaxRetries=1 Fixed 100ms 2 requisições, 0,1 s
503 para sempre, MaxRetries=0             1 requisição
lento 6 s, NetworkTimeout=1 s, 1 retry   AggregateException "Retry failed after 2 tries ..." aos 2,1 s, interna TaskCanceledException
```

Erros 4xx não são repetidos; 5xx, 429 (respeitando `Retry-After`) e timeouts são. O atraso exponencial tem jitter, então os intervalos variam entre execuções. Quando os retries acabam num código de status, vem `RequestFailedException`; quando acabam numa falha de rede ou timeout, vem uma `AggregateException` que embrulha cada tentativa. Se você empilhar o seu próprio retry (a [lição de resiliência](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers)) por cima deste, as tentativas se multiplicam: 4 x 4 aqui. Escolha uma camada, e para clientes Azure geralmente é esta.

### TokenCredential, escopos e o pedido de token

Um `TokenCredential` tem um trabalho só: `GetTokenAsync(TokenRequestContext)` devolve um `AccessToken` (a string e o `ExpiresOn`). O contexto leva `Scopes`, `TenantId` opcional e `Claims` (para desafios de continuous access evaluation). O escopo nomeia a audiência, o recurso mais `/.default`: Key Vault é `https://vault.azure.net/.default` (o que a cadeia abaixo pediu), Storage é `https://storage.azure.com/.default`. A biblioteca cliente escolhe o escopo; seu código escolhe a credencial. Tudo que consegue responder, de um client secret a uma identidade gerenciada ou a um `az login`, é uma subclasse, então um teste pode passar uma credencial escrita à mão (a minha contava as chamadas, como na execução acima). A [lição de Key Vault](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) mede as credenciais de identidade gerenciada e de workload identity, incluindo o cache de token por credencial; a [lição de OAuth](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles) explica o pedido `client_credentials` que um service principal acaba fazendo.

### DefaultAzureCredential: a cadeia real, offline

`DefaultAzureCredential` é um `ChainedTokenCredential` pré-configurado: tenta cada credencial em ordem e vence a primeira que devolve token. Uma `CredentialUnavailableException` de um elo quer dizer "não configurado, tente o próximo"; uma `AuthenticationFailedException` quer dizer "eu estava configurado e falhei", e isso para a cadeia (medido abaixo). A tabela da documentação (conferida em 2026-11-20) e o que a 1.21.0 fez numa máquina sem nada configurado (`az`, `pwsh` e `azd` fora do `PATH`, sem Visual Studio, para não alcançar nenhum tenant real):

```text
CredentialUnavailableException in 1116 ms
DefaultAzureCredential failed to retrieve a token from the included credentials. See the troubleshooting guide ...
- EnvironmentCredential authentication unavailable. Environment variables are not fully configured. ...
- WorkloadIdentityCredential authentication unavailable. The workload options are not fully configured. ...
- ManagedIdentityCredential authentication unavailable. No response received from the managed identity endpoint.
- VisualStudioCredential authentication failed: Visual Studio Token provider can't be accessed at ~/.IdentityService/AzureServiceAuth/tokenprovider.json
- VisualStudioCodeCredential requires the Azure.Identity.Broker package to be referenced from the project. ...
- AzureCliCredential authentication failed: Azure CLI not installed
- AzurePowerShellCredential authentication failed: PowerShell is not installed.
- AzureDeveloperCliCredential authentication failed: Azure Developer CLI could not be found.
- The BrokerCredential requires the Azure.Identity.Broker package to be referenced. ...
```

Essa é a cadeia padrão na 1.21.0, em ordem: Environment, Workload Identity, Managed Identity, Visual Studio, Visual Studio Code, Azure CLI, Azure PowerShell, Azure Developer CLI, Broker. A nona da tabela da documentação, `InteractiveBrowserCredential`, vem desligada (`ExcludeInteractiveBrowserCredential` era `True`). Os elos do Visual Studio Code e do Broker estão na cadeia, mas pedem o pacote separado `Azure.Identity.Broker`. A exceção é uma mensagem agregada que lista cada elo e por que ele foi pulado, então leia de baixo para cima quando "funciona no meu notebook". Tempo até falhar em cinco processos novos: 1116, 1118, 104, 121 e 124 ms; os dois lentos foram o primeiro processo depois de uma pausa, então o custo não é constante (a lição de Key Vault mediu 2,3 s na execução dela). Conte com cerca de um segundo, não com um milissegundo. No Azure o terceiro elo responde, então esse custo é sobretudo de desenvolvimento e de configuração errada.

`AZURE_TOKEN_CREDENTIALS` estreita a cadeia (a documentação diz que nomes de credencial isolados exigem Azure.Identity 1.15.0 ou superior; a 1.21.0 aceitou todos estes):

```text
prod                          Environment, WorkloadIdentity, ManagedIdentity                              51 ms
dev                           VisualStudio, VisualStudioCode, AzureCli, AzurePowerShell, AzureDeveloperCli, Broker   90 ms
visualstudiocredential        só essa                                                                    21 ms
azureclicredential            só essa                                                                    43 ms
bogus                         InvalidOperationException: Invalid value for environment variable AZURE_TOKEN_CREDENTIALS: bogus.
                              Valid values are 'dev', 'prod', 'visualstudiocredential', 'visualstudiocodecredential', 'azureclicredential', ...
```

`prod` mantém as três credenciais de serviço implantado, `dev` as de ferramentas de desenvolvedor, um nome de credencial mantém só aquela, e um valor inválido falha alto na construção. Por credencial, `new DefaultAzureCredentialOptions { ExcludeAzureCliCredential = true }` (e os outros `ExcludeXxxCredential`) tira elos em código; excluir Environment, Workload Identity, Managed Identity, Visual Studio, PowerShell e Developer CLI deixou Azure CLI, VS Code e Broker, falhando em 45 ms.

### EnvironmentCredential, e a credencial que vence em silêncio

O primeiro elo lê `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e um entre `AZURE_CLIENT_SECRET`, um caminho de certificado (`AZURE_CLIENT_CERTIFICATE_PATH`) ou usuário e senha (docs). Apontei `DefaultAzureCredentialOptions.AuthorityHost` para a autoridade falsa (ela conhece `app-A` com o segredo falso `s3cr3t-demo`) e rodei a cadeia mudando só as variáveis:

```text
só tenant + client id                EnvironmentCredential indisponível, a cadeia seguiu (as nove tentadas), CredentialUnavailableException
tenant + id + segredo CERTO          OK em 162 ms, expiresIn=60min, a autoridade viu grant_type=client_credentials client_id=app-A
tenant + id + segredo ERRADO         AuthenticationFailedException em 143 ms: "ClientSecretCredential authentication failed:"
                                     interna MsalServiceException ... See https://aka.ms/msal-net-invalid-client   (o log lista só EnvironmentCredential)
```

Quando as três variáveis existem, o `EnvironmentCredential` é dono do pedido: se ele falha, nada mais é tentado, mesmo num host com uma identidade gerenciada perfeitamente boa. Esse é o risco que a página de boas práticas descreve: a cadeia usa o primeiro elo que responde, e quem define variáveis para a máquina inteira não é decisão da aplicação. O exemplo da própria página é uma VM em que a identidade gerenciada começa a falhar e a cadeia cai em silêncio no `az login` de um desenvolvedor, ampliando ou reduzindo privilégios sem mudança de código. A credencial que você quis não é a que você recebeu, e nada avisa, a menos que você registre em log.

### Por que a produção deve nomear a credencial

A documentação (conferida em 2026-11-20) pede um `TokenCredential` específico em produção, por duas razões que as medidas sustentam: qual elo serviu o token não é garantido (acima), e elos que falham somam latência (acima; a página de credential chains lista "performance overhead" explicitamente). Escolha por ambiente, uma vez, na raiz de composição:

```csharp
TokenCredential credential = builder.Environment.IsDevelopment()
    ? new ChainedTokenCredential(new AzureCliCredential(), new VisualStudioCredential())
    : new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(builder.Configuration["Azure:ClientId"]!));
// no Kubernetes com federação: new WorkloadIdentityCredential()
```

O meio-termo barato é `AZURE_TOKEN_CREDENTIALS=prod`, ou a sobrecarga `new DefaultAzureCredential(string, options)` que torna a variável obrigatória (docs). As credenciais de desenvolvedor são docs only aqui: `AzureCliCredential` executa o `az` e lê o login dele (medi só a mensagem "not installed"), `VisualStudioCredential` lê a conta que o Visual Studio mantém, `AzureDeveloperCliCredential` faz o mesmo com o `azd`, e `InteractiveBrowserCredential` abre o navegador do sistema e precisa de um registro de aplicativo. Todas usam a sua identidade, então as permissões que um serviço tem em produção não são as que você testou: dê ao desenvolvedor o mesmo papel da workload para achar cedo uma atribuição de papel faltando.

### Registrando clientes com AddAzureClients

`Microsoft.Extensions.Azure` (1.14.1) liga os clientes à injeção de dependência. `AddClient` é a forma genérica; cada pacote de serviço acrescenta a sua (`AddBlobServiceClient`, `AddSecretClient`). Medido com o meu cliente e dois registros de `BlobServiceClient` (os de Blob nunca são chamados):

```csharp
services.AddAzureClients(b =>
{
    b.UseCredential(cred);                                          // uma credencial para todos os clientes
    b.ConfigureDefaults(o => o.Retry.MaxRetries = 5);               // ou ConfigureDefaults(configuration.GetSection("AzureDefaults"))
    b.AddClient<WidgetClient, WidgetClientOptions>((o, c, sp) => new WidgetClient(url, c, o));
    b.AddClient<WidgetClient, WidgetClientOptions>((o, c, sp) => new WidgetClient(url, c, o)).WithName("eu").ConfigureOptions(o => o.Retry.MaxRetries = 1);
    b.AddClient<WidgetClient, WidgetClientOptions>(...).WithName("cfg").ConfigureOptions(config.GetSection("Azure:Widgets")); // Retry:MaxRetries=7, Mode=Fixed
    b.AddBlobServiceClient(new Uri("https://acct.blob.core.windows.net")).WithName("hot");
});
```

```text
WidgetClient sem nome injetado, mesma instância na segunda resolução: True; IAzureClientFactory.CreateClient("eu") em cache: True
as três fábricas receberam a mesma credencial passada em UseCredential: True
503 para sempre, tempo até falhar:  default 27,9 s (5 retries do ConfigureDefaults)   eu 0,9 s (1 retry)   cfg 5,4 s (7 retries, Fixed 0,8 s, vindos da configuração)
BlobServiceClient sem nome quando só existem os nomeados: InvalidOperationException: Unable to find client registration with type 'BlobServiceClient' and name 'Default'.
```

O registro sem nome é injetado direto (um singleton); os nomeados vêm de `IAzureClientFactory<T>.CreateClient(name)`. `ConfigureDefaults` vale para todos os clientes e um `ConfigureOptions` por cliente sobrescreve; as opções podem vir de uma seção de configuração, então o ajuste de retry vira configuração de deploy. Credenciais: sem `UseCredential` e sem `WithCredential`, medi um `DefaultAzureCredential` por registro, cada um uma instância diferente (ou seja, cada um roda a própria cadeia e mantém o próprio cache de token); `WithCredential(new ManagedIdentityCredential(...))` o substituiu só naquele cliente. A documentação diz que o padrão é `DefaultAzureCredential`, então um `AddAzureClients` simples ainda leva a cadeia para a produção: passe `UseCredential` com a credencial da seção anterior.

### Depurando com AzureEventSourceListener

`AzureEventSourceListener` (Azure.Core) liga as fontes de eventos do SDK: `Azure-Core` para o pipeline, `Azure-Identity` para as credenciais. Um cliente contra a rota instável, `EventLevel.Verbose`, linhas aparadas:

```text
[Informational] Request: Request [69cc7b19-...] GET https://localhost:6990/widgets/flaky/k9 | Accept:application/json | x-ms-client-request-id:69cc7b19-... | User-Agent:azsdk-net-sdk/1.0.0 (.NET 10.0.0; macOS 27.2.1) | Authorization:REDACTED | client assembly: sdk
[Warning]       ErrorResponse: Error response [69cc7b19-...] 503 Service Unavailable (00.0s) | ... | x-ms-request-id:836be86f-... |
[Informational] RequestRetrying: Request [69cc7b19-...] attempt number 1 took 00.1s
[Warning]       ErrorResponse: ... 503 ...     [Informational] RequestRetrying: ... attempt number 2 took 00.0s
[Informational] Response: Response [69cc7b19-...] 200 OK (00.0s) | ...
```

`Authorization` vem ocultado e o User-Agent leva o nome do assembly e o SO. Para credenciais, o mesmo listener em `Azure-Identity` imprime `DefaultAzureCredential.GetToken invoked. Scopes: [ https://vault.azure.net/.default ]`, depois `EnvironmentCredential.GetToken invoked`, depois as linhas do MSAL (`Instance Discovery` ignorado quando desligado): é assim que você descobre qual elo venceu. Nunca deixe o log de conteúdo (`Diagnostics.IsLoggingContentEnabled`) ligado em produção, e use `AzureEventSourceListener.CreateConsoleLogger()` só em desenvolvimento. O listener é um `EventListener` comum, então os mesmos eventos podem alimentar o OpenTelemetry (veja a [lição de OpenTelemetry](/dotnet-concepts/opentelemetry-logs-metrics-and-traces)).

### Authority hosts e nuvens soberanas (constantes medidas, o resto docs only)

As credenciais obtêm tokens de `TokenCredentialOptions.AuthorityHost`, cujo padrão é `https://login.microsoftonline.com/`. `AzureAuthorityHosts` guarda as constantes: Public `login.microsoftonline.com`, China `login.chinacloudapi.cn`, Government `login.microsoftonline.us` (lidas do tipo). Um cliente para uma nuvem nacional precisa do authority host na credencial e, nas bibliotecas de plano de dados, de um `Audience` nas opções do cliente (docs only: não há tenant assim aqui). Minha autoridade falsa foi alcançada do mesmo jeito, por `AuthorityHost` e `DisableInstanceDiscovery = true` (senão a descoberta de instância chama um host da Microsoft, que uma autoridade que não é da Microsoft não responde).

### Book vs today

Livros e posts antigos usam a primeira geração das bibliotecas Azure: `WindowsAzure.Storage`, `Microsoft.Azure.Storage.Blob`, `Microsoft.Azure.KeyVault`, `Microsoft.Azure.ServiceBus`, cada uma com retry próprio, paginação própria baseada em `Task` e autenticação própria, e `Microsoft.Azure.Services.AppAuthentication` (`AzureServiceTokenProvider`, connection string `RunAs=App`) para tokens. Medido no registro do NuGet (2026-11-20): os cinco estão marcados como obsoletos ("Legacy"), com `Azure.Storage.Common`, `Azure.Storage.Blobs`, `Azure.Security.KeyVault.Certificates`, `Azure.Messaging.ServiceBus` e `Azure.Identity` indicados como substitutos. A biblioteca de login mais antiga, a ADAL (`Microsoft.IdentityModel.Clients.ActiveDirectory`), teve todo o suporte e as correções de segurança encerrados em 2023-06-30 segundo o Microsoft Learn; o MSAL a substituiu, e o `Azure.Identity` usa o MSAL por dentro (o 4.92.0 acima). Regra prática: pacote `Azure.*` mais `Azure.Identity` é o atual; `Microsoft.Azure.*` para acesso a dados e trechos com ADAL são legados.

## Trade-offs

- **`DefaultAzureCredential` é conveniente e não determinístico.** Uma linha para notebook e nuvem, mas uma variável ou um CLI logado no host muda quem você é. Use em desenvolvimento; em produção nomeie a credencial ou ao menos defina `AZURE_TOKEN_CREDENTIALS=prod`.
- **Elos que falham custam tempo.** Cerca de 0,1 a 1,1 s aqui para uma cadeia sem nada disponível, e cada instância de `DefaultAzureCredential` roda a própria cadeia. Sem `UseCredential`, cada registro ganhou a sua instância (medido), então compartilhe uma.
- **O retry embutido se multiplica com o seu.** Os padrões dão até 4 tentativas, 0,8 s de atraso-base e 100 s de timeout de rede. Uma segunda camada de retry dá 16, então ajuste `ClientOptions.Retry` e mantenha uma camada só.
  ```csharp
  b.ConfigureDefaults(o => { o.Retry.MaxRetries = 2; o.Retry.NetworkTimeout = TimeSpan.FromSeconds(10); });
  ```
- **Um serviço falso prova o cliente, não as permissões.** A autoridade falsa aceitou qualquer escopo e meu serviço ignorou o conteúdo do token, então RBAC (403 `AuthorizationFailed`), consentimento e acesso condicional não foram testados aqui: docs only.
- **Clientes nomeados multiplicam credenciais.** Cada registro sem `UseCredential` montou uma cadeia e um cache de token separados, então dez clientes são dez de cada. Passe uma credencial só.
- **Logar o fio expõe dados.** Os cabeçalhos saem ocultados por padrão, os corpos não saem se você ligar o log de conteúdo; reserve isso para uma sessão local de depuração.

## Documentation Links

- [Authenticate .NET apps to Azure services, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/) (doc)
- [Credential chains in the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/credential-chains) (doc)
- [Authentication best practices with the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/best-practices) (doc)
- [Dependency injection with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/dependency-injection) (doc)
- [Logging with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/logging) (doc)
- [Azure Identity client library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/identity-readme) (doc)
- [Microsoft.Extensions.Azure client library, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/microsoft.extensions.azure-readme) (doc)
- [DefaultAzureCredentialOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.defaultazurecredentialoptions) (doc)
- [RetryOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.core.retryoptions) (doc)
- [RequestFailedException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.requestfailedexception) (doc)
- [AzureAuthorityHosts class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.azureauthorityhosts) (doc)
- [Azure SDK design guidelines for .NET, Azure SDK](https://azure.github.io/azure-sdk/dotnet_introduction.html) (doc)
- [Azure Identity troubleshooting guide, GitHub](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/identity/Azure.Identity/TROUBLESHOOTING.md) (doc)
- [Migrate applications to MSAL (ADAL retirement), Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/msal-migration) (doc)
