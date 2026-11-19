---
version: 1.0
updatedAt: 2026-11-19
title: "Gerenciamento de Sessão: Cookies, Fixação e Revogação"
summary: O que acontece depois do login, medido contra um servidor de sessão de brinquedo em Node 22 sem framework. ID de sessão de 128 bits contra contador, cada atributo do Set-Cookie (HttpOnly, Secure, Path, Domain, Max-Age, prefixos __Host- e __Secure-) com curl, fixação de sessão e a regeneração do ID no login, expiração deslizante contra absoluta, "lembrar-me" com seletor e validador com hash, CSRF com token sincronizado, double submit assinado e Sec-Fetch-Site, logout de verdade, sair de todos os dispositivos, revogação por troca de senha e por SCIM active:false, JWT como cookie de sessão contra os mesmos testes, padrão BFF, Redis compartilhado e a queda do armazenamento, com SameSite e o Continuous Access Evaluation do Entra lidos só na documentação.
---
## Objective

O login prova quem você é uma vez; a sessão é o que mantém o usuário autenticado sem pedir a senha a cada request, e o que você precisa conseguir encerrar. Esta lição monta um servidor de sessão de brinquedo (Node 22, sem framework, 330 linhas, cada defesa é uma chave) e mede ataques e correções com curl: por que o ID de sessão precisa de 128 bits aleatórios, o que cada atributo do `Set-Cookie` muda, a fixação de sessão e sua correção de uma linha, expiração por inatividade contra absoluta, "lembrar-me", CSRF com quatro defesas, logout de verdade, "sair de todos os dispositivos", revogação ao trocar a senha e com o `active:false` do SCIM, JWT como cookie de sessão sob os mesmos testes, um Redis compartilhado e o que acontece quando ele cai. O comportamento do navegador (`SameSite`, prefixos) vem do MDN e dos drafts de cookies e está marcado "docs only", porque o curl não tem a noção de "site". Os mecanismos de logout do OIDC, a rotação de refresh e a limitação de taxa estão medidos nas lições que esta requer ou relaciona, e não se repetem aqui.
Versions: Node 22.23.4, curl 8.7.1, jq 1.7.1, `redis:7.4-alpine` (Docker), cheat sheets de Session Management e CSRF Prevention da OWASP e `draft-ietf-httpbis-rfc6265bis-22` (lidos em 2026-11-19), RFC 10017.

## Use Cases

- Revisar uma funcionalidade de login e listar o que precisa acontecer depois da checagem de senha.
- Decidir entre sessão no servidor e cookie com JWT para uma aplicação de navegador.
- Fazer logout, troca de senha e desativação de conta realmente encerrarem o acesso.
- Explicar por que uma SPA não deve guardar tokens no `localStorage`.

## Deep Dive

### O ID de sessão: 128 bits aleatórios, com hash em repouso (medido)

Uma sessão é um registro no servidor (usuário, `created`, `last`, `authTime`) e um ID que o navegador devolve num cookie. O ID é um segredo ao portador: quem o tem é o usuário, então adivinhá-lo tem que ser inviável. A OWASP pede pelo menos 64 bits de um CSPRNG e 128 quando você mesmo gera. Um contador tem quase nada:

```text
counter ids   : 1001 1002 1003 -> next one is 1004
randomBytes(16): iBf-9BWaTfXbbqng6DYYjA    MAsBdoFd1wyG5zgDWQqP_g    Nf8RkzbiQ_ESJ_huKJH4Aw
128-bit space 3.40e+38; years to hit one of 1e5 live ids at 1e4 guesses/s: 1.08e+22
64 bits = 11 base64url chars (16 hex); 128 bits = 22 base64url chars (32 hex)
```

A mesma conta com 64 bits dá os 585 anos da OWASP. Contra o brinquedo rodando com `ID_GEN=counter`, um atacante que recebe `sid=1002` só precisa andar até o vizinho enquanto a alice entra:

```text
attacker opens the site            -> Set-Cookie: sid=1002
alice logs in (never seen)         -> Set-Cookie: sid=1003 ; {"user":"alice"}
sid=1000 -> not authenticated   sid=1002 -> not authenticated   sid=1003 -> {"user":"alice"}
```

