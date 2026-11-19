---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A maioria dos vazamentos de identidade não quebra criptografia: atravessa uma brecha no modelo de confiança. Uma senha capturada por phishing, um cookie de sessão levado depois do prompt de MFA, um push aprovado às 3 da manhã, um app OAuth que o usuário foi convencido a autorizar, um atendente de help desk que redefine a pessoa errada: cada caso é um controle que funciona como projetado ao lado de uma suposição que não vale. Esta lição é defensiva. Ela nomeia cada ameaça como uma classe (mecanismo em um parágrafo, o controle que ela contorna, a defesa e o sinal que a detecta) e mede apenas defesas contra serviços de brinquedo meus, nesta máquina: uma sessão que funciona de outro cliente e deixa de funcionar quando presa a uma chave de dispositivo, um fluxo de recuperação de conta antes e depois de quatro controles, um detector de 60 linhas sobre um log gerado e uma concessão de consentimento com sua revogação num Keycloak local. Nenhum kit de phishing, proxy ou ladrão de tokens é construído ou descrito passo a passo. O fim traz os frameworks (IDs do MITRE ATT&CK, NIST SP 800-63B-4, CISA) e uma tabela que serve de checklist de revisão.
Versions: Node 22.23.4, Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`), curl 8.7.1, jq 1.7.1, OpenSSL 4.0.3; NIST SP 800-63B-4, MITRE ATT&CK, fact sheet da CISA, documentação do Microsoft Entra (tudo lido em 2026-11-19).

## Use Cases

- Responder "temos MFA, como entraram?" com o caminho específico: login retransmitido, sessão roubada, concessão de consentimento ou o fluxo de recuperação.
- Escrever as regras de detecção e o checklist de incidente de uma conta comprometida antes do incidente, sabendo o que cada regra deixa passar.
- Decidir onde investir o próximo trimestre: passkeys para administradores, vínculo de token, política de consentimento ou o fluxo de reset.

## Deep Dive

### Leia toda ameaça do mesmo jeito

Cada seção responde quatro perguntas: qual é o mecanismo, qual controle ela contorna, qual é a defesa, o que aparece no log. As lições anteriores desta trilha são donas dos controles; esta trata de como eles falham, então linka em vez de repetir: a lição de MFA (fatores, o relay AiTM em dois parágrafos), a de WebAuthn (origin binding, medido), a de senhas (stuffing e spraying, medido), a de sessões (cookies, revogação) e a de segurança OAuth (DPoP e mTLS, medido).

### Phishing e a escala de resistência

Phishing leva o usuário a entregar um segredo ou uma aprovação a quem não é o site real. Tudo o que o usuário pode digitar ou aprovar pode ser entregue: senha, código SMS, código TOTP, aprovação de push. O NIST SP 800-63B-4 define resistência a phishing como impedir "a divulgação de segredos de autenticação e saídas válidas do autenticador a um verificador impostor" e diz que autenticadores com digitação manual de uma saída (OTP, fora de banda) "NÃO DEVEM ser considerados resistentes a phishing". Ele reconhece dois métodos: channel binding (TLS com autenticação do cliente) e verifier name binding (WebAuthn: a assinatura cobre a origem real). A lição de WebAuthn mediu o segundo: uma origem parecida não rende nada reutilizável, enquanto um código TOTP retransmitido foi aceito. A fact sheet da CISA ordena as formas da mais forte à mais fraca: resistentes a phishing (FIDO/WebAuthn, baseado em PKI), depois OTP de app ou token e push com number matching, depois push sem ele, e por último SMS e voz. Ela chama FIDO/WebAuthn de "a única autenticação resistente a phishing amplamente disponível". O resto desta lição é o que sobra quando um fator mais abaixo nessa escala está em uso, ou quando o atacante evita o login por completo.

### AiTM: a sessão é roubada depois que o MFA tem sucesso

Mecanismo, em um parágrafo: o usuário é atraído para um endereço parecido que fica entre ele e o site real e retransmite toda a conversa, então o usuário vê a página genuína, completa o MFA genuíno e o intermediário termina segurando a sessão que o site real emitiu. A lição de MFA mostra por que um código TOTP não distingue o caso (o verificador aceitou um código enviado com `Origin` estrangeiro). Controle contornado: qualquer MFA que não resista a phishing. O que foi roubado não é a senha, e sim a sessão depois do MFA, então um segundo fator mais forte no próximo login não ajuda a sessão que já está na mão do atacante.

Defesas, na ordem em que compensam:

1. Passkeys ou chaves de segurança FIDO2 no login: a origem faz parte do que é assinado, então o relay não tem nada a encaminhar. Isso elimina o phishing, não o roubo posterior de sessão por malware.
2. Prender a sessão a algo que o ladrão não consegue copiar: uma chave de dispositivo (DPoP, RFC 9449, ou mTLS, RFC 8705, ambos medidos na lição de segurança OAuth; para cookies de navegador, Device Bound Session Credentials, um rascunho do W3C que se descreve como "um rascunho muito inicial", só docs; Entra Token Protection, só docs: tokens de sessão de login presos ao dispositivo registrado, disponibilidade geral para apps nativos em Windows, iOS e macOS e preview para alguns apps web).
3. Conditional Access que exige dispositivo conforme ou gerenciado (só docs), tempos de vida curtos e reavaliação contínua da sessão (CAE, veja a lição de sessões).
4. Detecção da mesma sessão usada de dois clientes, abaixo.

#### Demo de defesa: o cookie como bearer, depois preso a uma chave (medido)

Um servidor de brinquedo meu (`node:http`, porta 6720). O segundo fator é um stub, porque o laboratório trata do que acontece depois dele. Um login gera um cookie. Em `BIND=none` a sessão é um bearer simples; em `BIND=key` o login também registra a chave pública do dispositivo (ES256) e toda requisição precisa carregar uma assinatura sobre horário, método, caminho e hash da sessão. A checagem é uma prova estilo DPoP, 8 linhas:

```js
const [ts, sig] = (req.headers['x-proof'] || '').split('.');
if (!sig || Math.abs(now() - Number(ts)) > 30000) return 'proof missing or stale';
if (seen.has(sig)) return 'proof replayed';
const data = `${ts}.${req.method}.${req.url}.${sha(sid)}`;
if (!verify('sha256', Buffer.from(data), { key: s.key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))) return 'bad proof signature';
seen.add(sig); return null;
```

O cliente "dispositivo" guarda a chave privada. O "outro cliente" tem só o valor do cookie, que é exatamente o que uma cópia da sessão dá a qualquer pessoa:

```text
BIND=none                                         BIND=key
device, with proof        -> 200 balance 1000     200 balance 1000
other client, cookie only -> 200 balance 1000     401 proof missing or stale
other client, forged proof-> 200 balance 1000     401 bad proof signature
same valid proof sent again -> 200 balance 1000   401 proof replayed
```

Um cookie bearer copiado é a credencial. Preso a uma chave, a cópia não serve sem a chave privada, e uma prova capturada vale uma vez, numa requisição. Limites, ditos com clareza: isso impede a exfiltração, não o uso. Um malware no dispositivo pode pedir ao dispositivo (ou ao TPM) que assine requisições, então ainda age dali enquanto durar a infecção; a chave de dispositivo protege contra copiar o cookie para outra máquina, que é o caso comum. As provas aqui são um brinquedo na camada da aplicação; uma implantação real usa o padrão (DPoP, mTLS) ou o recurso da plataforma.

### Fadiga de MFA (push bombing)

Mecanismo: com uma senha válida, o atacante dispara prompts de push até o usuário tocar em Aprovar para fazê-los parar, ou aprovar um que parece rotineiro. Contorna o MFA que é um toque de sim ou não. Defesas (detalhes na lição de MFA): number matching para que Aprovar não seja cego (o Entra habilita number matching em todas as notificações push do Authenticator, só docs), contexto no prompt, limite de prompts desde o último sucesso (NIST: "DEVERIA implementar um limite razoável"), alertas por contagem de prompts e migração dos usuários para passkeys. Sinal: muitos prompts em pouco tempo, a maioria negada ou sem resposta, depois uma aprovação de um IP ou dispositivo novo. A regra R1 abaixo marca 5 prompts em 10 minutos com 3 negações.

### Roubo de token e de sessão (infostealers)

Mecanismo, como classe: um malware ou extensão maliciosa na máquina do usuário lê o armazenamento de cookies ou o cache de tokens do navegador e o envia para fora; o atacante o reaproveita em outro lugar. Contorna tudo o que aconteceu no login, MFA incluído, porque o cookie de sessão "é" a autenticação até expirar ou ser revogado (a lição de sessões mediu que uma cópia roubada sobrevive a um logout só de cookie e a um JWT sem deny list). Defesas: vincular o token (acima), tokens de acesso curtos com rotação de refresh (RFC 9700), revogação no servidor que realmente apaga a sessão (lição de sessões), step-up em ações sensíveis, conformidade do dispositivo e controles no endpoint (EDR, sem administrador local, política de navegador e extensões; só docs aqui). Sinal: o mesmo id de sessão em dois IPs ou user agents, um país novo no meio da sessão, padrões de acesso diferentes (download em massa, regras de caixa de correio). O log de brinquedo da demo acima, passado à regra R4 do detector:

```text
BIND=none: [{"rule":"session_reuse","user":"alice","why":"63265ec2: 203.0.113.10/VictimBrowser/1 then 198.51.100.77/curl/8.7.1"}]
BIND=key : o mesmo alerta, causado pelas duas requisições NEGADAS (proof missing, bad signature)
```

Vínculo e detecção não são alternativas: mesmo quando o vínculo bloqueia a cópia, as tentativas negadas são o melhor sinal de que um cookie vazou. Um atacante que também copia o user agent derrota uma checagem de UA (a lição de sessões disse isso: um tripwire, não um controle); o IP e as negações não dependem disso.

### Consent phishing: sem senha, sem MFA

Mecanismo: o atacante registra uma aplicação OAuth e manda ao usuário um link para a tela de consentimento dela. O usuário, já autenticado e passando pelo MFA de sempre, clica em Aceitar. O app agora tem uma concessão (e muitas vezes um refresh token) que lê e-mail, arquivos ou contatos com as permissões do próprio usuário e sem nenhum segredo roubado. Contorna MFA e troca de senha por inteiro: a "credencial" é a concessão, então redefinir a senha não a remove. A defesa é sobretudo política de plataforma, não vigilância do usuário.

O que o Microsoft Entra oferece (só docs, sem tenant aqui): desabilitar o consentimento do usuário ou permiti-lo por política. A política embutida `microsoft-user-default-low` permite consentimento "apenas para apps de publishers verificados e apps registrados no seu tenant, e apenas para permissões que você classifica como de baixo impacto"; `microsoft-user-default-legacy` deixa os usuários consentirem a qualquer permissão que não exija consentimento do admin. A Microsoft recomenda permitir consentimento do usuário só para apps de publisher verificado. Quando usuários não podem consentir, o fluxo de consentimento do administrador (admin consent workflow) deixa-os pedir uma revisão. Para remover acesso, admins revogam no portal as permissões concedidas por admin, mas "você não pode revogar permissões na aba User consent pelo portal", só com Graph ou PowerShell (e o script de exemplo também revoga os refresh tokens dos usuários do app).

O que o Keycloak oferece, medido na 26.8.2 com um cliente `pdf-tools` (`consentRequired: true`, público, PKCE) e o usuário `alice`:

```text
1. consent before any grant:  []
2. code flow, scope 'openid profile email offline_access'
   consent screen, "Do you grant these access privileges?" lists: User profile,Offline Access,Email address
