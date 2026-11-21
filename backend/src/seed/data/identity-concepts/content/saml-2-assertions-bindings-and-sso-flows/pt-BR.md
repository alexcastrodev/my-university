---
version: 1.1
updatedAt: 2026-11-21
title: "SAML 2.0: Assertions, Bindings e Fluxos de SSO"
summary: SAML 2.0 medido no fio contra um Keycloak 26.8.2 local como IdP. O fluxo SP-initiated com Redirect e POST binding contra o IdP-initiated (sem InResponseTo), o AuthnRequest e o Response decodificados de base64 e deflate, a Assertion anotada elemento a elemento (Issuer, NameID, Conditions, AudienceRestriction, SubjectConfirmationData, AuthnStatement, AttributeStatement), a metadata XML, a assinatura XMLDSig (C14N, Reference por ID), a lista de validações obrigatórias do SP cada uma falhada de propósito, o ataque XML Signature Wrapping contra um verificador de brinquedo, mapeamento de atributos para papéis, Single Logout e SAML contra OIDC.
---
## Objective

SAML 2.0 é SSO de navegador sobre XML assinado: um provedor de identidade (IdP)
atesta um usuário a um provedor de serviço (SP) com uma Assertion XML, levada
pelo navegador via Redirect e POST binding. É anterior ao OIDC e ainda roda a
maioria dos logins corporativos e universitários. Esta lição lê o protocolo no
fio contra um Keycloak local no papel de IdP: o AuthnRequest e o Response
decodificados de base64 e deflate, a Assertion anotada elemento a elemento, a
assinatura XMLDSig e as checagens obrigatórias do SP, cada uma falhada de
propósito. Um verificador de brinquedo mostra a classe XML Signature Wrapping. O
SP real tem 40 linhas ligando o `@node-saml/node-saml` do Node, instalado numa
pasta de scratchpad fora deste repo, então as checagens medidas são de uma
biblioteca mantida, não minhas.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`),
Node 22.23.4, `@node-saml/node-saml` 5.2.0 (`xml-crypto` 6.4.0, `@xmldom/xmldom`
0.8.15), curl 8.7.1, specs OASIS SAML 2.0 OS.

## Use Cases

- Integrar com um IdP corporativo ou SaaS (Okta, Entra, Keycloak, Shibboleth) que fala SAML, não OIDC.
- Revisar um SP que confia numa assertion depois de conferir só a assinatura.
- Depurar "funciona pelo portal do IdP, falha pelo app" (IdP-initiated contra SP-initiated).
- Decidir entre SAML e OIDC para uma integração nova.

## Deep Dive

### Papéis e os dois fluxos

Três partes: o **usuário** (navegador), o **IdP** que autentica e emite
assertions, o **SP** que as consome. **SP-initiated**: o usuário chega ao SP, o
SP manda um `AuthnRequest` com um `ID` aleatório, o IdP depois devolve um
`Response` cujo `InResponseTo` ecoa aquele `ID`. **IdP-initiated**: o usuário
começa no portal do IdP e o IdP posta um `Response` não solicitado, sem
`InResponseTo`. Esse campo ausente é todo o risco: nada amarra a assertion a uma
requisição que este SP fez, então um response IdP-initiated capturado pode ser
reenviado ou injetado. O SAML Profiles seção 4.1.4.2 só permite ao SP pular a
checagem de `InResponseTo` no caso não solicitado; o cheat sheet da OWASP
recomenda desativar o SSO IdP-initiated onde der.

### SP-initiated: o Redirect binding (medido)

O `/login` do SP redireciona o navegador (302) para o IdP com a requisição na
URL. O `SAMLRequest` é DEFLATE cru, depois base64, depois URL-encode (Bindings
spec seção 3.4.4.1); 954 bytes de XML viram cerca de 607 na query. Inflado:

```xml
<samlp:AuthnRequest ID="_e4b44d3a..." Version="2.0" IssueInstant="2026-11-19T05:43:58.922Z"
   ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
   Destination="http://localhost:6360/realms/demo/protocol/saml"
   AssertionConsumerServiceURL="http://localhost:6361/acs">
  <saml:Issuer>http://localhost:6361/sp</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
  <samlp:RequestedAuthnContext Comparison="exact">
    <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
  </samlp:RequestedAuthnContext>