`Math.random()` não é melhor: o MDN diz que ele não fornece números criptograficamente seguros. Use `crypto.randomBytes(16)` (ou o gerador do framework), e não um timestamp, um hash do nome do usuário ou qualquer coisa com parte fixa: a OWASP lembra que metade fixa de um ID corta os bits pela metade. O brinquedo indexa o armazenamento por `sha256(id)`, então um dump do Redis ou uma linha de log não entrega cookies que funcionem (OWASP: guarde um verificador de mão única quando a leitura do armazenamento por terceiros está no seu modelo de ameaça).

### Sessão no servidor contra JWT como sessão (medido)

O brinquedo também pode pôr um JWT assinado (HS256, `node:crypto`) no cookie. Mesmo atacante, mesmos testes (uma cópia roubada do cookie, guardada por alguém que a farejou antes do logout):

```text
JWT, no revocation check   logout -> victim browser: malformed   stolen copy: {"sub":"alice"}   (valid until exp)
JWT + deny list by jti     logout -> stolen copy: {"error":"denied jti"}
JWT + users.alice.ver      admin bumps ver -> victim and stolen copy: {"error":"stale ver"}
rotate the HS256 key       same token: {"error":"bad signature"}   (every user logged out at once)
cookie size  0 extra claims: 243 B   20: 896 B   60: 2229 B   server session id: 22 B
```

O logout só limpou o cookie da vítima: o token continuou funcionando para quem o copiou, até o `exp`. As duas correções são a parte instrutiva: lista de negação por `jti` e versão por usuário são ambas uma consulta ao servidor a cada request, ou seja, um armazenamento de sessão com passos extras. O cookie também tem teto: o draft de cookies diz que o agente de usuário ignora um `Set-Cookie` cujo nome mais valor passe de 4096 octetos, então tokens cheios de claims simplesmente param de funcionar (a lição do BFF em .NET mediu a mesma divisão em 4 KB). O ID no servidor vence para sessão de navegador porque apagar uma linha é revogar. JWT serve para chamadas de API entre serviços, com vida curta (a lição de IAM compara os dois), e rotação de refresh e logout tokens estão nas lições de OAuth e OIDC.

### Set-Cookie, atributo por atributo (curl medido, navegador só docs)

`/set?c=...` faz o brinquedo emitir exatamente o header pedido, por HTTPS (autoassinado, `curl -k`) e por HTTP puro, com o host `foo.test` mapeado para 127.0.0.1 via `--resolve`. O que o mecanismo de cookies do curl guarda e envia:

```text
HttpOnly                    jar line "#HttpOnly_foo.test ..." ; curl still sends it
Secure                      https: sid=a | plain http: none      (no Secure: sent on both)
Path=/echo                  /cookies: none | /echo/x: sid=a | /echo2: none
no Domain                   foo.test: sid=a | a.foo.test: none   (host-only)
Domain=foo.test             foo.test: sid=a | a.foo.test: sid=a  (subdomains included)
Domain=example.com          (set by foo.test) cookies stored: 0
Max-Age=3600                jar expiry minus now = 3600 s
Set-Cookie: sid=; Max-Age=0 -> cookie sent: none, stored: 0
Max-Age=3600 + Expires=1970 -> stored: 1 (Max-Age wins)
__Host-sid=a; Secure; Path=/                       stored 1
__Host-sid=a; Secure; Path=/; Domain=foo.test      stored 0
__Host-sid=a; Secure; Path=/x                      stored 0
__Host-sid=a; Path=/ (no Secure)                   stored 0
__Secure-sid=a; Secure -> stored 1        __Secure-sid=a (no Secure) -> stored 0
```

Um cookie vai num request quando host, caminho e esquema casam; o `HttpOnly` só o esconde do `document.cookie` (MDN: ele continua sendo enviado pelo `fetch`, então impede que o XSS leia o ID, não que o XSS use a sessão). O `Domain` é o botão perigoso: alarga o cookie para todos os subdomínios, e a OWASP manda deixá-lo de fora. Os prefixos fazem o navegador impor as regras: `__Host-` exige `Secure`, sem `Domain`, `Path=/`, o que também impede um subdomínio irmão de sobrescrever o cookie (o curl 8.7.1 as aplicou, como a tabela mostra). `Max-Age` vence `Expires`, uma vida independente de relógio; o draft recomenda que navegadores limitem a vida a 400 dias.

