---
version: 1.0
updatedAt: 2026-11-19
title: "Active Directory e Entra ID: Domínios, Florestas e Híbrido"
summary: O Active Directory medido contra um domínio compatível (Samba 4.22.11, lab.test, dois DCs) em Docker, e o Entra ID e o híbrido só pela documentação. Floresta, domínio, DC, Global Catalog, sites e DNS SRV, objetos e os quatro nomes de um usuário (DN, sAMAccountName, UPN, objectGUID e objectSid decodificados, com o RID), tipos e escopos de grupo, AGDLP, memberOf contra tokenGroups e o filtro LDAP_MATCHING_RULE_IN_CHAIN, bits de userAccountControl e filtro bit a bit, as duas portas (LDAP com StartTLS ou GSSAPI, Kerberos), replicação multi-master, pools de RID e FSMO medidos com dois DCs, GPO como objeto mais SYSVOL, política de senha padrão. Depois Entra ID (tenant, app registration contra enterprise application, permissões delegadas contra de aplicação, consentimento, Conditional Access, PIM, managed identities), sincronização híbrida (Entra Connect, Cloud Sync, source anchor ms-DS-ConsistencyGuid), PHS contra PTA contra federação, Seamless SSO, hybrid join, o atrito do UPN, segurança em prosa e uma tabela AD contra Entra.
---
## Objective

O Active Directory Domain Services (AD DS) é o diretório em que a maioria das empresas ainda roda o parque Windows: uma floresta de domínios, controladores de domínio que replicam entre si e duas portas de entrada, LDAP e Kerberos. O Microsoft Entra ID (antes Azure AD) é outro produto: um provedor de identidade na nuvem que se fala com OAuth 2.0, OIDC, SAML e Microsoft Graph, e não "o AD na nuvem". Esta lição roda um domínio compatível com AD (Samba, `lab.test`, dois DCs) para medir objetos, SIDs, GUIDs, nomes, grupos, `userAccountControl`, consultas de grupos aninhados, logins por Kerberos e LDAP, replicação, pools de RID e FSMO. O Entra ID e as peças híbridas (Entra Connect, Cloud Sync, PHS, PTA, AD FS, Seamless SSO) são só documentação: aqui não há Windows Server nem tenant. Os ataques ficam em prosa. O Samba é compatível com o AD, não é o Windows AD.
Versions: Samba 4.22.11 (Debian 13 `samba`, `samba-ad-dc`, `samba-ad-provision` 4.22.11+dfsg-0+deb13u1, imagem própria sobre `debian:trixie`, arm64), cliente MIT Kerberos 1.21.3, clientes OpenLDAP 2.6.10, Docker 29.9.2. As datas das páginas do Learn estão em cada seção.

## Use Cases

- Ler um DN, UPN, SID ou `memberOf` de um diretório corporativo e saber qual deles é uma chave estável.
- Escolher, para um app novo, entre "logar no AD" (LDAP, Kerberos) e "logar no Entra" (OIDC, SAML).
- Saber o que o Entra Connect e o Cloud Sync levam para a nuvem e o que cada método de login muda.

## Deep Dive

### O laboratório, e o que o Samba é e não é

Uma imagem, dois containers numa rede privada (`idn-ad-dc1`, `idn-ad-dc2`, sem portas publicadas):

```text
$ samba-tool domain provision --realm=LAB.TEST --domain=LAB --server-role=dc --dns-backend=SAMBA_INTERNAL --use-rfc2307
ERROR: File [.../AD_DS_Attributes_Windows_Server_v1903.ldf] not found. Please install samba-ad-provision package
$ samba-tool domain level show      ->  Forest and Domain function level: (Windows) 2008 R2
```

O primeiro provision falhou no Debian 13: os arquivos de schema estão em `samba-ad-provision`, não em `samba-ad-dc`. O wiki do Samba também dá 2008 R2 (um nível mais alto, desde a 4.19, é trabalho em andamento). KDC, LDAP, DNS e replicação são tarefas de um único processo `samba`. Não dá para medir aqui: gMSA, LAPS, os padrões do Windows, o Entra.

### Floresta, domínio, DC, site

Uma **floresta** é a fronteira de segurança e compartilha um schema. Um **domínio** (`lab.test`) é a unidade de replicação e de política. Um **controlador de domínio** guarda uma cópia gravável. O **Global Catalog** (GC) guarda uma cópia parcial de todos os domínios (portas 3268 e 3269). Os **sites** modelam a rede para o cliente escolher um DC próximo. O rootDSE e o DNS mostram a forma:

```text
namingContexts: DC=lab,DC=test | CN=Configuration,... | CN=Schema,CN=Configuration,... | DC=DomainDnsZones,... | DC=ForestDnsZones,...
domainFunctionality: 4   forestFunctionality: 4   isGlobalCatalogReady: TRUE
anonymous search of DC=lab,DC=test -> Operations error (1): 00002020: Operation unavailable without authentication
_ldap._tcp.lab.test SRV 0 100 389 dc1.lab.test.    _kerberos._tcp.lab.test SRV ... 88    _gc._tcp.lab.test SRV ... 3268
```

O anônimo só lê o rootDSE. Uma busca de subárvore a partir da raiz do domínio devolveu três "search references" (Configuration e duas zonas DNS): outro naming context é um referral. Os clientes acham os DCs por registros SRV no DNS, então DNS quebrado derruba o login primeiro.

### Objetos e os nomes de um usuário

Criei `OU=Staff` e `OU=Eng,OU=Staff`, os usuários `alice` e `bob`, um computador `ws01` e grupos, e li a alice por StartTLS:

```text
dn: CN=Alice Doe,OU=Eng,OU=Staff,DC=lab,DC=test         objectClass: top, person, organizationalPerson, user
sAMAccountName: alice   userPrincipalName: alice@lab.test   userAccountControl: 512   primaryGroupID: 513
objectGUID:: 7EJvKhXmTUOPFeUNrXt3cw==    objectSid:: AQUAAAAAAAUVAAAAonVJRUKHeBmnTrkjTwQAAA==
memberOf: CN=GG-Developers,OU=Staff,DC=lab,DC=test
```

| Nome | Valor | Muda quando | Use como |
|---|---|---|---|
| DN | `CN=Alice Doe,OU=Eng,...` | renomear ou mover | nunca como chave; o RDN é `CN`, não `uid` |
| `sAMAccountName` | `alice` (`LAB\alice`) | o admin edita | nome de logon legado |
| `userPrincipalName` | `alice@lab.test` | o admin edita | nome de logon moderno, parece e-mail, não é e-mail |
| `objectGUID` | `2a6f42ec-e615-...` | nunca | chave estável na floresta |
| `objectSid` | `S-1-5-21-...-1103` | mudança de domínio | o que ACLs e tokens do Windows guardam |

Decodificado com 10 linhas de Python, o SID é revisão 1, 5 sub-autoridades, autoridade 5, depois `21`, três números de 32 bits do domínio e o **RID** `1103`. As quatro primeiras sub-autoridades nomeiam o domínio e o RID, a conta; RIDs conhecidos: 500 Administrator, 502 krbtgt, 512 Domain Admins, 513 Domain Users (Learn "Security identifiers", 2025-06-26). O `objectGUID` é mixed-endian: os bytes crus `ec426f2a15e6...` são `2a6f42ec-e615-434d-8f15-e50dad7b7773`, e lidos de forma ingênua dão outro GUID.

Bind com a senha da alice (`ldapwhoami -ZZ`): `alice@lab.test`, `LAB\alice` e o DN deram `u:LAB\alice`; o `alice` puro deu `Invalid credentials (49) ... data 52e`. Depois de trocar o UPN dela para `alice@corp.example`, ele e o antigo `alice@lab.test` continuaram funcionando: o Samba cai para `sAMAccountName@domínio` (observado, não testado no Windows).

`(objectClass=user)` devolveu também `DC1$` e `ws01$`: `computer` é subclasse de `user` (`subClassOf: user`), então pessoas são `(&(objectCategory=person)(objectClass=user))`. O schema é um dado legível (269 classes, 1.499 atributos aqui).

### Grupos: tipo, escopo, aninhamento e o filtro em cadeia

**Tipo**: segurança (vale em permissões) ou distribuição (listas de e-mail). **Escopo**: global (membros do próprio domínio), domain local (concede acesso no domínio, membros de qualquer lugar) e universal (da floresta, no GC), segundo o Learn "Security groups" (2025-07-02). `groupType` lido: `GG-Developers` `-2147483646` (segurança, global), `DL-Repo-Write` `-2147483644` (segurança, domain local), `UG-Mail-List` `8` (distribuição universal); o bit de sinal é "segurança". **AGDLP**: Accounts em grupos Global (por papel), Global em Domain Local (um por recurso), Permission no Domain Local. Montei: alice em `GG-Developers` em `GG-Engineers` em `DL-Repo-Write`.

