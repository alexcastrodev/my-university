---
version: 1.0
updatedAt: 2026-10-28
title: "Data Protection: key ring e purposes"
summary: O sistema de Data Protection do ASP.NET Core: IDataProtector, Protect e Unprotect, o formato do payload, purposes e isolamento, payloads com prazo de validade, o key ring em disco com datas e rotação de chaves, SetApplicationName, EF Core e certificado, e o experimento com duas instâncias de cookie auth com rings separados, compartilhado e após um redeploy.
---
## Objective

Todo app ASP.NET Core já usa Data Protection, mesmo que ninguém no time tenha ouvido falar dele: o cookie de autenticação, o token de antiforgery, o TempData e os cookies de `state`/nonce do OIDC são todos criptografados e assinados com chaves de um key ring que o framework cria sozinho. No notebook isso simplesmente funciona. Em produção, com duas réplicas ou com um container substituído a cada deploy, o ring não é compartilhado e os usuários são deslogados aleatoriamente ou todos de uma vez, sem nada em nível de warning nos logs. Este conceito roda a API de consumo (`IDataProtectionProvider`, `CreateProtector`, `Protect`/`Unprotect`, purposes, payloads com prazo), lê o key ring em disco e suas opções, força uma rotação de chave e depois roda o experimento principal: duas instâncias reais com cookie auth em duas portas, com rings separados e com um ring compartilhado, mais um redeploy simulado. Versões usadas: SDK 10.0.100 (runtime do ASP.NET Core 10.0.0 para o app web), `Microsoft.AspNetCore.DataProtection.Extensions` 10.0.14, `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` 10.0.14, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14.

## Use Cases

- Rodar duas ou mais réplicas atrás de um load balancer sem o usuário alternar entre "logado" e "401" conforme a réplica que responde.
- Manter os usuários logados entre deploys de um app em container cujo filesystem é descartado a cada vez.
- Fazer estado do servidor passar pelo cliente (um link de reset, uma URL de "voltar para", um passo de wizard) com detecção de adulteração e prazo de validade, sem inventar criptografia própria.
- Permitir que dois apps diferentes (o site principal e um site de admin) leiam o mesmo cookie de propósito, ou garantir que não consigam.

## Deep Dive

### Onde o key ring fica por padrão

Subi um app web mínimo com a categoria de log `Microsoft.AspNetCore.DataProtection` em `Information` (o `"Microsoft.AspNetCore": "Warning"` do template esconde essas linhas). No macOS, com `HOME` apontando para uma pasta de rascunho para não tocar no meu ring real:

```text
info: Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager[62]
      User profile is available. Using '/.../a8/home/.aspnet/DataProtection-Keys' as key repository; keys will not be encrypted at rest.
warn: Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager[35]
      No XML encryptor configured. Key {b68cd791-f722-4e74-94b9-cca381e367f9} may be persisted to storage in unencrypted form.
```

No Linux e no macOS a pasta é `$HOME/.aspnet/DataProtection-Keys` (ou `$LOCALAPPDATA/ASP.NET/DataProtection-Keys` quando essa variável existe); a documentação lista `%LOCALAPPDATA%\ASP.NET\DataProtection-Keys` com criptografia DPAPI no Windows, o registro no IIS e `%HOME%\ASP.NET\DataProtection-Keys` no Azure App Service (compartilhado por todas as instâncias de um deployment slot, mas não entre slots). Remover a variável `HOME` não mudou nada: o .NET ainda encontrou o diretório do meu perfil. Para chegar ao último fallback, apontei `LOCALAPPDATA` para uma pasta que não pode ser criada:

```text
warn: Microsoft.AspNetCore.DataProtection.Repositories.EphemeralXmlRepository[50]
      Using an in-memory repository. Keys will not be persisted to storage.
warn: Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager[59]
      Neither user profile nor HKLM registry available. Using an ephemeral key repository. Protected data will be unavailable when application exits.
```

