---
version: 1.0
updatedAt: 2026-11-19
title: "SAML 2.0 Single Sign-On no ASP.NET Core"
summary: SAML 2.0 no ASP.NET Core medido contra um Keycloak real em Docker, com Sustainsys.Saml2.AspNetCore2 2.11.1 em net10.0. O estado das bibliotecas conferido em 2026-11-19 (Sustainsys, ITfoxtec, Duende), o AuthnRequest nos bindings Redirect e POST, a Response e a Assertion decodificadas, as metadatas, o mapeamento de atributos para claims e a sessão por cookie, e os ataques medidos: assinatura adulterada, asserção sem assinatura, XML Signature Wrapping (um verificador ingênuo é enganado, a biblioteca rejeita), chave de atacante, Audience, InResponseTo, janela de tempo com a tolerância de relógio de 5 minutos, replay (o cache é em memória e esquece no restart) e o Single Logout (o iniciado pelo SP funciona, o do IdP não derruba a sessão do app).
---
## Objective

Clientes corporativos e times de identidade ainda entregam um provedor de identidade SAML 2.0, e o ASP.NET Core não tem suporte a SAML. Esta lição adiciona single sign-on contra um IdP real (Keycloak em Docker) a um app ASP.NET Core com uma biblioteca de terceiros, e mede o que acontece no fio e quando alguém ataca: o AuthnRequest nos bindings HTTP-Redirect e HTTP-POST, a Response e a Assertion assinadas e decodificadas, assinatura, `Audience`, `InResponseTo`, `NotOnOrAfter` com a tolerância de relógio, replay, XML Signature Wrapping, uma asserção sem assinatura, o mapeamento de atributos para claims, a sessão por cookie depois do SSO, as metadatas do SP e do IdP e o Single Logout nos dois sentidos. O estado das bibliotecas (versões, licença, manutenção, suporte a net10) foi conferido em 2026-11-19 e está escrito abaixo, porque em SAML para .NET isso é metade da decisão. O protocolo em si está em [SAML 2.0: assertions, bindings and SSO flows](/identity-concepts/saml-2-assertions-bindings-and-sso-flows); esta lição é o lado do ASP.NET Core. Toda chave e todo certificado é descartável, feito para o teste.
Versions: `Sustainsys.Saml2.AspNetCore2` 2.11.1 (com `Sustainsys.Saml2` 2.11.1, `Microsoft.IdentityModel.Tokens.Saml` 5.7.0), `System.Security.Cryptography.Xml` 10.0.15 (só no harness de teste), `net10.0`, SDK 10.0.100 (macOS arm64, runtime 10.0.0), Keycloak `quay.io/keycloak/keycloak:26.8.2` (digest `sha256:c68e286cacd8...`, `start-dev`, um container).

## Use Cases

- Deixar os funcionários de uma empresa cliente entrarem com o IdP corporativo dela (Entra ID, ADFS, Okta, Keycloak, Shibboleth) quando esse IdP só oferece SAML.
- Integrar uma federação legada ou governamental que exige SAML 2.0 e asserções assinadas.
- Revisar uma integração SAML: o que a biblioteca valida por você, o que é opção e quais falhas são silenciosas.
- Decidir entre uma biblioteca SAML, um broker (Keycloak, IdentityServer) na frente do app, ou pedir ao cliente OpenID Connect.

## Deep Dive

### O que o ASP.NET Core traz, e o que não traz

O shared framework `Microsoft.AspNetCore.App` 10.0.0 no disco tem `Authentication.Abstractions`, `BearerToken`, `Cookies`, `Core` e `OAuth`, e nenhum assembly com `Saml` no nome (`Authentication` aparece em 6 dos assemblies, `Saml` em nenhum). Os pacotes que a Microsoft publica no NuGet (busca de 2026-11-19, linha 11.0.0) incluem `OpenIdConnect`, `WsFederation`, `Negotiate`, `Certificate`, `JwtBearer` e os provedores sociais, de novo sem SAML. O `WsFederation` fala o protocolo WS-Federation, que pode carregar tokens SAML, mas não é o protocolo SAML 2.0 (`AuthnRequest`, bindings, metadata) que um IdP corporativo oferece. A visão geral de autenticação do Microsoft Learn não menciona SAML. Portanto, um service provider (SP) SAML 2.0 no ASP.NET Core é sempre um pacote de terceiros ou um broker.

