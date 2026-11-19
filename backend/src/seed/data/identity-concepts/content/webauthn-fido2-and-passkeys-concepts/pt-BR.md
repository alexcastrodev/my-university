---
version: 1.0
updatedAt: 2026-11-19
title: "WebAuthn, FIDO2 e passkeys: o protocolo medido"
summary: WebAuthn medido sem navegador e sem chave física, com um autenticador ES256 de software e um servidor RP em Node 22. A cerimônia de registro (challenge, rp.id, user.id, authenticatorSelection), o clientDataJSON e o attestationObject CBOR, o authData byte a byte (rpIdHash, flags UP/UV/BE/BS/AT/ED, signCount, AAGUID, credentialId, chave COSE), a autenticação (assinatura sobre authData e SHA-256 do clientDataJSON) e a verificação passo a passo, credenciais discoverable e login sem username, origin binding contra phishing com o TOTP aceito no mesmo ataque, signCount e clonagem, passkey sincronizada contra ligada ao dispositivo, attestation e AAGUID, userVerification, recuperação de conta e a tabela de parâmetros do RP.
---
## Objective

Uma senha e um código TOTP são segredos compartilhados: o servidor conhece (ou recalcula) o que o usuário digita, então um site falso que o colete consegue reutilizá-lo. O WebAuthn troca o
segredo por um par de chaves por site: a chave privada nunca sai do autenticador, o servidor guarda só a chave pública, e a assinatura cobre a origem que o navegador viu. Esta lição mede
isso sem navegador e sem hardware: um autenticador ES256 de software, um navegador de mentira e um servidor relying party (RP) que eu escrevi (323 linhas de Node 22, só `node:crypto`, com um
codec CBOR de 30 linhas). Ela decodifica um `authData` real byte a byte, verifica uma asserção, faz login sem username, mostra a origem do atacante rejeitada onde um código TOTP é aceito,
pega um clone pelo `signCount` e compara passkeys sincronizadas e ligadas ao dispositivo. A implementação em ASP.NET é outro concept; este é o protocolo.
Versions: Node 22.23.4; WebAuthn Level 2 (Recomendação W3C, 8 de abril de 2021) e Level 3 (Candidate Recommendation Snapshot, 26 de maio de 2026), lidos em w3.org.

## Use Cases

- Ler uma falha de registro e saber qual de challenge, origin, rpIdHash, flags ou assinatura quebrou.
- Escolher `userVerification`, `residentKey` e `attestation` para um produto ou um ambiente regulado.
- Explicar a um revisor por que passkeys resistem a phishing e o TOTP não.

## Deep Dive

### O que muda em relação a um segredo compartilhado

| | Senha / TOTP | Credencial WebAuthn |
|---|---|---|
| O servidor guarda | hash, ou a semente do TOTP | uma chave pública |
| Vazamento do servidor expõe | material para atacar ou reutilizar | nada que faça login de alguém |
| O que o usuário envia | um segredo que digita em qualquer lugar | uma assinatura feita para um só `rpId` |
| Site falso coleta | funciona, reutilizável | não consegue produzir para o site real |

Três partes participam. O **RP** é o seu servidor. O **client** (navegador e SO) decide qual site pode pedir qual `rpId` e escreve a origem no `clientDataJSON`. O **autenticador** (celular,
TPM do notebook, chave de segurança, gerenciador de senhas) guarda as chaves e assina. **Passkey** é o nome para o usuário de uma credencial WebAuthn discoverable (passkeys.dev), em dois
sabores: sincronizada entre dispositivos, ou ligada a um dispositivo.

Meu código tem a mesma divisão: `Authenticator` (só vê `rpId` e um hash), `Browser` (escreve a origem real, recusa um `rpId` alheio) e um RP HTTP com quatro rotas (`/register/*`, `/login/*`,
`options` e `verify`) trocando o JSON que um navegador real envia.

### Registro: as opções que o RP decide

`navigator.credentials.create({ publicKey })` recebe o que `/register/options` devolveu (challenge abreviado):