Dentro de um container o perfil normalmente existe (o home do `root` ou do usuário do app na imagem), então aparece a primeira mensagem, não esta, e as chaves vão parar na camada gravável do container. Parece persistente e não é: o próximo deploy sobe um container novo com a pasta vazia. A documentação diz que no Docker as chaves precisam ir para um volume que sobreviva ao container ou para um provider externo. Repare também no momento: no .NET 10 o key ring foi carregado na inicialização (`Key ring with default key {...} was loaded during application startup.`), não na primeira requisição.

### IDataProtector: Protect, Unprotect e o formato da saída

Usei a API direto de um app console com um repositório em arquivo:

```csharp
services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dir))
    .SetApplicationName("lab");

var p = sp.GetRequiredService<IDataProtectionProvider>().CreateProtector("Orders.v1");
var t = p.Protect("order=42;user=alice");
var raw = Base64Url.DecodeFromChars(t);
Console.WriteLine($"magic={Convert.ToHexString(raw, 0, 4)} keyId={new Guid(raw.AsSpan(4, 16))}");
```

```text
protected (155 chars): CfDJ8BOS2G9bgk5CgBe0FAUpNBqIiVPt3iBkcvmAh-eRD4tdy4YQ6wGVbbiLhpktSYBClUZSWp5PIp9sKs1Ni0N08D2ksspoxTtponMqBH_6Vbcpvsshv3KWsaM2ZFBUBu1eNV3TWrSwZq37CfcruHxmxPE
bytes=116 magic=09F0C9F0 keyId=6fd89213-825b-424e-8017-b4140529341a
twice same? False
unprotect: order=42;user=alice
key files: key-6fd89213-825b-424e-8017-b4140529341a.xml
```

O overload de string devolve base64url. O payload começa com um cabeçalho mágico de 4 bytes (`09F0C9F0`, e é por isso que todo valor protegido, inclusive cookies de autenticação, começa com `CfDJ8`), depois os 16 bytes do id da chave que o protegeu, depois os dados criptografados e autenticados. Uma entrada de 19 caracteres virou 116 bytes, e proteger o mesmo texto duas vezes gerou duas saídas diferentes. Como o id da chave viaja em claro, quem não tem aquela chave sabe exatamente o que está faltando (veja a próxima seção). A documentação informa os padrões: AES-256-CBC para confidencialidade e HMACSHA256 para autenticidade, com subchaves derivadas por payload a partir de uma master key de 512 bits.

### Purposes isolam os consumidores

`CreateProtector(purpose)` deriva uma subchave diferente por cadeia de purposes a partir da mesma master key. Tentei ler o payload de `Orders.v1` de outras formas:

```csharp
prov.CreateProtector("Invoices.v1").Unprotect(t);
prov.CreateProtector("a", "b").Unprotect(prov.CreateProtector("a").CreateProtector("b").Protect("x"));
prov.CreateProtector("b", "a").Unprotect(prov.CreateProtector("a", "b").Protect("x"));
```

```text
purpose Invoices.v1:    CryptographicException: The payload was invalid. For more information go to https://aka.ms/aspnet/dataprotectionwarning
chain a->b vs (a,b):    OK 'x'
chain (a,b) vs (b,a):   CryptographicException: The payload was invalid. ...
purpose case Orders.V1: CryptographicException: The payload was invalid. ...
tampered last byte:     CryptographicException: The payload was invalid. ...
unknown key id:         CryptographicException: The key {6fd89313-825b-424e-8017-b4140529341a} was not found in the key ring. ...
```

`CreateProtector("a").CreateProtector("b")` é o mesmo que `CreateProtector("a", "b")`; ordem e maiúsculas importam (a documentação diz comparação ordinal). Purpose errado e payload adulterado dão a mesma mensagem, então um atacante não aprende nada. A mensagem de "key not found" é a que você vai ver em produção quando os rings não são compartilhados. A documentação sugere purposes com namespace e tipo mais uma versão (`Contoso.Security.BearerToken.v1`) e avisa para nunca deixar a entrada do usuário ser a cadeia inteira: use `CreateProtector("Contoso.Messaging.SecureMessage", $"User: {username}")` em vez de `CreateProtector(username)`.