3. the grant as the admin sees it (GET /admin/realms/thr/users/{id}/consents):
   [{"clientId":"pdf-tools","grantedClientScopes":["profile","offline_access","email"],
     "additionalGrants":[{"client":"838ad2c7-...","key":"Offline Token"}]}]
4. refresh token works: 200
6. DELETE /admin/realms/thr/users/{id}/consents/pdf-tools -> 204        7. grants after revoke: []
8. the old (offline) refresh token after revoke: 400 invalid_grant "Offline user session not found"
9. same app without offline_access: consent lists User profile, Email address; grant has no additionalGrants
10. DELETE consent -> 204; the online refresh token: 400 invalid_grant "Session doesn't have required client"
    the access token issued before, at userinfo: 401; but the JWT still has 299 s to run
11. alice's Keycloak SSO session after the revoke: still there (1 session)
```

O que isso ensina: a Admin API mostra a concessão (cliente, escopos, offline token) e uma chamada a remove e mata o refresh token, offline ou não. O access token que já está na mão do atacante vive até o `exp` (300 s aqui) em qualquer resource server que só confira a assinatura, e a sessão do próprio usuário no IdP continua, então revogar uma concessão não é "sair". O que não faz: dado já lido continua lido. No Keycloak, `fullScopeAllowed: false` e escopos por cliente limitam o que o token pode carregar, e a tela de consentimento só aparece para clientes marcados com `consentRequired`, então um cliente sem consentimento (um app próprio, por exemplo) nunca a mostra. Não encontrei na documentação do Keycloak um conceito de publisher verificado nem uma configuração em nível de tenant do tipo "o admin precisa aprovar todo app novo" (não documentado). No registro de clientes, o registro dinâmico anônimo com as políticas padrão do realm está fechado:

```text
POST /realms/thr/clients-registrations/default (no token) -> HTTP 403
{"error":"insufficient_scope","error_description":"Policy 'Trusted Hosts' rejected request to client-registration service. Details: Host not trusted."}
anonymous policies: Allowed Client Scopes; Allowed Protocol Mapper Types; Allowed Registration Web Origins; Consent Required; Default Roles Disabled; Full Scope Disabled; Max Clients Limit; Trusted Hosts
```

A documentação explica o porquê: nenhum host está na lista por padrão, então o registro anônimo está "de fato desabilitado". A lista é o checklist para realms que abrem registro (segundo a documentação, a política `Consent Required` faz todo cliente recém-registrado mostrar a tela de consentimento; não exercitado aqui; as `Client Policies` cobrem mais que o registro, só docs). Nas duas plataformas: escopos de privilégio mínimo, uma lista de apps permitidos para escopos sensíveis, revisão periódica dos apps concedidos e um alerta quando um app novo recebe um escopo amplo (`Mail.ReadWrite`, `Files.Read.All`, `offline_access`) ou quando um usuário consente a algo incomum. Permissões de aplicação (client credentials, sem usuário) não são consentimentos de usuário, então audite os service principals à parte.

### Recuperação de conta é o elo fraco

Mecanismo: um login forte é irrelevante se o "esqueci a senha" ou o help desk deixa o atacante entrar. Classes: reset por e-mail (a caixa de correio é a conta), recuperação por SMS (SIM swap: a operadora move o número, veja a lição de MFA), perguntas de segurança (as respostas são adivinháveis ou públicas; o NIST diz que verificadores "NÃO DEVEM induzir os assinantes a usar autenticação baseada em conhecimento (KBA) ... ou perguntas de segurança" ao escolher senhas) e engenharia social do help desk (quem liga e soa certo consegue o reset de um fator). O downgrade é o ataque de verdade: a passkey continua segura enquanto o caminho de recuperação aceita uma prova mais fraca. O NIST trata a troca de uma senha esquecida, quando o usuário consegue se autenticar de outro modo, como vínculo de um novo autenticador, e exige autenticação no AAL máximo da conta (ou no do novo autenticador, o que for menor) mais uma notificação "por um mecanismo independente da transação". Recuperação de verdade usa códigos de recuperação salvos ou emitidos (ao menos 64 bits aleatórios nos salvos), contatos de recuperação ou repetição da verificação de identidade, e "a recuperação de conta DEVE causar uma notificação".

O brinquedo de novo (mesmo servidor, `RECOVERY=weak` contra `strict`). O atacante controla só a caixa de correio e já tem uma sessão roubada. O `strict` acrescenta quatro controles: uma segunda prova além do link, notificação em todos os canais (e-mail e SMS) inclusive de tentativas bloqueadas, revogação de todas as sessões no sucesso e uma espera de 24 h antes de poder adicionar um fator novo (o relógio do brinquedo avança por uma rota de depuração).

```text
                              RECOVERY=weak            RECOVERY=strict
