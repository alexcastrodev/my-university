---
version: 1.0
updatedAt: 2026-08-20
title: "Segurança no Cassandra: Autenticação, RBAC e Criptografia"
summary: O modelo de segurança opt-in e plugável do Cassandra, PasswordAuthenticator e o superusuário padrão cassandra/cassandra para autenticação, CassandraAuthorizer e GRANT/REVOKE baseado em papéis para autorização, e TLS via server_encryption_options e client_encryption_options para criptografia de nó a nó e de cliente a nó em trânsito, além de por que a criptografia em repouso no nível de SSTable ainda não existe no Cassandra open source mesmo na 5.0.
---
## Objective

Aprender o modelo de segurança de três partes do Cassandra: autenticação (provar *quem* está se conectando), autorização baseada em papéis (controlar *o que* essa identidade pode fazer), e criptografia (proteger dados *em trânsito*, cliente-para-nó e nó-para-nó), e entender por que cada um deles é opt-in. O livro é explícito ao dizer que a postura de fábrica do Cassandra é totalmente aberta: "o Cassandra permite que qualquer cliente na sua rede se conecte ao seu cluster... configurado para usar um mecanismo de autenticação que permite todos os clientes, sem exigir que eles forneçam credenciais." Nada aqui é seguro por padrão; toda camada é uma interface plugável (`IAuthenticator`, `IAuthorizer`, `IRoleManager`, `IInternodeAuthenticator`) que você deliberadamente troca.

## Use Cases

- Inicializar a segurança de um cluster novo do zero: trocar `authenticator` de `AllowAllAuthenticator` para `PasswordAuthenticator`, logar com o superusuário embutido `cassandra`/`cassandra`, e imediatamente rotacionar essa senha antes de fazer qualquer outra coisa.
- Dar a um microsserviço sua própria credencial restrita: um usuário `reservation_service` com `SELECT` e `MODIFY` em exatamente um keyspace, em vez de compartilhar o login de superusuário entre toda aplicação que toca o cluster.
- Agrupar permissões em um papel (`reservation_maintenance`) uma vez que um time cresce além de "só lembrar quem tem o quê", para que adicionar ou remover o acesso de uma pessoa seja um único `GRANT`/`REVOKE` de um papel, em vez de reconciliar permissões por usuário.
- Restringir um papel a data centers específicos com `ACCESS TO DATACENTERS` em um cluster multi-DC, para que um papel de analytics lendo de um DC de relatórios não consiga tocar o DC transacional.
- Criptografar tráfego nó-a-nó (`server_encryption_options`) em um cluster que abrange data centers ou cruza qualquer fronteira de rede que você não controla totalmente, e tráfego cliente-a-nó (`client_encryption_options`) para qualquer servidor de aplicação alcançando o Cassandra sobre algo menos confiável do que uma VPC privada.
- Trancar o acesso JMX remoto (necessário uma vez que um cluster é grande o bastante para você não conseguir simplesmente entrar via SSH em cada nó para rodar `nodetool`) com um arquivo de senha, ou com a própria autenticação/autorização integrada do Cassandra.
- Ligar audit logging antes de uma revisão de conformidade, restrito a um keyspace e categoria específicos (`QUERY`, `DML`, `AUTH`, ...), para que você consiga produzir um registro de quem leu ou modificou o quê, sem pagar o custo de registrar toda operação em todo o cluster.

## Deep Dive

### Autenticação: plugável, e desligada por padrão

O autenticador padrão, `org.apache.cassandra.auth.AllowAllAuthenticator`, não faz checagem nenhuma. A alternativa que vem com o Cassandra é `org.apache.cassandra.auth.PasswordAuthenticator`, definida no `cassandra.yaml`:

```yaml
authenticator: PasswordAuthenticator
```

Uma vez que isso esteja ativo, o `cqlsh` recusa conexões anônimas diretamente (`AuthenticationFailed('Remote end requires authentication.')`). O Cassandra vem com um superusuário embutido para te passar por esse primeiro login: usuário `cassandra`, senha `cassandra`. O próximo movimento do livro é trocá-la:

```sql
cassandra@cqlsh> ALTER USER cassandra WITH PASSWORD 'Kxl0*nGpB6';
```