### As bibliotecas, conferidas em 2026-11-19

| | Sustainsys.Saml2 | ITfoxtec.Identity.Saml2 | Duende IdentityServer 8 |
|---|---|---|---|
| Última | 2.11.1 (NuGet 2026-11-16) | 4.22.3 (2026-11-19) | 8.0.0 (NuGet; previews 8.1) |
| Alvos | `net8.0` (pacote AspNetCore2) | `net10.0` e `net11.0` (adicionados na 4.22.0, 2026-11-12) | `net10.0` |
| Licença | MIT (2.x), LGPL (1.x) | BSD-3-Clause | comercial, SAML no add-on Standard e nas edições Advanced e Custom |
| Formato | `AuthenticationHandler` (`AddSaml2`), endpoints incluídos | toolkit: você escreve os endpoints e chama `Saml2AuthnRequest`, `Saml2PostBinding`, `Saml2AuthnResponse` | SAML IdP e SP dentro do IdentityServer (`AddSaml`, `AddSamlServiceProvider`) |
| Manutenção | 2.x só com correções de segurança e críticas, 3.x na `main` "ainda não pronta" (a v3 prevê camadas pagas para recursos avançados); último release de recurso 2.11.0 em 2025-03-02 | frequente: 4.22.0, 4.22.2 e 4.22.3 em 7 dias, as duas últimas com correções de segurança | ativo, docs atualizadas em 2026-11-16 |
| Advisories | 4 publicados em 2026-11-16, todos corrigidos na 2.11.1; CVE-2023-41890 (validação do issuer) corrigido na 2.9.2; CVE-2020-5261 (sem detecção de replay) corrigido na 2.5.0 | nenhum listado no GitHub | não conferido |

Fontes: a API de registro do NuGet e os `.nuspec`, os repositórios do GitHub (README, `SECURITY.md`, releases, security advisories) e a doc da Duende. Os quatro advisories de novembro do Sustainsys.Saml2 são `GHSA-h3wv-rf2m-mh72` (falta de encoding na saída HTML, alto), `GHSA-66qr-wxvc-jhg9` (negação de serviço por falta de validação de entrada, alto), `GHSA-hpv7-q3w8-5hf2` (validação insuficiente de LogoutRequest, baixo) e `GHSA-pfv2-f8g4-2w95` (validação incorreta da integridade do RelayState, baixo): qualquer versão abaixo da 2.11.1 é afetada, então fixe pelo menos essa. O SAML da Duende e o add-on da Rock Solid Knowledge `Rsk.Saml.DuendeIdentityServer` 12.1.0 são só doc aqui (não rodados): servem quando o IdentityServer já é o seu broker. A ComponentSpace também vende uma biblioteca SAML (apareceu na busca do NuGet, não avaliada). Entra ID e ADFS como IdP também são só doc; só o Keycloak foi executado.

Escolha para os experimentos: **Sustainsys.Saml2.AspNetCore2 2.11.1**. Ela é um `AuthenticationHandler`, então challenge, login por cookie e sign-out seguem o mesmo pipeline de qualquer outro scheme ([authentication and authorization fundamentals](authentication-and-authorization-fundamentals)), é MIT, e foi corrigida três dias antes desta conferência. O custo é real: modo só de segurança, alvo `net8.0` (roda no net10.0, medido abaixo) e uma árvore de dependências Microsoft.IdentityModel 5.7.0 que é antiga (`dotnet list package --vulnerable --include-transitive` não reportou nada, 2026-11-19). Se a biblioteca ficar parada preocupa você, a ITfoxtec é a alternativa ativa e exige mais código seu.