### Payloads com prazo de validade

`ToTimeLimitedDataProtector()` (pacote `Microsoft.AspNetCore.DataProtection.Extensions`, já incluído no shared framework) embute uma expiração:

```csharp
var p = provider.CreateProtector("ResetPassword.v1").ToTimeLimitedDataProtector();
var t = p.Protect("user=alice", TimeSpan.FromSeconds(2));
p.Unprotect(t, out var expires);
Thread.Sleep(2500);
p.Unprotect(t);
```

```text
unprotect: user=alice expires=2026-10-28T15:37:55.6932190+00:00
after 2.5 s: CryptographicException: The payload expired at 10/28/2026 3:37:55 PM +00:00.
plain protector on time-limited payload: CryptographicException: The payload was invalid. ...
```

A expiração é conferida contra o relógio do servidor, e um protector comum com o mesmo purpose não consegue ler o payload: o wrapper com prazo acrescenta um purpose próprio. A documentação desaconselha essas APIs para "payloads which require long-term or indefinite persistence" e sugere a regra prática: "Can I afford for the protected payloads to be permanently unrecoverable after a month?" (dá para aceitar que os payloads fiquem irrecuperáveis para sempre depois de um mês?).

### O arquivo da chave, suas datas e as opções

O arquivo de chave que o `PersistKeysToFileSystem` gravou:

```text
<key id="6fd89213-825b-424e-8017-b4140529341a" version="1">
  <creationDate>2026-10-28T15:37:48.59539Z</creationDate>
  <activationDate>2026-10-28T15:37:48.59539Z</activationDate>
  <expirationDate>2027-01-26T15:37:48.59539Z</expirationDate>
  <descriptor ...>
    <descriptor>
      <encryption algorithm="AES_256_CBC" />
      <validation algorithm="HMACSHA256" />
      <masterKey p4:requiresEncryption="true" ...>
        <!-- Warning: the key below is in an unencrypted form. -->
        <value>6gkqAxUwt2+UqdAEQ1Vf9JWj4oRu...</value>
```

A master key fica em base64 puro: quem consegue ler essa pasta consegue forjar seus cookies de autenticação. Li as opções de volta e testei os limites de lifetime:

```text
NewKeyLifetime=90.00:00:00 AutoGenerateKeys=True XmlEncryptor=null XmlRepository=FileSystemXmlRepository
ApplicationDiscriminator=lab
SetDefaultKeyLifetime(6 days): ArgumentOutOfRangeException: The new key lifetime must be at least one week. ... (Parameter 'value')
SetDefaultKeyLifetime(7 days): key expiration=2026-11-04T15:37:56Z
```

Com `DisableAutomaticKeyGeneration()` num ring vazio, o `Protect` falhou: o log disse `The key ring does not contain a valid default protection key. The data protection system cannot create a new key because auto-generation of keys is disabled.` e quem chamou recebeu `CryptographicException: An error occurred while trying to encrypt the provided data.` Segundo a documentação, essa opção é para secundários somente leitura ao lado de um primário que gerencia as chaves.

### Rotação de chaves e o atraso de ativação

A primeira chave de um ring vazio é ativada na hora (criação, ativação e expiração acima: agora, agora, agora + 90 dias). O Data Protection lê `DateTime.UtcNow` diretamente (um `TimeProvider` registrado no DI foi ignorado), então para ver uma rotação eu populei rings com `IKeyManager.CreateNewKey(activation, expiration)` e subi um provider novo:

```text
--- seeded one key that expires in 1 day:
Protect used the OLD key 7a51f05d-4772-4020-9d56-d8d66fa5aaab
  key-140c71c1-... created=2026-10-28T15:38:18Z activation=2026-10-29T15:38:17Z expiration=2027-01-26T15:38:18Z
  key-7a51f05d-... created=2026-07-31T15:38:17Z activation=2026-07-31T15:38:17Z expiration=2026-10-29T15:38:17Z
--- seeded one key that expired yesterday:
Protect used the NEW key 9a6e0fc7-e7ea-4962-ba42-5fea726addc5
  key-9a6e0fc7-... created=2026-10-28T15:38:18Z activation=2026-10-28T15:38:18Z expiration=2027-01-26T15:38:18Z
```

