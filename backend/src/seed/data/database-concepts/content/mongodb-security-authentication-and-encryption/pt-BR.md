---
version: 1.0
updatedAt: 2026-08-20
title: "Segurança no MongoDB: SCRAM, Autenticação x.509, RBAC e TLS"
summary: A camada de segurança mais antiga e mais ampla do MongoDB, abaixo da criptografia em nível de campo, com autenticação SCRAM e por certificado x.509 (incluindo um tutorial completo do livro, da CA ao cluster), autorização baseada em roles desde os embutidos como readWrite e dbOwner até root, e TLS para criptografia em trânsito, além de por que o Atlas impõe TLS por padrão enquanto o MongoDB autogerenciado ainda vem com ele desligado.
---
## Objective

Entender a camada de segurança do MongoDB que fica abaixo dos recursos mais novos de criptografia em nível de campo: verificar *quem* está se conectando (autenticação, com SCRAM por padrão e certificados x.509 para garantias de identidade mais fortes), controlar *o que* uma conexão autenticada pode fazer (autorização via controle de acesso baseado em roles) e proteger os dados *em trânsito* entre clientes e os processos `mongod` e `mongos` (TLS/SSL). O capítulo de segurança do livro é explícito ao dizer que essas são três preocupações separadas ("habilitar a autorização e impor a autenticação", "criptografar a comunicação", "criptografar os dados") e percorre as duas primeiras em profundidade com um tutorial prático de x.509: montar uma autoridade certificadora, assinar certificados de membros e de clientes e usá-los para proteger um replica set de três membros. Este conceito é a camada mais antiga e mais ampla sobre a qual todo o resto da história de segurança do MongoDB se apoia; ela é anterior e ortogonal ao **Queryable Encryption** (MongoDB 6.0, 2022), um recurso mais estreito e mais novo para criptografar *campos específicos* de ponta a ponta, de modo que nem o servidor veja seu texto em claro, tratado separadamente em `mongodb-atlas-search-and-vector-search`. Nada aqui o substitui; um cluster pode (e normalmente deveria) ter tanto uma base sólida de autenticação/RBAC/TLS *quanto* criptografia em nível de campo para seus campos mais sensíveis.

## Use Cases

- Montar um replica set de produção em que cada membro prova sua identidade aos outros com um certificado assinado por uma CA confiável (`clusterAuthMode x509`), em vez de confiar em um keyfile compartilhado que dá participação total a qualquer um que tenha uma cópia dele.
- Dar à conta de serviço de uma aplicação exatamente `readWrite` no seu próprio banco via um role embutido, em vez de entregar `root` ou `dbOwner` só porque a aplicação precisa escrever: a diferença entre uma credencial com escopo e um cheque em branco.
- Criar um role definido pelo usuário, estreito, para uma ferramenta de relatórios ou BI que só precisa de `find` em algumas coleções, em vez de recorrer a `readAnyDatabase` por ser o role embutido mais próximo que "basicamente funciona."
- Inicializar um cluster novo do jeito certo: criar o primeiro usuário admin *antes* de ligar o `--auth`, porque o MongoDB nunca cria uma conta root ou admin padrão para você, com ou sem x.509.
- Criptografar o tráfego de cliente para cluster e entre membros com TLS em uma implantação autogerenciada que atravessa uma fronteira de rede (um replica set multirregião, ou servidores de aplicação acessando o MongoDB por qualquer coisa menos confiável que uma VPC privada), já que o MongoDB autogerenciado vem com TLS desligado por padrão.
- Decidir se a criptografia de transporte imposta por uma plataforma gerenciada (o Atlas exige TLS e não deixa você desligá-lo) basta sozinha, ou se colunas específicas (CPFs, tokens de pagamento) ainda precisam de proteção em nível de campo por cima dela via Queryable Encryption.
- Restringir a exposição de rede com `--bind_ip` e regras de firewall como primeira linha de defesa, antes mesmo de a autenticação entrar em cena, na ordem do próprio livro: "restringir o acesso o máximo possível entre o mundo externo e o MongoDB" vem antes do capítulo de autenticação, não depois.

## Deep Dive

### Autenticação não é autorização

