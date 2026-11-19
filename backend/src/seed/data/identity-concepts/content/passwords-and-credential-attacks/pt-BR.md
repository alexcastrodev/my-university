---
version: 1.0
updatedAt: 2026-11-19
title: "Senhas e Ataques a Credenciais: Hash, Stuffing, Spraying e Política Moderna"
summary: Senhas do lado do servidor, medidas nesta máquina. Custo por hash de SHA-256, PBKDF2, bcrypt, scrypt e Argon2id nos parâmetros atuais da OWASP e a conta de palpites por segundo de quem tem o banco vazado (estimativa), salt único e pepper, formato PHC e migração de hash legado com rehash no login, as classes de ataque (força bruta online e offline, dicionário, credential stuffing, password spraying) contra um endpoint de login de brinquedo local, limitação de taxa, atraso progressivo contra bloqueio duro, resposta e tempo iguais para usuário inexistente, detecção, a política do NIST SP 800-63B-4, verificação de senha vazada com k-anonymity, fluxo de reset seguro e a tabela ataque, defesa, métrica.
---
## Objective

Senha ainda é o primeiro fator em quase todo lugar, e o jeito como o servidor a guarda e confere decide se uma tabela vazada ou uma botnet vira tomada de contas em massa. Esta lição é a senha vista do lado do servidor, medida nesta máquina: o custo por hash de SHA-256, PBKDF2, bcrypt, scrypt e Argon2id nos parâmetros atuais da OWASP, e quanto cada um custa a um atacante que tem a tabela vazada (estimativa, marcada como tal); por que um salt único por usuário mata as tabelas pré-computadas e não é segredo, e o que o pepper acrescenta; o formato PHC e uma migração com rehash no login; as classes de ataque (palpite online e offline, dicionário, credential stuffing, password spraying) explicadas contra um endpoint de login de brinquedo meu em 127.0.0.1, com as defesas que de fato mexem nos números (limite de taxa, atraso progressivo contra bloqueio duro, resposta e tempo iguais para usuário desconhecido, detecção); a política do NIST SP 800-63B-4; a checagem de senha vazada pelo protocolo de range com k-anonymity; e o fluxo de reset. Nenhum serviço real foi atacado ou consultado: a "população", o dump do "outro site" e o corpus de vazamento são arquivos sintéticos que eu gerei. O código é Node 22 mais os pacotes `argon2` e `bcryptjs` numa pasta de rascunho (o Node traz PBKDF2 e scrypt, não Argon2id nem bcrypt).
Versions: Node 22.23.4, `argon2` 0.45.2, `bcryptjs` 3.0.3, OpenSSL 4.0.3, Apple M4 Max (14 núcleos), NIST SP 800-63B-4 e os cheat sheets da OWASP (lidos em 2026-11-19).

## Use Cases

- Escolher o hash de senha e os parâmetros de um sistema novo, ou defender a escolha numa revisão ou auditoria.
- Migrar uma tabela antiga (MD5, SHA-1, sem salt ou com custo baixo) sem obrigar todo usuário a redefinir a senha.
- Triar "estamos vendo uma enxurrada de logins com falha": separar força bruta, stuffing e spraying e escolher o controle que funciona contra cada um.
- Escrever uma política de senha alinhada ao NIST SP 800-63B-4 e não às regras de 2005.

## Deep Dive

### Por que a senha sobrevive, e onde ela falha

A senha é grátis de emitir, não pede hardware e funciona em qualquer cliente, então é a camada base de todo login. Ela falha de quatro jeitos conhecidos: as pessoas a reutilizam entre sites (um vazamento abre os outros), escolhem senhas adivinháveis (alguns milhares de strings cobrem boa parte das contas), digitam em páginas parecidas com a real (phishing) e os servidores guardam mal (uma tabela vazada é quebrada offline em velocidade máxima). O NIST diz sem rodeio: "Passwords are not phishing-resistant." Tudo abaixo reduz a primeira, a segunda e a quarta falha no servidor. A terceira pede um fator preso à origem (a lição de MFA e a de passkeys desta trilha). A resposta do mercado hoje é a mesma em todo lugar: a senha continua como base, MFA e passkeys vão por cima, e o servidor endurece o caminho da senha de qualquer forma, porque ele também é a contingência.