O `SameSite` é o único atributo que o curl não consegue mostrar (ele não tem "site"), então é só docs. MDN e o cheat sheet de CSRF: `Strict` retém o cookie em todo request cross-site, inclusive o clique num link para o seu site; `Lax` envia em navegações de topo com métodos seguros (GET); `None` sempre envia e exige `Secure`. Um cookie sem `SameSite` é Lax no Chromium, não no Firefox nem no Safari, e navegadores com "Lax por padrão" enviam o cookie em POSTs de topo cross-site por cerca de dois minutos depois de ele ser criado, então declare sempre explicitamente. O cookie de sessão para entregar:

```text
Set-Cookie: __Host-sid=<22 chars>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
```

Strict é mais forte, mas o usuário que segue um link de e-mail chega sem o cookie e parece deslogado até o clique seguinte. A RFC 10017 (BFF) pede `SameSite=Strict` e o prefixo `__Host-Http-` (MDN: como o `__Host-`, e o cookie tem que ser `HttpOnly`, provando que veio de um header).

### Fixação de sessão (medido)

Na fixação o atacante não rouba o ID: ele o escolhe. Planta um ID conhecido no navegador da vítima (um link com o ID na URL, um cookie definido por um subdomínio irmão, uma injeção de header), espera a vítima entrar, e a sessão que ele já conhece passa a estar autenticada. O brinquedo ingênuo (`STRICT=0 REGEN=0`: aceita qualquer ID e o mantém no login):

```text
attacker plants sid=attacker-chosen-id-123
victim logs in sending that cookie:   Set-Cookie: sid=attacker-chosen-id-123  {"user":"alice","regenerated":false}
attacker, holding only that id:       {"user":"alice","via":"login"}
```

Duas correções independentes, e a tabela mostra por que as duas importam:

| Servidor | ID plantado | Resultado |
|---|---|---|
| aceita qualquer ID, sem regeneração | inventado | o atacante é a alice |
| aceita qualquer ID, regenera no login | inventado | `Set-Cookie: sid=nLHKhV...`, atacante 401 |
| estrito (só IDs que emitiu), sem regeneração | inventado | ID novo emitido, atacante 401 |
| estrito, sem regeneração | um ID anônimo real que o atacante pegou no site | `regenerated:false`, o atacante é a alice |
| estrito e regenerando (padrão) | ID anônimo real | ID novo, `{"error":"not authenticated"}` |

O modo estrito sozinho falha contra um atacante que antes obtém uma sessão anônima real, coisa que todo site entrega. A cura é a que a OWASP afirma: renovar o ID no login e em qualquer mudança de privilégio, e destruir o antigo. O log mostra: `session.create user:null`, depois `session.destroy why:"regenerate at login"`, depois `session.create user:"alice"`. Aceite também IDs só de cookies (nunca de parâmetro de URL) e mantenha o cookie `__Host-`, para que um subdomínio não consiga plantar um.

### Expiração: por inatividade contra absoluta (medido)

O brinquedo tem `IDLE_MS` (zerado a cada request) e `ABS_MS` (contado da criação), reduzidos a 2 s e 6 s dos usuais 15 minutos e 8 horas. A OWASP dá de 2 a 5 minutos de inatividade para apps de alto valor, de 15 a 30 para baixo risco, e de 4 a 8 horas absolutas para um dia de trabalho.

```text
A) a request every second:   t=1..5 s ok;  t=6 s, 7, 8: {"error":"not authenticated"}   -> session.destroy why:"absolute"
B) fresh login, 3 s of silence:                                                         -> session.destroy why:"idle"
```