</samlp:AuthnRequest>
```

`Issuer` é o `entityID` do SP, `Destination` o endpoint do IdP, `ProtocolBinding`
pede ao IdP que responda por POST. O IdP autentica o usuário (um formulário de
senha aqui) e responde.

### O POST binding e o Response (medido)

O IdP devolve uma página HTML que autoenvia um formulário ao AssertionConsumerService
do SP. O `SAMLResponse` é só base64, sem deflate (Bindings spec seção 3.5.4),
mais o `RelayState` com o deep link do SP:

```html
<form name="saml-post-binding" method="post" action="http://localhost:6361/acs">
  <input name="SAMLResponse" value="PHNhbWxwOlJlc3BvbnNlIHhtbG5z..."/>
  <input name="RelayState" value="/reports"/>
```

Decodificado (resumido), o Keycloak assinou o `Response` e a `Assertion`:

```xml
<samlp:Response Destination="http://localhost:6361/acs" ID="ID_a52c..." InResponseTo="_e4b44d3a..." ...>
  <saml:Issuer>http://localhost:6360/realms/demo</saml:Issuer>
  <dsig:Signature>...assina Reference URI="#ID_a52c..."...</dsig:Signature>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="ID_a6e4..." IssueInstant="2026-11-19T05:43:59.319Z">
    <saml:Issuer>http://localhost:6360/realms/demo</saml:Issuer>
    <dsig:Signature>...assina Reference URI="#ID_a6e4..."...</dsig:Signature>
    <saml:Subject>
      <saml:NameID Format="...emailAddress">alice@example.org</saml:NameID>
      <saml:SubjectConfirmation Method="...cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="_e4b44d3a..."
           NotOnOrAfter="2026-11-19T05:48:57Z" Recipient="http://localhost:6361/acs"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-11-19T05:43:57Z" NotOnOrAfter="2026-11-19T05:44:57Z">
      <saml:AudienceRestriction><saml:Audience>http://localhost:6361/sp</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="...59Z" SessionIndex="54Dwn..." SessionNotOnOrAfter="...15:43:59Z">
      <saml:AuthnContext><saml:AuthnContextClassRef>...ac:classes:unspecified</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email">...alice@example.org...</saml:Attribute>
      <saml:Attribute Name="Role">...finance-approver...</saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

O que cada elemento faz: `Issuer` nomeia o IdP (conferido na metadata); `NameID`
é o id do usuário num `Format` escolhido (emailAddress aqui, mas `persistent` e
`transient` são ids opacos por SP que evitam vazar o e-mail);
`SubjectConfirmationData` amarra a assertion a esta entrega via `Recipient` (a ACS
deste SP), `InResponseTo` (nossa requisição) e `NotOnOrAfter`; `Conditions` define
a janela de validade e `AudienceRestriction` o SP pretendido; `AuthnStatement`
registra quando e como o usuário autenticou; `AttributeStatement` leva as claims.
O SP aceitou e leu: `{"nameID":"alice@example.org","sessionIndex":"54Dwn...","Role":[...]}`.

### Metadata: como SP e IdP confiam um no outro

Nenhum lado fixa o outro no código. Cada um publica um `EntityDescriptor` XML. O
do IdP (`/realms/demo/protocol/saml/descriptor`, 3343 bytes) traz `entityID`,
`WantAuthnRequestsSigned`, endpoints `SingleSignOnService` por binding e um
`KeyDescriptor` de assinatura com o `X509Certificate`. O do SP (`/metadata`) traz
seu `entityID`, o `AssertionConsumerService` (POST, nossa URL de ACS) e
`WantAssertionsSigned="true"`. Trocar metadata é a configuração de confiança: o
SP fixa o certificado do IdP a partir da metadata do IdP, de nenhum outro lugar.

### XMLDSig: o que assinar XML quer dizer

