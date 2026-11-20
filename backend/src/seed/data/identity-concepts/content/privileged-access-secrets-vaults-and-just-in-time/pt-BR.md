---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Todo ambiente acaba com algumas credenciais que podem tudo: o administrador de domínio ou da nuvem, o dono do banco, o root token, a chave de deploy. A pergunta desta lição é por quanto tempo essas credenciais existem, quem pode segurá-las e o que sobra no log depois. O gerenciamento de acesso privilegiado (PAM, privileged access management) responde com um inventário das contas privilegiadas, um cofre que entrega e recolhe credenciais, sessões gravadas e elevação just-in-time (JIT) em direção a zero standing privilege. O gerenciamento de segredos responde à mesma pergunta para aplicações: nada de senha estática, e sim um lease que expira. Esta lição sobe o HashiCorp Vault em modo dev no Docker e mede a operação: versões do KV v2, políticas, TTL e expiração de token, credenciais dinâmicas do Postgres (emitidas, expiradas, revogadas, e uma sessão aberta que sobrevive à revogação), rotação estática, AppRole com response wrapping contra o secret zero, uma elevação JIT aprovada por uma segunda pessoa, certificados SSH assinados, seal e unseal, o log de auditoria com valores mascarados e uma leitura break-glass que dispara um alerta. Entra PIM, a orientação de break-glass, AWS Secrets Manager, Azure Key Vault, CyberArk e BeyondTrust são docs only aqui (sem tenant, sem conta de nuvem, sem licença). Ferramentas: `curl`, `jq`, a CLI `vault` dentro do contêiner, `psql`, `ssh-keygen`; o protocolo é o ponto, não a stack.
Versions: `hashicorp/vault:2.2.2` (build arm64, edição community, `enterprise:false` em `/sys/health`), `postgres:16` (16.15), curl 8.7.1, jq 1.7.1, OpenSSH 10.5p1. Medido num Apple M4 Max (14 núcleos), Docker 29.9.2. Documentação lida em 2026-11-20. Docs only: Entra PIM, AWS, Azure, CyberArk, BeyondTrust, OpenBao, aceitação do certificado SSH por um sshd real, init Shamir com várias partes.

## Use Cases

- Trocar uma senha de administrador compartilhada e um login "root" do banco por um lease que expira e um log que nomeia a pessoa.
- Desenhar contas break-glass sem trancar o tenant inteiro para fora (a falha que esta lição explica).
- Escolher entre um produto de PAM, um cofre de segredos e o armazenamento da própria nuvem, e saber o que um auditor vai perguntar.
- Ler um log de auditoria do Vault ou uma política de acesso numa revisão e saber o que cada linha prova.

## Deep Dive

### O problema: privilégio permanente e raio de explosão

Uma conta de administrador permanente é um alvo parado: funciona às 3 da manhã para quem a tiver, com phishing ou sem (a lição de ameaças lista os papéis de administrador em primeiro lugar entre as contas que os atacantes preferem). Uma credencial compartilhada por um time é pior: o log diz "admin" e ninguém sabe quem foi. O raio de explosão é a soma do que a credencial alcança vezes o tempo em que ela fica válida. Três alavancas o reduzem: menos contas com o privilégio, vida mais curta para cada concessão e registro de todo uso. O NIST SP 800-53 Rev. 5 enuncia o princípio no controle AC-6: permitir "only authorized accesses for users (or processes acting on behalf of users) that are necessary to accomplish assigned organizational tasks". Zero standing privilege é a forma estrita: ninguém tem o privilégio até que um pedido seja aprovado, e ele some sozinho.

### PAM em quatro partes