O livro traça a linha com precisão: "o propósito da autenticação é verificar a identidade de um usuário, enquanto a autorização determina o acesso do usuário verificado a recursos e operações." Habilitar a autorização em um cluster é o que *impõe* a autenticação na prática: uma vez ligada, toda conexão precisa provar quem é antes que suas permissões baseadas em roles signifiquem alguma coisa. O MongoDB Community suporta **SCRAM** (Salted Challenge Response Authentication Mechanism) e **autenticação por certificado x.509** de fábrica; o Enterprise adiciona Kerberos e autenticação via proxy LDAP. Nem a autenticação nem a autorização vêm ligadas por padrão: você habilita as duas explicitamente com `--auth` na linha de comando ou `security.authorization: enabled` em um arquivo de configuração.

### x.509: autenticando membros e clientes com certificados

O livro concentra seu tutorial no x.509 porque é o mecanismo que protege não só as conexões de clientes, mas o tráfego interno do próprio replica set: todo membro precisa se autenticar com todos os outros para trocar dados. Para isso, "é necessário que uma autoridade certificadora (CA) confiável assine todos os certificados", atuando como um terceiro confiável contra ataques man-in-the-middle.

A estrutura do tutorial, resumida:

1. **Estabelecer uma hierarquia de CAs.** Gere uma CA raiz autoassinada (`openssl genrsa` + `openssl req -x509`) e depois uma CA intermediária *de assinatura*, assinada pela raiz. A boa prática é assinar os certificados de servidores e clientes com a intermediária, não com a raiz: "se a CA intermediária for comprometida e o certificado precisar ser revogado, só uma parte da árvore de confiança é afetada, em vez de todos os certificados."
2. **Assinar certificados de membros** (um por `mongod`/`mongos`) e **certificados de clientes** (um por pessoa ou aplicação que se conecta) usando a CA de assinatura. O livro é explícito sobre o que distingue as duas categorias: elas precisam diferir no Distinguished Name, especificamente em Organization (O), Organizational Unit (OU) ou Domain Component (DC), e é por isso que o tutorial usa `OU=MyServers` para certificados de membros e `OU=MyClients` para certificados de clientes. Todos os certificados dos membros do mesmo cluster precisam compartilhar o mesmo O/OU/DC, e o Common Name ou o Subject Alternative Name de cada certificado precisa coincidir com o hostname para o qual ele é emitido.
3. **Subir o replica set sem autenticação primeiro**, iniciá-lo e só então criar o primeiro usuário admin, porque não há conta admin padrão, com x.509 ou sem.
4. **Criar o usuário admin no banco `$external`.** Cada certificado de cliente x.509 corresponde a exatamente um usuário do MongoDB; você não pode reutilizar um certificado para duas identidades. O usuário é criado com o *subject* do certificado como nome de usuário:

   ```javascript
   db.getSiblingDB("$external").runCommand({
     createUser: "CN=client1,OU=MyClients,O=MongoDB,L=New York,ST=NY,C=US",
     roles: [
       { role: "readWrite", db: "test" },
       { role: "userAdminAnyDatabase", db: "admin" },
       { role: "clusterAdmin", db: "admin" }
     ],
     writeConcern: { w: "majority", wtimeout: 5000 }
   });
   ```

5. **Reiniciar todos os membros com autenticação e TLS habilitados**, apontando para os certificados: `--tlsMode requireTLS --clusterAuthMode x509 --tlsCAFile root-ca.pem --tlsCertificateKeyFile <host>.pem --tlsClusterFile <host>.pem`. O arquivo da CA estabelece uma cadeia de confiança: o servidor confia em qualquer coisa assinada pelos certificados que ele contém.
6. **Conectar com um certificado de cliente** em vez de uma senha: `mongo --tls --tlsCertificateKeyFile client1.pem --tlsCAFile root-ca.pem --authenticationDatabase '$external' --authenticationMechanism MONGODB-X509`. Conectar com um certificado *diferente*, cujo subject nunca foi registrado como usuário, falha de cara; o livro mostra o erro exato, `Could not find user "CN=client2,..." for db "$external"`.

As ressalvas finais do próprio livro valem ser guardadas: os diretórios com as chaves da CA e de assinatura precisam ser protegidos contra acesso não autorizado, e no tutorial as chaves são deixadas deliberadamente sem senha por simplicidade; "em produção, é necessário usar senhas para proteger a chave contra uso não autorizado."

### Autorização: roles embutidos e o problema de inicializar o admin