Bate com a documentação: quando a chave padrão expira em menos de 2 dias, uma chave nova é gravada com `activationDate` igual à expiração da antiga, para que todas as instâncias tenham tempo de lê-la antes de alguém usá-la; se todas as chaves já expiraram, a nova é ativada na hora. As chaves antigas continuam no ring e seguem decifrando payloads antigos. A documentação diz que as instâncias releem o ring mais ou menos a cada 24 horas, e que apagar o arquivo de uma chave torna tudo o que ela protegeu ilegível para sempre.

### SetApplicationName: o mesmo ring não basta

Três providers numa mesma pasta compartilhada:

```text
same ring, app 'shop' -> 'shop':  OK 'hi'
same ring, app 'shop' -> 'admin': CryptographicException: The payload was invalid. ...
key files in shared dir: 1
```

O nome da aplicação entra em toda cadeia de purposes. Num host ASP.NET Core o padrão é o caminho do content root, então duas cópias publicadas em caminhos diferentes não compartilham payloads a menos que você defina o mesmo nome; dois apps diferentes num mesmo ring continuam isolados enquanto os nomes forem diferentes. A documentação acrescenta que comprometer um app num repositório compartilhado é comprometer todos.

### O experimento principal: duas instâncias, um cookie

Um app com cookie auth e antiforgery, iniciado duas vezes a partir do mesmo build nas portas 5664 e 5665, com uma pasta compartilhada opcional:

```csharp
if (Environment.GetEnvironmentVariable("KEYS_DIR") is { } dir)
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dir)).SetApplicationName("shop");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(...);
app.MapGet("/login", ...);                              // SignInAsync como alice
app.MapGet("/me", ...).RequireAuthorization();
app.MapGet("/form", (IAntiforgery af, HttpContext c) => af.GetAndStoreTokens(c).RequestToken!);
app.MapPost("/form", ...);                              // af.ValidateRequestAsync
```

Fiz login em A e repeti o mesmo cookie jar contra B:

```text
### (a) separate rings (ringA, ringB)
A /login: signed in on localhost:5664
A /me:    200 alice on localhost:5664
B /me:    401
B POST /form with A's antiforgery token: "The antiforgery token could not be decrypted." 400
### (b) shared ring
B /me:    alice on localhost:5665 200
B POST /form with A's antiforgery token: "antiforgery valid on localhost:5665" 200
### restart both on the same shared ring
A /me after restart: alice on localhost:5664 200
B /me after restart: alice on localhost:5665 200
### redeploy: new container, fresh ring dir
A /me after redeploy: 401
```

O caso (a) é o que um load balancer sem sticky sessions produz: uma requisição sim, outra não vira 401, e um post de formulário sim, outro não vira 400. Com um provider em memória (ephemeral), nem dois providers no mesmo processo conseguiram ler um ao outro. O caso (b) resolveu os dois, e os restarts mantiveram os usuários logados. A linha do redeploy é o bug "todo deploy desloga todo mundo". A pior parte é o log: B escreveu `Cookies was not authenticated. Failure message: Unprotect ticket failed` em `Information`, que o template padrão filtra, então em produção não aparece nada.

Duas instâncias subindo no mesmo instante com a pasta compartilhada vazia gravaram uma chave cada (2 arquivos), mas as duas escolheram depois a mesma chave padrão e leram os payloads uma da outra, então essa corrida é inofensiva.

### Armazenando e protegendo o ring