1. **Inventário.** Não dá para guardar no cofre o que você não encontrou: domain admins, administradores locais, contas de serviço, donos de banco, logins de equipamentos de rede, usuários root da nuvem, chaves de API com escrita. A lição de ciclo de vida de identidade mostrou a reconciliação achando órfãos; o mesmo exercício para contas privilegiadas é o primeiro projeto de PAM.
2. **Cofre com check-out e check-in.** A credencial mora no cofre, o usuário pede com um motivo, recebe por um tempo limitado e o cofre a troca depois, para que a cópia na área de transferência não valha nada. A página de arquitetura da CyberArk descreve isso como um Vault mais um Central Policy Manager (CPM) que rotaciona senhas nos alvos "with no human intervention". O BeyondTrust Password Safe tem pedido com motivo, e o check-out de credencial do Privileged Remote Access mostra a senha por pouco tempo e exige o check-in depois (docs only).
3. **Gravação de sessão.** O usuário conecta por um proxy que injeta a credencial, então o humano nunca a vê, e a sessão é gravada. O Privileged Session Manager da CyberArk e os revisores de sessão gravada do BeyondTrust fazem isso (docs only). O Entra PIM lista gravações de sessão do Azure Bastion Premium como preview e diz que a análise de sessões mostra o ciclo de vida do papel e a atividade do Bastion, não os comandos executados dentro da VM.
4. **JIT e just-enough access.** O papel é elegível, não ativo. A ativação exige justificativa, muitas vezes aprovação e MFA, dura um tempo limitado e termina sozinha. Entra PIM: "time-based and approval-based role activation", com máximo de ativação entre 1 e 24 horas, notificações e revisões de acesso; exige licenças (Entra ID Governance licensing fundamentals). Just enough significa que o papel é o menor para a tarefa, não Global Administrator para resetar uma senha.

### O laboratório: Vault em modo dev (medido)

```bash
docker run -d --rm --name idn-pam-vault -p 127.0.0.1:7090:8200 --cap-add=IPC_LOCK \
  -e VAULT_DEV_ROOT_TOKEN_ID=dev-only-root-token -e VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200 hashicorp/vault:2.2.2
curl -s localhost:7090/v1/sys/seal-status | jq -c '{type,sealed,t,n,storage_type}'
{"type":"shamir","sealed":false,"t":1,"n":1,"storage_type":"inmem"}
```

A imagem tem build arm64 e o contêiner registra `tls: "disabled"`. A documentação diz "Never, ever, ever run a dev mode server in production": armazenamento em memória, uma única parte da chave, servidor já aberto (unsealed) e um root token que você escolheu. Licença, como o repositório diz hoje: o Vault 1.15.0 e posteriores está sob a Business Source License 1.1, licenciante IBM, com um additional use grant que permite uso em produção, exceto oferecê-lo a terceiros de forma hospedada ou embutida para competir com a versão paga do fornecedor, e uso interno não é competitivo; cada versão converte para MPL 2.0 quatro anos após a publicação. Rodar dentro de uma empresa é permitido; montar um produto hospedado concorrente não. O OpenBao é o fork sob MPL-2.0 hospedado pela OpenSSF da Linux Foundation (docs only, não rodei aqui). O contêiner de banco é `idn-pam-db` (`postgres:16`, rede Docker privada, porta 7091), meu e efêmero. Os dois foram removidos no fim. Atalho usado abaixo: `v` é `curl -s -H "X-Vault-Token: $T"`.

### KV v2: versões e metadata (medido)

```text
POST secret/data/billing/db {"data":{...}}                     -> version 1
POST ... {"options":{"cas":1}}                                 -> version 2
POST ... {"options":{"cas":1}} de novo                         -> 400 check-and-set parameter did not match the current version
GET  secret/data/billing/db        -> dados da v2, "lease_duration":0,"renewable":false   (KV não tem lease)
GET  secret/data/billing/db?version=1                          -> dados da v1
DELETE secret/data/billing/db      -> 204; GET -> 404 com metadata.deletion_time preenchido     (soft delete)
POST secret/undelete/billing/db {"versions":[2]} -> 204; GET -> dados de volta
POST secret/destroy/billing/db {"versions":[1]}  -> 204; GET ?version=1 -> 404, "destroyed":true
POST secret/metadata/billing/db {"max_versions":2}; depois 3 escritas -> current_version 5, versões mantidas ["4","5"]
```

Delete é reversível, destroy não é, e `max_versions` poda as mais antigas em silêncio (doc da API: 0 ou ausente mantém 10). A metadata lista `created_time` e quem criou cada versão (`created_by.client_id`). O `cas` faz a escrita falhar se outra pessoa mudou o segredo no meio tempo, que é como dois operadores evitam sobrescrever um ao outro. O KV é um armazenamento versionado como o Key Vault ou o Secrets Manager: é a parte menos interessante do Vault, e onde a maioria dos times para.

### Políticas: privilégio mínimo em HCL (medido)

```text
path "secret/data/billing/*"     { capabilities = ["read"] }
path "secret/metadata/billing/*" { capabilities = ["list", "read"] }
```