Criar um usuário sempre acontece *em* um banco específico: esse banco vira o banco de autenticação do usuário, mas os privilégios de um usuário **não** ficam limitados a ele. Ao criar um usuário, você concede um conjunto de roles, cada um com escopo no banco que ele mira. O MongoDB traz uma longa lista de roles embutidos, então raramente você precisa montar documentos de privilégio do zero:

| Role | Concede |
|---|---|
| `read` | Ler todas as coleções que não são de sistema (mais algumas de sistema) |
| `readWrite` | `read`, mais escrita em coleções que não são de sistema |
| `dbAdmin` | Tarefas de schema, índices, estatísticas; não gerencia usuários/roles |
| `userAdmin` | Criar e modificar roles e usuários no banco atual |
| `dbOwner` | `readWrite` + `dbAdmin` + `userAdmin` combinados |
| `clusterManager` | Ações de gerenciamento e monitoramento do cluster |
| `clusterMonitor` | Acesso somente leitura às ferramentas de monitoramento |
| `hostManager` | Monitorar e gerenciar servidores |
| `clusterAdmin` | `clusterManager` + `clusterMonitor` + `hostManager` + `dropDatabase` |
| `backup` | O suficiente para fazer backup de uma instância `mongod` inteira |
| `restore` | Restaurar a partir de backups (exceto dados de `system.profile`) |
| `readAnyDatabase` | `read` em todos os bancos exceto `local`/`config`, mais `listDatabases` |
| `readWriteAnyDatabase` | `readWrite` em todos os bancos exceto `local`/`config`, mais `listDatabases` |
| `userAdminAnyDatabase` | `userAdmin` em todos os bancos exceto `local`/`config`; na prática, superusuário |
| `dbAdminAnyDatabase` | `dbAdmin` em todos os bancos exceto `local`/`config`, mais `listDatabases` |
| `root` | `readWriteAnyDatabase` + `dbAdminAnyDatabase` + `userAdminAnyDatabase` + `clusterAdmin` + `restore` + `backup`, combinados |

Além desses, **roles definidos pelo usuário** permitem agrupar um conjunto específico de operações permitidas sob um nome e distribuí-lo a vários usuários de uma vez: a ferramenta para "este role precisa exatamente destas cinco ações e nada mais" quando nenhum role embutido serve.

Uma pegadinha operacional que o livro aponta diretamente e que derruba as pessoas em um cluster novo: **o MongoDB não cria um usuário root ou admin padrão quando você habilita autenticação e autorização**, nem com SCRAM, nem com x.509. A sequência correta é sempre: subir o cluster sem autenticação, criar o usuário admin e depois reiniciar com a autenticação ligada. Começar com `--auth` em um cluster novo e sem usuários tranca você fora do seu próprio banco.

### Contenção em nível de rede, antes da autenticação

A seção de segurança em produção do livro coloca a restrição de rede *antes* da autenticação em sua lista de prioridades: "não monte servidores MongoDB endereçáveis publicamente... restrinja o acesso o máximo possível." As opções relevantes:

- `--bind_ip`: em quais interfaces o `mongod`/`mongos` escuta. Desde o MongoDB 3.6, os dois escutam em `localhost` **por padrão**, aceitando apenas conexões da mesma máquina, a menos que você amplie explicitamente; um endurecimento deliberado do padrão anterior, que escutava em todas as interfaces.
- `--nounixsocket`: desativa o socket de domínio UNIX se você nunca se conecta a ele localmente.
- `--noscripting`: desativa a execução de JavaScript no servidor, fechando uma classe de problemas de segurança já relatados no MongoDB, ao custo de quebrar helpers do shell como `sh.status()` que presumem que ele está disponível.

### Criptografia em trânsito: TLS/SSL

A criptografia de transporte TLS/SSL está disponível em **todas** as edições do MongoDB (Community incluído) e usa as bibliotecas TLS nativas do sistema operacional do host. Ela é configurada com `--tlsMode` e companhia (`disabled`, `allowTLS`, `preferTLS`, `requireTLS`), mais `--tlsCAFile` e `--tlsCertificateKeyFile` para a cadeia de confiança e o certificado do próprio servidor. O livro afirma o padrão do autogerenciado sem rodeios: "por padrão, as conexões com o MongoDB transferem dados sem criptografia." No MongoDB autogerenciado, TLS é algo que você liga, não algo de que você abre mão.

