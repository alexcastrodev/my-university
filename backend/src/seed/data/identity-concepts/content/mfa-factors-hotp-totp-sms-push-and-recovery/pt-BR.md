---
version: 1.0
updatedAt: 2026-11-19
title: "MFA: Fatores, HOTP, TOTP, SMS, Push e Recuperação"
summary: Os fatores de autenticação medidos no fio. Algo que você sabe, tem e é, HOTP (RFC 4226) e TOTP (RFC 6238) escritos do zero em 10 linhas e validados contra os 18 vetores de teste oficiais do RFC 6238, o URI otpauth:// do QR code, janela de tolerância e deriva de relógio, replay de código, força bruta e bloqueio com as contas feitas, o segredo cifrado em repouso, códigos de recuperação de uso único, SMS e e-mail segundo o NIST SP 800-63B-4, fadiga de push e number matching, phishing em tempo real (AiTM) e origin binding, e a tabela de resistência a phishing de cada fator.
---
## Objective

Uma senha prova uma coisa só: você sabe um segredo que pode ser phishado, adivinhado, reutilizado ou vazado. A autenticação multifator (MFA) pede uma segunda prova de outro tipo, para que um segredo roubado deixe de bastar. Esta lição cobre os fatores e quanto cada um realmente vale, monta HOTP (RFC 4226) e TOTP (RFC 6238) do zero em 10 linhas e confere os dois contra os vetores de teste oficiais, gera o URI `otpauth://` que está por trás do QR code, e depois mede o que um verificador precisa acertar: a janela de relógio, o replay, a força bruta, o segredo em repouso e os códigos de recuperação de uso único. Termina com SMS, fadiga de push, phishing em tempo real (por que o TOTP não resiste a ele e a passkey resiste) e uma tabela comparativa. O código é Node 22 sem pacotes, porque o foco é o algoritmo, não uma biblioteca.
Versions: Node 22.23.4, OpenSSL 4.0.3, curl 8.7.1, jq 1.7.1, RFC 4226, RFC 6238, NIST SP 800-63B-4 (lido em 2026-11-19).

## Use Cases

- Adicionar um segundo fator por app autenticador e saber o que o servidor guarda e confere (segredo, último passo, contador de falhas).
- Depurar o "meu código sempre dá errado": deriva de relógio, dígitos ou algoritmo errados no URI, base32 contra bytes crus, reuso do código.
- Escolher quais fatores oferecer ou aposentar depois de um incidente de phishing ou SIM swap, ou para uma auditoria que exige MFA resistente a phishing.

## Deep Dive

### Três fatores, e por que um segundo ajuda

Três categorias: conhecimento (senha, PIN: phishada, adivinhada, reutilizada, vazada), posse (app no celular, chave de hardware, folha de códigos de recuperação: roubada, clonada, retransmitida) e inerência (digital, rosto: não dá para trocar, e em geral destrava uma chave local em vez de ser enviada). MFA exige duas categorias diferentes: senha mais pergunta secreta é um fator duas vezes. O ganho é estatístico: o atacante com a senha vazada ainda precisa vencer um segundo canal que não está no mesmo banco nem na mesma página. Não é mágica: o resto da lição trata de quais segundos fatores também podem ser phishados, retransmitidos ou resetados.

### HOTP e TOTP em 10 linhas (medido)

HOTP: faz o HMAC do contador de 8 bytes big-endian com o segredo compartilhado, pega 4 bytes na posição dada pelo nibble baixo do último byte (truncamento dinâmico), descarta o bit de sinal e fica com os últimos N dígitos decimais. TOTP é o HOTP com contador `floor(unix_time / 30)`.

```js
import { createHmac } from 'node:crypto';
export function hotp(key, counter, digits = 6, alg = 'sha1') {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(alg, key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;                  // dynamic truncation offset
  const bin = h.readUInt32BE(o) & 0x7fffffff;        // 31 bits
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const step = (t, period = 30) => Math.floor(t / period);
export const totp = (key, t, digits = 6, alg = 'sha1', period = 30) => hotp(key, step(t, period), digits, alg);
```

O primeiro vetor do RFC 4226 à mão com `openssl` (segredo: a string ASCII `12345678901234567890`, contador 0):