Um token com essa política (`vault policy write billing-read`): ler `billing/db` dá 200, ler `reports/db` dá 403, escrever em `billing/db` dá 403, listar `secret/metadata/billing` devolve `["api","db"]`, `sys/policies/acl` dá 403; `sys/capabilities-self` responde `["read"]` e `["deny"]` para os dois caminhos. Três armadilhas, cada uma medida com um token sem a política `default`: uma política em `secret/billing/*` (sem `/data/`, o hábito do KV v1) dá 403 em leituras do KV v2; `secret/data/billing/*` não casa com `secret/data/billing` em si (403); um `deny` explícito em `billing/db` vence o glob (api 200, db 403). As políticas são deny por padrão, ficam anexadas aos tokens, e o token também recebe `default` a menos que `no_default_policy` esteja ligado. É a lição de autorização num só engine: um motor de políticas sobre caminhos e capabilities, de quem administra o cofre.

### Tokens, TTL e leases (medido)

Um token é uma credencial com uma lista de políticas e um tempo de vida. Criado com `policies=billing-read, ttl=2m, explicit_max_ttl=10m`, o `lookup-self` mostra `ttl:120, creation_ttl:120, explicit_max_ttl:600, renewable:true`. O teste de expiração (ttl 6 s, máximo explícito 14 s):

```text
t+0   lookup ttl 5, lê o segredo -> 200
t+4   renew-self +6s            -> lease_duration 6
t+8   renew-self +60s           -> lease_duration 6, aviso: TTL of "1m" exceeded the effective max_ttl of "6s"; capped
t+14  lê o segredo -> 403 {"errors":["permission denied","invalid token"]}; lookup-self e renew-self -> 403 também
```

Um token expirado não é 401: o Vault responde 403 com "invalid token", então um cliente que trata 403 só como "sem política" vai entrar em loop. A renovação não passa do máximo, e esse é o objetivo do `explicit_max_ttl`: um token roubado não pode ser renovado para sempre. Outros comportamentos medidos: `num_uses=2` permite duas requisições e a terceira dá 403; revogar um pai pelo accessor (`auth/token/revoke-accessor`, que não revela o token) mata também o filho que ele criou (ambos 403), enquanto um token `orphan` criado ao lado sobrevive (200); `revoke-self` encerra o token na hora; um token `period` (1 h) pode ser renovado indefinidamente, para um serviço de longa duração que ainda precisa ser revogável. Segredos de engines dinâmicos carregam um lease com o mesmo modelo: consultar, renovar, revogar, revogar por prefixo.

### Segredos dinâmicos: o engine de banco (medido)

Em vez de guardar a senha, o Vault mantém uma conexão administrativa e cria um usuário por pedido. Configuração, com `postgresql-database-plugin`, a conexão `postgresql://{{username}}:{{password}}@idn-pam-db:5432/appdb` e um role:

```json
{"db_name":"appdb","default_ttl":"20s","max_ttl":"60s",
 "creation_statements":["CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';",
                        "GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";"],
 "revocation_statements":["REVOKE ALL ON ALL TABLES IN SCHEMA public FROM \"{{name}}\";","DROP ROLE IF EXISTS \"{{name}}\";"]}
```

```text
GET database/creds/app-readonly -> {"lease_duration":20,"renewable":true,"data":{"username":"v-token-app-read-qAp389rukJlr8m9h0n4S-1795197370","password":<20 chars>}}
pg_roles: esse role, rolvaliduntil 17:56:35 (emitido 17:56:10: 25 s para um lease de 20 s)
como esse usuário: select count(*) from invoices -> 2;  insert -> ERROR: permission denied for table invoices
um segundo GET -> outro usuário
```

Um tropeço no meu próprio laboratório: conectar com `-h 127.0.0.1` dentro do contêiner do Postgres aceitou qualquer senha, porque o `pg_hba.conf` da imagem oficial tem `host ... 127.0.0.1/32 trust`. Meus primeiros testes de "login funciona" não provaram nada. Conectar pelo nome de rede do contêiner (`-h idn-pam-db`, regra `scram-sha-256`) deu o resultado real, usado daqui em diante: a senha certa funciona, `wrong` dá `password authentication failed`. A expiração, consultada a cada 3 s desde a emissão:

```text
t+0 ... t+18  login ok
t+21          FATAL: password authentication failed        (log do Vault: "expiration: revoked lease" em t+20.0 s)
```