### O laboratório

Keycloak 26.8.2 (`KC_HOSTNAME=http://localhost:6901`, porta 6901) com o realm `lab`, um client SAML cujo clientId é o entity ID do SP, os usuários `alice` (role `app-user`) e `bob` (`app-user` e `app-admin`), a Response e a Assertion as duas assinadas, e o client exigindo AuthnRequest assinado (o certificado do SP está registrado no client). O SP é um app mínimo em `http://localhost:6900`, e o "navegador" é um `HttpClient` que segue redirects, preenche o formulário de login do Keycloak e faz POST do formulário que o Keycloak devolve, então toda mensagem pode ser capturada e alterada. O SP (as chaves do laboratório, como binding e tolerância de relógio, lidas de variáveis de ambiente, foram removidas):

```csharp
builder.Services.AddAuthentication(o =>
{
    o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;        // a sessão depois do SSO
    o.DefaultChallengeScheme = Saml2Defaults.Scheme;                             // o 401 vai para o IdP
    o.DefaultForbidScheme = CookieAuthenticationDefaults.AuthenticationScheme;   // veja o 500 abaixo
})
.AddCookie(o => { o.Cookie.Name = "app.session"; o.ExpireTimeSpan = TimeSpan.FromMinutes(20);
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; }; })
.AddSaml2(o =>
{
    o.SPOptions.EntityId = new EntityId("http://localhost:6900/Saml2");
    o.SPOptions.ServiceCertificates.Add(new ServiceCertificate
        { Certificate = X509CertificateLoader.LoadPkcs12FromFile("sp.pfx", "lab"), Use = CertificateUse.Signing });
    o.SPOptions.ReturnUrl = new Uri("http://localhost:6900/me");
    o.IdentityProviders.Add(new IdentityProvider(new EntityId("http://localhost:6901/realms/lab"), o.SPOptions)
    {
        MetadataLocation = "http://localhost:6901/realms/lab/protocol/saml/descriptor", LoadMetadata = true,
        Binding = Saml2BindingType.HttpRedirect,   // ou HttpPost
    });
});
app.MapGet("/me", (ClaimsPrincipal u) => u.Claims.Select(c => new { c.Type, c.Value })).RequireAuthorization();
app.MapGet("/logout", () => Results.SignOut(new() { RedirectUri = "/" }, [CookieAuthenticationDefaults.AuthenticationScheme, Saml2Defaults.Scheme]));
```

O handler serve `/Saml2` (metadata do SP), `/Saml2/Acs` (o assertion consumer service) e `/Saml2/Logout` sob `SPOptions.ModulePath`. O cookie de estado do próprio handler, `Saml2.<relay state>`, é `SameSite=None` e o ASP.NET Core registrou um aviso de que ele também precisa ser `Secure`: em `http://localhost` puro o laboratório ignora isso, em produção o SP tem que ser HTTPS, porque o IdP faz o POST a partir de outro site.

### SSO iniciado pelo SP no fio

`GET /me` sem sessão devolve 303 para o IdP. Com o binding Redirect, o AuthnRequest vai com deflate puro, base64 e URL-encode na query, e a assinatura em parâmetros extras (`SAMLRequest` com 348 caracteres, `RelayState`, `SigAlg`, `Signature` com 344). Decodificado:

```xml
<saml2p:AuthnRequest ID="id09c24b33e3f8478e850697fd5596c0ff" Version="2.0" IssueInstant="2026-11-19T16:19:30Z"
    Destination="http://localhost:6901/realms/lab/protocol/saml" AssertionConsumerServiceURL="http://localhost:6900/Saml2/Acs">
  <saml2:Issuer>http://localhost:6900/Saml2</saml2:Issuer>
</saml2p:AuthnRequest>
```

