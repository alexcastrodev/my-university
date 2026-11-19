---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Serviços também precisam de identidade, e a mais comum é um segredo: uma chave de API numa variável de ambiente, um client secret no CI, uma senha num config map. Ele vaza, ninguém rotaciona e não diz qual workload o usou. Identidade de workload troca isso por outra pergunta: o que prova QUEM é este processo, e essa prova pode ser de vida curta e emitida sem um humano? Esta lição mede as respostas que dá para rodar local: a sua própria CA e mTLS (o que o servidor realmente lê de um certificado), depois SPIFFE/SPIRE em Docker (SVIDs, atestação por selector, dois workloads fazendo mTLS com checagem de ID, rotação e o que "revogação" realmente é). ServiceAccount projetado do Kubernetes, federação OIDC do GitHub Actions, identidades gerenciadas de nuvem e service meshes são só documentação aqui (sem cluster, sem conta de nuvem), com a condição de confiança do caso do CI testada em código. Ferramentas: openssl, curl, jq, Node 22 (o protocolo é o ponto, não a stack).
Versions: SPIRE server e agent 1.16.0 (`ghcr.io/spiffe/spire-server:1.16.0`, `spire-agent:1.16.0`), OpenSSL 4.0.3, curl 8.7.1 (LibreSSL), jq 1.7.1, Node 22.23.4. Docs only: Kubernetes (aqui não há `kind` nem `minikube`), GitHub Actions, AWS, Azure, GCP, Istio, Linkerd.

## Use Cases

- Trocar uma chave de API ou client secret estático entre dois serviços internos.
- Revisar um pipeline que faz deploy numa nuvem com uma chave de longa vida guardada como secret do CI.
- Decidir entre mTLS com CA própria, SPIFFE/SPIRE, um mesh ou um recurso da plataforma (Kubernetes, managed identity).
- Ler um log de auditoria e responder "qual workload chamou", não só "qual usuário".

## Deep Dive

### O problema: o secret zero

Uma credencial estática tem três defeitos. É copiada (repositório, camada de imagem, log, notebook), então o vazamento é silencioso. Raramente é rotacionada, pois rotacionar exige coordenar todos os portadores. E identifica a chave, não o chamador: dois serviços que a compartilham são indistinguíveis. O que a substitui esbarra numa pergunta de bootstrap, o "secret zero": para obter uma credencial você já precisa provar algo. A resposta de todo esquema moderno é a mesma: provar com algo que a plataforma atesta (o nó, o Pod, a execução do CI), não com algo que você carrega. Na lição de OAuth isso é o grant client credentials, em que o `client_secret` é exatamente o que a identidade de workload remove; a lição de token exchange usou `a-secret` para o serviço A e o marcou como o que não se deve distribuir.

### Opção 1: certificado de uma CA própria e mTLS (medido)

Um certificado é uma chave pública assinada por uma CA em que o par confia. No mTLS os dois lados apresentam um, então a própria conexão autentica o chamador, sem segredo no fio. Uma CA descartável e três certificados de serviço, EC P-256, validade de 1 dia:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key -out ca.crt -days 30 \
  -subj "/CN=Lab Internal CA" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout billing.key -out billing.csr -subj "/CN=billing"
printf "subjectAltName=DNS:billing.lab\nextendedKeyUsage=clientAuth,serverAuth\nkeyUsage=digitalSignature\nbasicConstraints=CA:FALSE\n" > billing.ext
openssl x509 -req -in billing.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out billing.crt -days 1 -extfile billing.ext
```

```text
subject=CN=billing        issuer=CN=Lab Internal CA
notBefore=Nov 19 09:08:36 2026 GMT   notAfter=Nov 20 09:08:36 2026 GMT
X509v3 Subject Alternative Name: DNS:billing.lab      Extended Key Usage: TLS Web Client Authentication, TLS Web Server Authentication
```

O servidor (`orders`, porta 6640) são 8 linhas de Node: o TLS verifica a cadeia, a aplicação lê o certificado do par já verificado e autoriza pelo **SAN**, nunca pelo CN (a RFC 6125 e as regras do CA/Browser deprecaram o CN para nomes há anos):

```js
https.createServer({ key, cert, ca, requestCert: true, rejectUnauthorized: true }, (req, res) => {
  const c = req.socket.getPeerCertificate();
  const ok = (c.subjectaltname || '').split(', ').some(s => (allow[req.url] || []).includes(s)); // allow = {'/invoices': ['DNS:billing.lab']}
  res.writeHead(ok ? 200 : 403); res.end(JSON.stringify({ cn: c.subject.CN, san: c.subjectaltname, allowed: ok }));
}).listen(6640);
```

```text
curl --cacert ca.crt --cert billing.crt --key billing.key https://localhost:6640/invoices
  -> {"cn":"billing","san":"DNS:billing.lab","valid_to":"Nov 20 09:08:36 2026 GMT","allowed":true}  HTTP 200