### Armazenamento: hash rápido é a ferramenta errada (medido)

O SHA-256 foi feito para ser rápido, e rápido é o que quer o atacante que tem a tabela. As KDFs (funções de derivação de chave) são lentas de propósito, e as que exigem memória (scrypt, Argon2id) ainda pedem RAM por palpite, o que limita GPUs e ASICs. Uma thread de Node, de 20 a 500 mil execuções cada, parâmetros do Password Storage Cheat Sheet da OWASP (lido em 2026-11-19). As colunas do atacante são estimativa: assumo uma máquina de 10^10 SHA-256/s, escalo cada algoritmo pela mesma razão de custo medida e calculo o tempo para testar uma lista de 10^9 entradas e o espaço inteiro de 8 caracteres em `a-z0-9` (2,8 x 10^12).

```text
algoritmo                  login ms  palpites/s est  memória   lista 1e9   8 chars a-z0-9
SHA-256, 1 rodada          0.43 us       1.0e+10        0       100 ms        5 min
PBKDF2-SHA256 600k           44.5        9.6e+4        0       2.9 h       339 days
PBKDF2-SHA512 220k           38.2        1.1e+5        0       2.5 h       291 days
bcrypt custo 10 (bcryptjs)   52.2        8.2e+4     4 KiB      3.4 h       397 days
bcrypt custo 12 (bcryptjs)  194.3        2.2e+4     4 KiB     12.6 h         4 years
scrypt N=2^17 r=8 p=1       150.5        2.8e+4   128 MiB      9.7 h         3 years
scrypt N=2^15 r=8 p=3       104.5        4.1e+4    32 MiB      6.8 h         2 years
Argon2id m=19 MiB t=2 p=1    10.4        4.1e+5    19 MiB       40 min        79 days
Argon2id m=46 MiB t=1 p=1    12.9        3.3e+5    46 MiB       50 min        98 days
Argon2id m=64 MiB t=3 p=1    59.9        7.2e+4    64 MiB       3.9 h       456 days
```

Medido: o SHA-256 faz cerca de 2,3 milhões de hashes por segundo numa thread (2.298.565 e 2.331.118 em duas execuções, já com o custo da chamada no Node). O resto é aritmética, então leia como ordem de grandeza. Três ressalvas. O modelo por razão favorece o atacante nas funções que exigem memória: GPU tem pouca memória rápida por núcleo, então a diferença real é maior para scrypt e Argon2id que a da tabela. O `bcryptjs` é JavaScript puro. E uma senha fraca muda tudo: uma senha comum cai nos primeiros palpites de qualquer lista, seja qual for a KDF. A KDF compra tempo para senhas fortes e encarece a quebra em massa. O mesmo custo é pago por você em todo login (de 10 a 150 ms de CPU aqui), então ele também é número de capacidade e superfície de negação de serviço: a OWASP diz que o hash deve levar normalmente menos de um segundo e avisa que um fator alto deixa o atacante esgotar a CPU com muitos logins.

Mínimos atuais da OWASP (lidos em 2026-11-19): Argon2id com 19 MiB, 2 iterações, paralelismo 1 (opções equivalentes: 46 MiB/1, 12 MiB/3, 9 MiB/4, 7 MiB/5); se não houver Argon2id, scrypt com N=2^17, r=8, p=1 (equivalentes até N=2^13, p=10); bcrypt (só legado) custo 10 ou mais com limite de 72 bytes; PBKDF2 (quando o FIPS-140 é exigido) 600.000 iterações com HMAC-SHA-256, 220.000 com HMAC-SHA-512, 1.400.000 para SHA-1 (só legado). A especificação do Argon2 é a RFC 9106, a do PBKDF2 é a RFC 8018 e a do scrypt é a RFC 7914. O concept de Criptografia linkado abaixo mede o PBKDF2 em .NET e decodifica o hasher do Identity: linke para ele em vez de repetir.