### Criptografia em repouso: só no Enterprise, e diferente do Queryable Encryption

O livro é igualmente direto ao dizer que este recurso é exclusivo do Enterprise: "a criptografia de dados está disponível no MongoDB Enterprise. Estas opções não são suportadas na versão Community do MongoDB." O mecanismo é uma hierarquia de chaves padrão (gerar uma chave mestra, gerar uma chave por banco, criptografar os dados com as chaves dos bancos, criptografar as chaves dos bancos com a chave mestra), implementada dentro do storage engine WiredTiger via `--enableEncryption`, `--encryptionCipherMode` (`AES256-CBC` ou `AES256-GCM`) e `--encryptionKeyFile` (ou KMIP para gerenciamento centralizado de chaves). Os dados ficam criptografados em repouso e só são descriptografados em memória e durante a transmissão, e é exatamente por isso que esse recurso é combinado com TLS, e não um substituto dele.

Essa criptografia do banco inteiro, na camada de armazenamento, é um recurso diferente do **Queryable Encryption**, introduzido anos depois da 3ª edição deste livro, que criptografa *campos* individuais no lado do cliente, de modo que o próprio servidor nunca lide com o texto em claro deles, nem em memória; veja `mongodb-atlas-search-and-vector-search` para esse mecanismo. Os dois são complementares: a criptografia em repouso protege o arquivo de dados inteiro se um disco for roubado; o Queryable Encryption protege campos sensíveis específicos até mesmo do próprio operador do servidor de banco.

### Livro vs hoje

> **SCRAM-SHA-256 é o padrão moderno, e o capítulo do livro não precisa tanto de correção quanto de complemento.** O capítulo de autenticação do livro se concentra inteiramente no x.509 e só cita o SCRAM de passagem. O `db.createUser()` do MongoDB atual escolhe **SCRAM-SHA-256** como mecanismo de autenticação padrão quando nenhum é especificado (desde que o driver e a implantação o suportem), com o antigo **SCRAM-SHA-1** ainda disponível por compatibilidade e, em algumas configurações FIPS, exigindo ser combinado com SCRAM-SHA-256, Kerberos, LDAP ou x.509 em vez de usar só SHA-1. Nada no livro está errado aqui; ele só nunca se aprofundou o bastante no SCRAM para haver uma lacuna de versão.

> **O Atlas impõe TLS por padrão; o MongoDB autogerenciado ainda não.** Este é o único ponto em que "livro vs hoje" se divide de fato pelo *alvo de implantação* em vez de pela versão. Tudo o que o livro diz sobre o MongoDB autogerenciado vir com TLS desligado (`net.tls.mode` tem padrão `disabled`) continua correto para um `mongod` hospedado por conta própria hoje: você ainda precisa ativá-lo com `requireTLS` ou similar, exatamente como o exercício de montar a CA do tutorial sugere. O MongoDB Atlas, que não era o alvo principal de implantação do livro, impõe TLS em toda conexão de cliente e não oferece forma de desligá-lo; uma connection string `mongodb+srv://` implica TLS automaticamente. O mundo do livro (TLS como algo que você monta sozinho) e o mundo do Atlas (TLS como garantia obrigatória da plataforma) são os dois verdadeiros hoje, para modelos de implantação diferentes.

> **`clusterAuthMode` e a autenticação por keyfile continuam lá, e o x.509 continua sendo a opção mais forte que o livro apresenta.** Nada na mecânica do tutorial foi descontinuado: replica sets e clusters shardeados ainda suportam `x509` como `clusterAuthMode` hoje, e o fluxo de assinatura de certificados (CA raiz, CA intermediária de assinatura, distinção de OU entre membros e clientes) não mudou. A autenticação interna mais simples por keyfile, que o livro menciona só de passagem, continua sendo o padrão de menor atrito para muitas implantações; o x.509 é o que você usa quando o modelo do keyfile, em que "qualquer um com o arquivo é membro pleno", não é forte o suficiente.

## Trade-offs