```text
$ printf '\0\0\0\0\0\0\0\0' | openssl mac -macopt hexkey:$KEY -macopt digest:SHA1 -binary HMAC | xxd -p
cc93cf18508d94934c64b65d8ba7667fb7cde4b0
offset = last nibble = 0, bytes 0..3 = cc93cf18; & 0x7fffffff = 1284755224; mod 10^6 = 755224
```

Essa é a linha 0 da tabela do Apêndice D do RFC 4226. A execução completa: Apêndice D (10 valores HOTP) e Apêndice B do RFC 6238 (18 valores TOTP), este último extraído do texto do RFC em vez de redigitado. As sementes são as do RFC: 20 bytes `12345678901234567890` para SHA1, 32 bytes para SHA256, 64 bytes para SHA512; 8 dígitos.

```text
HOTP 0..9 : 755224 287082 359152 969429 338314 254676 287922 162583 399871 520489  -> all 10 match
RFC 6238 TOTP, 8 digits (RFC value = my value in all 18 rows):
 Time (s)     SHA1      SHA256    SHA512
 59           94287082  46119246  90693936
 1111111109   07081804  68084774  25091201
 1111111111   14050471  67062674  99943326
 1234567890   89005924  91819424  93441116
 2000000000   69279037  90698825  38618901
 20000000000  65353130  77737706  47863826      -> 18/18 match
```

Com 6 dígitos o mesmo número de 31 bits é tomado módulo 10^6 em vez de 10^8 (T=59, SHA1: `94287082` vira `287082`). O contador é um `BigInt`, então a última linha (ano 2603) funciona; um campo de tempo de 32 bits falha nela. Tudo o que um app autenticador faz está nessa função: o app só guarda o segredo e um relógio. O que não está na matemática do RFC e importa em produção: a janela, a proteção contra replay e o limite de tentativas.

### O URI `otpauth://` e o QR code

O QR code da tela de cadastro é só este URI (o "Key URI Format" do Google Authenticator, um padrão de fato):

```text
otpauth://totp/Example%20Corp:alice@example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example%20Corp&algorithm=SHA1&digits=6&period=30
```

- `totp` ou `hotp` (HOTP também exige `counter=`), depois o rótulo `issuer:conta`.
- `secret`: a chave em base32 (RFC 4648) sem padding. Não é hex nem base64: codificação errada é a causa mais comum de "todos os códigos errados". O segredo de teste de 20 bytes acima vira esses 32 caracteres e volta ao original.
- `issuer`: recomendado como parâmetro e como prefixo do rótulo; versões antigas do Google Authenticator usam só o prefixo.
- `algorithm`, `digits`, `period`: padrões SHA1, 6, 30. A wiki do Key URI diz que o Google Authenticator ignora `algorithm` e `period` (e `digits` em algumas plataformas), então um servidor com SHA256 ou `period=60` gera códigos que nunca batem para esses usuários (só doc, não testado aqui). Mantenha os padrões.

Gere o segredo com `crypto.randomBytes(20)`: 160 bits, o tamanho que o RFC 4226 recomenda. O URI contém o segredo: mostre uma vez, sobre TLS, e nunca registre em log.

### Deriva de relógio e a janela (medido)

Os relógios do celular e do servidor divergem, então o verificador aceita também os passos vizinhos do atual. Deslocamentos simulados do celular contra um servidor 15 s dentro de um passo, aceitos com janela 0, ±1, ±2 passos:

```text
phone offset -> window 0 / +-1 / +-2
  0 s yes/yes/yes | 10 s yes/yes/yes | 20 s no/yes/yes | 40 s no/yes/yes | -20 s no/yes/yes | -50 s no/no/yes | 80 s no/no/no
```

Com janela 0, um celular 20 s adiantado já falha; ±1 tolera de -45 s a +44 s neste instante, o bastante para deriva real e quem digita devagar. O preço: um palpite aleatório de 6 dígitos é aceito com probabilidade `(2w+1) / 10^6`. Monte Carlo, 20M de palpites aleatórios por janela (ruído de Poisson em torno do valor exato):

```text
window +-0: 20 hits = 1.00 per million (exact 1) | +-1: 53 = 2.65 (exact 3) | +-2: 105 = 5.25 (exact 5)
```

Então ±1 triplica a chance e ±2 a quintuplica. Corrija o relógio (NTP) em vez de alargar. O HOTP tem o problema espelhado: o contador do token avança a cada aperto de botão, então o servidor aceita uma janela à frente e ressincroniza (RFC 4226, seção 7.4).