Com `Binding = HttpPost` a mesma requisição não leva deflate e a assinatura vai para dentro do XML: o SP responde 200 com um formulário de submit automático (`SAMLRequest` com 3360 caracteres, `RelayState`) e o XML traz um `<Signature>` envelopado com o certificado do SP em `KeyInfo`. Os dois bindings terminaram na mesma sessão. Depois do login o IdP devolve um formulário que o navegador faz POST para o ACS. A Response (assinaturas e certificados abreviados), como o Keycloak 26.8.2 emitiu:

```xml
<samlp:Response Destination="http://localhost:6900/Saml2/Acs" ID="ID_f0c44d26-..." InResponseTo="id75c94342842e40b6a5c4c11a1021b930" IssueInstant="2026-11-19T16:17:57.004Z">
  <saml:Issuer>http://localhost:6901/realms/lab</saml:Issuer>
  <dsig:Signature>...Reference URI="#ID_f0c44d26-..." (enveloped-signature, exc-c14n, rsa-sha256)...</dsig:Signature>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success" /></samlp:Status>
  <saml:Assertion ID="ID_dd663da0-..." IssueInstant="2026-11-19T16:17:57.001Z">
    <dsig:Signature>...Reference URI="#ID_dd663da0-..."...</dsig:Signature>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@lab.test</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="id75c94..." NotOnOrAfter="2026-11-19T16:22:55.001Z" Recipient="http://localhost:6900/Saml2/Acs" />
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-11-19T16:17:55.001Z" NotOnOrAfter="2026-11-19T16:18:55.001Z">
      <saml:AudienceRestriction><saml:Audience>http://localhost:6900/Saml2</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="..." SessionIndex="Nt_vQ0NA...::8dafb9ce-..." SessionNotOnOrAfter="2026-11-20T02:17:57.005Z">...</saml:AuthnStatement>
    <saml:AttributeStatement>... given_name, family_name, email, Role (x7) ...</saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

Tudo que o SP precisa conferir está nessa página: quem assinou (`Issuer` e a chave), para quem (`Audience`, `Recipient`, `Destination`), em resposta a quê (`InResponseTo`), quando (`NotBefore`, os dois `NotOnOrAfter`) e a identidade (`NameID`, atributos). Os padrões do Keycloak aqui: Conditions válidas por 60 s, `SubjectConfirmationData` por 5 minutos, `SessionNotOnOrAfter` de 10 horas. O ACS responde 303 para o `ReturnUrl`, grava `app.session` (o cookie do ASP.NET Core) e apaga o cookie de estado `Saml2.*`. Depois disso a Response SAML não é mais usada: a sessão é o cookie, de 20 minutos deslizantes pelas opções do cookie, independente da sessão do IdP.

### Atributos viram claims, e o cookie de sessão

`GET /me` como `alice` (abreviado aos tipos de claim): `nameidentifier` = `alice@lab.test` (o NameID), `authenticationmethod`, `authenticationinstant`, depois duas claims da biblioteca, `http://Sustainsys.se/Saml2/LogoutNameIdentifier` e `.../SessionIndex` (as duas necessárias para o logout), depois uma claim por atributo, cujo tipo é o `Name` SAML (`given_name`, `family_name`, `email`, `Role`). O mapeamento para o que o seu código usa é com você: o laboratório copia cada valor de `Role` que começa com `app-` para `ClaimTypes.Role` em `Notifications.AcsCommandResultCreated`, e `RequireRole("app-admin")` deu 403 em `/admin` para a alice e 200 para o bob.