e ele sinaliza uma armadilha operacional real pelo caminho: o `cqlsh` escreve todo comando (incluindo senhas em texto puro digitadas na linha de comando) em `~/.cassandra/cqlsh_history`, então esse arquivo de histórico precisa ser limpo depois que você define uma senha. O comando `LOGIN` permite trocar de usuário dentro de uma sessão `cqlsh` sem reconectar, e um arquivo `.cqlshrc` permite pular digitar credenciais a cada invocação (ao custo de uma senha em texto puro sentada em um dotfile que você então precisa proteger).

Autenticação é genuinamente plugável além de senhas: implemente `IAuthenticator` para Kerberos ou um armazenamento apoiado em LDAP (tanto DataStax Enterprise quanto Instaclustr trazem essas integrações), e separadamente, `IInternodeAuthenticator` controla quais nós têm permissão de se conectar uns aos outros de forma alguma, com padrão `AllowAllInternodeAuthenticator`, que não faz checagem nenhuma.

A partir de código de aplicação, o driver Java DataStax autentica com:

```java
CqlSession session = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("127.0.0.1", 9042))
    .withAuthCredentials("reservation_service", "i6XJsj!k#9")
    .build();
```

`withAuthCredentials()` registra o `PlainTextAuthProvider` padrão do driver; uma implementação customizada de `AuthProvider` troca por qualquer coisa que o lado do servidor precise combinar.

### Autorização: CassandraAuthorizer e o modelo de permissão

Autorização é uma segunda camada plugável, independente. O padrão, `org.apache.cassandra.auth.AllowAllAuthorizer`, concede a todo cliente autenticado acesso a tudo: autenticação sozinha te dá *identidade*, não *restrição*. Ligar controle de acesso real significa trocar para `org.apache.cassandra.auth.CassandraAuthorizer`:

```yaml
authorizer: CassandraAuthorizer
```

Com isso em vigor, um usuário que não é superusuário consegue navegar o schema (`DESCRIBE KEYSPACES`, `DESCRIBE TABLES`), mas é negado em qualquer acesso a dado real até que permissões sejam concedidas explicitamente:

```
reservation_service@cqlsh:reservation> SELECT * FROM reservations_by_confirmation;
Unauthorized: Error from server: code=2100 [Unauthorized]
  message="User reservation_service has no SELECT permission on
  <table reservation.reservations_by_confirmation> or any of its parents"
```

O conserto é uma concessão explícita, com escopo tão estreito ou amplo quanto a hierarquia de recursos permite (keyspace, ou uma única tabela):

```sql
cassandra@cqlsh> GRANT SELECT ON KEYSPACE reservation TO reservation_service;
cassandra@cqlsh> GRANT MODIFY ON KEYSPACE reservation TO reservation_service;
```

O vocabulário de permissão, segundo `HELP PERMISSIONS`:

| Permissão | Concede |
|---|---|
| `CREATE`, `ALTER`, `DROP` | Gerenciar keyspaces, tabelas, funções, e papéis |
| `SELECT` | Ler dados (e `get()` em MBeans) |
| `MODIFY` | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` (e `set()` em MBeans) |
| `AUTHORIZE` | `GRANT`/`REVOKE` de outras permissões: delegação administrativa |
| `DESCRIBE` | Acesso à saída de `DESCRIBE`, já que o próprio schema pode ser sensível |
| `EXECUTE` | Invocar funções e ações de MBean |

### Controle de acesso baseado em papéis

A partir da versão 2.2, permissões se anexam a **papéis**, não diretamente a contas de login individuais, e um papel pode ser concedido a outro papel, ou a um usuário, em qualquer combinação:

```sql
cassandra@cqlsh> CREATE ROLE reservation_maintenance;
cassandra@cqlsh> GRANT ALL ON KEYSPACE reservation TO reservation_maintenance;
cassandra@cqlsh> GRANT reservation_maintenance TO jeff;
```

Um papel criado dessa forma (sem senha, sem login) não pode ser logado diretamente: existe puramente como um pacote de permissões para ser anexado a contas reais. "Papéis são aditivos no Cassandra, significando que se qualquer um dos papéis concedidos a um usuário tem uma permissão específica concedida, então essa permissão é concedida ao usuário." Não existe um conceito separado de "usuário" no nível de armazenamento; o Cassandra rastreia tanto usuários quanto papéis como linhas no mesmo keyspace `system_auth`, que é por que `CREATE USER` e `CREATE ROLE` são primos próximos do mesmo mecanismo subjacente.

O Cassandra 4.0 adicionou uma quarta camada plugável, `INetworkAuthorizer`, para restringir um papel a data centers específicos:

```yaml
network_authorizer: CassandraNetworkAuthorizer
```

```sql
CREATE ROLE reservation_maintenance WITH ACCESS TO DATACENTERS {'DC1', 'DC2'};
```

> **A replicação do `system_auth` é fácil de esquecer.** O livro sinaliza isso diretamente: `system_auth` vem de fábrica com `SimpleStrategy` e `replication_factor: 1`, o que significa que "quaisquer usuários, papéis, e permissões que você configurar não vão ser distribuídos pelo cluster até que você reconfigure a estratégia de replicação do keyspace `system_auth` para combinar com a topologia do seu cluster e rode repair" nele. Pule esse passo em um cluster multi-nó e seus papéis cuidadosamente configurados podem simplesmente não existir de forma consistente em todo lugar.

### Criptografia: TLS em trânsito, não em repouso

O Cassandra criptografa dados **em trânsito** (cliente-para-nó e nó-para-nó) via TLS (ainda comumente chamado de SSL, em homenagem ao seu protocolo predecessor). Na edição do livro, **criptografia de arquivos de dados em repouso não é suportada** no Cassandra open source; essa lacuna é preenchida ou pelo DataStax Enterprise, ou por opções na camada de armazenamento, como volumes EBS criptografados.

A configuração de TLS começa com certificados: um par de chave pública/privada por nó, gerado com o `keytool` do JDK para clusters de desenvolvimento, ou assinado por uma CA real para produção:

```
$ keytool -genkey -keyalg RSA -alias node1 -keystore node1.keystore \
    -storepass cassandra -keypass cassandra \
    -dname "CN=192.168.86.29, OU=None, O=None, L=Scottsdale, C=USA"
```

Cada nó também precisa de um **truststore** contendo as chaves públicas de todo par em que deve confiar, construído exportando e importando certificados entre os keystores e truststores dos nós.

**Criptografia nó-a-nó** é o `server_encryption_options` no `cassandra.yaml`:

```yaml
server_encryption_options:
    enabled: false
    internode_encryption: none   # none | rack | dc | all
    keystore: conf/.keystore
    keystore_password: cassandra
    truststore: conf/.truststore
    truststore_password: cassandra
```

`internode_encryption` escolhe o raio de impacto: `all` criptografa todo link entre nós, `dc` só tráfego entre data centers, `rack` só tráfego entre racks. `require_client_auth` liga TLS mútuo entre nós; `require_endpoint_verification` checa o nome do nó conectante contra seu certificado.

**Criptografia cliente-a-nó** é o bloco paralelo `client_encryption_options`, com seu próprio toggle `enabled`/`optional` e seu próprio keystore/truststore (que pode reutilizar os do nó ou ser separado).

> **Prefira suítes de cifra fortes as colocando primeiro.** `cipher_suites` é uma lista de prioridade negociada entre cliente e servidor, "a mesma técnica... que seu navegador [usa] ao negociar com servidores web." Se você não controla todo cliente, remover suítes fracas completamente fecha ataques de downgrade, em vez de apenas despriorizá-las.

### Segurança JMX

Por padrão, o JMX (a interface que `nodetool` e ferramentas de monitoramento usam) só é alcançável a partir de `localhost`. Expô-lo remotamente (`LOCAL_JMX=no` em `cassandra-env.sh`) é necessário em escala de cluster, mas abre uma superfície de ataque real, então o livro o combina ou com um par de arquivos `jmxremote.password`/`jmxremote.access` (com SSL opcionalmente sobreposto via a mesma maquinaria de keystore/truststore), ou, a partir da versão 3.6, roteando a autenticação JMX através do próprio `PasswordAuthenticator`/`CassandraAuthorizer` do Cassandra, em vez de um armazenamento de credencial separado, configurado via concessões `DESCRIBE ON MBEANS`, `SELECT ON MBEAN`, `MODIFY ON MBEAN`, e `EXECUTE ON MBEAN`.

### Audit logging

O Cassandra 4.0 adicionou audit logging de primeira classe (`org.apache.cassandra.audit`, a interface `IAuditLogger`), distinto do logging completo de query, ainda que os dois compartilhem implementação. Audit logging tem escopo por keyspace, usuário, e categoria (`QUERY`, `DML`, `DDL`, `PREPARE`, `DCL`, `AUTH`, `ERROR`, `OTHER`) e é configurado no `cassandra.yaml`:

```yaml
audit_logging_options:
    enabled: true
    logger: FileAuditLogger
    included_keyspaces: reservation
    included_categories: QUERY,DML