```text
alice memberOf (direct only):  CN=GG-Developers,OU=Staff,DC=lab,DC=test
(&(objectCategory=person)(memberOf=CN=DL-Repo-Write,...))                          -> 0 entries
(&(objectCategory=person)(memberOf:1.2.840.113556.1.4.1941:=CN=DL-Repo-Write,...)) -> CN=Alice Doe
(memberOf:1.2.840.113556.1.4.1941:=CN=DL-Repo-Write,...)  -> GG-Developers, Alice Doe, GG-Engineers
tokenGroups of alice: -1106 (GG-Developers) -1105 (GG-Engineers) -1107 (DL-Repo-Write) -513 (Domain Users) S-1-5-32-545 (Builtin Users)
```

O `memberOf` é de um nível só. O `LDAP_MATCHING_RULE_IN_CHAIN` (`1.2.840.113556.1.4.1941`, Learn "Search filter syntax") percorre o aninhamento dentro do servidor, com custo quando há muita ramificação. O `tokenGroups` é a lista achatada de SIDs que um logon recebe, e inclui o `513`, o grupo primário, que o `memberOf` nunca mostra: perguntar "a alice está em Domain Users?" pelo `memberOf` está errado. No OpenLDAP (lição de LDAP) o `memberOf` é um overlay, os filtros não são recursivos e o RDN é `uid=`.

### `userAccountControl`: um campo de bits, buscado com filtros de bits

O UAC junta o estado da conta num inteiro (Learn "useraccountcontrol", 2026-02-12). Medido:

```text
new user 512 (NORMAL_ACCOUNT)   setexpiry --noexpiry 66048 (+DONT_EXPIRE_PASSWORD 65536)   disable 66050 (+ACCOUNTDISABLE 2)   enable 66048
ws01$ 4098 (WORKSTATION_TRUST 4096 + disabled until joined)     krbtgt 514 (disabled: nobody logs in as krbtgt)
delegation for-any-service bob on -> 524800 (512 + TRUSTED_FOR_DELEGATION 524288)     DC1$ 532480 (SERVER_TRUST 8192 + 524288)
(userAccountControl:1.2.840.113556.1.4.803:=2) -> Guest, krbtgt, ws01$, bob           # LDAP_MATCHING_RULE_BIT_AND: disabled accounts
```

A delegação restrita é um atributo: `samba-tool delegation add-service bob cifs/dc1.lab.test` gravou `msDS-AllowedToDelegateTo`, e `samba-tool spn add HTTP/web.lab.test bob` pôs um SPN num usuário (a superfície do Kerberoasting da lição de Kerberos). `NOT_DELEGATED` (1048576) é "não pode ser delegada". `msDS-` é o namespace de extensão do AD: `msDS-KeyVersionNumber: 2` é o `kvno`.

### As duas portas: LDAP e Kerberos

```text
ldapsearch -x -H ldap://127.0.0.1 -D alice@lab.test -w ... -> Strong(er) authentication required (8): Transport encryption required
same with -ZZ (StartTLS) -> works      kinit alice@LAB.TEST ; ldapwhoami -Y GSSAPI -> SASL data security layer installed.  u:LAB\alice
klist -e: krbtgt/LAB.TEST@LAB.TEST, 10 h, renew 1 d, aes256-cts-hmac-sha1-96     kvno cifs/dc1.lab.test: kvno = 1
smbclient //dc1.lab.test/netlogon -k -c ls -> lists      wrong password: Password incorrect      disabled bob: credentials have been revoked
```

O Samba recusa por padrão um simple bind sem criptografia (`ldap server require strong auth = Yes`); o Windows tem políticas de "LDAP signing" (não verificado). Os tickets são os da lição de Kerberos, vindos de um KDC do AD achado por `_kerberos._tcp`, com o `krbtgt` (RID 502) guardando a chave e os SIDs de grupo no PAC. O GSSAPI dá um bind autenticado com camada de assinatura e sem TLS. Pegadinha: o `ldapwhoami -Y GSSAPI` falhou primeiro com `Server not found in Kerberos database`; `rdns = false` não resolveu, `SASL_NOCANON on` no `ldap.conf` resolveu (a biblioteca canonicalizou o nome do host, provavelmente por DNS reverso; não verificado). O LDAP é como os apps leem e fazem bind, o Kerberos é como os membros entram.