O limite de 72 bytes do bcrypt é real, medido com uma senha de 75 bytes que difere de outra só depois do byte 72:

```text
bcrypt 72-byte: hash(a) verifies b? true | length a 75
argon2 same pair: false
```

Imponha o limite (ou faça pré-hash como a OWASP descreve, com HMAC e pepper, nunca SHA puro), porque truncar em silêncio faz duas senhas diferentes virarem a mesma.

### Salt, rainbow tables e pepper (medido)

Uma rainbow table é um índice pré-computado `hash -> senha` (as reais comprimem cadeias de hashes para economizar espaço; minha demo é uma tabela de consulta simples, a ideia é a mesma). Contra SHA-256 sem salt, uma tabela construída uma vez quebra toda conta cuja senha está nela. População sintética de 4 usuários, tabela de 1.000.000 de candidatos construída em 0,69 s:

```text
--- unsalted SHA-256 dump ---
alice  968ebd645ad900b8... summer2026!
bob    f00a8b634f1ec597... dragon77!
carol  968ebd645ad900b8... summer2026!        <- mesma senha, mesmo hash: visível para qualquer um
dave   c914a382df9b3d84... (not in table)
lookups: 264 us, cracked 3/4
--- per-user random salt + scrypt (N=2^15) ---
alice  2d64bea87647cc62... salt 3dcd2d95
carol  0cd46755c63776aa... salt f2662566       <- mesma senha, hashes diferentes
table hits against salted hashes: 0
```

Um salt aleatório único por senha (NIST: no mínimo 32 bits, 16 bytes é a escolha comum) obriga a refazer a tabela para cada usuário, e senhas iguais deixam de ser visíveis. O salt não é segredo: fica guardado ao lado do hash (veja o formato abaixo), o atacante o tem, e sua única função é tornar cada palpite exclusivo de uma conta. O salt não deixa mais lento um palpite dirigido a uma conta só: isso é trabalho do fator de custo.

O pepper é um segredo compartilhado por todas as senhas e guardado fora do banco (KMS, HSM ou cofre de segredos), de modo que uma tabela roubada sozinha não pode ser quebrada. A OWASP descreve as variantes pré-hash e pós-hash; o NIST diz que o verificador DEVERIA aplicar mais uma operação de hash com chave ou cifra com uma chave guardada à parte, de preferência numa área protegida por hardware. A variante pós-hash, medida:

```text
verify with the pepper: true | with only the DB (wrong key): false
```

Custos: o pepper não gira sem as senhas (girar significa forçar resets, ou guardar uma versão de pepper por linha), e se ele fica no mesmo host com as mesmas permissões do banco, acrescenta quase nada. Use quando houver um lugar de verdade para guardá-lo.

### Formatos e migração de hash legado

Guarde o algoritmo, os parâmetros, o salt e o hash numa string só, para poder mudar os parâmetros depois. O formato PHC faz isso (`$id$params$salt$hash`, salt e hash em Base64 sem padding). Saída real da minha execução:

```text
$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$69I7qCjDTsQwhQqFvpQJiqEI0lGQvxC84fXE0Ktxca4
$2b$10$ydE1v8YnTHfq1EfJyB64m.qpgt1gwEqc9A98Wudh8T6X7zrPuvU7G     (bcrypt: versão, custo, salt de 22 chars + hash de 31)
```