Duas surpresas medidas. O mapper `role_list` do Keycloak mandou 7 valores de `Role` para a alice, não só `app-user`: `offline_access`, `uma_authorization`, `view-profile`, `default-roles-lab` e outros, então faça whitelist do que você mapeia em vez de confiar em todo atributo. E as claims mais os 7 papéis duplicados deixaram o cookie de sessão com 4017 + 177 bytes, dividido em `app.sessionC1` e `C2`; remover as claims `Role` cruas deu um cookie só, de 2407 bytes. A segunda: `/admin` como alice respondeu **500**, não 403, com `NotImplementedException` vindo de `Saml2Handler.ForbidAsync`, porque o Forbid scheme cai no challenge scheme por padrão. Com `DefaultForbidScheme` apontando para o cookie (como no código acima) resolveu. O cookie de estado `Saml2.*` e a sessão são protegidos pelo Data Protection, então o key ring precisa ser compartilhado entre as instâncias ([data protection key ring and purposes](data-protection-key-ring-and-purposes)).

### Metadata, nos dois sentidos

`GET /Saml2` é a metadata do SP, ela mesma assinada com o certificado de serviço: `EntityDescriptor` com `entityID`, um `KeyDescriptor use="signing"`, `SingleLogoutService` (só HTTP-Redirect) e `AssertionConsumerService` para HTTP-POST (índice 0, padrão) e HTTP-Artifact. Ela dizia `AuthnRequestsSigned="false"` e `WantAssertionsSigned="false"` enquanto as requisições eram de fato assinadas, porque o `AuthenticateRequestSigningBehavior` padrão é `IfIdpWantAuthnRequestsSigned`; configure `Always` e `WantAssertionsSigned` explicitamente se o time do IdP lê a metadata. A metadata do IdP (`/realms/lab/protocol/saml/descriptor`) tem `WantAuthnRequestsSigned="true"`, o certificado de assinatura, `SingleSignOnService` para POST, Redirect, SOAP e Artifact, `SingleLogoutService` para os mesmos quatro e quatro formatos de NameID. `LoadMetadata = true` faz a biblioteca buscá-la e confiar nas chaves de assinatura dela; essa é a âncora de confiança, então a URL da metadata tem que ser HTTPS em produção e a troca de chave dela precisa de tratamento (a rotação da chave do IdP não foi medida; depois de recriar o Keycloak com uma chave nova eu reiniciei o SP).

### O que a biblioteca rejeita (medido)

Cada linha é um login novo; depois a Response capturada é alterada e enviada por POST a `/Saml2/Acs` como o navegador faria. Resultados com a 2.11.1 em net10.0:

```text
0  Response intacta                                  ACCEPTED (303, cookie de sessão gravado, GET /me 200)
1  editar um valor de Role na asserção assinada      REJECTED InvalidSignatureException: Signature didn't verify. Have the contents been tampered with?
2  editar o NameID                                   REJECTED InvalidSignatureException (igual)
3  remover toda Signature                            REJECTED Saml2ResponseFailedValidationException: The SAML Response is not signed and contains unsigned Assertions.
4  remover só a assinatura da Response (controle)    ACCEPTED (a assinatura da própria asserção basta)
5  remover a assinatura da Response + editar a asserção  REJECTED InvalidSignatureException
6  XSW: asserção forjada primeiro, a assinada depois REJECTED ...is not signed and contains unsigned Assertions
7  XSW: original assinado movido para Extensions     REJECTED (igual)
8  XSW: original assinado dentro do Advice da forjada REJECTED (igual)
9  asserção forjada com o ID da original             REJECTED (igual)
10 asserção forjada assinada com a chave de um atacante REJECTED InvalidSignatureException: The signature verified correctly with the key contained in the signature, but that key is not t[rusted]...
```

A linha 4 é um controle: uma Response sem a assinatura no nível da Response mas com a Assertion assinada é SAML válido, e a biblioteca aceita. As linhas de wrapping só significam algo se o documento alterado realmente enganar um verificador fraco, então o harness também tem um (um teste de autorização do meu próprio SP, nunca apontado para outra coisa). Ele confere "existe uma `<Signature>` válida no documento" com `SignedXml.CheckSignature` e depois lê a primeira `<Assertion>`, o erro clássico, no documento da linha 6:

```text
naive: signature valid = True
naive: first Assertion NameID = bob@lab.test
naive: first Assertion Role   = app-admin,app-user
o mesmo documento enviado ao SP de verdade     REJECTED ...is not signed and contains unsigned Assertions
```

A assinatura é genuína (cobre a segunda asserção pelo `ID`), a identidade lida é a do atacante. A defesa da biblioteca é estrutural: toda asserção tem que estar assinada (ou a Response inteira), então uma asserção extra sem assinatura falha mesmo que todo o resto seja válido. A linha 10 mostra a outra metade: a assinatura pode verificar contra o certificado que vem no `KeyInfo` e mesmo assim ser rejeitada, porque essa chave não está entre as do IdP vindas da metadata. O `KeyInfo` é uma dica, nunca confiança. Os casos 6 a 9 são os formatos padrão de XSW, não uma lista exaustiva: rode de novo a cada upgrade da biblioteca, os advisories de novembro de 2026 mostram que essas bibliotecas ainda têm bugs de validação. Toda rejeição acima saiu como **HTTP 500** com a exceção no log, não como 4xx, então trate (tratamento de exceção em volta do ACS que registra o motivo e devolve um 400 genérico) ou o tráfego de atacante vira alerta de plantão.

### Audience, InResponseTo, janela de tempo e replay

```text
Response de outro SP (entityId do SP trocado)     REJECTED SecurityTokenInvalidAudienceException: IDX10214: Audience validation failed
Response 3 enviada com o cookie de estado da requisição 4  REJECTED Saml2ResponseFailedValidationException: InResponseTo Id "id02158..." in received response does not match...
Response enviada de outro navegador (sem estado)  REJECTED UnexpectedInResponseToException
Response iniciada pelo IdP, configuração padrão   REJECTED Unsolicited responses are not allowed for idp "http://localhost:6901/realms/lab"
iniciada pelo IdP com AllowUnsolicitedAuthnResponse  ACCEPTED (303, sessão, /me 200)
a mesma Response enviada pela segunda vez         REJECTED SecurityTokenReplayDetectedException: IDX10228: The securityToken has previously been validated
a mesma Response depois de reiniciar o processo do SP  ACCEPTED (cookie de sessão gravado)
```

`Audience` e `InResponseTo` vêm ligados por padrão. Respostas não solicitadas (iniciadas pelo IdP) vêm desligadas e ligá-las remove a proteção do `InResponseTo`, e é por isso que o replay importa ali. A rejeição de replay veio do `ITokenReplayCache` em memória da biblioteca (`SPOptions.TokenReplayCache`): disparou mesmo com `TokenValidationParametersTemplate.ValidateTokenReplay` deixado em `false`, e **esqueceu tudo no restart**, então depois de um restart (e, pela mesma lógica, num segundo nó que nunca viu a Response) uma Response capturada é aceita de novo até o `NotOnOrAfter` mais a tolerância. Com mais de um nó, dê ao `SPOptions.TokenReplayCache` uma implementação compartilhada (Redis, banco) ou mantenha o IdP-initiated desligado. Uma Response solicitada enviada por um navegador sem o cookie de estado falhou antes no `InResponseTo`. As checagens de `Destination` e `Recipient` não foram medidas (os valores alterados quebram a assinatura antes que qualquer checagem possa ser isolada); leia o código da biblioteca antes de depender delas.

A janela de tempo: configurei o tempo de vida da asserção do client do Keycloak para 10 s, então `Conditions NotOnOrAfter` é a emissão + 10 s, e enviei por POST uma Response capturada por atraso (cada uma com seu cookie de estado):

```text
tolerância padrão (TokenValidationParametersTemplate.ClockSkew = 5 min)   +20s ACCEPTED   +300s ACCEPTED   +320s REJECTED
ClockSkew = 0                                                             +1s  ACCEPTED   +20s  REJECTED
```