### Replicação multi-master, pools de RID e FSMO

Todo DC é gravável. `samba-tool domain join lab.test DC` criou o `dc2`; o `drs showrepl` nele listou `DC1 via RPC` como vizinho de entrada de cinco naming contexts. Um usuário criado no `dc1` apareceu no `dc2` em até uma checagem de 5 segundos, antes de eu forçar qualquer coisa. O **RID master** entrega um bloco a cada DC, e assim os SIDs não colidem:

```text
CN=RID Set,CN=DC1,...  rIDAllocationPool: 1100-1599      carol created on dc1 -> RID 1111
CN=RID Set,CN=DC2,...  rIDAllocationPool: 1600-2099      dave  created on dc2 -> RID 1600
samba-tool fsmo transfer --role=rid (on dc2) -> RidAllocationMasterRole owner: DC2 ; the other four stay on DC1
```

Existem cinco papéis **FSMO** porque algumas operações não podem ser multi-master: schema master e domain naming master (por floresta), PDC emulator, RID master e infrastructure master (por domínio), segundo o Learn "operations master role placement" (2025-05-12), que também diz que o PDC emulator processa as trocas de senha.

### GPO: um objeto no diretório mais arquivos, aplicados pelo cliente

```text
samba-tool gpo listall -> {31B2F340-016D-11D2-945F-00C04FB984F9} Default Domain Policy ; {6AC1786C-...} Default Domain Controllers Policy
CN={31B2F340-...},CN=Policies,CN=System,DC=lab,DC=test: versionNumber: 0, gPCFileSysPath: \\lab.test\sysvol\lab.test\Policies\{31B2F340-...}
DC=lab,DC=test: gPLink: [LDAP://CN={31B2F340-...},CN=Policies,CN=System,DC=lab,DC=test;0]     # folders of files under SYSVOL
```

Um **Group Policy Object** é um `groupPolicyContainer` (metadados, versão) mais uma pasta no SYSVOL (as configurações), ligado a um domínio, site ou OU pelo `gPLink`. O DC não empurra nada: o cliente Windows lê os links do seu lugar na árvore e aplica os arquivos (o intervalo de atualização não foi verificado aqui), por isso desenhar as OUs é desenhar a política. O Samba hospeda GPOs; o wiki dele diz que habilitá-los exige um passo no `smb.conf`. Política de senha padrão aqui: complexidade ligada, histórico 24, tamanho mínimo 7, idade máxima 42 dias (o `kinit` avisou "expire in 41 days"), limiar de bloqueio 0: sem bloqueio, então chutar senha fica silencioso até você configurar um.

### Entra ID: o que é e o que não é (só documentação)

Páginas: "What is Microsoft Entra?" (2026-06-18), "How and why applications are added" (2022-10-26), "Permissions and consent overview" (2025-03-18). Sem tenant.

- **Um tenant é um diretório mais um IdP.** Cada um recebe `contoso.onmicrosoft.com`; quem assina Microsoft 365 ou Azure já tem um. Os objetos são acessados pelo **Microsoft Graph** (`https://graph.microsoft.com`); o login é OAuth 2.0, OIDC ou SAML. Os grupos são de segurança ou Microsoft 365, atribuídos ou **dinâmicos** (regras sobre atributos). A visão geral lista política de grupo, LDAP e Kerberos/NTLM como o que o **Entra Domain Services** acrescenta, um domínio gerenciado "para aplicações legadas" e "transitório". Uma frase "o Entra ID não tem OUs nem GPO" não está nas páginas lidas, mas essa divisão de produto diz isso. A ferramenta parecida com OU é a **administrative unit**: um contêiner de usuários, grupos ou dispositivos que delimita um papel, não uma política.
- **App registration contra Enterprise application.** O *application object* (App registrations) é a definição, no tenant de origem: redirect URIs, segredos, scopes, app roles. O *service principal* (Enterprise applications) é a instância em cada tenant que a usa: atribuições, consentimentos e Conditional Access vivem nele; o primeiro consentimento o cria. O cliente OIDC da lição de .NET é o primeiro, o que o admin governa é o segundo.
- **Permissões delegadas contra de aplicação.** As delegadas (scopes) agem em nome de um usuário logado e não passam do que ele pode; as de aplicação (app roles) são app-only e "able to access any data that the permission is associated with". O **admin consent** do tenant inteiro é descrito como sensível. É a divisão `scp` contra `roles` da lição de .NET, e o OBO (lição de token exchange) precisa de consentimento do mesmo jeito.
- **Plano de controle**: Conditional Access (políticas se-então "enforced after first-factor authentication"), Privileged Identity Management (papéis just-in-time, elegível contra ativo, licenciado) e **managed identities** (atribuída ao sistema ou ao usuário, apoiada num service principal; a lição de workload identity compara com SPIFFE). O Application Proxy só é citado aqui.