mailbox only, confirm      -> 200 {"revoked":0}        403 second factor required (log: notified email+sms)
owner: mailbox + 2nd factor ->  (not needed)           200 {"revoked":1}
old stolen session after   -> 200 still works          401 no session
add a factor right away    -> 200                      423 cooldown
add a factor 25 h later    -> 200                      200
```

No `weak`, redefinir a senha deixa a sessão do atacante viva e deixa que ele adicione um fator próprio na hora: persistência. A espera de 24 h é a ideia de "tempos de espera estendidos" do NIST em miniatura, e a notificação dá ao dono verdadeiro uma janela. O endpoint responde igual para contas inexistentes (sem enumeração). Help desk: verificar por um canal que quem liga não controla (ligar de volta para um número cadastrado, aprovação do gestor, um chamado), nunca redefinir um fator forte só por telefonema ou mensagem de chat, registrar todo reset como evento de alto risco. Menos resets ajudam mais: duas ou mais passkeys por usuário, códigos de recuperação impressos no cadastro e SMS como fallback apenas com checagem de troca de SIM.

### Credential stuffing e spraying

Pares vazados reaproveitados ou poucas senhas comuns sobre muitas contas; a lição de senhas mediu os dois e os controles (blocklist de senhas vazadas, detecção entre contas, MFA). Aqui entra só o lado da detecção, regras R2 e R3 abaixo: uma impressão de senha falhando em 10 contas numa hora, um IP falhando em 20 contas. A R3 também marca as contas que tiveram sucesso a partir daquele IP, porque são essas as tomadas.

### Contas privilegiadas e de serviço

Atacantes preferem contas que pulam os controles: papéis de administrador (um admin capturado é o tenant inteiro), contas de serviço com segredo estático e sem MFA, e contas break-glass que ninguém vigia. Defesas: identidades de admin separadas com autenticação só resistente a phishing, nenhum privilégio permanente (elevação just-in-time, as próximas lições sobre acesso privilegiado), nenhum segredo de longa vida em workloads (a lição de workload identity: SPIFFE, federação, certificados curtos) e alertas para qualquer uso de identidade privilegiada ou de serviço de um lugar novo, mais concessões de papéis e de consentimento feitas por elas. Sinais: papel de admin atribuído fora de janela de mudança, login interativo de conta de serviço, login break-glass.

### Detecção e resposta

Os eventos que importam são poucos: rajadas de falha seguidas de sucesso, dispositivo ou user agent novo, viagem impossível, fator de MFA adicionado ou removido, app novo consentido, regra de encaminhamento de caixa de correio, reset de senha ou de recuperação, papel privilegiado concedido, a mesma sessão em dois lugares. Registre-os a partir do provedor de identidade com usuário, horário, IP, user agent, resultado e a política que decidiu, e guarde o log onde o atacante que domina a conta não possa editá-lo.

Um detector meu, `detect.mjs` (60 linhas, sem dependências), sobre um log gerado: 8.194 eventos, 300 usuários em 7 dias de ruído benigno (erros de digitação, viagens legítimas, troca de saída de VPN) e cenários injetados com um arquivo de rótulos como verdade de referência. As regras: R1 fadiga de push (5 prompts em 10 min, 3 negados), R2 spray (uma impressão de senha em 10 contas em 1 h), R3 stuffing (um IP falhando em 20 contas em 1 h), R4 reuso de sessão (um id de sessão, dois pares IP/UA em 10 min), R5 viagem impossível (mais de 900 km/h entre logins bem-sucedidos), R6 dez falhas e depois um sucesso, R7 cadeia de tomada (um user agent nunca visto, depois dois tipos de mudança entre MFA, consentimento e regra de encaminhamento em 1 h). A R4, o núcleo:

```js
for (const [sid, xs] of group(e => e.sid, e => e.event === 'session_use' && e.sid)) {
  const o = xs.find(x => (x.ip !== xs[0].ip || x.ua !== xs[0].ua) && ms(x) - ms(xs[0]) <= 600e3);
  if (o) alert('session_reuse', xs[0].user, `${sid}: ${xs[0].ip}/${xs[0].ua} then ${o.ip}/${o.ua}`);
}
```

```text
push_fatigue       caught 1/1   | other attack users 0 | false positives 0
spray              caught 40/40 | other attack users 0 | false positives 0
stuffing           caught 60/60 | other attack users 0 | false positives 0
session_reuse      caught 3/3   | other attack users 0 | false positives 0
impossible_travel  caught 2/2   | other attack users 6 | false positives 4 (the VPN exit hops)
fail_then_success  caught 2/2   | other attack users 0 | false positives 0
takeover_chain     caught 2/2   | other attack users 0 | false positives 0
malicious users 110, caught by at least one rule 110 | benign users alerted 4 of 190
```

Leia com honestidade: o log é sintético e eu escrevi os cenários e as regras, então 110 de 110 mostra que as regras funcionam como desenhadas, não o que você verá em produção. A parte útil é o falso positivo: viagem impossível disparou em quatro usuários que trocaram de saída de VPN, o custo clássico dessa regra. As correções são uma lista de faixas de saída conhecidas e exigir um segundo sinal (dispositivo novo, login de risco) antes de alertar. Uma primeira versão da R3 marcava só as contas que falharam e perdeu as 3 contas em que o IP do stuffing de fato entrou (57 de 60); contar toda conta que o IP tocou resolveu. Fadiga de alerta também é métrica de defesa: meça alertas por dia e a fração encerrada como benigna.

Quando uma conta é comprometida, a ordem que funciona (só docs para as chamadas de plataforma, medido onde marcado):

1. Conter: revogar todas as sessões e refresh tokens (`revokeSignInSessions` do Graph no Entra; na lição de sessões, "sair em todos os lugares") e desabilitar a conta se o atacante estiver ativo.
2. Remover a persistência: autenticadores ou fatores adicionados desde a invasão, consentimentos e concessões de apps (a chamada da Admin API acima), regras de encaminhamento e delegação de caixa de correio, registros de app extras, chaves de API e registros de dispositivo.
3. Redefinir: a senha e, em seguida, exigir o cadastro de um autenticador forte novo, pelo caminho estrito de recuperação.
4. Delimitar: montar a linha do tempo a partir do log (primeiro login anômalo, o que mudou, o que foi lido) e então verificar outras contas tocadas pelo mesmo IP ou origem de sessão.
5. Aprender: qual controle faltou (vínculo de token, política de consentimento, força da recuperação) e a detecção que teria disparado antes.

### Frameworks: ATT&CK, NIST, CISA

Técnicas do MITRE ATT&CK para essas ameaças (cada ID confirmado em attack.mitre.org em 2026-11-19; a tabela liga a lição aos nomes das técnicas):

| Ameaça | Técnica | ID |
|---|---|---|
| Phishing, link malicioso | Phishing, Spearphishing Link | T1566, T1566.002 |
| Relay AiTM | Adversary-in-the-Middle | T1557 |
| Sessão roubada ou reaproveitada | Steal Web Session Cookie; Web Session Cookie (material alternativo) | T1539, T1550.004 |
| Fadiga de push | Multi-Factor Authentication Request Generation | T1621 |
| Abuso de token e de consentimento OAuth | Steal Application Access Token | T1528 |
| Adulteração de fator e persistência | Modify Authentication Process: MFA; Device Registration | T1556.006, T1098.005 |
| Stuffing, spraying | Brute Force: Credential Stuffing, Password Spraying | T1110.004, T1110.003 |
| Uso da conta depois | Valid Accounts, Cloud Accounts | T1078, T1078.004 |
| Regra de encaminhamento de e-mail | Email Collection: Email Forwarding Rule | T1114.003 |

NIST SP 800-63B-4: verificadores em AAL2 "DEVEM oferecer pelo menos uma opção de autenticação resistente a phishing" e agências federais devem exigi-la de funcionários; o AAL3 pede uma chave não exportável; a seção de sessões fixa tempos de reautenticação (no AAL2, no máximo 24 h no total e 1 h de inatividade, como DEVERIA); a recuperação de conta e o vínculo de novo autenticador exigem notificação a todos os endereços guardados, exceto o postal. CISA, "Implementing Phishing-Resistant MFA": a classificação acima e o conselho de somar number matching e detecção enquanto a migração acontece.

### Resumo: ameaça, o que contorna, defesa, sinal

| Ameaça | Contorna | Defesa | Sinal de detecção |
|---|---|---|---|
| Phishing | senha, SMS, TOTP, push | passkey ou FIDO2 (preso à origem) | login de IP novo logo após clique em link sinalizado |
| Relay AiTM | qualquer MFA não resistente a phishing | passkeys, sessões presas ao dispositivo, dispositivo conforme | reuso de sessão, token usado de ASN ou dispositivo novo |
| Fadiga de MFA | push de tocar e aprovar | number matching, limite de prompts, passkeys | rajada de prompts, negações e depois uma aprovação |
| Roubo de token ou sessão | tudo o que ocorreu no login | vínculo, vida curta, revogação, EDR | mesma sessão, dois clientes; viagem impossível |
| Consent phishing | senha e MFA | política de consentimento, publishers verificados, escopo mínimo, revisão de concessões | app novo com escopo amplo; consentimento fora da política |
| Recuperação fraca | fator forte, por downgrade | recuperação estrita, espera, aviso em todos os canais, revogar sessões | reset seguido de fator novo; resets por conta |
| Stuffing e spraying | senhas reusadas ou fracas | blocklist, MFA, regras entre contas | uma senha em muitas contas; IP em muitas contas |
| Abuso de privilegiadas e de serviço | isenções de MFA, segredos estáticos | passkeys de admin, JIT, workload identity | papel concedido fora da janela de mudança; login de serviço de lugar novo |

Livro contra hoje: SMS e TOTP ainda estão por toda parte e continuarão por anos, então um plano precisa cobri-los com number matching, detecção e força na recuperação. A direção do mercado são passkeys no login e sessões presas ao dispositivo para o que vem depois (Entra Token Protection e o rascunho do DBSC são iniciais e cobrem poucos apps hoje). Política de consentimento e endurecimento da recuperação são as vitórias baratas, em nível de plataforma, que a maioria dos tenants ainda não fez.

### Where to go next

A próxima lição de acesso privilegiado desta trilha cobre o lado administrativo (JIT, cofres, break-glass). Para a mecânica de cookie e revogação por trás das seções 2 e 4, a lição de sessões; para DPoP e mTLS, a lição de segurança OAuth.

## Trade-offs

- **Passkeys contra o que dá para implantar.** O único fator resistente a phishing amplamente disponível, e ainda exige um plano de recuperação e uma história para perda de dispositivo. A maioria das organizações roda os dois por anos; mantenha o caminho mais fraco tão forte quanto o mais forte.
- **Vínculo de dispositivo contra compatibilidade.** Uma sessão presa a uma chave não pode ser copiada, e quebra proxies que terminam ou reescrevem requisições, dispositivos compartilhados e navegadores sem suporte. Exemplo: o Entra Token Protection cobre apps nativos primeiro e poucos apps web.
- **Detecção contra fadiga de alerta.** Viagem impossível marcou 4 usuários de VPN entre 190 benignos no brinquedo; toda regra precisa de uma lista de exceções ou de um segundo sinal. Acompanhe a fração de alertas encerrados como benignos.
- **Recuperação estrita contra custo de suporte.** Espera de 24 h, segunda prova e revogação de todas as sessões protegem a conta e incomodam o usuário real que perdeu o celular. Mitigue com várias passkeys e códigos de recuperação emitidos no cadastro.
- **Política de consentimento contra atrito dos desenvolvedores.** Permitir só publishers verificados e escopos de baixo impacto barra o app de phishing e atrasa ferramentas internas legítimas; um fluxo de consentimento do administrador absorve isso.
- **Alcance da revogação.** Apagar uma concessão interrompe o refresh em segundos (medido), não o access token já emitido nem a sessão do usuário no IdP. Combine com tokens curtos e uma revogação completa de sessões.

## Documentation Links

- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Implementing Phishing-Resistant MFA, CISA](https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf) (doc)
- [Phishing, T1566, MITRE ATT&CK](https://attack.mitre.org/techniques/T1566/) (doc)
- [Adversary-in-the-Middle, T1557, MITRE ATT&CK](https://attack.mitre.org/techniques/T1557/) (doc)
- [Steal Web Session Cookie, T1539, MITRE ATT&CK](https://attack.mitre.org/techniques/T1539/) (doc)
- [Multi-Factor Authentication Request Generation, T1621, MITRE ATT&CK](https://attack.mitre.org/techniques/T1621/) (doc)
- [Steal Application Access Token, T1528, MITRE ATT&CK](https://attack.mitre.org/techniques/T1528/) (doc)
- [Configure how users consent to applications, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent) (doc)
- [Review and revoke permissions granted to applications, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions) (doc)
- [Token Protection in Conditional Access, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-token-protection) (doc)
- [How number matching works in MFA push notifications, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-number-match) (doc)
- [Keycloak Admin REST API, users consents](https://www.keycloak.org/docs-api/latest/rest-api/index.html) (doc)
- [Revoke signed-in sessions, Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions) (doc)
- [Client registration service and policies, Keycloak Securing Applications](https://www.keycloak.org/securing-apps/client-registration) (doc)
- [Client registration policies, Keycloak Server Administration](https://www.keycloak.org/docs/latest/server_admin/index.html#_client_registration_policies) (doc)
- [Device Bound Session Credentials, W3C draft](https://w3c.github.io/webappsec-dbsc/) (doc)
- [RFC 9449, OAuth 2.0 Demonstrating Proof of Possession (DPoP), IETF](https://www.rfc-editor.org/rfc/rfc9449) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [Forgot Password Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) (doc)