A tolerância padrão de 5 minutos faz uma asserção de 10 segundos servir por cerca de 310 segundos, e o padrão de 60 s do Keycloak por cerca de 6 minutos. Ajuste o `ClockSkew` ao que o seu NTP realmente garante (30 segundos é comum); a entrada do cache de replay deve viver pelo menos esse tempo.

### Single Logout

Iniciado pelo SP, medido de ponta a ponta com o binding Redirect: `GET /logout` apaga o cookie do app e devolve 303 para o Keycloak com `SAMLRequest`, `RelayState`, `SigAlg` e `Signature`; a requisição é assinada com o certificado de serviço do SP e leva o NameID e o `SessionIndex` que a biblioteca guardou nas claims:

```xml
<saml2p:LogoutRequest ID="id29d48..." Destination="http://localhost:6901/realms/lab/protocol/saml">
  <saml2:Issuer>http://localhost:6900/Saml2</saml2:Issuer>
  <saml2:NameID Format="...emailAddress">alice@lab.test</saml2:NameID>
  <saml2p:SessionIndex>qPFJuQkB...</saml2p:SessionIndex>
</saml2p:LogoutRequest>
```

O Keycloak respondeu 200 com um formulário de submit automático cujo `SAMLResponse` é um `LogoutResponse` assinado com `StatusCode Success`; o SP aceitou esse POST em `/Saml2/Logout` (303 para `/`), `/me` voltou a redirecionar para o login, e uma nova requisição do SP com o mesmo navegador do IdP recebeu o formulário de login do Keycloak, então a sessão do IdP tinha acabado. Funciona, mas só pelo navegador (front channel).

O logout iniciado pelo IdP **não** funcionou. Encerrei as sessões da alice pela API admin do Keycloak com o client em back-channel logout. O Keycloak mandou um `LogoutRequest` por POST para o SP (o laboratório precisou de `host.docker.internal` e do SP ligado em todas as interfaces para isso, um artefato só do Docker) e o SP lançou:

```text
System.InvalidOperationException: Received a LogoutRequest from "http://localhost:6901/realms/lab" for SessionIndex "8aasz23D...::1b5aa595-...", but the current session has SessionIndex "".
GET /me com o cookie antigo depois: 200
```

Um POST de servidor para servidor não tem cookie, então o handler não acha a sessão do usuário e o cookie continua válido até expirar. Para honrar um logout do IdP é preciso um session store no servidor indexado por `SessionIndex` (`CookieAuthenticationOptions.SessionStore` ou uma checagem sua em `OnValidatePrincipal`) e uma forma de revogá-lo; não construí isso (só doc). Até lá, trate o logout SAML como "saio do meu app e peço ao IdP que encerre a sessão dele", e mantenha a sessão do app curta. O Sustainsys também anuncia só o binding Redirect para logout na metadata; o `LogoutResponse` enviado por POST e o `LogoutRequest` de back-channel por POST chegaram ao handler com a configuração padrão. `Compatibility.EnableLogoutOverPost` também existe (não exercitado).

### Quem é dono de quê

O IdP é dono da autenticação e do MFA ([MFA with TOTP](mfa-totp-and-recovery-codes-with-aspnet-core-identity) pertence a ele, não a este SP). O SP é dono da validação, da sessão e da autorização. Se o app também vai falar OpenID Connect, ponha um broker na frente e dê ao app um protocolo só ([OpenID Connect, Entra ID and BFF](openid-connect-entra-id-and-bff), [choosing a federation protocol](/identity-concepts/choosing-a-federation-protocol-saml-oidc-kerberos-and-ldap)). Para APIs atrás da sessão, os tokens do [JWT bearer](jwt-bearer-and-aspnet-core-identity) ou de um [authorization server](building-an-authorization-server-with-openiddict) são o passo seguinte usual; asserções SAML não são tokens de API.

## Trade-offs