### Híbrido: levar as identidades e escolher o caminho de login (só documentação)

Páginas: Entra Connect e "user sign-in options" (2025-04-09), Cloud Sync (2026-10-21), Seamless SSO (2025-04-09), hybrid join (2026-10-06), design concepts e PHS (2025-04-09).

**Sincronização.** O *Connect Sync* é uma aplicação Windows on-premises (motor de sync, setup de PHS, PTA e AD FS, Health). O *Cloud Sync* é um agente leve mais um serviço na nuvem que usa SCIM, a cada uns dois minutos, vários agentes, florestas desconectadas. A página do Connect diz que o Cloud Sync "is the future" e o "replaces"; a do Cloud Sync manda consultar o guia de decisão de migração e, se não servir, "continue using Connect Sync". O **source anchor** (`sourceAnchor`, `immutableId`) diz "este usuário do AD é aquele usuário do Entra": definido na instalação, imutável depois do primeiro sync. O padrão é o `objectGUID`; o Connect 1.1.524.0 em diante pode usar o **`ms-DS-ConsistencyGuid`** para usuários, copiando o `objectGUID` para ele quando vazio (a conta de sync precisa de permissão de escrita). Escolha-o se usuários se movem entre florestas, pois o `objectGUID` muda.

| Método | Senha checada em | O que chega ao Entra | Infraestrutura extra | Forma do risco |
|---|---|---|---|---|
| PHS | Entra | hash derivado (hash MD4, PBKDF2 com HMAC-SHA256, 1.000 iterações, salt por usuário) | nenhuma além do sync | o hash na nuvem não serve de pass-the-hash on-premises (doc) |
| PTA | seu DC, via agente | nada guardado; agentes só com saída | agentes, disponibilidade | política on-premises (horário de logon) respeitada; agentes viram críticos |
| Federação (AD FS, terceiros) | seu IdP | um token da sua farm | farm, proxies, certificados | mais controle, mais para operar; farm e chave de assinatura viram Tier 0 |

A página de login recomenda "the default password hash synchronization option" e o guia de migração "We recommend using PHS". Que o AD FS esteja em declínio não está dito nessas páginas; existe um guia de migração da federação para a nuvem, só isso. O **Seamless SSO** (Kerberos, o claim de SID no ticket) loga dispositivos ingressados no domínio sem prompt, funciona com PHS ou PTA, é "opportunistic" (volta a pedir a senha) e não vale para AD FS; no Windows 10 e posteriores a doc prefere o primary refresh token. O **hybrid join** mantém o dispositivo no AD e o registra no Entra (precisa de linha de visada periódica até um DC). O **password writeback** deixa o reset de senha self-service do Entra alterar a senha on-premises.

**Atrito.** O UPN é o nome de login do Entra. Se o sufixo não é um domínio personalizado verificado (`corp.local` é o clássico), o Entra o troca por `user@contoso.onmicrosoft.com`; a doc oferece um *alternate ID* (e-mail), mas recomenda "strongly" manter o `userPrincipalName`, e diz que UPN e e-mail "might or might not" coincidir. No laboratório, editar o UPN não mexeu em `sAMAccountName` nem em `mail`: são atributos separados.

### Segurança: por que o AD é o alvo, em prosa

Um DC guarda todos os hashes de senha e a chave do `krbtgt`: quem domina o AD domina a empresa. O MITRE ATT&CK cataloga o DCSync (T1003.006) e tickets e tokens forjados (T1558, T1606.002); sem receitas aqui. Controles:

- **Tiers**: mantenha o Tier 0 (DCs, `krbtgt`, admins do AD, AD FS) separado de servidores e estações. Livro contra hoje: o "enterprise access model" do Learn parte do modelo de tiers do AD e o amplia para um plano de controle; a "red forest" ESAE é "a legacy approach".
- **LAPS** gira a senha do admin local de cada máquina. **gMSA**: o DC deriva a senha do serviço de um serviço de chaves, então nenhum humano a conhece: a resposta a um SPN em usuário como o `bob`. Só documentação.
- **`krbtgt`** redefinido duas vezes após um comprometimento, **Protected Users** (sem delegação, NTLM ou RC4; no Samba o grupo existe vazio, não testado), limiar de bloqueio, LDAP signing e auditoria de quem pode replicar o diretório.