`argon2id` é a variante, `v=19` a versão 0x13 do Argon2, `m` a memória em KiB, `t` as passadas, `p` as lanes. O salt decodifica para os 16 bytes `0123456789abcdef` (fixei para conferir) e o hash para 32 bytes. Para ter certeza de que o pacote calcula Argon2id de verdade e não algo que só valida a si mesmo, derivei a mesma saída com o OpenSSL 4.0.3 (`openssl kdf -keylen 32 ... ARGON2ID` com o mesmo salt, `iter:2`, `memcost:19456`, `lanes:1`): os 32 bytes crus são idênticos (`ebd23ba8...71ae`). O Spring prefixa o algoritmo (`{bcrypt}...`) e o ASP.NET Core Identity codifica um byte de versão; é a mesma ideia, veja os concepts linkados.

A migração no login é o caminho padrão, porque só nesse momento você tem a senha em texto. O `verify` do servidor devolve "ok" e "precisa de rehash", e o login atualiza a linha. Núcleo do brinquedo (linhas MD5 hex, bcrypt e Argon2id convivem):

```js
async function verify(stored, pw) {                       // returns [ok, needsRehash]
  if (stored.startsWith('$argon2id$')) return [await argon2.verify(stored, pw), argon2.needsRehash(stored, P)];
  if (stored.startsWith('$2'))         return [await bcrypt.compare(pw, stored), true];
  const a = Buffer.from(md5(pw)), b = Buffer.from(stored);   // legacy: unsalted md5 hex
  return [a.length === b.length && timingSafeEqual(a, b), true];
}
// in login(): if (ok && rehash) user.hash = await argon2.hash(pw, P);
```

Execução com um usuário MD5 e um bcrypt, senha errada e depois a certa:

```text
old-md5    wrong -> 401 | right -> 200     server log: rehash old-md5: $argon2id$v=19$m=1...
old-bcrypt wrong -> 401 | right -> 200     server log: rehash old-bcrypt: $argon2id$v=19$m=1...
(second login of each: no rehash line, already Argon2id)
```

Quem nunca volta a logar fica com o hash antigo. A OWASP oferece duas saídas: expirar e apagar os hashes de usuários inativos há muito tempo (eles redefinem no próximo acesso), ou embrulhar o hash velho no novo (`argon2id(md5(pw))`) já, e trocar por um hash direto no próximo login. Embrulhar protege a tabela na hora sem saber senha nenhuma. Nunca faça rehash num login que falhou, e suba o custo do mesmo jeito conforme os anos passam.

### Classes de ataque, medidas contra um endpoint de brinquedo

O brinquedo é o `server.mjs`, preso em 127.0.0.1 porta 6440: `/login`, `/register`, `/reset/*`, Argon2id no mínimo da OWASP (cerca de 11 ms por checagem). Um script gerou 1.000 contas: 8% com `Summer2026!`, 5% com `Password123!`, 3% com `Welcome1!` e o resto aleatório (185 contas com senha comum), mais um dump inventado de "outro site" em que 149 contas reutilizam a senha. Nada disso toca um serviço real; os percentuais são escolha minha, não taxa do mundo real.

- **Palpite online** passa pelo seu endpoint de login, então dá para limitar, registrar e bloquear. É limitado pela taxa.
- **Quebra offline** acontece depois que a tabela vaza, na velocidade do atacante, sem limite que você controle. Só as escolhas de armazenamento acima defendem. Por isso armazenamento e controles online são trabalhos separados.
- **Dicionário e força bruta** testam muitas senhas contra uma conta (online) ou um hash (offline). Defesas: blocklist no cadastro, limitação, hash lento.
- **Credential stuffing** repete pares `usuário:senha` vazados de outro site. Uma tentativa por conta, de uma lista em que o par provavelmente está certo. Medido: 1.000 pares, **149 logins deram certo** (14,9%, por construção do meu dump). Não havia nada errado no alvo: o segredo já era público. Defesas: MFA (a OWASP cita a análise da Microsoft de que ele teria barrado 99,9% dos comprometimentos), checagem de senha vazada, detecção de anomalia, controles contra bots.
- **Password spraying** tenta poucas senhas muito comuns em muitas contas, uma ou duas por conta, então um contador por conta nunca dispara. Medido com bloqueio duro de 5 falhas: 3 senhas x 1.000 contas = 3.000 requisições, **185 contas quebradas, nenhuma bloqueada** (cada conta viu no máximo 3 falhas). Defesas: blocklist para que as senhas comuns não possam ser escolhidas, detecção entre contas, limites por IP e globais, MFA.
- **Rainbow tables** são uma classe offline, morta pelo salt (acima).