```json
{"challenge":"HFJz7Yu6Ly-e...","rp":{"id":"example.com","name":"Example"},"user":{"id":"RDWejTPJ...","name":"alice","displayName":"alice"},
 "pubKeyCredParams":[{"type":"public-key","alg":-7},{"type":"public-key","alg":-257}],
 "authenticatorSelection":{"residentKey":"required","userVerification":"required"},"attestation":"none","timeout":60000}
```

- `challenge`: 32 bytes aleatórios, uso único (a spec pede pelo menos 16).
- `rp.id`: um sufixo de domínio registrável da origem da página. As credenciais ficam presas a ele para sempre.
- `user.id`: um identificador opaco de até 64 bytes, sem dado pessoal (nem o e-mail, nem o username).
- `pubKeyCredParams`: algoritmos aceitos, em ordem de preferência: `-7` ES256 (P-256), `-257` RS256 (RSA, ainda exigido em alguns Windows; só docs, meu autenticador assina só ES256).
- `authenticatorSelection`: `residentKey` e `userVerification`, tratados abaixo.

### A resposta: clientDataJSON e attestationObject

O navegador devolve duas sequências de bytes. O `clientDataJSON` é JSON puro, escrito pelo navegador e não pela página:

```text
{"type":"webauthn.create","challenge":"HFJz7Yu6Ly-ecvOLq7PkiRpNsyeh8QS9OJaWS4KzGXg",
 "origin":"https://example.com","crossOrigin":false}
```

O `attestationObject` é CBOR (RFC 8949), 194 bytes aqui, um mapa com três chaves: `fmt` (`none`), `attStmt` (vazio para `none`) e `authData`. Os 164 bytes do `authData`, decodificados pelo
meu parser (uma execução real):

```text
off  hex                                           meaning
  0  a379a6f6eeafb9a55e378c118034e2751e682fab...  rpIdHash = SHA-256("example.com") (matches)
 32  45                                            flags 0b01000101: UP=1 UV=1 BE=0 BS=0 AT=1 ED=0
 33  00000000                                      signCount = 0
 37  0123456789abcdef0123456789abcdef              AAGUID (16 bytes, identifies the authenticator model)
 53  0020                                          credentialId length = 32
 55  789762e2464e5684d348308144b6962767748d8f...   credentialId (random, picked by the authenticator)
 87  a501020326200121582051cf60eb491e6b23df94...   credentialPublicKey, COSE_Key CBOR (77 bytes)
```

O byte de flags é `0x45`: bit 0 UP (usuário presente, um toque), bit 2 UV (usuário verificado: PIN ou biometria), bit 3 BE (elegível a backup), bit 4 BS (estado de backup), bit 6 AT (dados
da credencial atestada vêm a seguir), bit 7 ED (dados de extensão vêm a seguir). A chave pública é uma COSE_Key (RFC 9052), um mapa CBOR com chaves inteiras: `1:2` kty EC2, `3:-7` alg ES256,
`-1:1` crv P-256, `-2` x e `-3` y (32 bytes cada). Os 77 bytes são um cabeçalho de mapa, três pares de 2 bytes e duas entradas de coordenada de 35 bytes. Numa asserção não há `AT`, então o
`authData` tem só os primeiros 37 bytes.

O servidor verifica nesta ordem (cada passo dá nome ao erro no meu código): `type` é `webauthn.create`; `challenge` é um que ele emitiu e ainda não usado; `origin` é a esperada; `rpIdHash` é
o SHA-256 do seu `rpId`; UP está ligado; UV está ligado quando exigido; `alg` é um que ele ofereceu; `fmt` e `attStmt` conferem; BS não vem ligado sem BE. Depois guarda:

```text
{"username":"alice","publicKey":"COSE_Key (5 entries)","signCount":0,"transports":["internal"],"uv":true,"be":false,"bs":false,"aaguid":"0123...cdef","fmt":"none"}
```

Guarde o `credentialId` (a chave de busca), a chave pública, o `signCount`, os `transports` (dicas para um `allowCredentials` futuro) e o UV e o BE/BS vistos no registro. Nenhum segredo:
vazar essa tabela não faz login de ninguém.

### Autenticação: o que é assinado e como se verifica