- **O x.509 compra autenticação forte por identidade e um fardo operacional real de PKI.** Todo certificado expira, toda CA precisa ter sua chave privada protegida (o próprio tutorial do livro deixa deliberadamente as chaves de assinatura sem senha "por simplicidade" e aponta isso como inaceitável em produção), e trocar uma CA intermediária comprometida significa reemitir todos os certificados assinados por ela. O modelo de segredo compartilhado do SCRAM é mais simples de operar no dia a dia; o x.509 é o que você assume quando precisa especificamente de prova criptográfica de identidade para os membros do cluster, não só de uma senha.
- **Roles embutidos são convenientes e um caminho fácil para excesso de privilégio.** `root` ou `dbOwner` "basicamente funcionam" para quase qualquer tarefa, e é exatamente esse o problema: o livro lista uma dúzia de roles mais direcionados justamente porque recorrer ao mais amplo que serve é o modo de falha padrão. Um role definido pelo usuário custa mais para desenhar, mas não entrega à conta de serviço de uma aplicação poderes de administrador de cluster que ela nunca vai usar.
- **A regra de não haver usuário admin padrão é um recurso de segurança que também é um jeito fácil de se trancar para fora.** O MongoDB se recusar a criar uma conta root padrão significa que não há credencial de fábrica para um atacante adivinhar, mas também significa que habilitar `--auth` em um cluster antes de criar qualquer usuário é irrecuperável sem reiniciar de novo sem autenticação. A sequência do livro de subir primeiro sem autenticação existe porque não há outro jeito de entrar.
- **A restrição de rede é necessária, mas nunca foi pensada para bastar sozinha.** `--bind_ip` com padrão localhost desde o 3.6 e um firewall bloqueando o mundo externo detêm varreduras oportunistas, mas não fazem nada quando uma conexão já está dentro da rede confiável, que é exatamente a lacuna que autenticação e autorização existem para fechar. A ordem dos capítulos do próprio livro (segurança de rede, depois autenticação, depois criptografia) se lê como defesa em profundidade, não como se qualquer camada bastasse por si só.
- **A criptografia em repouso é exclusiva do Enterprise, o que empurra os usuários do Community para alternativas em nível de sistema de arquivos.** Se a criptografia embutida do WiredTiger não estiver disponível no seu tier de licença, a alternativa é criptografia em nível de disco ou volume (LUKS, criptografia de EBS/disco do provedor de nuvem), gerenciada inteiramente fora do MongoDB; ela protege contra a mesma ameaça (um disco roubado), mas sem a granularidade de chave por banco nem a integração KMIP que o livro descreve.
- **O TLS protege os dados em movimento e não diz nada sobre o que um servidor comprometido consegue ver.** Um cluster com `requireTLS`, autenticação de cliente x.509 e RBAC com escopo bem restrito ainda tem uma propriedade em comum com o mundo anterior à criptografia em repouso e ao Queryable Encryption: qualquer operação que consulta o banco vê texto em claro. Quando isso é inaceitável (um campo que um atacante com acesso ao banco, ou mesmo um admin curioso, nunca deve ver), é exatamente o caso para o qual o Queryable Encryption existe, em camada por cima de tudo neste conceito, e não substituindo nada dele.

## Documentation Links

- Shannon Bradshaw, Eoin Brazil e Kristina Chodorow, "MongoDB: The Definitive Guide", 3ª edição (O'Reilly, 2020): Capítulo 19, "An Introduction to MongoDB Security", p. 389-404: doc
- Shannon Bradshaw, Eoin Brazil e Kristina Chodorow, "MongoDB: The Definitive Guide", 3ª edição (O'Reilly, 2020): Capítulo 21, "Setting Up MongoDB in Production" (Security, Data Encryption, SSL Connections), p. 415-424: doc
- [MongoDB Documentation: SCRAM](https://www.mongodb.com/docs/manual/core/security-scram/): doc
- [MongoDB Documentation: Use x.509 Certificates to Authenticate Clients](https://www.mongodb.com/docs/manual/tutorial/configure-x509-client-authentication/): doc
- [MongoDB Documentation: Built-In Roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/): doc
- [MongoDB Documentation: Configure TLS/SSL](https://www.mongodb.com/docs/manual/tutorial/configure-ssl/): doc
- [MongoDB Documentation: Encryption at Rest](https://www.mongodb.com/docs/manual/core/security-encryption-at-rest/): doc
- [MongoDB Atlas Documentation: Security FAQ (TLS enforcement)](https://www.mongodb.com/docs/atlas/reference/faq/security/): doc