O role é removido quando o lease acaba, e o Postgres responde a mesma mensagem para role removido e senha errada (sem enumeração). O `VALID UNTIL` (25 s aqui) é a rede de proteção se o Vault estiver fora do ar. Renovação: `sys/leases/renew` com `increment:30` dá 30 s; pedir 300 s dá `52` com o mesmo aviso de TTL limitado (máximo de 60 s menos os 8 s já passados). Revogação antecipada: `sys/leases/revoke` remove o role, e `revoke-prefix` em `database/creds/app-readonly` removeu 3 roles pendentes (de 3 para 0).

O achado que importa: uma sessão aberta sobrevive à revogação. Mantive uma conexão com `select pg_sleep(40)`, revoguei o lease, e o `pg_stat_activity` ainda mostrava o pid 267 como `active`, com o role já removido (`usename` nulo), ainda rodando 13 s depois. Acrescentar `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{name}}';` como primeira instrução de revogação resolveu: mesmo teste, o backend sumiu 1 s depois da revogação. "Revogado" só significa o que as suas instruções de revogação fazem.

Static roles e rotação do root. Um role mapeado para um usuário existente (`static_app`) com `rotation_period: 15s`: a primeira leitura devolveu uma senha e a original parou de funcionar (o Vault rotaciona na criação); a segunda, 9 s depois, teve a mesma senha e `ttl:6`; a terceira, 18 s depois da primeira, uma nova, com `last_vault_rotation` 16,4 s depois da primeira. `database/rotate-root/appdb` trocou a senha do administrador por um valor que nenhum humano conhece: a antiga deu `password authentication failed`, e o Vault continuou emitindo credenciais. Emitir 30 credenciais levou 11,8 ms cada, uma leitura de KV 9,6 ms (ambos incluem o início do processo `curl`, então o engine acrescenta pouco nesta máquina).

Estático contra dinâmico: a rotação estática serve a uma conta que uma aplicação possui e a um sistema legado que não consegue criar usuários (uma identidade só, atribuição borrada, uma janela até os consumidores pegarem o valor novo); o dinâmico dá a cada consumidor a sua credencial, única no log do banco e revogada por lease, ao custo de o cofre estar no caminho da partida e de as instruções de revogação serem sua responsabilidade. Docs only: o mesmo engine cobre MySQL, MongoDB, MSSQL e outros; o engine LDAP oferece uma biblioteca de check-out de contas de serviço (a documentação a lista no resumo de recursos), que é o modelo de check-out e check-in do PAM.

### Secret zero: AppRole e response wrapping (medido)

O cofre protege segredos, e algo precisa autenticar a aplicação no cofre sem um segredo guardado: o secret zero (o termo da lição de identidade de workload). O AppRole divide a credencial em duas: um `role_id` (um identificador, seguro na imagem) e um `secret_id` que a plataforma entrega na partida. Role `billing`: `token_policies billing-read`, `token_ttl 1m`, `secret_id_ttl 2m`, `secret_id_num_uses 1`. O orquestrador pede um secret id embrulhado, com wrap TTL de 30 s:

```text
POST auth/approle/role/billing/secret-id  -H "X-Vault-Wrap-TTL: 30s"  -> a resposta tem wrap_info (ttl 30, creation_path ...), data:null, auth:null
POST sys/wrapping/lookup {"token": wrapping token}                    -> creation_path, creation_time, creation_ttl (sem o segredo)
POST sys/wrapping/unwrap, token = só o wrapping token                 -> secret_id, secret_id_ttl 120, secret_id_num_uses 1
o mesmo unwrap de novo                                                -> 400 wrapping token is not valid or does not exist
POST auth/approle/login {role_id, secret_id}  -> policies billing-read,default, lease_duration 60, renewable
o mesmo login de novo (num_uses 1)            -> 400 invalid role or secret ID
```

O orquestrador nunca vê o secret id, só um token de uso único num cubbyhole, e um wrapping token aberto duas vezes é evidência de interceptação: quando fiz o papel do atacante e abri primeiro (200), a aplicação legítima recebeu o 400. Trate esse 400 como alerta. Um wrap TTL de 3 s também tinha sumido depois de 4 s (400). O limite honesto: o AppRole move o secret zero para quem pode pedir o secret id embrulhado (o job de CI, o orquestrador). A resposta melhor é um método de autenticação em que a plataforma atesta: a autenticação Kubernetes e a JWT/OIDC do Vault (docs only; um token do GitHub Actions ou do Kubernetes é trocado por um token do Vault, com a condição de confiança medida na lição de identidade de workload), ou o IAM da nuvem. SPIFFE e tokens projetados são a mesma ideia.