### Força bruta: a conta e o bloqueio (medido)

Chance exata de pelo menos um acerto em `n` tentativas contra uma janela válida, e tentativas para 50% de chance:

```text
n=10: 0.0010% (window 0) 0.0030% (+-1) | n=100: 0.0100% 0.0300% | n=1000: 0.1000% 0.2996% | n=10000: 0.9950% 2.9555%
tries for 50%: window 0 693147, +-1 231049; at 10 guesses/s with no limit, +-1 reaches 50% in 6.4 hours
```

Sem limite, quem tem a senha vence em horas. O NIST SP 800-63B-4 exige limitar as falhas consecutivas de um autenticador a no máximo 100 (um teto que o próprio texto liga a "100 tentativas contra uma saída OTP decimal de seis dígitos"; limites menores são permitidos): com 100 tentativas a chance em ±1 é 0,03%. Conte por conta, não só por IP (botnets trocam de IP). O bloqueio transforma força bruta em negação de serviço, então prefira atrasos crescentes a uma trava permanente.

### Um verificador que acerta isso (medido)

Cerca de 45 linhas de `node:http` e `node:crypto` (`server.mjs`, porta 6300): o cadastro cria o segredo, o verify aplica a janela, a regra de replay e o bloqueio. O núcleo:

```js
for (let s = cur - WINDOW; s <= cur + WINDOW; s++) {
  if (!eq(hotp(key, s), code)) continue;               // eq = timingSafeEqual
  if (s <= u.lastStep) return [401, 'replay'];         // that step, or an older one, was already used
  u.lastStep = s; u.fails = 0; return [200, `ok step ${s}`];
}
u.fails++; return [401, `invalid (${u.fails}/${MAX_FAILS})`];   // MAX_FAILS = 5 in the demo
```

Acionado com curl (um script cliente calcula o código; status de cada chamada):

```text
first use -> 200 | same code again -> 401 (log: replay) | previous-step code -> 401 (replay)
wrong guesses 000000 .. 444444 -> 401 x5 (invalid 1/5 ... 5/5) | the RIGHT code now -> 429 (log: locked)
```

Um código vale pela janela inteira (até 90 s com ±1), e quem o vê (olhar por cima do ombro, página de phishing, log de proxy) pode usá-lo nesse tempo, a menos que o servidor lembre o último passo aceito. O NIST diz o mesmo dos códigos fora de banda: um segredo é aceito uma única vez no seu período de validade. Efeito colateral, visto numa execução anterior: aceitar um código do passo `n+1` (celular adiantado) empurra `lastStep` para frente, e o código do passo atual `n` passa a ser recusado como replay. Está correto, e é mais um motivo para manter a janela pequena.

### O segredo em repouso: cifrar, não fazer hash

O verificador de senha guarda um hash lento porque só compara. O verificador de TOTP precisa do próprio segredo para calcular o código esperado, então hash não serve. Opções: cifrar em repouso (AES-256-GCM, chave num KMS ou HSM, não junto dos dados) ou deixar um HSM calcular o HMAC. O registro da demo depois do cadastro:

```text
{"secret":{"iv":"a81af2bc0f1c183ce2fdb550","ct":"f8f3104483183bdd917b7abfc2b198400cdb7015","tag":"b7b2e0b3..."},
 "lastStep":-1,"fails":0,"recovery":[{"hash":"8a001d4a...0790","used":false}]}
```

`ct` são os 20 bytes cifrados; não há segredo em texto claro no registro. Um vazamento do banco mais a chave deixa o atacante gerar os códigos de todos os usuários: mantenha a chave em outro lugar. O concept de Criptografia (link abaixo) cobre AES-GCM e hash de senha.

### Códigos de recuperação: gerar, fazer hash, queimar

Usuários perdem celulares. Um código de recuperação é um segredo de consulta (look-up secret): aleatório, de uso único, mostrado uma vez. Gere com um CSPRNG, guarde só o hash e marque como usado no sucesso. A demo cria 10 códigos de 80 bits (`XXXX-XXXX-XXXX-XXXX`):

```text
code CI4B-K77R-XZBX-7XI5 | use 1 -> 200 (server: ok recovery code burned) | use 2 -> 401
```