reports cert (same CA, SAN reports.lab)   -> {"cn":"reports","san":"DNS:reports.lab","allowed":false}  HTTP 403
no client certificate                     -> curl: (56) ... ; server: peer did not return a certificate
cert from another CA with the SAME subject name "Lab Internal CA" (mallory)
                                          -> curl: (56) Connection reset ; server: ERR_SSL_PROVIDER_SIGNATURE_FAILURE
cert whose notAfter is in the past        -> Connection reset ; openssl s_server: "verify error:num=10:certificate has expired"
client without --cacert                   -> curl: (60) self signed certificate in certificate chain
URL name billing.lab (server cert is orders.lab/localhost) -> curl: (60) no alternative certificate subject name matches target host name
```

Duas lições. Autenticação (cadeia, validade) é trabalho do TLS e é recusada no handshake; autorização (quem pode chamar `/invoices`) continua sendo código seu: `reports` tem um certificado perfeitamente válido e recebe 403. E o caso mallory mostra como a cadeia é casada: o OpenSSL acha o emissor pelo nome e falha na ASSINATURA, então o mesmo nome com outra chave é rejeitado. O handshake em si, com `openssl s_server -Verify 1` e `s_client`, termina em `Verification: OK`, TLSv1.3, `TLS_AES_256_GCM_SHA384`, `Peer signature type: ecdsa_secp256r1_sha256`. Custo, 50 execuções contra o servidor Node: mediana de 7,1 ms por conexão nova (início do processo curl incluído) contra 0,27 ms por requisição em conexão reaproveitada: reaproveite conexões, o handshake é o preço.

O que isto não resolve: quem opera a CA, quem pode pedir a ela um certificado `billing` (isso é o secret zero de novo) e como certificados de 1 dia são renovados. Essa engrenagem é o que o SPIFFE/SPIRE acrescenta.

### SPIFFE e SPIRE: o modelo

SPIFFE é uma especificação, SPIRE é a implementação de referência. Quatro termos:

- **SPIFFE ID**: uma URI, `spiffe://<trust domain>/<path>`, o nome de um workload (`spiffe://lab.example/billing`). O trust domain é a fronteira de uma CA.
- **SVID** (SPIFFE Verifiable Identity Document): a prova desse ID. Duas formas: **X.509-SVID** (certificado com o ID como única URI SAN, usável em mTLS) e **JWT-SVID** (token assinado com `sub`, `aud`, `exp`, para onde o TLS termina, como proxies L7).
- **Trust bundle**: os certificados públicos das CAs (autoridades X.509) e as chaves JWT de um trust domain, que é como o par verifica um SVID.
- **Workload API**: um socket Unix local em que o workload pergunta "quem sou eu?" e recebe SVIDs e o bundle. Não precisa de credencial para chamar: o agent identifica o chamador pelo kernel.

O SPIRE tem um **server** (a CA e o registro de entradas) e um **agent** em cada nó. A identidade é emitida em duas atestações. **Atestação do nó**: o agent prova ao server em que nó roda, com um documento da plataforma (identidade de instância AWS, PSAT do Kubernetes, Azure MSI, TPM...) ou, no laboratório, um `join_token` de uso único. **Atestação do workload**: quando um processo chama a Workload API, o agent pergunta ao kernel e a plugins sobre ele (uid e caminho Unix, namespace, ServiceAccount e labels do Pod no Kubernetes, labels do Docker), produzindo **selectors**. Uma **entrada** no server diz "pai = este agent, selectors = estes, ID = este", e o agent entrega o SVID correspondente a quem chamou. Nada no workload guarda segredo.

### SPIRE em Docker (medido)

Laboratório: `idn-wl-spire-server` e `idn-wl-spire-agent` numa rede Docker privada, trust domain `lab.example`, datastore SQLite, `join_token` para o nó e `unix` para workloads (o par mais simples que funciona em Docker), TTL do SVID de 2 minutos para a rotação ficar visível. As imagens são distroless (sem shell), então aqui um workload é o próprio binário `spire-agent` rodado com `docker exec -u <uid>`, e o selector é o uid. A configuração do server, só o que importa:

```text
server { trust_domain = "lab.example"  ca_ttl = "24h"  default_x509_svid_ttl = "2m"  default_jwt_svid_ttl = "2m" }
plugins { DataStore "sql" {...sqlite3}  NodeAttestor "join_token" {}  KeyManager "memory" {} }
```

```text
$ spire-server token generate -ttl 300                       # credencial de nó de uso único
agent log: Node attestation was successful reattestable=false
           spiffe_id=spiffe://lab.example/spire/agent/join_token/f17b600e-...
$ spire-server entry create -parentID <id desse agent> -spiffeID spiffe://lab.example/billing -selector unix:uid:1001
$ spire-server entry create -parentID <id desse agent> -spiffeID spiffe://lab.example/orders  -selector unix:uid:1002
```

Os workloads pedem a identidade (uid 1001, 1002 e depois 1003, que não tem entrada):

```text
uid 1001: SPIFFE ID: spiffe://lab.example/billing   SVID Valid After 09:09:59, Valid Until 09:12:09   (CA válida até o dia seguinte 09:09:30)
uid 1002: SPIFFE ID: spiffe://lab.example/orders
uid 1003: rpc error: code = PermissionDenied desc = no identity issued          (log do agent: registered=false)
```

A primeira busca, poucos segundos depois de criar as entradas, também falhou com o mesmo erro: o agent sincroniza entradas num intervalo (5 s por padrão), então uma entrada nova leva alguns segundos para ficar visível. O X.509-SVID, decodificado com openssl:

```text
subject=C=US, O=SPIRE      issuer=C=US, O=SPIFFE, serialNumber=8691...5765
notBefore=09:09:59  notAfter=09:12:09          (janela de 130 s para um TTL de 120 s: o início é recuado 10 s por causa de clock skew)
X509v3 Subject Alternative Name: URI:spiffe://lab.example/billing
Key Usage (critical): Digital Signature, Key Encipherment, Key Agreement    EKU: Server Auth, Client Auth    CA:FALSE
$ openssl verify -CAfile bundle.0.pem svid.0.pem   -> svid.0.pem: OK
```

A identidade é a URI SAN: sem hostname, sem CN. O bundle é a CA de `spiffe://lab.example`. Um **JWT-SVID** para a audience `orders.lab` (`spire-agent api fetch jwt -audience orders.lab`), decodificado:

```text
header : {"alg":"ES256","kid":"87ANiYLUqY1Zy2c2hhOwpf5UZBFWx8xf","typ":"JWT"}
payload: {"aud":["orders.lab"],"exp":1795079541,"iat":1795079421,"sub":"spiffe://lab.example/billing"}
spire-agent api validate jwt -audience orders.lab    -> SVID is valid.  SPIFFE ID : spiffe://lab.example/billing
spire-agent api validate jwt -audience payments.lab  -> SVID is not valid: expected audience in ["payments.lab"] (audience=["orders.lab"])
```

O `aud` é obrigatório e o verificador deve exigir o seu próprio: a mesma defesa contra replay do OAuth (um JWT-SVID é bearer e funciona para quem o tiver, então mantenha-o curto e preso a uma audience; prefira o X.509-SVID onde você controla o endpoint TLS).

### Dois workloads, mTLS, autorização por SPIFFE ID (medido)

`orders` (uid 1002) escuta com o seu SVID; `billing` (1001) e `reports` (1003, com uma entrada temporária) conectam com os deles. Os dois lados verificam a cadeia contra o bundle, e a checagem de identidade substitui a comparação de hostname: o cliente exige que a URI SAN do servidor seja `spiffe://lab.example/orders`, e o servidor tem uma allow list de SPIFFE IDs.

```js
const spiffeId = c => (c.subjectaltname || '').split(', ').find(s => s.startsWith('URI:spiffe://'))?.slice(4);
// server: tls.createServer({ key, cert, ca: bundle, requestCert: true, rejectUnauthorized: true }, s => { allowed = spiffeId(...) === 'spiffe://lab.example/billing' })
// client: tls.connect({ key, cert, ca: bundle, checkServerIdentity: (_, c) => spiffeId(c) === 'spiffe://lab.example/orders' ? undefined : new Error(...) })
```

```text
u1001: {"caller":"spiffe://lab.example/billing","allowed":true}
u1003: {"caller":"spiffe://lab.example/reports","allowed":false}
```