### O que usar hoje, e a tabela

Livro contra hoje: o AD DS ainda é o centro do Windows on-premises e dos apps legados (file shares, SSO Kerberos, GPO, SQL Server, IIS). Apps novos e SaaS usam OIDC ou SAML contra o Entra (ou Keycloak, Okta) e recebem identidades por SCIM. O formato comum é híbrido: o AD segue como fonte dos funcionários, um sync alimenta o Entra, PHS ou PTA é o caminho de login e app novo nunca fala LDAP com um DC. Próximo: escolher um protocolo de federação entre SAML, OIDC, Kerberos e LDAP; a lição de SCIM cobre o provisionamento.

| Conceito do AD DS | Equivalente no Entra ID | Observação |
|---|---|---|
| floresta, domínio | tenant | o tenant é a fronteira; não há árvore de domínios |
| DC, replicação, FSMO | nada exposto | a Microsoft opera; o Domain Services dá um domínio gerenciado |
| OU | administrative unit | só delimita papéis, não política |
| GPO | Conditional Access, Intune | configurações diferentes, não é tradução |
| `sAMAccountName`, UPN | UPN, object ID | o UPN precisa de um domínio verificado |
| SID, grupos com escopo | object ID (GUID), grupos de segurança e M365 | sem escopo domain local ou global |
| LDAP, Kerberos, NTLM | Graph, OIDC, SAML | Kerberos só via Seamless SSO ou Domain Services |
| gMSA, delegação | managed identity, on-behalf-of | mesma ideia, outro mecanismo |

## Trade-offs

- **Samba AD contra Windows AD.** Reproduzível num container em minutos, mas níveis 2008 R2, setup de GPO e recursos só do Windows ficaram sem medir; serve para aprender e testar, não prova o comportamento de produção.
- **Grupos aninhados (AGDLP) contra planos.** As permissões ficam nos recursos e os papéis nas pessoas, mas o `memberOf` mostra um nível e consultas em cadeia custam mais: use `tokenGroups` ou a regra em cadeia e teste a profundidade.
- **Chave estável contra nome bonito.** O `objectGUID` (object ID no Entra) sobrevive a renomeações; `sAMAccountName`, UPN e DN não.
- **PHS, PTA ou federação.** O PHS exige menos infraestrutura mas guarda um hash derivado na nuvem; o PTA mantém a política on-premises com agentes críticos; a federação dá controle e a maior superfície de ataque. A doc recomenda PHS.

## Documentation Links

- [Active Directory Domain Services overview, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/get-started/virtual-dc/active-directory-domain-services-overview) (doc)
- [Security identifiers, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-identifiers) (doc)
- [Active Directory security groups, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-groups) (doc)
- [Operations master role placement, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/plan/planning-operations-master-role-placement) (doc)
- [Search filter syntax, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/adsi/search-filter-syntax) (doc)
- [What is Microsoft Entra?, Microsoft Learn](https://learn.microsoft.com/en-us/entra/fundamentals/whatis) (doc)
- [How and why applications are added to Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/how-applications-are-added) (doc)
- [Overview of permissions and consent, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview) (doc)
- [What is Microsoft Entra Connect?, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/whatis-azure-ad-connect) (doc)
- [What is Microsoft Entra Cloud Sync?, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/cloud-sync/what-is-cloud-sync) (doc)
- [Microsoft Entra Connect user sign-in options, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/plan-connect-user-signin) (doc)
- [Password hash synchronization, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-password-hash-synchronization) (doc)
- [Microsoft Entra seamless single sign-on, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-sso) (doc)
- [Enterprise access model, Microsoft Learn](https://learn.microsoft.com/en-us/security/compass/privileged-access-access-model) (doc)
- [Setting up Samba as an Active Directory Domain Controller, Samba Wiki](https://wiki.samba.org/index.php/Setting_up_Samba_as_an_Active_Directory_Domain_Controller) (doc)
- [T1003.006, OS Credential Dumping: DCSync, MITRE ATT&CK](https://attack.mitre.org/techniques/T1003/006/) (doc)