### Defesas online e o que custam (medido)

**Limite por conta, com atraso progressivo.** Depois de 3 falhas livres, o brinquedo recusa novas tentativas por 1, 2, 4, 8 s e assim por diante, com teto de 900 s, e recusa antes de calcular o hash, então as tentativas rejeitadas custam quase nada. Um cliente martelando uma conta por 20 s:

```text
20 s of guessing: 231195 requests sent, outcomes {"401":7,"429":231188}
owner during the delay -> 429 | retry in 12s
```

Só 7 palpites chegaram ao hash em 20 s. Por aritmética (não rodei por um dia): com o teto de 900 s, cerca de 110 palpites por conta por dia, então uma senha aleatória de 12 caracteres fica fora de alcance online, e uma senha comum do top 100 não: é por isso que a blocklist importa. O texto do NIST é um limite superior de 100 falhas consecutivas num autenticador, com limites menores permitidos, e ele lista esperas crescentes (por exemplo de 30 segundos até uma hora) e checagens por risco como formas de não trancar o usuário de verdade.

**Bloqueio duro é uma ferramenta de negação de serviço.** Com "bloquear após 5 falhas":

```text
attacker, 6 wrong guesses -> 401 401 401 401 401 423
owner, CORRECT password    -> 423 | account locked
```

Quem sabe um nome de usuário tranca aquele usuário para fora. O atraso também tranca o dono por um tempo (os 12 s acima), mas se recupera sozinho. A OWASP também manda amarrar o contador à conta e não ao IP, e permitir o fluxo de reset mesmo com a conta bloqueada. Combine qualquer contador com um caminho de reset que não dependa da senha bloqueada.

**Limites por IP** barram um endereço barulhento e falham contra uma botnet que espalha a carga, então complementam o contador por conta e não o substituem. Medido com 20 falhas por minuto por endereço: um endereço fazendo spray de `Summer2026!` recebeu 20 `401` e depois `429` a partir da requisição 21. Um spray distribuído por muitos endereços não foi simulado aqui (docs only): é esse caso que obriga a detecção a olhar o sistema inteiro, não só um IP.

**Detecção entre contas.** O brinquedo guarda um hash com chave de cada senha que falhou e conta as contas distintas que a receberam, e conta as contas distintas que falham por endereço. Log do servidor no spray acima:

```text
ALERT spray at request #10: one password tried on 10 distinct accounts
ALERT at request #20: 127.0.0.1 failed on 20 distinct accounts in 60 s
```

Os sinais que merecem painel: falhas por minuto no total, contas distintas com falha por origem, uma senha em várias contas, taxa de sucesso de logins de dispositivos novos, uma rajada de logins bem-sucedidos de um mesmo ASN. CAPTCHA e fingerprint de dispositivo só são citados aqui: a OWASP os lista como camadas extras que atacantes terceirizam ou driblam, para usar depois de algumas falhas e nunca como único controle.

### Mesma resposta, mesmo tempo para usuário desconhecido (medido)

Se o `/login` diz "no such user" para um nome desconhecido, ele é um oráculo de usernames de graça. A mensagem genérica é o primeiro passo, e o segundo é o tempo: se um usuário conhecido custa uma checagem de Argon2id e um desconhecido volta na hora, o relógio entrega. 300 logins de usuário conhecido e 300 de desconhecido por variante:

```text
variante       mediana conhecido  mediana desconhecido  adivinhar "existe?" só pelo tempo
leaky (404)       10.89 ms            0.30 ms           100.0% de 600 requisições (e o corpo diz)
fast  (401 both)  10.94 ms            0.29 ms           100.0% de 600 requisições (mesmo texto, ainda vaza)
constant          11.02 ms           11.02 ms            50.2% de 600 requisições (cara ou coroa)
```

A correção é um hash falso: para um nome desconhecido, verifique a senha enviada contra um hash Argon2id pré-calculado de dados aleatórios (`const DUMMY = await argon2.hash(random, P)`), de modo que o mesmo trabalho aconteça, e responda o mesmo texto. Cadastro e reset também precisam responder igual (abaixo). Sistemas reais têm ruído, filas e jitter de rede, então um atacante remoto precisa de mais amostras, não de mágica: não conte com o ruído.

### Política: NIST SP 800-63B-4

O NIST SP 800-63B-4 (texto em pages.nist.gov, carimbado 26 Aug 2025, que declara substituir o 800-63B anterior; lido em 2026-11-19) vira décadas de folclore de cabeça para baixo. As regras de senha:

- Comprimento acima de composição: uma senha usada como único fator precisa de no mínimo 15 caracteres; usada só dentro de MFA, no mínimo 8. O verificador DEVERIA aceitar pelo menos 64 caracteres, e aceitar todo ASCII imprimível, espaço e Unicode (cada code point conta como um caractere; aplique normalização NFC antes do hash).
- NÃO PODE impor regras de composição (mistura de tipos de caractere) e NÃO PODE forçar troca periódica; DEVE forçar a troca quando há evidência de comprometimento.
- DEVE comparar a senha nova com uma blocklist de valores comuns, esperados ou vazados (corpora de vazamentos, palavras de dicionário, o nome do serviço e o username), rejeitar no acerto dizendo o motivo e orientar o usuário. O NIST acrescenta que listas enormes dão pouco a mais, porque o palpite online já é limitado.
- NÃO PODE haver dicas visíveis a quem não se autenticou, e NÃO PODE usar autenticação baseada em conhecimento nem perguntas de segurança.
- DEVE permitir gerenciadores de senha e autofill; DEVERIA permitir colar; DEVERIA oferecer a opção de mostrar a senha.
- Guardar com salt e hash de um esquema aprovado, com custo o mais alto que for prático; limitar tentativas falhas (no máximo 100 consecutivas, veja acima).

Livro contra hoje: regras como "uma maiúscula, um dígito, um símbolo, troque a cada 90 dias" ainda estão em muita política interna e auditoria, mas são exatamente o que o NIST agora proíbe, porque produzem `Summer2026!` e `Summer2027!`. Confira a versão que o seu auditor cita: algumas normas ainda citam o texto antigo.

### Senhas vazadas com k-anonymity (medido local, API só na doc)

Checar um candidato contra um corpus sem entregar a senha ao corpus é o trabalho do protocolo de range do Pwned Passwords. O cliente calcula o SHA-1 da senha, envia só os 5 primeiros caracteres hex, recebe todos os sufixos daquele bucket com uma contagem e procura o seu sufixo localmente. O serviço nunca vê a senha nem o hash inteiro. Segundo a documentação da API do HIBP (docs only, não chamei): `GET https://api.pwnedpasswords.com/range/{5 primeiros chars do SHA-1}`, resposta com linhas `SUFIXO:CONTAGEM`, cerca de 800 por bucket, sempre HTTP 200 nos 1.048.576 prefixos possíveis; o cabeçalho `Add-Padding: true` completa a resposta para 800 a 1.000 linhas (as de enchimento têm contagem 0) para que o tamanho não revele o bucket; existe `?mode=ntlm`; e checar a cada tecla é desencorajado porque o fluxo de prefixos pode vazar a senha, então cheque uma vez no envio.