`reports` completa o handshake (SVID válido da mesma CA) e é recusado pela allow list, a mesma divisão do laboratório com openssl: a cadeia prova o ID, uma checagem de ID autoriza. Em produção isso é feito num proxy (Envoy SDS), numa biblioteca (`go-spiffe`, `java-spiffe`) ou no mesh, não à mão.

### Rotação e "revogação" (medido)

```text
09:10:41 SVID de reports criado   09:10:51 SVID do agent renovado   09:11:05 orders renovado   09:11:10 billing renovado
serial de billing 87DB52EA... (09:09:59, 09:12:09)  ->  2CFFC0A4... (09:11:00, 09:13:10)
```

O agent renova com mais ou menos metade da vida, e o workload, observando o stream da Workload API, recebe o novo SVID sem reiniciar. Agora a pergunta difícil. Entrada de `reports` apagada às 09:11:24:

```text
09:11:32  busca como uid 1003 -> rpc error: code = PermissionDenied desc = no identity issued
09:11:32  o SVID já emitido: notAfter 09:12:41, `openssl verify -CAfile bundle.0.pem svid.0.pem` -> OK
```

Apagar a entrada impede a emissão FUTURA (em até uma sincronização), mas um SVID já em mãos continua verificando até expirar. Listas de revogação X.509 não são como isso funciona: o controle é o TTL curto (padrão de 1 hora no SPIRE, 2 minutos aqui), então a janela de revogação é igual ao TTL. Escolha-o como escolheria o tempo de vida de um access token. Duas notas de produção do próprio laboratório: o `join_token` é um segredo bearer de uso único do agent (o secret zero saiu do workload e foi para o nó), e o log do agent avisou `reattestable=false`: com esse attestor um agent reiniciado não consegue uma identidade nova sem um token novo. Attestors de plataforma (`k8s_psat`, `aws_iid`, `azure_msi`, `gcp_iit`, `tpm_devid`, `x509pop`; só documentação aqui) provam o nó a partir da plataforma e podem reatestar sozinhos, e por isso `join_token` é coisa de laboratório.

### ServiceAccount tokens do Kubernetes (docs only: sem cluster aqui)

Não há `kind` nem `minikube` neste laboratório, então nada abaixo foi executado. Todo Pod roda como um ServiceAccount e, desde o Kubernetes 1.22, a credencial é um **token projetado e vinculado** obtido pela TokenRequest API, não um Secret guardado. Na spec do pod:

```yaml
volumes: [{ name: vault-token, projected: { sources: [{ serviceAccountToken: { path: vault-token, expirationSeconds: 7200, audience: vault } }] } }]
```

O kubelet o solicita e renova; o JWT carrega `iss` (o issuer do cluster), `aud` (o que você pediu, ou o padrão do API server), `exp` e uma claim `kubernetes.io` com o namespace, o ServiceAccount e o Pod ao qual está vinculado, então apagar o Pod o invalida. Como a audience é escolhida por token, um Pod pode ter um token que só o Vault aceita e nenhum utilizável contra o API server. Quando `--service-account-issuer` é uma URL HTTPS, o API server publica `/.well-known/openid-configuration` e `/openid/v1/jwks` (legíveis por todo ServiceAccount via `system:service-account-issuer-discovery`), e um sistema externo valida o token como qualquer token OIDC: é isso o "Kubernetes como provedor de identidade". As lições de Kubernetes daqui já mostram um token real decodificado (k3s) e o lado de automount e RBAC; esta lição só acrescenta a visão de identidade: o ServiceAccount é o ID do workload, e o que ele pode fazer dentro do cluster é RBAC.

### Federação do CI: OIDC do GitHub Actions (docs only, condição de confiança testada)

A má prática clássica é uma chave de acesso da nuvem guardada como secret do CI. Com federação OIDC o workflow pede um JWT ao GitHub e a nuvem (ou o Vault) o troca por credenciais de vida curta. O issuer do GitHub é `https://token.actions.githubusercontent.com` (o documento de discovery é público: `jwks_uri` `.../.well-known/jwks`, algoritmo `RS256`, claims como `sub`, `aud`, `repository`, `repository_id`, `repository_owner_id`, `ref`, `environment`, `job_workflow_ref`, `workflow_ref`). A doc não traz um token completo de exemplo, então o payload abaixo foi montado a partir da tabela de claims e dos formatos de `sub`, não é um token capturado:

```text
{"iss":"https://token.actions.githubusercontent.com","aud":"sts.lab.example",
 "sub":"repo:octo-org/octo-repo:ref:refs/heads/main","repository":"octo-org/octo-repo","ref":"refs/heads/main"}
```

A segurança está inteira na condição de confiança que o role guarda. O `gh-trust.mjs` avalia três condições (glob no `sub`, com `iss` e `aud` checados) contra quatro valores de `sub`:

```text
condição repo:octo-org/*                              ALLOW main, ALLOW pull_request, ALLOW side-project:anything, ALLOW environment:production
condição repo:octo-org/octo-repo:ref:refs/heads/main  ALLOW main, deny nos outros três
condição repo:octo-org/octo-repo:environment:production   ALLOW só o job do environment production
```

O erro clássico é a primeira: qualquer repositório da organização, qualquer branch ou pull request, assume o role, e um repositório de hobby ou um PR vindo de uma branch vira porta de entrada para produção. Fixe o `sub` num repositório E num ref ou environment (environments podem exigir aprovação), mantenha `aud` específico e use as claims `repository_id` e `repository_owner_id` (a doc as recomenda, pois nomes podem ser renomeados ou registrados de novo). Nunca confie só no issuer: ele assina tokens de todos os repositórios do GitHub.

### Identidades de nuvem e mesh (docs only, o princípio)

O mesmo formato em todo lugar: a plataforma atesta o workload e a nuvem troca essa prova por uma credencial de vida curta, então nenhuma chave fica guardada. **Azure**: managed identities para recursos do Azure e Workload Identity Federation para issuers OIDC externos como Kubernetes ou GitHub, com uma credencial federada que casa `issuer`, `subject`, `audience`. **AWS**: IAM roles for service accounts (IRSA) e EKS Pod Identity (um agent no nó entrega credenciais ao Pod), com uma trust policy do role sobre o `sub` do token. **GCP**: Workload Identity Federation com attribute conditions. **Meshes** (Istio, Linkerd): o sidecar ou o proxy de nó obtém um certificado de workload de vida curta por ServiceAccount (o Istio usa SPIFFE IDs no formato `spiffe://<domínio>/ns/<namespace>/sa/<serviceaccount>`) e faz mTLS entre serviços automaticamente, então as apps ganham criptografia e identidade sem código. A autorização você escreve sobre a identidade (`AuthorizationPolicy`), a mesma allow list de antes.

### O antipadrão: token de usuário entre serviços

Um atalho tentador é repassar o access token do usuário de serviço em serviço como "identidade". Ele falha na audience, esconde qual serviço agiu e dá a cada serviço da cadeia toda a autoridade do usuário; a lição de token exchange mediu isso no fio. A identidade de workload é a outra metade: serviços se autenticam como eles mesmos (esta lição), e o usuário é carregado como dado ou como token delegado (aquela lição), nunca emprestando a credencial do usuário como identidade do serviço. As duas camadas devem aparecer no log de auditoria.

### Rotação, auditoria e atribuição

- **Rotação**: automática e rotineira (renovação na metade da vida, medida), ou você não faz. Uma credencial que precisa de um humano para rotacionar será rotacionada raramente.
- **Revogação**: pelo tempo de vida (medido: o SVID antigo verificou até o `notAfter`). Para corte mais rápido use TTL de minutos, uma regra de negação na camada de política, ou os dois; não dependa de CRLs para certificados de workload.
- **Atribuição**: registre o ID verificado no chamado (`spiffe://lab.example/billing`, o SAN do certificado, o `sub` do ServiceAccount, o `sub` do GitHub), mais o usuário (`sub`, `act`) se houver. "Qual workload chamou qual" é a trilha de que um incidente precisa e que uma chave de API compartilhada não dá.
- **Secret zero, resumido**: o SPIRE o leva para a atestação do nó (a plataforma atesta), o Kubernetes o leva para o kubelet, a federação do CI o leva para a chave de assinatura da plataforma de CI. Cada um desloca a confiança para um lugar menor e mais bem guardado. A NIST SP 800-207 (Zero Trust) enquadra isso: autenticar e autorizar toda requisição de workload, sem confiança por localização na rede.

### Qual mecanismo, e a armadilha