```

Cada entrada registra o texto CQL real mais usuário, host, e timestamp: o detalhe que uma auditoria de conformidade precisa, que um log completo de query apenas de sintaxe não fornece.

### Book vs today

> **Tudo que é essencial no capítulo permanece inalterado no Cassandra atual (5.0.x, meados de 2026).** `AllowAllAuthenticator`/`AllowAllAuthorizer` continuam sendo os padrões; `PasswordAuthenticator`, `CassandraAuthorizer`, e `CassandraRoleManager` continuam sendo os substitutos opt-in descritos no livro, com a mesma sintaxe `CREATE ROLE` / `GRANT` / `ACCESS TO DATACENTERS`. O superusuário padrão `cassandra`/`cassandra` ainda existe exatamente como o livro descreve.

> **A documentação atual acrescenta um detalhe que o livro não menciona: as credenciais do superusuário padrão são lidas em consistência `QUORUM`, não a consistência de leitura usual do cluster.** Esse é um caso especial deliberado: uma leitura de baixa consistência das credenciais de superusuário durante uma interrupção poderia deixar uma credencial obsoleta ou ausente trancar de fora a única conta com garantia de existir. A documentação atual dá a sintaxe exata de desabilitação que a prosa do livro só descreve: `ALTER ROLE cassandra WITH SUPERUSER = false AND LOGIN = false;`, em vez de `DROP USER`, já que removê-la completamente pode complicar cenários de recuperação. O próprio conselho do livro (criar um novo superusuário, depois remover o status de superusuário do `cassandra`) aponta para a mesma prática; a documentação atual só torna o CQL explícito.

> **Criptografia em repouso no nível de SSTable ainda não está no Cassandra open source, mesmo na 5.0.** A afirmação do livro se mantém hoje: criptografia de commit log e hints existe desde a série 3.x (os tickets de JIRA que ele cita, `CASSANDRA-11040` e `CASSANDRA-6018`), mas criptografia completa de arquivo de dados (SSTable) permanece fora do Cassandra upstream. A solução alternativa também permanece inalterada: DataStax Enterprise, ou criptografia de disco/volume completo (LUKS, criptografia de disco no estilo EBS de provedores de nuvem) gerenciada inteiramente fora do banco de dados.

> **Um guardrail de força de senha está a caminho, mas ainda não na linha 5.0 que o livro visa.** A CEP-24 (`CASSANDRA-17457`) adiciona um validador/gerador de senha configurável, construído sobre o framework Guardrails introduzido na 4.1, que pode avisar sobre ou rejeitar senhas fracas de `CREATE ROLE`/`ALTER ROLE`. Foi lançado na linha 5.1-alpha, não na 5.0: vale a pena saber se você está planejando em torno disso, mas não muda nada sobre o comportamento da 5.0 descrito acima.

> **O depreciado `ssl_storage_port` é exatamente como o livro descreve e não avançou mais.** Desde a 4.0, tráfego entre nós criptografado e não criptografado pode compartilhar a porta de armazenamento, e a porta SSL de armazenamento separada só importa quando `enable_legacy_ssl_storage_port` é definido durante uma atualização de 3.x para 4.0. Esse caminho de atualização já é velho o suficiente para que a maioria dos clusters atuais nunca toque essa configuração, mas o mecanismo em si permanece inalterado.

## Trade-offs

- **Toda camada de segurança é opt-in, o que significa que "seguro por padrão" não é algo que você ganha de graça.** Um nó Cassandra recém-instalado aceita conexões não autenticadas e as autoriza para tudo. Essa é uma escolha de design deliberada favorecendo facilidade de começar, em vez de padrões seguros, mas significa que segurança é um checklist que você realmente precisa percorrer (autenticador, autorizador, gerenciador de papéis, TLS, JMX), não uma caixa que você pode deixar desmarcada e confiar que a plataforma cobriu.
- **O modelo de dados de anexação/upsert não tem rede de segurança equivalente para credenciais: uma senha perdida no `cqlsh_history` não é recuperável, apenas rotacionável.** Toda senha em texto puro digitada em um prompt do `cqlsh` ou em uma linha de comando `LOGIN` aterrissa em `~/.cassandra/cqlsh_history` por padrão. Não há desfazer; a mitigação é pedir senhas interativamente (nunca na linha de comando) e limpar manualmente o histórico depois de qualquer comando que incluiu uma.
- **Papéis são apenas aditivos, o que é simples de raciocinar e fácil de conceder demais.** Como permissões de todo papel concedido simplesmente se unem, não há forma de conceder um papel e depois subtrair uma permissão específica dele para um usuário: o conserto é sempre um papel mais finamente definido, não uma concessão negativa. Isso empurra em direção a muitos papéis pequenos e estritamente definidos, em vez de poucos amplos, a mesma disciplina que o próprio exemplo `reservation_maintenance` do livro modela.
- **TLS protege o fio, não o disco, e não o operador.** `server_encryption_options` e `client_encryption_options` impedem que alguém escutando a rede leia tráfego; não dizem nada sobre um disco roubado (sem criptografia de SSTable open source) ou um papel de superusuário que já pode ler qualquer coisa que o RBAC permite. Defesa em profundidade aqui significa que TLS, RBAC, e criptografia em nível de disco são três investimentos separados, não uma configuração que cobre os três.
- **Operações de certificado são um custo real, contínuo, que o tutorial de "gerar uma vez" subestima.** Todo par keystore/truststore precisa de distribuição para os nós certos, todo certificado tem uma expiração, e rotacionar uma CA comprometida significa reemitir tudo assinado sob ela. O recarregamento a quente de certificado do Cassandra 4.0 (`nodetool reloadssl`, ou um recarregamento automático de 10 minutos) remove o custo de downtime da rotação, mas não o processo operacional de gerar, assinar, e distribuir novos certificados em primeiro lugar.
- **JMX é uma segunda superfície de ataque que é fácil esquecer ao proteger o banco de dados.** Trancar a porta de transporte nativo com `PasswordAuthenticator` e `CassandraAuthorizer`, enquanto deixa o JMX aberto à rede, ou aberto com credenciais fracas baseadas em arquivo, deixa exposto controle no nível do `nodetool` sobre o cluster. O livro sinaliza isso diretamente: "seria um desperdício investir seus esforços em proteger o acesso ao Cassandra via o transporte nativo, mas deixar uma superfície de ataque importante como o JMX vulnerável."
- **Audit logging tem escopo por uma razão: registrar tudo tem um custo real de latência.** O recurso é deliberadamente restringível por keyspace, usuário, e categoria precisamente porque o objetivo de design do Cassandra para ele era "minimizar o impacto na latência de leitura e escrita." Ligar audit logging sem escopo em todo um cluster ocupado troca parte do throughput que o resto deste modelo de segurança teve o cuidado de não tocar.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 14, "Security", p. 353-378](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, Security (Authentication, Authorization, SSL/TLS, JMX, Audit Logging)](https://cassandra.apache.org/doc/latest/cassandra/operating/security.html) - doc
- [Apache Cassandra Documentation, cassandra.yaml (authenticator, authorizer, encryption options)](https://cassandra.apache.org/doc/latest/cassandra/configuration/cass_yaml_file.html) - doc
- [ASF Jira, CASSANDRA-17457, CEP-24 Password validation/generation](https://issues.apache.org/jira/browse/CASSANDRA-17457) - doc
- [Apache Cassandra Blog, 4.1 Features: Guardrails Framework](https://cassandra.apache.org/_/blog/Apache-Cassandra-4.1-Features-Guardrails-Framework.html) - doc