O `credentials.get` devolve `clientDataJSON` (`type` agora `webauthn.get`), `authenticatorData` (37 bytes) e uma `signature` ES256 em DER (72 bytes nesta execução) sobre `authData ||
SHA256(clientDataJSON)`, ou seja, 37 + 32 = 69 bytes. Essa construção é o truque: o `authData` leva o hash do `rpId`, o `clientDataJSON` leva o challenge e a origem. O núcleo do servidor:

```js
const raw = unb64u(authenticatorData), ad = parseAuthData(raw);
checkAuthData(ad, p);   // rpIdHash == sha256(RP_ID), UP, UV if required
if (!verify('sha256', Buffer.concat([raw, sha256(cdBytes)]), publicKey, unb64u(signature))) fail('signature', 'invalid');
if ((ad.signCount || c.signCount) && ad.signCount <= c.signCount) fail('signCount', ...);
c.signCount = ad.signCount;
```

Antes disso, `takeChallenge` confere o `type`, apaga o challenge (uso único) e compara a `origin`. Um servidor real amarra o challenge à sessão; o meu usa o próprio valor como chave para
ficar curto. Medido:

```text
login with username      OK  {"user":"alice","signCount":1,"uv":true}
same response again      REJECTED  challenge: unknown or already used
```

### Credenciais discoverable: login sem username

Com `residentKey: "required"` o autenticador guarda o `user.id` junto da chave (credencial discoverable, antes chamada "resident key"). O RP manda `allowCredentials` vazio, o autenticador
oferece a credencial daquele `rpId` e devolve o `userHandle`:

```text
allowCredentials sent: []  userHandle returned: RDWejTPJ...
login without username   OK  {"user":"alice","signCount":2,"uv":true}
```

O servidor acha a credencial pelo `credentialId` e confere que o `userHandle` pertence a ela. Passkeys são credenciais discoverable por definição, o que habilita o botão "Entrar com passkey"
e o autofill do navegador (conditional UI, só docs). Uma credencial não discoverable precisa do username antes, para o RP listar `allowCredentials`; responder com uma lista falsa para
usernames desconhecidos evita revelar quais contas existem (só docs).

### Origin binding: o teste de phishing (medido)

O atacante roda `https://evil.example`, repassa o challenge real e pede ao autenticador do usuário que assine. Quatro camadas dizem não:

```text
evil page asks for rpId example.com : SecurityError: rpId example.com is not a domain suffix of evil.example
evil page asks for its own rpId    : NotAllowedError: no credential for this rpId
rogue client: origin lie, rpId example.com   REJECTED  origin: expected https://example.com, got https://evil.example
assertion made for rpId evil.example         REJECTED  rpIdHash: does not match SHA-256 of example.com
```

1. O navegador recusa um `rpId` que não seja sufixo da origem da página.
2. Com o `rpId` do próprio atacante, o autenticador não tem credencial para `evil.example`: não há o que assinar.
3. Um cliente malicioso (malware, não um navegador) pode escrever qualquer `clientDataJSON` e o autenticador assina, porque nunca vê a origem. O RP rejeita a `origin`.
4. Uma assinatura feita para outro `rpId` falha no `rpIdHash`.

As checagens básicas também falham como esperado: challenge errado (`challenge: unknown or already used`) e um bit trocado na assinatura (`signature: invalid`). Agora o mesmo ataque contra o
TOTP: a vítima digita seis dígitos na página falsa e o atacante os repassa dentro da janela de 30 segundos:

```text
TOTP typed at evil.example, relayed to the RP within the window: ACCEPTED
```

Um código TOTP não carrega identidade de site, então uma página adversary-in-the-middle ganha (o concept de fatores de MFA cobre o algoritmo). Uma asserção de passkey está presa a
`example.com`, então a mesma página não obtém nada reutilizável, e o usuário não pode ser enganado a "aprovar o site errado", porque a escolha não é dele.

### signCount e autenticadores clonados