A expiração por inatividade limita a janela de um notebook esquecido, mas não a de um sequestrador que mantém a sessão aquecida (a execução A é exatamente um script chamando a cada segundo); a absoluta limita o sequestro aconteça o que acontecer. Mantenha as duas, imponha as duas no servidor (fechar o navegador não é sinal confiável: a restauração de sessão mantém cookies de sessão, segundo o MDN), e no Redis o TTL é `min(idle, absoluto restante)`, então o armazenamento esquece sozinho. A reautenticação para ações sensíveis é um terceiro relógio: com `authTime` mais antigo que `REAUTH_S`, uma transferência de 600 devolveu `{"error":"reauth_required","max_age":2}`; `POST /reauth` com a senha emitiu um ID novo, o ID antigo passou a dar 401 e a transferência então passou. Isso é step-up, e o ID também muda ali (elevação conta como mudança de privilégio).

### Lembrar-me: uma segunda credencial (medido)

"Manter conectado por 30 dias" não pode ser um ID de sessão de 30 dias: esse ID estaria a um cookie roubado de um mês de acesso, e seria guardado como o de uma sessão curta. O desenho comum é um cookie persistente à parte, `rm=<seletor>.<validador>`: o seletor (72 bits aleatórios) acha uma linha, o validador (192 bits) é comparado com o `sha256(validador)` guardado na linha, com `timingSafeEqual`, de modo que um vazamento do banco não dá nenhum cookie utilizável. Ele é trocado por uma sessão normal nova e rotacionado a cada uso:

```text
session idle-expired, /me with sid only:        {"error":"not authenticated"}
/me with the rm cookie (browser reopened):      {"user":"alice","via":"remember"}      (new sid and new rm issued)
real selector, guessed validator:               {"error":"remember token reuse: all sessions revoked"}
login again, rotate, then replay the OLD rm:    {"error":"remember token reuse: all sessions revoked"}
log: session.revokeAll why:"remember-me theft signal" and why:"remember-me reuse"
```

A linha de um token já usado fica como lápide, para que um replay seja reconhecido em vez de parecer um seletor desconhecido, e um sinal de roubo derruba tudo daquele usuário. É a mesma detecção de reuso da rotação de refresh token (lição de OAuth), com o mesmo custo: um cliente instável que reenvia um token desloga o usuário. Trate o login por lembrar-me como confiança menor: ações sensíveis ainda pedem a senha (o step-up acima).

### CSRF: o navegador anexa o cookie por você (medido)

Um cookie vai em todo request ao seu host, seja quem for que causou o request. Uma página em `evil.test` que envia sozinha um formulário para `/transfer` faz o navegador anexar o cookie da alice. O `/transfer` do brinquedo com os headers cross-site que um navegador poria:

```text
no defense:        POST /transfer (Origin: http://evil.test, Sec-Fetch-Site: cross-site) -> alice 900, mallory 100
synchronizer token (random token inside the session, header X-CSRF-Token):
   no token / wrong token  -> 403 {"error":"csrf","why":"csrf token missing or wrong"}
   token from /csrf-token  -> 200 transfer
naive double submit (cookie csrf must equal header):
   attacker plants csrf=x and sends X-CSRF-Token: x       -> 200, mallory 100   (defeated)
signed double submit (token = HMAC(secret, session id), cookie and header must both match):
   attacker plants csrf=x                                 -> 403 signed double submit mismatch
   server-issued pair                                     -> 200
   a valid-looking pair that is not bound to this id      -> 403
Fetch Metadata / Origin, no token at all:
   Sec-Fetch-Site: cross-site  -> 403 ; only Origin: http://evil.test -> 403 ; same-origin -> 200
   neither header (curl)       -> 200   (not a browser: nobody is riding the victim's cookie)
```

