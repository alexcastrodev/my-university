---
version: 1.0
updatedAt: 2026-11-12
title: "OWASP no ASP.NET Core: Security Headers e CSP"
summary: O mapa do OWASP Top 10:2025 para o ASP.NET Core (o que o framework já faz e o que é com você), os security headers (CSP com nonce, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors), middleware próprio contra o pacote NetEscapades, CSP com Blazor e scripts inline, mass assignment com DTO e user-secrets em desenvolvimento, tudo rodado no .NET 10.
---
## Objective

Uma revisão de segurança de um app ASP.NET Core costuma chegar como uma lista: "mapeie para o OWASP Top 10, mostre os headers de resposta, diga onde ficam os segredos". Outros concepts desta track cobrem mecanismos isolados (HTTPS e HSTS, CSRF, CORS, Data Protection). Este é o passe de endurecimento que amarra tudo: o que o framework já faz para cada categoria do OWASP e o que continua com você, os headers para o navegador (Content-Security-Policy com nonce por requisição, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`), se vale escrever esse middleware ou usar um pacote, como a CSP encontra o Blazor e scripts inline, mass assignment com DTO e onde o desenvolvedor guarda um segredo que não pode chegar ao git.

Tudo abaixo foi rodado no .NET 10 (SDK 10.0.100), que é o LTS. O lab usa `WebApplicationFactory` e lê os headers como strings, então não há navegador. Onde uma afirmação depende do comportamento do navegador, eu digo.

## Use Cases

- Responder a um achado de pentest ou auditoria que diz "sem CSP, sem `nosniff`, clickjacking possível".
- Escolher entre um middleware de 30 linhas e um pacote de security headers para uma API nova ou um site Razor/Blazor.
- Adicionar uma CSP a uma página com scripts inline sem recorrer a `'unsafe-inline'`.
- Revisar um endpoint que faz bind de uma entidade direto do corpo da requisição.
- Orientar um time que guarda chaves de API no `appsettings.json`.

## Deep Dive

### O Top 10 como mapa: o que o framework faz, o que é seu

A lista atual é o OWASP Top 10:2025. As categorias, em ordem: A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions. Em relação à lista de 2021, supply chain e exceptional conditions são entradas novas. Um mapa curto para o ASP.NET Core, com os concepts que aprofundam:

| Categoria | O framework dá | Continua com você |
|---|---|---|
| A01 Controle de acesso | Políticas de autorização, `RequireAuthorization`, fallback policy | Checar que este usuário é dono desta linha (IDOR), não esquecer um endpoint |
| A02 Misconfiguração | Defaults seguros, helpers de HSTS e redirecionamento HTTPS | Headers, origens de CORS, páginas de erro de dev desligadas em produção, segredos fora dos arquivos de config |
| A03 Supply chain | O NuGet Audit avisa no restore | Ler esses avisos, lock files, pinning, revisão de pacote novo |
| A04 Criptografia | Data Protection, `PasswordHasher<T>` | Nunca inventar a sua, guarda das chaves (veja `data-protection-key-ring-and-purposes`) |
| A05 Injection | O Razor codifica a saída; EF Core e `FromSql` interpolado parametrizam | SQL montado com string em `FromSqlRaw`, `Html.Raw`, `MarkupString` com dado do usuário |
| A06 Design inseguro | Middleware de rate limiting | Modelagem de ameaças, casos de abuso, limites em endpoints caros |
| A07 Autenticação | Lockout e hash do Identity, validação de JWT | Lockout sensato, MFA, tokens de vida curta |
| A08 Integridade | Payloads assinados do Data Protection, sem `BinaryFormatter` | Verificar assinatura de webhook, não confiar em estado do cliente |
| A09 Logging | `ILogger`, HTTP logging que redige headers por padrão | Não logar segredos ou tokens, alertar sobre o que se loga |
| A10 Condições excepcionais | Exception handler e `ProblemDetails` | Falhar fechado, sem stack trace para o cliente, sem exceção engolida em código de autenticação |

Duas linhas dessa tabela eu verifiquei rodando. O NuGet Audit vem ligado por padrão: restaurar um projeto que referencia `System.Text.Encodings.Web` 4.5.0 imprimiu `warn : NU1904: Package 'System.Text.Encodings.Web' 4.5.0 has a known critical severity vulnerability` com o link do advisory, e `dotnet list package --vulnerable` listou o mesmo pacote com severidade `Critical`. Um aviso que ninguém lê não defende nada, então muitos times transformam esse aviso em erro (`<WarningsAsErrors>NU1904</WarningsAsErrors>`). A linha de injection é coberta por `input-validation-in-minimal-apis` e pelos concepts de EF Core.

O resto deste concept é o canto de A02 e A05 menos coberto em outros lugares: o que se diz ao navegador sobre as suas páginas.

### Os headers, um a um

Cada um é um header de resposta, e cada um limita algo específico que o navegador permitiria:

- `X-Content-Type-Options: nosniff` impede o navegador de adivinhar que uma resposta servida como `text/plain` é na verdade um script. Protege principalmente contra arquivos enviados por usuários.
- `Referrer-Policy: strict-origin-when-cross-origin` envia só a origem (sem caminho e query) para outros sites, e nada ao ir de HTTPS para HTTP. Caminhos costumam carregar ids ou tokens.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` desliga recursos do navegador que o site nunca usa, inclusive para qualquer script de terceiro que entre.
- `Content-Security-Policy` é a lista do que uma página pode carregar e executar. É a defesa mais forte contra XSS depois da codificação de saída.
- Dentro da CSP, `frame-ancestors 'none'` diz que ninguém pode embutir a página num frame, o substituto moderno de `X-Frame-Options` contra clickjacking. Ele não pode ser definido por uma tag `<meta>`, só por header.

HSTS é o outro header clássico e tem concept próprio (`https-hsts-and-secure-defaults`), então não se repete aqui.

### Uma CSP com nonce

Uma política com `script-src 'self'` já bloqueia todo script inline, injetado ou não. Uma página real costuma ter um script inline legítimo (config de bootstrap, um stub de analytics). Liberá-lo com `'unsafe-inline'` desliga a proteção inteira: o `<script>` injetado por um atacante também é inline. O nonce resolve. O servidor gera um valor aleatório por resposta, coloca no header (`'nonce-...'`) e em cada tag de script em que confia (`<script nonce="...">`). O navegador executa só os scripts inline cujo nonce bate, e um atacante que injeta marcação não conhece o valor.

O middleware do lab é a coisa toda:

```csharp
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public const string NonceKey = "csp-nonce";

    public Task InvokeAsync(HttpContext context)
    {
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        context.Items[NonceKey] = nonce;

        context.Response.OnStarting(() =>
        {
            var h = context.Response.Headers;
            h.XContentTypeOptions = "nosniff";
            h["Referrer-Policy"] = "strict-origin-when-cross-origin";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            h.ContentSecurityPolicy =
                $"default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none'; " +
                "base-uri 'self'; frame-ancestors 'none'";
            return Task.CompletedTask;
        });

        return next(context);
    }
}
```

Dois detalhes importam. O nonce tem 16 bytes aleatórios por requisição: um nonce fixo é uma entrada estática de allowlist que o atacante pode copiar. E os headers são definidos dentro de `OnStarting`, que roda logo antes de a resposta começar, então eles também aparecem em respostas escritas por middleware posterior, como um 404 ou uma página de erro. O resultado dos testes do lab, rodados contra a solução:

```text
Passed!  - Failed: 0, Passed: 8, Skipped: 0, Total: 8 - SecurityHeadersLab.Tests.dll (net10.0)
```

As asserções por trás: `nosniff`, `Referrer-Policy` e `Permissions-Policy` estão presentes em `/`, `/api/ping` e numa rota desconhecida (404); a CSP contém `frame-ancestors 'none'` e `object-src 'none'` e não contém `unsafe-inline`; duas requisições a `/` produzem dois nonces diferentes de 16 bytes cada; e o nonce do header é igual ao do `<script nonce="...">` no corpo. A versão starter do mesmo lab, com os TODOs em branco, falha 7 desses 8 testes.

O que isso não prova: um teste compara strings, não roda um navegador. Na primeira vez que você adicionar uma política, abra a página e leia o console, porque a violação de CSP aparece ali e em nenhum lugar do servidor.

### Middleware ou pacote

O pacote que conferi é o NetEscapades.AspNetCore.SecurityHeaders, versão 1.3.1 (publicada em dezembro de 2025, licença MIT, compilado para `netcoreapp3.1` e usado aqui no .NET 10). O builder dele substitui a string escrita à mão:

```csharp
app.UseSecurityHeaders(policy => policy
    .AddDefaultSecurityHeaders()
    .AddPermissionsPolicyWithDefaultSecureDirectives()
    .AddContentSecurityPolicy(b =>
    {
        b.AddDefaultSrc().Self();
        b.AddScriptSrc().Self().WithNonce();
        b.AddObjectSrc().None();
        b.AddBaseUri().Self();
        b.AddFrameAncestors().None();
    }));

app.MapGet("/", (HttpContext c) => $"nonce={c.GetNonce()}");
```

Rodando e lendo a resposta, saiu uma política tipada e um nonce novo a cada requisição (`GetNonce()` devolveu um valor diferente em cada chamada):

```text
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: script-src 'self' 'nonce-pmnd+VoI+8i6ZtC02wQ4xtI6aDAZQ6WUTp+Vzq7vzXY='; default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Resource-Policy: same-site
Permissions-Policy: accelerometer=(), autoplay=(), camera=(), ...
```

Olhe o que o `AddDefaultSecurityHeaders()` acrescentou e o lab não: `X-Frame-Options` e três headers cross-origin. `Cross-Origin-Embedder-Policy: credentialless` pode quebrar páginas que embutem imagens ou iframes de terceiros, então um default de pacote é uma decisão tomada por você. O header `Server: Kestrel` continuou presente: removê-lo é outra escolha (`AddServerHeader = false` nas opções do Kestrel, vindo da documentação, não rodado aqui).

Como escolher:

- Escreva o middleware quando precisar de cinco headers fixos e um nonce. São menos de 30 linhas, sem dependência, e cada linha é sua para ler numa auditoria.
- Use o pacote quando a política crescer (muitas diretivas, políticas por endpoint, modo report-only, `Report-To`), porque o builder tipado erra menos que strings concatenadas.
- De qualquer forma, teste os headers. Uma atualização do pacote pode mudar um default, e um teste sobre a string final do header pega isso.

### CSP com Blazor e outros scripts inline

Blazor Web Apps encontram uma CSP estrita em três lugares. Rodei o template `blazor` do .NET 10 e li o HTML de `/counter`: ele contém um `<script type="importmap">` inline (renderizado pelo componente `ImportMap` em `App.razor`), um handler `onclick="..."` inline no menu de navegação, e scripts externos (`blazor.web.js` e um script de módulo). Sob `script-src 'self' 'nonce-...'` os externos carregam, e os outros dois ficam bloqueados até você tratá-los.

Para o import map, o componente `ImportMap` aceita um atributo `nonce`. Com o middleware acima colocando o nonce em `HttpContext.Items`, o `App.razor` lê e repassa:

```razor
<ImportMap nonce="@Nonce" />
@code {
    [CascadingParameter] private HttpContext? HttpContext { get; set; }
    private string? Nonce => HttpContext?.Items["csp-nonce"] as string;
}
```

A tag renderizada virou `<script type="importmap" nonce="KQSKi1XNmdzTQKntssZCgA==">` e o header trouxe o mesmo valor. O atributo `onclick` é diferente: o nonce vale para elementos `<script>`, não para atributos de event handler. A documentação da Microsoft dá duas saídas, uma fonte `'unsafe-hashes'` com o SHA-256 daquele handler, ou mover o handler para um arquivo JavaScript que a política permita. Prefira mover; hashes quebram no dia em que alguém edita o handler.

Outros fatos da documentação de CSP do Blazor (não rodados aqui): Blazor WebAssembly precisa de `'wasm-unsafe-eval'` em `script-src` (não o antigo `'unsafe-eval'`), o modo interativo Server precisa que `connect-src` permita o WebSocket (`ws:`/`wss:`), e atributos `style` inline precisam de `'unsafe-inline'` em `style-src`, a menos que o componente os evite. A documentação também registra que o .NET 11 faz o `Virtualize` parar de emitir estilos inline.

Mais uma coisa que observei: o template Blazor Web App já envia sozinho `Content-Security-Policy: frame-ancestors 'self'` e `X-Frame-Options: SAMEORIGIN`. Quando o meu middleware acrescentou a própria CSP, a resposta saiu com dois headers `Content-Security-Policy`. O navegador aplica todos, então o resultado é a interseção e o `frame-ancestors 'none'`, mais estrito, vence na prática. Funciona, mas é bom saber quando um teste faz `Single()` nesse header, como o lab faz no app dele. A opção documentada para definir isso pelo Blazor é `ContentSecurityFrameAncestorsPolicy` em `AddInteractiveServerRenderMode`.

Lance uma política nova primeiro com `Content-Security-Policy-Report-Only`, para que as violações sejam reportadas (a um endpoint `report-to`) sem quebrar usuários, e só depois troque o nome do header.

### Mass assignment e overposting

Mass assignment é um bug de binding: o cliente envia mais campos do que o formulário mostra, e o binder grava todos. Aqui a entidade tem `IsAdmin`, e o endpoint recebe a entidade:

```csharp
public class User { public int Id { get; set; } public string Name { get; set; } = ""; public bool IsAdmin { get; set; } }
public record CreateUserRequest(string Name);

app.MapPost("/users/unsafe", (User user) => Results.Ok(user));
app.MapPost("/users/safe", (CreateUserRequest request) =>
    Results.Ok(new User { Id = 1, Name = request.Name, IsAdmin = false }));
```

```text
POST /users/unsafe {"name":"mallory","isAdmin":true}   -> {"id":0,"name":"mallory","isAdmin":true}
POST /users/safe   {"name":"mallory","isAdmin":true}   -> {"id":1,"name":"mallory","isAdmin":false}
```

A correção é um tipo que só tem os campos que o cliente pode definir, com o servidor preenchendo o resto. O lab testa os dois: um deixa o buraco aberto de propósito para você ver a diferença. Note que o endpoint seguro ignora o campo extra em silêncio: a requisição é aceita com 200. Se você quer o contrário (um cliente que manda `isAdmin` provavelmente é um atacante ou um bug), o `System.Text.Json` pode rejeitar membros sem mapeamento. Num app de teste com as opções padrão, `POST /users` com o campo extra respondeu 200. Com `[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]` no DTO, respondeu 400. Definir `Disallow` em `ConfigureHttpJsonOptions` (`SerializerOptions.UnmappedMemberHandling`) fez o mesmo para todos os endpoints, o que também rejeita um cliente que está apenas uma versão à frente, então uma API pública que evolui costuma aplicar por DTO ou não aplicar.

A mesma regra vale para models e formulários do MVC, onde `[BindNever]` ou uma view model é o equivalente (lido na documentação, não rodado aqui), e para o EF Core: fazer bind de uma entidade vinda da requisição e chamar `Update` também sobrescreve colunas que o cliente nunca deveria tocar.

### Onde um segredo mora em desenvolvimento

Uma chave no `appsettings.json` acaba no git, em imagens e em screenshots. Para o desenvolvimento local, o .NET tem um armazenamento por usuário fora da pasta do projeto:

```text
$ dotnet user-secrets init
Set UserSecretsId to '015dd2e2-...' for MSBuild project '.../Sec2.csproj'.
$ dotnet user-secrets set "Stripe:ApiKey" "sk_test_123"
Successfully saved Stripe:ApiKey to the secret store.
$ dotnet user-secrets list
Stripe:ApiKey = sk_test_123
$ dotnet user-secrets remove "Stripe:ApiKey"
$ dotnet user-secrets list
No secrets configured for this application.
```

O `init` escreve um `UserSecretsId` no `.csproj`; os valores ficam num arquivo JSON no perfil do seu usuário (no macOS, `~/.microsoft/usersecrets/<id>/secrets.json`), fora do repositório. O host lê esse arquivo para o `IConfiguration` só no ambiente `Development`. Rodar o mesmo build imprimiu `Development: key=sk_test_123` e `Production: key=(null)`: a produção nunca vê os segredos de um desenvolvedor, que é o objetivo, e significa também que a produção precisa da própria fonte.

Conheça o limite: o arquivo é texto puro, protegido só pelas permissões de arquivo do seu usuário. A documentação afirma que user secrets é uma conveniência de desenvolvimento e não um cofre. Em produção, use variáveis de ambiente, um segredo montado ou um gerenciador de segredos como o Azure Key Vault. Como a configuração é em camadas, o código que lê `Stripe:ApiKey` não muda entre eles (veja `configuration-and-the-options-pattern`).

## Trade-offs

- **Nonce, hash ou `'unsafe-inline'`.** Um nonce exige que o HTML seja gerado por requisição, então não serve para páginas totalmente estáticas ou muito cacheadas (uma página em cache repete um nonce velho). Um hash serve para um script inline estático que nunca muda. `'unsafe-inline'` remove a proteção contra XSS. Prefira nenhum script inline, com o nonce para os poucos que não dá para evitar.
- **Uma CSP estrita custa manutenção.** Uma tag nova de analytics, uma fonte de CDN ou um vídeo embutido quebram até a política permitir. O modo report-only e um teste sobre a string do header fazem essa mudança ser revisável, em vez de um incidente de sexta à noite.
- **Headers são defesa em profundidade.** `nosniff` e uma CSP reduzem o que um XSS ou um upload consegue fazer. Eles não substituem codificação de saída, validação ou autorização, e uma CSP não impede SQL injection nem CSRF.
- **Defaults de pacote são decisões.** `AddDefaultSecurityHeaders()` é conveniente, e também definiu valores de COEP e COOP que você não escolheu. Leia a saída uma vez e decida cada header.
- **O DTO é a correção barata, `Disallow` é uma política.** Um DTO sem `IsAdmin` remove o buraco sem custo. Rejeitar membros desconhecidos pega sondagem, mas pode quebrar clientes tolerantes. Escolha por API.
- **Teste de header não é teste de navegador.** O lab prova que o servidor envia a política. Se a sua página funciona sob ela, confira no console do navegador, uma vez a cada mudança de política.

## Lab

Neste lab você recebe uma API pequena com uma página que tem um script inline e dois endpoints de usuário. Nenhum security header está definido e o endpoint seguro ainda faz bind da entidade. Você escreve o middleware, liga ele e corrige o binding. Os testes usam `WebApplicationFactory` e comparam strings de headers e nonces, então não é preciso navegador. O lab usa `net10.0`. Sem Docker.

**O cenário**

O `Program.cs` serve `/` (HTML com um script inline), `/api/ping`, `/users/unsafe` (deixado vulnerável de propósito, para mostrar o buraco) e `/users/safe`. `SecurityHeadersMiddleware` é uma casca vazia com a constante `NonceKey`.

**O que você vai fazer, passo a passo**

1. **Gerar o nonce (TODO-00).** 16 bytes aleatórios, Base64, novo a cada requisição, guardado em `HttpContext.Items`.
2. **Definir os headers estáticos (TODO-01).** `nosniff`, `Referrer-Policy`, `Permissions-Policy`, dentro de `Response.OnStarting`.
3. **Definir a CSP (TODO-02).** Com o nonce, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` e sem `unsafe-inline`.
4. **Ligar (TODO-03 e TODO-04).** Adicionar o middleware ao pipeline e colocar o nonce da requisição no script inline.
5. **Parar o overposting (TODO-05).** Fazer bind de `CreateUserRequest` em `/users/safe` e montar o `User` no servidor.

**Como saber que terminou**

`dotnet test` está verde. Você deve saber dizer por que a resposta 404 também leva os headers, por que duas requisições não podem compartilhar um nonce e por que o teste do endpoint inseguro continua passando depois de você corrigir o seguro.

## Documentation Links

- [OWASP Top 10:2025](https://top10.owasp.org/2025) (doc)
- [Enforce a Content Security Policy for ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/security/content-security-policy) (doc)
- [Content Security Policy (CSP), MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) (doc)
- [NetEscapades.AspNetCore.SecurityHeaders, NuGet](https://www.nuget.org/packages/NetEscapades.AspNetCore.SecurityHeaders) (doc)
- [Safe storage of app secrets in development in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (doc)
- [How to customize System.Text.Json: handle missing members, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/missing-members) (doc)
- [Mass Assignment Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html) (doc)