- **Filesystem num volume**: `PersistKeysToFileSystem` num volume compartilhado ou montado. A documentação avisa que, quando você escolhe o local, as chaves deixam de ser criptografadas em repouso automaticamente.
- **EF Core**: `PersistKeysToDbContext<KeysDb>()` com um contexto que implementa `IDataProtectionKeyContext`. Com SQLite obtive uma linha por chave: `row Id=1 FriendlyName=key-97b31eed-ba02-46c4-9256-12b8b2c9d1e1 XmlLength=884`, o mesmo XML do arquivo.
- **Certificado**: `ProtectKeysWithCertificate(cert)` com um certificado autoassinado criado no próprio processo trocou o `<masterKey>` por um `<encryptedSecret>` (XML Encryption, `aes256-cbc`) e eliminou o warning "No XML encryptor". Depois abri a mesma pasta numa instância sem o certificado: 11 linhas `fail` com `Unable to retrieve the decryption key.`, a chave foi marcada como inelegível, a instância gravou uma chave nova sem criptografia na pasta compartilhada e o `Unprotect` lançou `CryptographicException: Unable to retrieve the decryption key.` Toda instância precisa do certificado, e uma mal configurada polui o ring.
- **Não rodado aqui (só documentação)**: DPAPI (`ProtectKeysWithDpapi`, Windows), Azure Blob Storage (`Azure.Extensions.AspNetCore.DataProtection.Blobs`) com `ProtectKeysWithAzureKeyVault`, e Redis (`Microsoft.AspNetCore.DataProtection.StackExchangeRedis`). A documentação diz que só Redis com persistência de dados deve guardar chaves.

### Não é um cofre para segredos de longa duração

A visão geral diz que as APIs "aren't primarily intended for indefinite persistence of confidential payloads" (não foram feitas principalmente para persistência indefinida de payloads confidenciais) e aponta DPAPI ou Azure Rights Management para isso, embora admita que elas "can be used" para esse fim. Chaves expiram (continuam decifrando, mas só enquanto forem mantidas), podem ser revogadas (aí ficam ilegíveis por padrão) e podem se perder junto com uma pasta. Proteja cookies, tokens e estado de vida curta; para dados em repouso, criptografe com uma chave que você gerencia explicitamente.

## Trade-offs

- **Zero configuração é um padrão de máquina única.** Serve para desenvolvimento e está errado para qualquer scale-out ou deploy em container; configure um repositório compartilhado e um nome de aplicação desde o primeiro dia.
  ```csharp
  builder.Services.AddDataProtection()
      .PersistKeysToFileSystem(new DirectoryInfo("/keys"))   // um volume montado
      .SetApplicationName("shop");
  ```
- **Um ring compartilhado é um segredo compartilhado.** Quem lê a pasta ou a tabela consegue forjar cookies para todos os apps dela; restrinja o acesso à identidade do app e criptografe em repouso.
- **Criptografia em repouso adiciona uma dependência operacional.** Toda instância precisa do certificado ou do acesso ao Key Vault, inclusive certificados antigos enquanto existirem chaves antigas (`UnprotectKeysWithAnyCertificate`).
- **As falhas são silenciosas por padrão.** Uma chave faltando vira um 401 ou um 400 com log em `Information`; suba `Microsoft.AspNetCore.Authentication` e `Microsoft.AspNetCore.DataProtection` para `Information` em produção ou monitore picos de 401 depois de deploys.
- **Purposes são isolamento barato, não controle de acesso.** Use um purpose fixo e versionado por funcionalidade e nunca um purpose montado só com entrada do usuário.
- **Payloads com prazo não são revogação de token.** Até a expiração passar, um payload vazado funciona; para links de uso único, mantenha também estado no servidor.

## Documentation Links

- [ASP.NET Core Data Protection overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction?view=aspnetcore-10.0) (doc)
- [Configure ASP.NET Core Data Protection, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0) (doc)
- [Data Protection key management and lifetime in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/default-settings?view=aspnetcore-10.0) (doc)
- [Key storage providers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-storage-providers?view=aspnetcore-10.0) (doc)
- [Purpose strings in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/purpose-strings?view=aspnetcore-10.0) (doc)
- [Limit the lifetime of protected payloads in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/limited-lifetime-payloads?view=aspnetcore-10.0) (doc)