Cada defesa responde a uma pergunta diferente. O token sincronizado exige estado de sessão mas é difícil de forjar (a primeira escolha da OWASP para apps com estado). O double submit ingênuo é sem estado e quebra quando o atacante consegue escrever um cookie (um subdomínio irmão, injeção em HTTP puro, cookie sem `__Host-`), por isso a OWASP hoje recomenda a variante assinada e ligada ao ID da sessão. O Fetch Metadata (`Sec-Fetch-Site`, enviado por todos os navegadores principais desde março de 2023 segundo a OWASP) não pede mudança no cliente, mas pede o fallback por `Origin` e quebra quando um proxy remove os headers; acrescente `Vary: Sec-Fetch-Site, Origin` nas respostas que dependem deles. O `SameSite` ajuda, mas a OWASP é explícita: é defesa em profundidade. O `GET /transfer?to=mallory&amount=50` do brinquedo é enviado por um cookie Lax numa navegação de topo e moveu 50, então mudança de estado em GET é CSRF qualquer que seja o cookie, e "mesmo site" cobre todo subdomínio do domínio registrável. Um header customizado como o `X-CSRF: 1` (a lição do BFF em .NET) também funciona para APIs só de fetch, porque um request cross-origin com ele exige um preflight de CORS.

### Logout de verdade, sair de todos os dispositivos, desligados (medido)

Apagar o cookie não é fazer logout. O brinquedo com `LOGOUT_SERVER=0` limpa o cookie na resposta e deixa o registro; o mesmo request contra o padrão:

```text
cookie-only logout:  victim browser: not authenticated | stolen copy of the cookie: {"user":"alice"}
server-side logout:  victim browser: not authenticated | stolen copy:                not authenticated
```

OWASP: apagar um cookie não invalida uma cópia roubada, e depois do logout nenhum dos IDs pode ser aceito. O resto é a mesma primitiva, "apagar linhas" (`u:<usuário>` indexa os hashes das sessões do usuário):

```text
GET /sessions                  -> [{"id":"ee1a0843","current":true,"ua":"Mozilla/5.0 (Macinto"},
                                   {"id":"a3ab7c86","current":false,"ua":"Mozilla/5.0 (iPhone)"}, {"id":"5cd9225f",...,"ua":"curl/8.7.1"}]
DELETE /sessions/a3ab7c86      -> phone now: not authenticated
POST /logout-all               -> {"revoked":2}   laptop and work: not authenticated
POST /password (from laptop)   -> {"revokedOthers":1}; phone dead, laptop's old id dead, new id works
SCIM PATCH active:false (bearer scim-secret) -> {"active":false,"revoked":2}; bob's session dead, login: bad credentials
POST /backchannel-logout sid=IDP-77 -> {"deleted":2}   (toy of the OIDC logout token: sessions indexed by the IdP `sid`)
```

A lista é um recurso que a OWASP recomenda (IP, user agent, criação, último uso e um jeito de encerrar uma). A troca de senha tem que encerrar as outras sessões e rotacionar o ID de quem chamou, porque a senha é o que o atacante pode ter usado. O caso do desligado liga ao ciclo de vida das lições anteriores: quando o IdP desativa a conta (o `active:false` da lição de SCIM), o app tem que derrubar as sessões naquele momento, e o brinquedo ainda confere `active` a cada consulta, o que cobre uma chamada perdida. Sem as duas coisas, um funcionário desligado mantém uma sessão funcionando até o timeout de inatividade.

### SSO, sessões encadeadas e o BFF

Com SSO há duas camadas de sessão: o cookie do IdP e um por app. Sair de um app não faz nada nos outros a menos que o IdP avise, que é o que o logout front-channel (iframe, depende do navegador) e o back-channel (POST servidor a servidor com um `sid`) fazem; a lição de OIDC mediu os dois. O índice `idp_sid` do brinquedo é o mínimo de que o app precisa: mapear o ID de sessão do IdP para os hashes das sessões locais e apagá-los quando a notificação chega. Lembre que sair só do app deixa a sessão do IdP viva, então o próximo desafio entra de novo sem pedir nada.

Uma single-page app tem um problema pior: todo token que o JavaScript consegue ler fica exposto a XSS, e a OWASP diz sem rodeio para não guardar tokens nem IDs de sessão em `localStorage` ou `sessionStorage`. A RFC 10017 (o BCP de apps de navegador, antes um Internet-Draft) descreve o "persistent token theft": um script lendo o token a cada 10 segundos derrota vidas curtas e rotação de refresh, porque o atacante sempre tem o último. A arquitetura que ela recomenda é o BFF: o navegador só guarda um cookie de sessão `HttpOnly`, o BFF é o cliente OAuth confidencial, guarda os tokens de acesso e de refresh no registro da sessão e acrescenta o bearer ao encaminhar as chamadas. O `/bff/*` do brinquedo (a troca OAuth substituída por um login de mentira, coberta na lição de OAuth) mediu o formato:

```text
cookies the browser holds:      sid (HttpOnly) only, no token anywhere in a body or header (0 matches for "at-")
/bff/orders, cookie, no header: 400 {"error":"missing X-CSRF header"}
/bff/orders, cookie + X-CSRF:   200 {"orders":[1,2,3],"saw":"Bearer at-1-yJR..."}   (the resource server saw the bearer)
resource server with the cookie only: 401 no bearer
```

O XSS ainda pode mandar requests como o usuário pelo BFF enquanto a página está aberta, mas não consegue levar um token embora, e logout ou revogação mata o registro. A implementação em ASP.NET Core (handlers OIDC, cookie `__Host-`, `SaveTokens`, YARP) está na lição de OIDC, Entra ID e BFF da trilha .NET.

### Sessões em escala: armazenamento compartilhado, afinidade e a queda dele (medido)

Duas instâncias do brinquedo com memória própria se comportam como dois apps atrás de um balanceador round-robin:

```text
in-memory:  login on A -> request to A ok | the same cookie to B: not authenticated | restart A: not authenticated
Redis (STORE=redis, SET key PX ttl):  login on A -> request to B ok | restart A: ok | logout on B -> request on A: not authenticated
keys: sess:db3f2923883b... (sha256 of the id), u:alice   PTTL 899876 ms = idle timeout, not the 8 h absolute
```

As opções: sessões fixas (afinidade por cookie, uma instância é dona do usuário: simples, mas reinício ou redução de réplicas perde a sessão; a lição de hospedagem de MCP mediu afinidade por cookie em 20 de 20 e um 404 depois do `docker restart`), armazenamento compartilhado (Redis ou banco: qualquer instância atende qualquer request e o logout é global, ao preço de um salto de rede por request), ou o próprio cookie guardando o estado (cifrado e assinado, sem armazenamento, mas a revogação e o tamanho voltam). Serialize o registro num formato versionado, porque um deploy que muda o formato ainda precisa ler as sessões antigas.

O armazenamento vira dependência de todo request. Parar o Redis fez a requisição autenticada devolver `503 {"error":"session store unavailable"}`, e o `/` anônimo, que precisa criar um registro, também, enquanto o `/health` seguiu respondendo: fail closed. Falhar aberto (tratar a falta do armazenamento como "válido") transformaria uma queda em bypass de autenticação, então não faça. Depois do `docker start` o cookie voltou a funcionar (parada graciosa, e `appendonly` estava `no`); uma queda brusca sem persistência pode perder sessões (não medi), o que para sessões muitas vezes é aceitável: o usuário entra de novo.

### Sinais para reavaliar a sessão

Uma sessão pode ser questionada depois do login. Sinais baratos: mudança de user agent (o `BIND=ua` do brinquedo mata a sessão no primeiro desencontro, e um atacante que copia o header o derrota, então é um alarme e não um controle), mudança de IP ou de país, viagem impossível, dispositivo novo, um pedido de ação sensível (o step-up acima, `max_age` e `acr` na lição de OIDC). Amarrar ao IP quebra em redes móveis. A ideia mais forte é deixar o IdP empurrar eventos: o Continuous Access Evaluation da Microsoft (docs only, não medido, exige um tenant) permite que serviços como Exchange Online e SharePoint assinem eventos críticos (usuário desativado ou excluído, troca ou reset de senha, MFA habilitado, um administrador revogando todos os refresh tokens, risco alto do usuário) e políticas de localização e os apliquem quase em tempo real; a documentação diz que a latência pode chegar a 15 minutos, e sessões CAE recebem access tokens de até 28 horas porque a revogação, e não uma expiração curta, é que os encerra. É o padrão desta lição (um canal de revogação) aplicado a tokens bearer.

### Ameaça, mecanismo, defesa, o que medir