Minha versão local: um arquivo sintético de 1.001.004 linhas (1.000.000 de SHA-1 aleatórios com contagens, 4 senhas inventadas e as senhas do meu dump inventado), no mesmo formato de linha, servido pelo brinquedo como endpoint de range. Como o corpus tem 1M e não centenas de milhões, um bucket guarda cerca de 1 sufixo, não 800. O cadastro usa:

```text
sha1("Summer2026!") = F1DF7 1A9D60CD46A2E09691E504C4E09A4DA9A7A     só "F1DF7" sai da função
Summer2026!                422 | this password appears in a breach corpus, choose another
letmein-test-pw            422 | this password appears in a breach corpus, choose another
zebra-lantern-quietly-42   201 | created
server log: range query: F1DF7 (1 suffixes back) / 310D2 (2 back) / B095D (0 back)
```

Regra para qualquer experimento com a API real: use só uma senha de teste inventada, nunca a senha nem o hash de um usuário real. Para mais privacidade, mantenha uma cópia baixada do corpus (o HIBP oferece um downloader) e consulte offline: a lista de vazamentos é uma checagem de cadastro e de troca de senha, e o NIST também a quer nesses eventos, não numa varredura noturna de hashes guardados que você não consegue reverter mesmo.

### Gerenciadores, passkeys e o fluxo de reset

Gerenciadores de senha resolvem reuso e escolha fraca pela raiz, então permita colar e autofill (o NIST torna isso obrigatório para gerenciadores) e não os bloqueie com scripts. Passkeys removem o segredo compartilhado: o servidor guarda uma chave pública e nada é phishável nem reaproveitável em stuffing (próximas lições desta trilha). Enquanto existirem senhas, o caminho de reset é o elo mais fraco: é uma segunda porta de entrada, tão forte quanto o seu canal. O fluxo do brinquedo, medido:

```text
existing    -> 202 if the account exists, an e-mail was sent
nonexistent -> 202 if the account exists, an e-mail was sent      (mesmo status, mesmo texto)
token length 43 chars (32 random bytes, base64url); server stores only sha256(token)
use 1       -> 200 password changed
use 2       -> 400 invalid or expired token                         (uso único)
after TTL   -> 400 invalid or expired token                         (TTL de 1 s nesta execução; 15 min por padrão)
```

Segundo o Forgot Password Cheat Sheet da OWASP: token de um CSPRNG, longo o bastante, ligado a um usuário, invalidado depois do uso e guardado com hash, com vida curta; não altere a conta até chegar um token válido (para que um estranho não tranque você pedindo resets); responda igual para conta existente e inexistente. Depois do reset, encerre as outras sessões e avise o dono. Um reset por e-mail faz da caixa de entrada uma credencial, e um reset pelo help desk faz de uma pessoa uma credencial: a recuperação de conta como caminho de ataque (e o rebaixamento de MFA) é assunto da lição de ameaças de identidade prevista para esta trilha.

### Ataque, defesa, métrica

| Classe de ataque | O que explora | Defesa do servidor | O que medir ou monitorar |
|---|---|---|---|
| Força bruta online | uma conta, muitos palpites | atraso ou teto por conta, blocklist, MFA | falhas por conta, requisições recusadas antes do hash |
| Quebra offline | tabela vazada, sem limite para o atacante | Argon2id (ou scrypt, bcrypt, PBKDF2), salt único, pepper num KMS | ms por hash, parâmetros do hash por linha, fatia de linhas legadas |
| Dicionário | senhas comuns | blocklist no cadastro, comprimento acima de regras | fatia de contas rejeitadas, top senhas vistas nas falhas |
| Credential stuffing | reuso entre sites | MFA, checagem de senha vazada, sinais de bot e dispositivo | taxa de sucesso de logins de dispositivos novos, rajadas por ASN |
| Password spraying | poucas senhas x muitas contas, abaixo dos limites por conta | blocklist, detecção entre contas, limites por IP e globais, MFA | uma senha em muitas contas, contas distintas por origem |
| Rainbow tables | hashes pré-computados | salt único, KDF lenta | linhas sem salt (devem ser zero) |
| Enumeração de usuário | texto ou tempo diferente por caso | mensagem única, hash falso, mesma resposta no reset | status e latência por usuário existe ou não, em testes |
| DoS por bloqueio duro | contador que tranca o dono | atraso progressivo, caminho de reset que continua funcionando | donos trancados por dia, chamados de suporte |