Por que 80 bits com SHA-256 simples: nesse tamanho a velocidade do hash não importa. Medido numa thread do Node, 2,39 milhões de SHA-256/s, então um espaço de 50 bits leva cerca de 5.400 dias ali; uma GPU é milhares de vezes mais rápida (supondo 10^10 hashes/s, 50 bits caem em cerca de 1,3 dia). Em 80 bits fica fora de alcance. Para códigos curtos (8 a 10 caracteres) use scrypt ou Argon2 e bloqueio. O NIST os trata como look-up secrets: utilizáveis, não resistentes a phishing, e entregar ou resetar esses códigos é em si um evento de autenticação. Regenere o conjunto depois de uso suspeito, e nunca deixe o suporte resetar um fator só por e-mail ou chat.

### SMS e e-mail como fator

O SMS manda um código pela rede telefônica. Ataques reais: SIM swap (convencem a operadora a mover o número), interceptação via SS7, malware lendo a mensagem e o usuário digitando o código numa página de phishing. O que diz o NIST SP 800-63B-4 (lido em 2026-11-19): a entrega fora de banda pela rede telefônica pública (SMS ou voz) é "restricted"; o verificador deve oferecer a todo usuário um tipo alternativo, deve checar indicadores de risco (troca de SIM, portabilidade) antes de enviar, e trata a troca do número cadastrado como o vínculo de um novo autenticador. Os códigos expiram em até 10 minutos, têm ao menos seis dígitos e valem uma vez. O e-mail "SHALL NOT be used for out-of-band authentication" (interceptação, redirecionamento), embora um link por e-mail ainda possa verificar um endereço. O guia de MFA resistente a phishing da CISA coloca SMS e voz por último, como "último recurso".

Livro contra hoje: o SMS ainda está em todo lugar (bancos, operadoras, apps de consumo) porque todo telefone recebe e não há nada a instalar. O mercado está migrando para apps autenticadores, push com number matching e passkeys, mantendo o SMS como contingência com checagem de risco. Não construa SMS como única opção num sistema novo.

### Aprovações por push e fadiga de MFA

O push pergunta "Foi você? Aprovar / Negar" num app. É cômodo e mostra contexto, mas o Aprovar às cegas é a fraqueza: o atacante com a senha dispara pedidos sem parar até um usuário cansado tocar em Aprovar (push bombing, fadiga de MFA; o NIST lista "Authentication Fatigue"). Defesas: number matching (a página de login mostra um número que o usuário digita no app, então o Aprovar não pode ser às cegas), contexto no aviso, teto de avisos (NIST: verificadores "SHOULD implement a reasonable limit on the rate or total number of push notifications"; a OWASP concorda) e alerta de rajadas. O number matching é recomendação da CISA, da OWASP e de fornecedores, não uma cláusula do texto do NIST, e não detém um proxy de retransmissão (próxima seção).

### Phishing em tempo real (AiTM) e origin binding

Um site de phishing adversary-in-the-middle é um proxy reverso: a vítima abre um domínio parecido, o proxy repassa cada requisição ao site real e cada resposta de volta, e a página parece autêntica. A vítima digita a senha e depois o código TOTP (ou aprova o push); o proxy repete os dois em tempo real e fica com o cookie de sessão que o site real devolve. Nada está quebrado: o segundo fator era válido e foi usado dentro da janela.

O TOTP não resiste a isso, e o verificador mostra o porquê: o código é função só do segredo e do tempo, sem rastro da página onde foi digitado. Na demo, um código enviado com `Origin: https://login-examp1e.test` é aceito exatamente como um vindo do site real (nenhuma ferramenta de proxy é construída aqui; o ponto é que o verificador não tem como distinguir):

```text
HTTP/1.1 200 OK
{"result":"ok step 59835553"}
```

O NIST concorda: fatores com "manual entry of an authenticator output (e.g., out-of-band and OTP authenticators)" não são resistentes a phishing, porque a saída não fica presa à sessão sendo autenticada.

O WebAuthn (FIDO2, passkeys) é diferente por construção (só doc, W3C WebAuthn): o autenticador assina um desafio junto com dados que incluem o hash do RP ID e, via navegador, a origem real da página, e só usa uma chave criada para aquele RP ID. Num domínio parecido a origem está errada ou não existe credencial, então a assinatura que o proxy retransmite não verifica. O usuário não pode ser enganado, porque não há segredo para digitar ou aprovar. O origin binding transforma a resistência a phishing de vigilância do usuário em protocolo.