### JIT com o Vault OSS: aprovação por uma segunda pessoa (medido)

A aprovação nativa do Vault são os Control Groups, que a documentação coloca sob o Vault Enterprise (docs only). Na edição community o padrão ainda funciona com um token role e wrapping: `alice` tem só `engineer` (lê `secret/data/dev/*`); `bob` tem só `approver`, que pode escrever em `auth/token/create/jit-prod`; o token role `jit-prod` permite a política `prod-admin`, é não renovável, `token_explicit_max_ttl 20s`, orphan, sem política default.

```text
alice lê prod/payments: 403   alice cria jit-prod: 403   bob lê prod/payments: 403      (zero standing privilege)
bob POST auth/token/create/jit-prod  -H "X-Vault-Wrap-TTL: 60s"  {"display_name":"jit-alice-INC-4711"}  -> token embrulhado
alice abre o wrap -> um token com prod-admin;  leituras às 18:01:36, :43, :50 -> 200;  às :57 -> 403 (expirou em 20 s)
auditoria: "token-jit-alice-INC-4711" três leituras, e a criação do token por bob, no mesmo horário
```

Ninguém tinha acesso a prod antes da aprovação, ninguém tem depois de 20 s, e o log liga a concessão (bob) ao uso (o token JIT). O número do ticket foi para o `display_name`, não para o `meta`, porque a auditoria aplica hash nos valores de `meta` e deixa o `display_name` legível. Um fluxo real acrescenta a checagem do ticket, uma etapa de MFA para o aprovador e um bot de chat; o cofre fornece o mecanismo: expiração, escopo e rastro. É o modelo do Entra PIM (elegível, aprovar, expirar) montado a partir de peças.

### Certificados SSH de vida curta (medido, em parte)

O engine SSH como CA substitui `authorized_keys` de longa vida: os servidores confiam na chave da CA (`TrustedUserCAKeys`) e o Vault assina a chave pública de um usuário por minutos.

```text
POST ssh/config/ca {"generate_signing_key":true,"key_type":"ssh-ed25519"}
POST ssh/roles/ops {"key_type":"ca","allow_user_certificates":true,"allowed_users":"alice,ops","default_user":"ops","ttl":"30s","max_ttl":"5m"}
assinar alice.pub para o principal alice -> ssh-keygen -L:  Type: ssh-ed25519-cert-v01@openssh.com user certificate
   Valid: from 2026-11-20T18:00:27 to 2026-11-20T18:01:27     Principals: alice     Extensions: permit-pty
principal root -> 400 root is not a valid value for valid_principals       ttl 1h -> 400 ttl is larger than maximum allowed 300
```

O TTL de 30 s mostra uma janela de 60 s porque o role recua o `ValidAfter` por `not_before_duration` (padrão 30 s) por causa de diferença de relógio, a mesma troca do SVID do SPIRE. Docs only: um `sshd` real aceitando o certificado. Aqui também a expiração substitui a revogação.

### Seal, unseal e Shamir

O Vault cifra tudo com uma chave que ele não guarda em claro. Um servidor selado não sabe nada: medido, `operator seal` deu `/sys/health` 503 e `{"errors":["Vault is sealed"]}` em toda leitura; `operator unseal` com a chave dev e o mesmo token leu o segredo de novo (200). A documentação descreve o padrão: a unseal key é dividida com o Shamir's Secret Sharing, e um limiar de partes (por exemplo 3 de 5, `operator init -key-shares=5 -key-threshold=3`, docs only aqui; o modo dev é 1 de 1) precisa ser informado para reconstruí-la, então nenhum operador sozinho consegue abrir o cofre. O auto-unseal com um KMS de nuvem ou HSM é a resposta usual em produção, docs only. O ponto para o PAM: as partes de unseal são elas mesmas credenciais privilegiadas, guardadas por pessoas diferentes.

### Audit device e valores mascarados (medido)

```bash
vault audit enable file file_path=/tmp/vault-audit.log
```