- **Escolha da biblioteca.** O Sustainsys encaixa no pipeline do ASP.NET Core e é MIT, mas a 2.x está em modo só de segurança, mira `net8.0`, e a v3 tem um plano open-core inacabado. A ITfoxtec é ativa e mira net10 e net11, mas os endpoints são escritos e protegidos por você. Um broker tira a biblioteca do seu app e acrescenta um serviço para operar.
- **Fixe a versão e acompanhe os advisories.** Quatro advisories saíram em 2026-11-16 (dois altos). Assine os advisories do repositório, fixe pelo menos a 2.11.1 e rode a tabela de adulterações (wrapping, sem assinatura, chave errada, replay) como teste de integração a cada upgrade.
- **Política de assinatura.** A linha 4 mostra que a biblioteca aceita uma Response assinada só no nível da asserção, o que é SAML válido. Saiba qual dos dois o seu IdP assina, e mantenha as linhas de asserção sem assinatura da tabela como teste de regressão.
- **Tolerância de relógio.** Os 5 minutos padrão transformam uma asserção de 60 segundos numa de 6 minutos. Baixe para a precisão real dos seus relógios; baixo demais quebra o login em hosts com deriva.
- **Cache de replay.** Em memória, logo por processo: um restart ou um segundo nó aceita o replay. Compartilhe, ou aceite IdP-initiated só se puder.
- **SSO iniciado pelo IdP.** Cômodo para portais, mas sem `InResponseTo` e sem cookie de estado. Deixe `AllowUnsolicitedAuthnResponse` desligado, a menos que um cliente exija.
- **Logout.** O logout front-channel iniciado pelo SP funcionou; o logout back-channel do IdP não encerrou a sessão do app. Um cookie sem estado não pode ser revogado à distância: encurte a sessão ou acrescente um store no servidor.
- **Erros como 500.** Toda falha de validação é uma exceção não tratada. Trate, registre o motivo no servidor, devolva ao usuário um 400 genérico ou a página de login.
- **Confiança nos atributos.** Mapeie uma whitelist de atributos para claims. Atributos `Role` sem filtro trouxeram `offline_access` e `manage-account` para o principal e inflaram o cookie.
- **Limites do laboratório.** Um IdP (Keycloak), HTTP em localhost, uma biblioteca, uma plataforma. Entra ID, ADFS, Okta e asserções criptografadas não foram executados, nem a rotação de chave do IdP nem uma farm com vários nós.

## Documentation Links

- [Authentication handlers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/) (doc)
- [Use cookie authentication without ASP.NET Core Identity, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie) (doc)
- [WS-Federation authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/ws-federation) (doc)
- [ASP.NET Core Data Protection overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction) (doc)
- [ASP.NET Core handler, Sustainsys.Saml2 documentation](https://saml2.sustainsys.com/en/v2/asp.net-core.html) (doc)
- [Configuration in code, Sustainsys.Saml2 documentation](https://saml2.sustainsys.com/en/v2/code-configuration.html) (doc)
- [Sustainsys.Saml2 repository, README and SECURITY.md, GitHub](https://github.com/Sustainsys/Saml2) (doc)
- [Sustainsys.Saml2 security advisories, GitHub](https://github.com/Sustainsys/Saml2/security/advisories) (doc)
- [ITfoxtec.Identity.Saml2 repository, GitHub](https://github.com/ITfoxtec/ITfoxtec.Identity.Saml2) (doc)
- [SAML 2.0 in IdentityServer, Duende documentation](https://docs.duendesoftware.com/identityserver/saml/) (doc)
- [SAML 2.0 external provider, Duende documentation](https://docs.duendesoftware.com/identityserver/ui/login/saml-provider/) (doc)
- [SAML Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html) (doc)
- [Assertions and Protocols for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) (doc)
- [Bindings for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf) (doc)
- [Profiles for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf) (doc)
- [Metadata for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf) (doc)
- [XML Signature Syntax and Processing Version 1.1, W3C](https://www.w3.org/TR/xmldsig-core1/) (doc)
- [Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [SAML protocol reference, Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/saml-protocol-reference) (doc)