Um autenticador DEVERIA incrementar um contador a cada asserção e o RP guarda o último valor. Pela spec, se um dos valores é diferente de zero e o novo é menor ou igual ao guardado, pode
existir um clone (ou uma corrida, ou um defeito). Medido: copio a chave, a chave legítima faz login (guardado 7) e o clone assina com um contador que também é 7:

```text
legit login (counter moves on)     OK  {"user":"alice","signCount":7,"uv":true}
clone signs with the old counter   REJECTED  signCount: 7 <= stored 7: possible cloned authenticator
```

O login legítimo seguinte mostrou 6, não 3, porque o autenticador também assinou as três requisições que o RP rejeitou na seção anterior (origem falsa, challenge errado, bit trocado): ele
conta assinaturas, não logins. Autenticadores sem contador mandam 0 para sempre, o que a regra aceita (os dois zero). É um sinal, não uma prova: decida se um alerta bloqueia o login ou só
avisa.

### Passkeys sincronizadas contra ligadas ao dispositivo

BE (elegível a backup) é fixado na criação da credencial; BS (estado de backup) diz se ela está com backup agora. Pares válidos: BE=0 BS=0 de um dispositivo; BE=1 BS=0 multidispositivo, sem
backup; BE=1 BS=1 multidispositivo com backup. BE=0 BS=1 não é permitido (meu RP rejeita). Meu celular de mentira, elegível a backup e sem contador:

```text
synced: flags=0x5d BE=1 BS=1 {"ok":true,"fmt":"none","flags":93,"be":true,"bs":true,...}
bob login, twice (signCount stays 0)   OK  {"user":"bob","signCount":0,"uv":true}
```

`0x5d` é UP+UV+AT mais BE e BS. Passkeys sincronizadas (iCloud Keychain, Google Password Manager, gerenciadores de senha) dão recuperação e vários dispositivos, mas a chave vive numa conta
na nuvem, então a conta que sincroniza passa a fazer parte da sua segurança. Chaves ligadas ao dispositivo (chave de segurança, chave de TPM) não são exportáveis, o que o NIST SP 800-63B-4
exige no AAL3: autenticadores sincronizáveis NÃO PODEM ser usados lá. Guarde BE/BS e use na política (por exemplo, step-up numa ação de risco quando BE=1).

### Attestation e o AAGUID

A attestation deixa o autenticador provar o que ele é. `attestation` nas opções é uma preferência: `none`, `indirect`, `direct` ou `enterprise`. Formatos: `packed`, `tpm`, `android-key`,
`android-safetynet`, `fido-u2f`, `apple`, `none`. Medido: `none` deu um `attStmt` vazio; `packed` com self attestation (sem cadeia `x5c`, a própria chave da credencial assina `authData ||
clientDataHash`) deu `attStmt` com chaves `[alg,sig]` e verificou. A validação de cadeia de certificados de `tpm`, `android-key` e `apple` é só docs aqui. Com `none` o client pode trocar o
AAGUID por zeros, por privacidade (a spec permite).

A maioria dos RPs deve pedir `none`. Attestation direta diz o modelo (AAGUID, conferido no FIDO Metadata Service), mas custa privacidade e pode excluir provedores sincronizados. Importe-se
com ela em ambientes regulados que só podem aceitar chaves certificadas (governo, bancos). Ela prova o modelo no registro, não a pessoa.

### UV e UP: o que o RP decide

UP é um toque; UV é um PIN ou biometria checado pelo autenticador. Quando a passkey é o único passo do login, o UV é o que a torna multifator (posse mais PIN ou biometria), então exija. Meu
RP rejeita um autenticador que não fez UV:

```text
register, no UV done (RP requires it)  REJECTED  flags: user verification (UV) required but not set
```

Pedir `userVerification: "required"` não basta: confira a flag, porque só o `authData` assinado é evidência. Se uma senha ainda vem antes, `preferred` ou `discouraged` é mais rápido e
aceitável.

### Recuperação de conta: o elo fraco

Uma passkey que se perde precisa de um caminho de volta. Recuperar por link de e-mail ou SMS transforma o fator mais forte no mais fraco: o atacante usa o caminho de recuperação. Prefira
várias passkeys por conta (um segundo dispositivo ou uma chave de segurança), a recuperação do provedor de sincronização e uma recuperação tão forte quanto o login (identidade verificada, um
atraso, uma notificação). É o problema de ciclo de vida da trilha: recuperação, reset e o desligamento são onde a resistência a phishing costuma acabar.