Depois de 3 requisições o log tinha 6 linhas de request e 6 de response. O segredo `fake-audit-pass-123` escrito no KV não aparece (0 ocorrências); `data.data.password` é `hmac-sha256:acddc274...`. `POST sys/audit-hash/file {"input":"fake-audit-pass-123"}` devolve o mesmo hash, então dá para conferir se um valor conhecido foi usado sem o log guardá-lo. Os tokens root e billing também têm hash (`client_token`, accessor). Uma leitura negada tem `error: permission denied`, `auth.display_name`, `policies` e `policy_results.allowed:false`, e a entrada é escrita para a requisição que falhou, que é o sinal. Com `log_raw=true` a mesma escrita apareceu em claro (2 ocorrências contra 0): nunca em produção. Documentação: a auditoria registra request e response em todo device habilitado, e se o Vault não consegue escrever em pelo menos um, ele se recusa a atender a requisição, então habilite pelo menos dois. A auditoria diz quem, quando, qual caminho e qual resultado. Ela não torna a política correta.

### Contas break-glass

Contas break-glass (acesso de emergência) existem porque o sistema de acesso pode falhar com você. A orientação do Entra lista os casos: federação indisponível, administradores cujos únicos dispositivos de MFA ou redes de telefonia estão fora, o último Global Administrator saindo, e todos os papéis privilegiados elegíveis com aprovação exigida e nenhum aprovador sobrando, de modo que "no one can approve activation and tenant administration is effectively locked". Como mantê-las, segundo essa página: duas ou mais contas apenas em nuvem no domínio `*.onmicrosoft.com`, não ligadas a uma pessoa, com um método sem senha resistente a phishing (FIDO2 recomendado, ou certificados) diferente do dos administradores do dia a dia; excluídas das políticas de Conditional Access que bloqueiam ou restringem o login (uma política que exige dispositivo em conformidade pode bloquear a conta justamente na emergência); ativas de forma permanente no PIM, não elegíveis; credenciais em cofres físicos em locais separados; monitoramento de login com alertas para outros administradores; revisão depois de cada uso e um teste de validação pelo menos a cada 90 dias. O NIST AC-2(2) nomeia a mesma ideia: "temporary and emergency accounts" desativadas automaticamente depois de um tempo definido.

Três lições das falhas. Uma política que exige MFA para todos sem exceção derruba a conta de que você precisa quando o MFA está fora. As credenciais break-glass não podem depender do sistema que quebrou (um cofre atrás do mesmo IdP é circular). E um login break-glass sem monitoramento é um administrador invisível. Uma versão com Vault, medida: a credencial em `secret/breakglass/idp-admin`, um token com `breakglass-read`, `num_uses=1`, `display_name oncall-carol-INC-5000`, e um vigia de 4 linhas sobre o log de auditoria:

```bash
jq -c 'select(.type=="request" and (.request.path|startswith("secret/data/breakglass/")) and .request.operation=="read")
  | {alert:"breakglass_read", at:.time, path:.request.path, who:.auth.display_name}' audit.log
{"alert":"breakglass_read","at":"2026-11-20T18:02:13.33Z","path":"secret/data/breakglass/idp-admin","who":"token-oncall-carol-INC-5000"}
{"alert":"breakglass_read","at":"2026-11-20T18:02:13.34Z","path":"secret/data/breakglass/idp-admin","who":null}   <- a segunda leitura, recusada
```

A segunda leitura é bloqueada pelo `num_uses`, e o log de auditoria ainda a registra. A senha em si não está no log (0 ocorrências). O break-glass do próprio Vault é o root token: `operator generate-root` cria um só com um quórum de unseal keys e uma senha de uso único; medido com a chave dev: `-init`, a chave, `-decode` deram um token `root` com `ttl:0`, e `revoke-self` o encerrou (o lookup seguinte deu 403). A tentativa e suas atualizações estão no log de auditoria. Revogue root tokens logo depois do uso.

### Comparação: armazenamentos e o que cada um dá (docs only)

| | Azure Key Vault | AWS Secrets Manager | Secret do Kubernetes | HashiCorp Vault (medido) |
|---|---|---|---|---|
| Guarda | segredos, chaves, certificados | segredos como credenciais de banco e chaves de API | pequenos objetos chave/valor | KV, mais engines dinâmicos |
| Versões | sim (versões do segredo) | labels AWSCURRENT, AWSPREVIOUS, AWSPENDING | nenhuma | versões do KV v2 |
| Rotação | evento "near expiry" do Event Grid 30 dias antes, uma função que você escreve | rotação gerenciada, ou uma função Lambda | nenhuma embutida | rotação estática, ou dinâmica por pedido |
| Credenciais por pedido | não na documentação que li | não na documentação que li | não | leases, revogação por lease ou prefixo |
| Auditoria | logs de diagnóstico pelo Azure Monitor | o CloudTrail registra as chamadas de API | auditoria do cluster, não específica de Secrets | audit devices, valores com hash |
| Armadilha | leitura na partida, um segredo compartilhado | permissões da função de rotação | sem cifra no etcd por padrão, quem cria Pod lê | você opera: seal, backup, upgrade |