### Para onde ir

A próxima lição desta trilha acrescenta o segundo fator que torna stuffing e spraying quase irrelevantes, e a lição de passkeys remove o segredo compartilhado. Como o caminho de reset vira o alvo de verdade está na lição de ameaças de identidade prevista para esta trilha. Para as implementações em .NET e Spring do hash desta lição, use os concepts linkados.

## Trade-offs

- **Argon2id contra PBKDF2.** O Argon2id exige memória e é a primeira escolha da OWASP, mas pede um pacote em .NET e Node, e a OWASP aponta o PBKDF2 quando o FIPS-140 é exigido. O PBKDF2 é nativo e amigo do FIPS, e precisa de 600.000 iterações por ser fácil de paralelizar em GPU. Exemplo: 44,5 ms de CPU no PBKDF2 e 10,4 ms no Argon2id nesta máquina, em ajustes "equivalentes".
- **Fator de custo contra capacidade de login.** Dobrar o custo dobra a sua CPU por login e o custo do atacante por palpite. Meça em hardware parecido com o de produção, fique abaixo de cerca de um segundo e ponha o trabalho de hash atrás das recusas baratas (limite de taxa primeiro), senão o hash vira o DoS.
- **Pepper.** Protege uma tabela roubada sozinha (SQL injection, um backup) e custa um segredo para guardar, versionar e girar. Sem KMS ou HSM é teatro.
- **Bloqueio duro contra atraso.** O bloqueio duro barra o palpite e deixa qualquer um trancar qualquer vítima (o 423 acima). Atrasos e checagens por risco custam ao dono alguns segundos. Escolha atrasos e mantenha um caminho de recuperação.
- **Tamanho da blocklist.** Uma lista enorme irrita os usuários e acrescenta pouco, já que o palpite online é limitado; uma lista curta de valores comuns e vazados pega o spray. O NIST concorda.
- **Sem rotação forçada.** Menos trocas previsíveis do tipo `Summer2027!`, e você precisa saber detectar comprometimento e forçar a troca quando surgir evidência.
- **Rehash no login.** Sem resets forçados, e as linhas de quem nunca volta continuam fracas. Expire os inativos ou embrulhe o hash antigo.
- **API de vazamentos contra cópia local.** A API é grátis, atual e k-anonymous (saem 5 caracteres), e traz dependência de rede e confiança num terceiro. A cópia local é privada e pede armazenamento e atualização.

## Documentation Links

- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Password Storage Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (doc)
- [Authentication Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) (doc)
- [Credential Stuffing Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html) (doc)
- [Forgot Password Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) (doc)
- [RFC 9106, Argon2 Memory-Hard Function for Password Hashing, IETF](https://www.rfc-editor.org/rfc/rfc9106) (doc)
- [RFC 8018, PKCS #5: Password-Based Cryptography Specification v2.1, IETF](https://www.rfc-editor.org/rfc/rfc8018) (doc)
- [RFC 7914, The scrypt Password-Based Key Derivation Function, IETF](https://www.rfc-editor.org/rfc/rfc7914) (doc)
- [PHC String Format, Password Hashing Competition](https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md) (doc)
- [Have I Been Pwned API v3, Pwned Passwords, Troy Hunt](https://haveibeenpwned.com/API/v3#PwnedPasswords) (doc)