### Parâmetros que o RP decide

| Parâmetro | Valores | Quando usar |
|---|---|---|
| `rp.id` | um domínio registrável | o domínio pai para compartilhar passkeys entre subdomínios; trocar orfana as credenciais |
| `challenge` | 16+ bytes aleatórios | sempre, uso único, amarrado à sessão |
| `residentKey` | `discouraged`, `preferred`, `required` | `required` para passkeys e login sem username |
| `userVerification` | `required`, `preferred`, `discouraged` | `required` quando a passkey é o único fator |
| `authenticatorAttachment` | `platform`, `cross-platform` | `cross-platform` para forçar chaves de segurança |
| `attestation` | `none`, `indirect`, `direct`, `enterprise` | `none`, salvo se precisar restringir modelos |
| `pubKeyCredParams` | `-7` ES256, `-257` RS256, `-8` EdDSA | ES256 primeiro, RS256 por compatibilidade |
| `allowCredentials` | lista ou vazio | vazio para login discoverable |

### Mercado e pontes

Passkeys são o caminho de MFA resistente a phishing que o mercado está adotando: navegadores, sistemas operacionais e grandes provedores já as suportam. Fatores de segredo compartilhado
(TOTP, SMS, push) continuam a maioria em produtos mais antigos, então planeje conviver com os dois. Livro contra hoje: o material antigo (WebAuthn Level 1, U2F) trata de chaves de segurança;
a história padrão hoje é a passkey sincronizada, e o Level 3 ainda é um snapshot de Candidate Recommendation.

Pontes: o concept anterior deste grupo é a lição de fatores de MFA (HOTP, TOTP, SMS, push e códigos de recuperação), o lado de segredo compartilhado desta. Para uma implementação completa de
passkeys em ASP.NET Core, veja o concept .NET ligado abaixo. A recuperação continua nos concepts de ciclo de vida desta trilha.

## Trade-offs

- **Sincronizada contra ligada ao dispositivo.** Passkeys sincronizadas resolvem o dispositivo perdido e são o que os usuários adotam, mas a conta de sincronização vira alvo. Chaves ligadas
  ao dispositivo são mais fortes e exigidas no AAL3, ao custo de um plano de recuperação por usuário.
- **Attestation contra privacidade.** `direct` deixa aceitar só modelos certificados, mas restringe quem se cadastra e expõe o modelo. `none` aceita todo mundo, inclusive uma chave de
  software como a desta lição.
- **UV `required` contra atrito.** Exigir UV torna a passkey um passo multifator de verdade. Bloqueia autenticadores sem UV e adiciona um prompt em logins de baixo risco.
- **Caminho de recuperação.** Qualquer fallback mais fraco (SMS, e-mail) limita a segurança da conta a esse fallback.
- **Escrever o próprio verificador.** Este servidor pula cadeias x5c, RS256, metadata, extensões e `topOrigin`. Use uma biblioteca mantida em produção e leia este código como um mapa do que
  ela faz.

## Documentation Links

- [Web Authentication: An API for accessing Public Key Credentials, Level 3, W3C](https://www.w3.org/TR/webauthn-3/) (doc)
- [Web Authentication: Level 2, W3C Recommendation](https://www.w3.org/TR/webauthn-2/) (doc)
- [Web Authentication API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) (doc)
- [passkeys.dev, community guide to passkeys](https://passkeys.dev) (doc)
- [FIDO Alliance specifications](https://fidoalliance.org/specs/) (doc)
- [RFC 9052, CBOR Object Signing and Encryption (COSE): Structures, IETF](https://www.rfc-editor.org/rfc/rfc9052) (doc)
- [RFC 8949, Concise Binary Object Representation (CBOR), IETF](https://www.rfc-editor.org/rfc/rfc8949) (doc)
- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Enable Web Authentication API (WebAuthn) passkeys, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/) (doc)