As fontes estão nos links. A página do Kubernetes diz que Secrets ficam "by default, stored unencrypted" no etcd e que quem pode criar um Pod num namespace consegue ler os Secrets dele (veja a [lição de Secrets do Kubernetes](/kubernetes-concepts/kubernetes-secrets-fundamentals) e [segredos como variáveis de ambiente ou arquivos montados](/kubernetes-concepts/secrets-as-env-vars-vs-mounted-files)). O lado .NET, com `DefaultAzureCredential` e o provider de configuração, está em [segredos e managed identities](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) e [Key Vault e App Configuration em .NET](/azure-dotnet-concepts/key-vault-and-app-configuration-in-dotnet). Um armazenamento de nuvem que você alcança com a identidade de nuvem do workload é a escolha de menor esforço naquela nuvem; o Vault compensa quando você precisa de credenciais dinâmicas, várias nuvens, ou um só modelo de política e auditoria.

### Mercado, auditorias e livro contra hoje

Dois tipos de produto dividem a palavra "cofre" e respondem a perguntas diferentes. As **suítes de PAM** (CyberArk, BeyondTrust) miram pessoas e contas privilegiadas em servidores, bancos e equipamentos de rede: check-out de credencial com motivo, rotação, gravação de sessão e relatórios para auditores. A Palo Alto Networks anunciou a conclusão da aquisição da CyberArk em 11 de fevereiro de 2026 e disse que a plataforma de Identity Security continua disponível de forma independente (confira o empacotamento atual antes de comprar). Os **gerenciadores de segredos** (Vault, OpenBao, os armazenamentos de nuvem) miram aplicações, pipelines e times de plataforma: API em primeiro lugar, leases, TTL curto. Uma empresa madura roda os dois, mais o JIT do IdP (Entra PIM) para papéis de nuvem.

Livro contra hoje. A receita antiga é uma senha de administrador compartilhada num cofre, rotacionada depois de cada check-out, alcançada a partir de um jump host: ainda viva nas empresas, e adequada para sistemas que não conseguem mais do que isso. Hoje o alvo é nenhum papel permanente (papéis elegíveis com expiração), certificados por sessão ou credenciais dinâmicas no lugar de uma senha guardada, MFA resistente a phishing para administradores e identidade de workload para as máquinas. O que as auditorias pedem: só consegui ler o NIST SP 800-53 Rev. 5 (o catálogo OSCAL), que tem privilégio mínimo (AC-6), autorizar acesso a funções de segurança (AC-6(1)), contas não privilegiadas para tarefas que não são de segurança (AC-6(2)), restringir contas privilegiadas (AC-6(5)), revisão periódica de privilégios (AC-6(7)), registro da execução de funções privilegiadas (AC-6(9)) e gestão automatizada de contas temporárias e de emergência (AC-2(2)). PCI DSS e ISO 27001 pedem coisas parecidas, mas o PDF do padrão PCI respondeu 403 aqui e a ISO é paga, então não cito nenhum dos dois. A página de acesso de emergência do Entra mapeia o break-glass para os procedimentos de acesso de emergência do HIPAA.

### Para onde ir depois

A lição de identidade de workload tira segredos dos serviços; esta trata do que sobra e dos administradores humanos. A lição de ameaças nomeia contas privilegiadas e logins break-glass como sinais; a lição de autorização modela o lado da política; a lição de ciclo de vida de identidade (SCIM) cobre quem sai e as contas órfãs, inclusive as contas de serviço que a fonte de RH não conhece. O próximo passo são as revisões de acesso e um job de inventário que compara o conteúdo do cofre com o que o diretório diz.

## Trade-offs