A assinatura não é sobre o blob base64. O `SignedInfo` nomeia um
`CanonicalizationMethod` (C14N exclusivo, `xml-exc-c14n#`), um `SignatureMethod`
(`rsa-sha256`) e um `Reference URI="#ID_a6e4..."` apontando por `ID` ao elemento
que cobre, com um transform de enveloped-signature (para a `Signature` ficar
dentro do que assina) e C14N. A C14N importa porque um XML idêntico em bytes pode
ser reserializado (espaços, ordem de namespaces) e ainda tem que validar; ela fixa
os bytes canônicos que entram no hash do `DigestValue`. Aqui o Keycloak assina o
`Response` e, à parte, a `Assertion`. O SP precisa exigir a própria assertion
assinada: uma assinatura só no `Response` deixa a assertion trocável se o SP ler
uma não assinada.

### As checagens obrigatórias do SP, cada uma falhada de propósito (medido)

A biblioteca aplica a lista do Profiles seção 4.1.4.3 e do cheat sheet da OWASP.
Cada linha é uma rejeição real do SP medido:

```text
assertion assinada, NameID editado para admin@example.org -> rejected: Invalid document signature
response reenviado com outro certificado fixado           -> rejected: Invalid document signature
mesmo response postado duas vezes (InResponseTo=always)   -> rejected: InResponseTo is not valid
response IdP-initiated, InResponseTo exigido              -> rejected: InResponseTo is missing from response
replay IdP-initiated (rejectReplayedAssertions ligado)    -> rejected: The assertion ID_db06... has already been received
audience apontando para outro SP                          -> rejected: audience mismatch. Expected .../other-sp Received .../sp
Issuer esperado como outro realm                          -> rejected: Unknown SAML issuer. Expected .../other Received .../demo
assertion além do NotOnOrAfter                            -> rejected: SAML assertion expired: clocks skewed too much
```

Uma armadilha ficou medida: com `Destination`/`Recipient` apontando para outra
ACS, o node-saml 5.2 só **avisa** (`The Response has the Destination ... where
callbackUrl ... was expected. The next major version rejects it`) e ainda aceita.
Livro contra hoje: muitas stacks de SAML historicamente conferiram mal
`Destination` e `Recipient`; a correção é rejeitar, não avisar, amarrando a
assertion a este endpoint exato para não ser repassada a outro SP.

### XML Signature Wrapping contra um verificador de brinquedo (medido)

XSW é a classe de bypass de assinatura: a assinatura vale para o elemento X, mas
o SP lê o elemento Y. O verificador de brinquedo valida o XMLDSig da assertion com
`xml-crypto` e depois lê o primeiro `<NameID>` do documento, um erro comum:

```js
const valid = sx.checkSignature(xml);                 // signature valid: true
console.log('naive NameID:', doc.getElementsByTagNameNS(SAML,'NameID')[0].textContent);
const signed = parse(sx.getSignedReferences()[0]);    // só o que a Reference cobriu
console.log('fixed NameID:', signed.getElementsByTagNameNS(SAML,'NameID')[0].textContent);
```

Entrada do ataque: a assertion assinada genuína fica byte a byte intacta, e uma
cópia não assinada com `admin@example.org` e outro `ID` é inserida antes dela. A
assinatura continua válida contra o original intocado. Saída:

```text
signature valid: true | Reference URI: #ID_76a28471-...
naive NameID: admin@example.org     <- lê o elemento injetado pelo atacante
fixed NameID:  alice@example.org     <- lê só os bytes que a assinatura cobriu
```

A correção é uma regra: depois de validar, opere **só** sobre o elemento que a
`Reference` validada devolveu (`getSignedReferences()`), nunca sobre um elemento
achado por uma busca nova no documento. Postado ao SP real de node-saml, o mesmo
arquivo embrulhado é rejeitado (`Invalid document signature`): ele canonicaliza e
lê o nó assinado, não a primeira ocorrência. Forjar um embrulho que derrote uma
biblioteca endurecida e mantida fica docs only aqui: é a família XSW documentada
(OWASP XML Security Cheat Sheet, e Somorovsky et al., "On Breaking SAML"),
derrotada validando posição, não só a criptografia.