| Ameaça | Mecanismo | Defesa | O que medir |
|---|---|---|---|
| Adivinhar o ID | ID previsível ou curto | ID de 128 bits de CSPRNG, com hash em repouso | IDs de `randomBytes`, sem contador, taxa de IDs desconhecidos |
| Fixação | aceitar ou manter um ID plantado | regenerar no login e na elevação, só cookie, `__Host-` | log: destroy antes do create no login |
| Roubo do ID (rede) | HTTP puro, sem `Secure` | `Secure`, HSTS, `__Host-` | cookie nunca enviado por http |
| Roubo do ID (XSS) | script lê o cookie ou o token | `HttpOnly`, sem tokens em web storage, BFF | nenhum token em body ou storage |
| CSRF | o navegador anexa o cookie | `SameSite`, token (sincronizado ou double submit assinado), `Sec-Fetch-Site`, sem mutação em GET | POST forjado leva 403, GET é seguro |
| Sequestro longo | sessão mantida aquecida | timeout absoluto, step-up, sinais | idade da sessão ao destruir, motivos |
| Logout que não é | só o cookie é limpo | apagar no servidor, back-channel no SSO | cópia roubada devolve 401 |
| Desligado ou reset | sessão sobrevive à conta | revogar no `active:false`, na troca de senha, logout-all | sessões vivas por usuário desativado = 0 |
| JWT sem revogação | validação sem estado | sessão no servidor, ou lista de negação, `ver`, TTL curto | token revogado devolve 401 |
| Queda do armazenamento | dependência de estado compartilhado | fail closed, réplicas, TTLs curtos | taxa de 503, latência do armazenamento |

Próximo na trilha: ameaças de identidade (I19) cobre o que os atacantes fazem com contas e sessões (roubo de token e de cookie, adversary-in-the-middle, abuso de recuperação de conta), e modelos de autorização (I15) cobre o que uma sessão autenticada pode fazer, coisa que a sessão não responde.

## Trade-offs

- **Sessão no servidor contra cookie assinado ou JWT.** A sessão no servidor é revogável e minúscula, e custa uma consulta ao armazenamento e uma dependência operacional; um token sem estado escala sem armazenamento e não pode ser revogado antes do `exp` (medido: a cópia roubada ainda funcionou), então acrescentar lista de negação ou `ver` traz a consulta de volta.
- **Strict contra Lax.** Strict fecha mais CSRF e quebra o primeiro request vindo de um link externo (o usuário parece deslogado); Lax mantém os links funcionando e permite GET cross-site, então nenhum GET pode mudar estado.
- **Tamanho do timeout de inatividade.** Curto é mais seguro e custa logins; longo agrada o usuário e alarga a janela. A OWASP sugere de 2 a 5 minutos para apps de alto valor e de 15 a 30 para baixo risco, sempre com um teto absoluto.
- **Lembrar-me.** Conveniência de um mês contra uma credencial persistente: mantenha à parte, com hash, rotacionada, e nunca suficiente para uma ação sensível.
- **Sessões fixas contra armazenamento compartilhado.** Afinidade é uma flag de configuração, mas perde sessões em reinício e redução de réplicas; um armazenamento acrescenta um salto e um modo de falha (fail closed, planeje a capacidade), e dá logout global.
- **Renovação do ID durante a sessão.** Rotacionar o ID no meio da sessão (o renewal timeout da OWASP) encolhe a janela de roubo e pode disputar com requests paralelos; mantenha o ID antigo por um curto período de tolerância.

## Documentation Links

- [Session Management Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) (doc)
- [Cross-Site Request Forgery Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) (doc)
- [RFC 6265, HTTP State Management Mechanism (Cookies), IETF](https://datatracker.ietf.org/doc/html/rfc6265) (doc)
- [Cookies: HTTP State Management Mechanism, draft-ietf-httpbis-rfc6265bis, IETF](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) (doc)
- [Set-Cookie header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) (doc)
- [Sec-Fetch-Site header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) (doc)
- [RFC 10017, OAuth 2.0 for Browser-Based Applications, IETF](https://datatracker.ietf.org/doc/html/rfc10017) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [OpenID Connect Back-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-backchannel-1_0.html) (doc)
- [Continuous access evaluation, Microsoft Entra, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation) (doc)