| Mecanismo | O que prova | Vida da credencial | Quem valida | Armadilha |
|---|---|---|---|---|
| Chave de API ou secret estático | posse da string | até alguém rotacionar | o chamado compara | copiado, compartilhado, sem atribuição |
| Client credentials com secret | o cliente sabe o segredo | token em minutos, segredo longo | o authorization server | o segredo é o secret zero de novo |
| mTLS, CA própria | portador de uma chave assinada pela CA | certificado de dias a semanas, como você emitir | o par TLS, depois a app no SAN | sem automação: renovação e quem pode pedir certificado |
| SPIFFE/SPIRE X.509 ou JWT SVID | nó atestado mais selectors do workload | minutos a 1 hora, rotação automática | o par contra o bundle, allow list de IDs | revogação = TTL; `join_token` é só de laboratório |
| Token projetado do Kubernetes | este Pod, este ServiceAccount, esta audience | `expirationSeconds`, renovação automática | o API server ou qualquer verificador OIDC via JWKS | o verificador não checar a audience |
| OIDC de CI (GitHub Actions) | esta execução deste repositório, ref, environment | o token em minutos, depois credenciais da nuvem | a nuvem ou o Vault por `iss`, `aud`, `sub` | `sub` frouxo como `repo:org/*` |
| Managed identity de nuvem | este recurso ou Pod, pela plataforma | minutos a horas | o IAM da nuvem | uma identidade compartilhada por muitos workloads |
| mTLS de mesh (Istio, Linkerd) | o proxy deste ServiceAccount | horas, rotação automática | o proxy do par | identidade só tão fina quanto o ServiceAccount |

### Para onde ir depois

Token exchange (I13) leva o usuário entre serviços depois que cada serviço tem identidade própria; a lição de segurança do OAuth cobre amarrar tokens a um certificado (`cnf`, RFC 8705), que é o lado OAuth do mTLS medido aqui. Armazenamento de segredos, cofres, rotação e acesso privilegiado just-in-time (I20) cobrem as credenciais que sobram depois de remover o que dá.

## Trade-offs

- **CA própria contra SPIRE.** openssl e um script bastam para poucos serviços e ensinam o protocolo, mas renovação, distribuição e "quem pode ter qual nome" viram código seu; o SPIRE automatiza os três ao custo de operar um server, agents e o registro de entradas.
- **X.509-SVID contra JWT-SVID.** O X.509 não é replayável sem a chave privada e serve para mTLS; o JWT-SVID atravessa proxies que terminam TLS, mas é um bearer token, então mantenha-o curto e preso a uma audience.
- **TTL curto contra carga.** Um TTL de 2 minutos deixa a revogação rápida (medido: um SVID emitido só parou de verificar na expiração de 2 minutos) e a renovação constante; uma hora é mais fácil de operar e uma exposição mais longa.
- **Autenticação contra autorização.** Um SVID ou certificado válido (`reports` aqui) não é permissão: mantenha uma allow list ou um motor de políticas sobre o ID.
- **Identidade da plataforma contra portabilidade.** IRSA, managed identity e tokens projetados dão menos trabalho numa plataforma; o SPIFFE dá um ID só entre nuvens e VMs, com uma operação maior.

## Documentation Links

- [SPIFFE Concepts, SPIFFE](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/) (doc)
- [SPIRE Concepts, SPIFFE](https://spiffe.io/docs/latest/spire-about/spire-concepts/) (doc)
- [Registering workloads, SPIFFE](https://spiffe.io/docs/latest/deploying/registering/) (doc)
- [The X.509-SVID specification, SPIFFE](https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md) (doc)
- [The JWT-SVID specification, SPIFFE](https://github.com/spiffe/spiffe/blob/main/standards/JWT-SVID.md) (doc)
- [Service Accounts, Kubernetes](https://kubernetes.io/docs/concepts/security/service-accounts/) (doc)
- [Managing Service Accounts (projected tokens, issuer discovery), Kubernetes](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/) (doc)
- [OpenID Connect in GitHub Actions (security hardening), GitHub Docs](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) (doc)
- [OpenID Connect reference (claims), GitHub Docs](https://docs.github.com/en/actions/reference/security/oidc) (doc)
- [Workload identities overview, Microsoft Learn](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-overview) (doc)
- [EKS Pod Identity, AWS](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html) (doc)
- [Workload Identity Federation, Google Cloud](https://cloud.google.com/iam/docs/workload-identity-federation) (doc)
- [Istio security concepts, Istio](https://istio.io/latest/docs/concepts/security/) (doc)
- [Automatic mTLS, Linkerd](https://linkerd.io/2/features/automatic-mtls/) (doc)
- [RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc8705) (doc)
- [NIST SP 800-207, Zero Trust Architecture, NIST](https://csrc.nist.gov/pubs/sp/800/207/final) (doc)