- **Dinâmico contra estático.** Credenciais por consumidor com lease são atribuíveis e expiram sozinhas (medido: role removido 20 s depois da emissão), mas exigem o cofre no caminho da partida e instruções de revogação que também matem as sessões abertas (o achado do `pg_terminate_backend`). A rotação estática serve a contas legadas.
- **JIT contra disponibilidade.** Uma concessão de 20 s ou de 8 h remove o privilégio permanente e acrescenta um passo às 3 da manhã. Guarde o break-glass para o dia em que o caminho de aprovação estiver fora, e torne mais barato usá-lo corretamente do que contorná-lo.
- **TTL curto contra rotatividade.** Tokens curtos limitam o roubo (medido: 403 na expiração) e obrigam todo cliente a renovar e tratar 403 como "expirou". Use tokens `period` para serviços longos.
- **Vault contra armazenamentos de nuvem.** O Vault dá segredos dinâmicos, uma só linguagem de política e audit devices; você opera seal, storage e upgrades. Um armazenamento de nuvem dá menos trabalho numa nuvem. Exemplo: a licença BSL do Vault permite uso interno, então a questão é operação, não licença.
- **Completude da auditoria contra disponibilidade.** O Vault recusa requisições quando nenhum audit device pode ser escrito: dois devices o mantêm no ar. Valores com hash mantêm segredos fora dos logs, e o `log_raw` desfaz isso.
- **Suíte de PAM contra solução caseira.** As suítes trazem gravação de sessão e relatórios para auditores; as 60 linhas de jq e de política aqui mostram o mecanismo, não substituem gravação e revisões.

## Documentation Links

- [Vault documentation: key concepts, dev server, HashiCorp](https://developer.hashicorp.com/vault/docs/concepts/dev-server) (doc)
- [KV version 2, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2) (doc)
- [KV v2 API, HashiCorp Vault](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2) (doc)
- [Policies, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/policies) (doc)
- [Tokens, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/tokens) (doc)
- [Lease, renew and revoke, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/lease) (doc)
- [Database secrets engine, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/databases) (doc)
- [Database secrets engine API (roles, static roles, rotate-root), HashiCorp Vault](https://developer.hashicorp.com/vault/api-docs/secret/databases) (doc)
- [LDAP secrets engine (service account check-out), HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/ldap) (doc)
- [AppRole auth method, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/auth/approle) (doc)
- [Response wrapping, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/response-wrapping) (doc)
- [Kubernetes auth method, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/auth/kubernetes) (doc)
- [JWT/OIDC auth method, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/auth/jwt) (doc)
- [Signed SSH certificates, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/ssh/signed-ssh-certificates) (doc)
- [SSH secrets engine API, HashiCorp Vault](https://developer.hashicorp.com/vault/api-docs/secret/ssh) (doc)
- [Seal and unseal, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/seal) (doc)
- [operator generate-root, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/commands/operator/generate-root) (doc)
- [Audit devices, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/audit) (doc)
- [Control groups (Enterprise), HashiCorp Vault](https://developer.hashicorp.com/vault/docs/enterprise/control-groups) (doc)
- [Vault LICENSE (BSL 1.1), HashiCorp, GitHub](https://github.com/hashicorp/vault/blob/main/LICENSE) (doc)
- [OpenBao documentation, OpenBao](https://openbao.org/docs/) (doc)
- [What is Privileged Identity Management, Microsoft Entra](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) (doc)
- [Manage emergency access accounts, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access) (doc)
- [Automate secret rotation with Event Grid, Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/secrets/tutorial-rotation) (doc)
- [Monitor Azure Key Vault, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/monitor-key-vault) (doc)
- [Rotate AWS Secrets Manager secrets, AWS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html) (doc)
- [Secret versions and staging labels, AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html) (doc)
- [Log Secrets Manager events with CloudTrail, AWS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-cloudtrail.html) (doc)
- [Secrets, Kubernetes](https://kubernetes.io/docs/concepts/configuration/secret/) (doc)
- [Encrypting confidential data at rest, Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) (doc)
- [Auditing, Kubernetes](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) (doc)
- [Check out credentials, BeyondTrust Privileged Remote Access](https://docs.beyondtrust.com/pra/v24.3/docs/check-out) (doc)
- [Privileged Access Manager architecture (Vault, CPM, PSM), CyberArk Docs](https://docs.cyberark.com/pam-self-hosted/latest/en/content/pasimp/privileged-account-security-solution-architecture.htm) (doc)
- [Password Safe sessions, BeyondTrust Docs](https://docs.beyondtrust.com/bips/docs/ps-sessions) (doc)
- [Palo Alto Networks completes acquisition of CyberArk, Palo Alto Networks](https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-completes-acquisition-of-cyberark-to-secure-the-ai-era) (doc)
- [NIST SP 800-53 Rev. 5, Security and Privacy Controls, NIST](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) (doc)
- [NIST SP 800-53 Rev. 5 OSCAL catalog (AC-6, AC-2), NIST on GitHub](https://github.com/usnistgov/oscal-content/blob/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json) (doc)