### Escala de força e tabela-resumo

O NIST liga o nível de garantia a isto: AAL2 exige dois fatores e uma opção resistente a phishing disponível; AAL3 exige uma chave resistente a phishing e não exportável; agências federais devem exigir autenticação resistente a phishing de sua equipe. Em ordem aproximada de força:

| Fator | Resiste a phishing ou retransmissão | Ataque típico | Onde ainda se usa |
|---|---|---|---|
| Só senha | não | phishing, stuffing, vazamento | primeiro fator em todo lugar |
| Código por SMS ou voz | não | SIM swap, SS7, retransmissão de phishing | bancos, apps de consumo, contingência |
| Código ou link por e-mail | não | invasão da caixa, interceptação | cadastro, recuperação de conta |
| Códigos de recuperação | não | folha roubada, engenharia social no suporte | último recurso de todo fator |
| App TOTP (RFC 6238) | não | retransmissão AiTM, phishing, vazamento do segredo | padrão de SaaS e painéis de admin |
| Push, sem number matching | não | push bombing | produtos de MFA legados |
| Push com number matching | não (ainda retransmitido) | retransmissão AiTM, pressão social | SSO corporativo |
| Chave de segurança ou passkey (WebAuthn) | sim (preso à origem) | roubo do dispositivo (ainda pede PIN ou biometria), downgrade para contingência fraca | admins, programas FIDO2, logins modernos |

Uma contingência fraca derrota um fator forte: se o dono de uma passkey ainda pode resetar por SMS ou ligando para o suporte, o atacante vai por esse caminho (MFA downgrade). A resistência a phishing só vale quando a recuperação é tão forte quanto o fator.

### Para onde ir

Passkeys e WebAuthn são medidos na próxima lição desta trilha. Para avisar a um relying party que houve MFA, o OIDC leva `acr` (garantia atingida) e `amr` (métodos usados, como `pwd`, `otp`, `hwk`) no ID token, e a lição de OIDC desta trilha mostra como pedir e verificar esses claims.

## Trade-offs

- **TOTP contra passkey.** O TOTP funciona em qualquer celular, offline, sem suporte do navegador, mas não resiste a retransmissão de phishing e o servidor guarda um segredo recuperável. A passkey resiste a phishing e o servidor guarda só uma chave pública, mas exige suporte a WebAuthn e um plano de recuperação para dispositivos perdidos.
- **Largura da janela.** Uma janela maior perdoa deriva de relógio e multiplica a chance de um palpite sortudo (3 por milhão em ±1, 5 em ±2). Corrija a sincronia de tempo primeiro, e sempre combine janela com limite de falhas.
- **Bloqueio contra negação de serviço.** Bloquear após 5 falhas barra a força bruta e deixa quem tem a senha trancar a vítima para fora. Atrasos crescentes e contadores por conta são mais gentis; o teto do NIST é 100.
- **Força da recuperação.** Um fator forte com reset fácil vale o que vale o reset: um atendente que desliga o MFA depois de uma mensagem de chat é o verdadeiro segundo fator. Exemplo: 10 códigos de 80 bits, uso único, mostrados uma vez.
- **Cifrar o segredo TOTP.** Um dump do banco sozinho fica inútil, ao custo de uma chave para operar e rotacionar. Com a chave no mesmo host o ganho é pequeno: use KMS ou HSM e registre os usos de decrypt.
- **SMS como contingência.** Alcança quase todos e herda SIM swap e retransmissão. Se mantido, deixe por último, cheque trocas recentes de SIM ou número, e nunca deixe resetar um fator mais forte.

## Documentation Links

- [RFC 4226, HOTP: An HMAC-Based One-Time Password Algorithm, IETF](https://datatracker.ietf.org/doc/html/rfc4226) (doc)
- [RFC 6238, TOTP: Time-Based One-Time Password Algorithm, IETF](https://datatracker.ietf.org/doc/html/rfc6238) (doc)
- [RFC 4648, The Base16, Base32, and Base64 Data Encodings, IETF](https://www.rfc-editor.org/rfc/rfc4648) (doc)
- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Key Uri Format, Google Authenticator wiki](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) (doc)
- [Multifactor Authentication Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) (doc)
- [Implementing Phishing-Resistant MFA, CISA](https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf) (doc)
- [Web Authentication Level 3, W3C](https://www.w3.org/TR/webauthn-3/) (doc)