O lab em .NET desta lição mostrou uma segunda armadilha: `SignedXml.CheckSignature` continuou devolvendo true quando uma cópia sem assinatura com o mesmo `ID` ficava antes da assertion assinada, porque a referência é resolvida por ID em qualquer lugar do documento. O SP precisa recusar o documento em que esse ID aparece duas vezes e ler só o elemento que a assinatura cobre.

### Atributos para papéis, e Single Logout (medido)

Atributos mapeiam para papéis do app. O role mapper do Keycloak tem um botão
`single`: desligado, ele emite `<saml:Attribute Name="Role">` repetidos com um
valor cada e a biblioteca guardou só um; ligado, emite um `Attribute` com vários
`AttributeValue` e o SP leu o array completo `["finance-approver",...]`. Leia
atributos multivalorados de propósito; não confie que uma chamada devolve todos.
O **Single Logout** (SLO) propaga um logout: o SP manda um `LogoutRequest`
assinado nomeando o `NameID` e o `SessionIndex`, decodificado aqui como:

```xml
<samlp:LogoutRequest ID="_409e..." Destination="http://localhost:6360/realms/demo/protocol/saml">
  <saml:Issuer>http://localhost:6361/sp</saml:Issuer>
  <saml:NameID Format="...emailAddress">alice@example.org</saml:NameID>
  <samlp2:SessionIndex>abc</samlp2:SessionIndex>
</samlp:LogoutRequest>
```

SLO é frágil na prática: o front-channel logout depende de o navegador alcançar
todo SP, um SP inalcançável quebra a cadeia, e ele não revoga nada que um SP já
emitiu. Muitas implantações o desativam e contam com sessões curtas.

### SAML contra OIDC, e para onde esta trilha vai

SAML persiste porque IdPs corporativos, catálogos de SaaS e federações (InCommon,
eduGAIN) padronizaram nele, e migrações são lentas. O OIDC (I10, desta trilha) o
substituiu para apps novos: JSON e JWT no lugar de XML e XMLDSig, sem C14N e sem a
classe XSW, suporte nativo a mobile e SPA, e um discovery mais simples. Use SAML
só quando o outro lado fala só SAML. A escolha de protocolo em geral é o I14, e o
Kerberos (I8) é o SSO Windows on-premises ao lado do qual isto fica.

## Trade-offs

- **IdP-initiated contra SP-initiated.** IdP-initiated é cômodo (tile do portal)
  mas não tem `InResponseTo`, então a proteção contra replay tem que vir de
  janelas curtas e ids de assertion de uso único; SP-initiated amarra todo response
  a uma requisição. Prefira SP-initiated.
- **Assinar o Response ou a Assertion.** Assinar só o Response é mais barato mas
  deixa uma assertion não assinada ser trocada; exija a assertion assinada e leia
  só o nó assinado. Assinar os dois (medido) é o mais seguro.
- **XML e XMLDSig contra JWT.** A canonicalização XML compra assinaturas destacadas
  por elemento mas traz a superfície de wrapping e de XXE; o JWT (OIDC) é uma string
  assinada plana, mais simples e menor, ao custo da assinatura fina do SAML.
- **Single Logout contra sessões curtas.** SLO encerra sessões em todo lugar na
  teoria mas é frágil (um SP inalcançável o quebra); vidas de sessão curtas são
  menos completas mas confiáveis.

## Documentation Links

- [SAML Core 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) (doc)
- [SAML Bindings 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf) (doc)
- [SAML Profiles 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf) (doc)
- [SAML Metadata 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf) (doc)
- [XML Signature Syntax and Processing 1.1, W3C](https://www.w3.org/TR/xmldsig-core1/) (doc)
- [SAML Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html) (doc)
- [XML Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/XML_Security_Cheat_Sheet.html) (doc)
- [Guia de Administração do Servidor, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Securing applications with SAML, Keycloak](https://www.keycloak.org/securing-apps/saml-galleon-layers) (doc)
