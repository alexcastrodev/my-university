---
version: 1.0
updatedAt: 2026-08-05
title: "Pooling e Proxy de Conexões: HAProxy e PgBouncer"
summary: Dimensionar um pool de conexões a partir de princípios básicos de RAM, CPU e disco, rotear escritas e leituras por pares frontend-backend do HAProxy com balanceamento leastconn, e multiplexar muitos clientes em poucas conexões reais do PostgreSQL com as trocas de pool_mode session/transaction/statement do PgBouncer.
---
## Objective

Uma conexão PostgreSQL é cara: cada uma é um processo completo do sistema operacional com sua própria pegada de memória, e o desempenho degrada quando as conexões ativas passam de aproximadamente 2-3x o número de núcleos de CPU. As aplicações, enquanto isso, querem abrir conexões à vontade. Duas camadas fecham essa lacuna: o HAProxy fica na frente do cluster para abstrair *com qual servidor* um cliente fala (roteando escritas para o primário e espalhando leituras pelas réplicas), e o PgBouncer fica na frente do próprio PostgreSQL para abstrair *quantas conexões reais* são de fato necessárias, multiplexando muitas conexões de clientes em um pool muito menor de conexões com o banco.

## Use Cases

- Impedir que uma frota de servidores de aplicação (cada um com seu próprio pool de conexões) sobrecarregue coletivamente o PostgreSQL com muito mais conexões do que o hardware consegue atender com eficiência.
- Rotear tráfego somente leitura entre várias réplicas standby via balanceamento `leastconn` do HAProxy, para que as réplicas façam trabalho útil em vez de ficarem ociosas como alvos de failover puros.
- Reduzir o custo por conexão em aplicações que abrem (e abandonam) conexões com frequência, fazendo o PgBouncer reciclar um pequeno conjunto de conexões reais do PostgreSQL em vez de o sistema operacional criar um novo processo de backend por cliente.
- Dimensionar um pool de conexões a partir de princípios básicos (RAM disponível, núcleos de CPU, discos) em vez de chutar um número redondo.

## Deep Dive

### Dimensionando o pool antes de configurar qualquer coisa

A fórmula do livro: estime a RAM por conexão como 8 MB de base mais 4× o `work_mem` e veja quantas delas cabem em metade da RAM do servidor; separadamente, estime um teto ligado a CPU/E/S como `2 × núcleos + discos` (+100 se for SSD). O *menor* dos dois números é o teto prático de conexões: o recurso mais escasso define o limite.

```
Baseado em RAM:  (RAM_MB / 2) / (8 + 4 × work_mem_MB)
Baseado em CPU:  (2 × núcleos) + discos   (+100 se for SSD)
pool_size = min(baseado em RAM, baseado em CPU)
```

Um exemplo resolvido do livro: 32 GB de RAM, 8 núcleos, 8 discos, `work_mem = 8MB` → a RAM permite cerca de 409 conexões, mas CPU/E/S limitam a 24. O número menor vence: o pool deveria mirar algo próximo de 24, não 409, porque CPU/E/S é o gargalo real aqui.

### HAProxy: roteando para o nó certo

```
frontend ft_postgresql
    bind *:5432
    default_backend bk_db

backend bk_db
    option pgsql-check user haproxy_check
    server postgresql_primary pgha1:5432 check
```

Um frontend escuta em uma porta e encaminha para um backend; o backend lista os servidores PostgreSQL candidatos e como verificar sua saúde (`pgsql-check`, usando um role dedicado só de login que não precisa de acesso ao banco, apenas o suficiente para provar que o servidor responde). Para escalar leituras, um segundo par frontend/backend em outra porta (por exemplo `5500`) lista todas as réplicas com `balance leastconn`, enviando cada nova sessão para o nó que tiver menos conexões no momento:

```
frontend ft_pg_ro
    bind *:5500
    default_backend bk_pg_ro

backend bk_pg_ro
    balance leastconn
    option pgsql-check user haproxy_check
    server postgresql_pgha1 pgha1:5432 check
    server postgresql_pgha2 pgha2:5432 check
    server postgresql_pgha3 pgha3:5432 check
```

Aplicações que toleram atraso das réplicas apontam o tráfego pesado de leitura para a porta de leitura; o tráfego de escrita fica na porta exclusiva do primário. É o mesmo princípio de abstração de um IP virtual (esconder qual nó físico é "o" primário), mas estendido para balancear carga entre muitas réplicas de leitura ao mesmo tempo, algo que um único IP virtual não consegue fazer.

### PgBouncer: multiplexando muitos clientes em poucas conexões reais

```ini
[databases]
* = host=pgha1

[pgbouncer]
listen_addr = *
auth_type = md5
admin_users = postgres
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
```

`default_pool_size` é por usuário e por banco: a contagem ideal de conexões calculada pela fórmula de dimensionamento acima. `max_client_conn` limita quantas conexões de *clientes* o próprio PgBouncer aceita (muito mais que o pool real, já que os clientes esperam em uma fila interna em vez de cada um ocupar uma conexão real do PostgreSQL). A autenticação é tratada por um arquivo `userlist.txt` separado que o próprio PgBouncer mantém, já que ele não é uma extensão do PostgreSQL e não tem acesso direto a `pg_authid`.

### `pool_mode`: a configuração que muda a compatibilidade com a aplicação

- **`session`** (padrão): uma conexão fica atribuída a um cliente até ele desconectar. É o mais seguro, mas um cliente que nunca desconecta (ou uma aplicação com má higiene de conexões) pode monopolizar uma vaga indefinidamente.
- **`transaction`**: uma conexão volta ao pool assim que uma transação faz commit ou abort, permitindo que muito mais clientes compartilhem o mesmo pool pequeno. A contrapartida: estado de sessão (como um `SET` que não é desfeito, ou um cursor que deveria persistir entre transações) quebra, porque a próxima instrução pode cair em outra conexão física.
- **`statement`**: liberada após cada instrução; transações com várias instruções não são permitidas. Raramente é a escolha certa para uma carga PostgreSQL de propósito geral.

O modo `transaction` é o que de fato entrega o benefício de multiplexação do PgBouncer em escala, e é por isso que o livro dedica sua seção "there's more" às ressalvas necessárias para usá-lo com segurança.

## Trade-offs

- **O balanceamento `leastconn` não leva em conta o atraso das réplicas.** A verificação de saúde do HAProxy confirma que uma réplica está *alcançável*, não que está *em dia*; uma aplicação sensível a leituras desatualizadas precisa de sua própria noção de atraso (verificar `pg_last_wal_replay_lsn()`/`pg_stat_replication` antes de confiar em uma réplica), o que o HAProxy sozinho não fornece.
- **O pool_mode `transaction` troca recursos de sessão por escala.** Qualquer coisa que dependa de estado no escopo da conexão (advisory locks mantidos entre instruções, `LISTEN`/`NOTIFY`, variáveis `SET` de sessão, cursores que deveriam durar mais que uma transação) pode se comportar mal em silêncio no modo `transaction`, porque a próxima instrução do cliente não tem garantia de cair na mesma conexão de backend.
```ini
; só é seguro quando a aplicação realmente não depende de estado de sessão
; entre transações:
pool_mode = transaction
```
- **Regenerar o `userlist.txt` do PgBouncer não acontece automaticamente.** Como o PgBouncer não faz parte do sistema de autenticação do PostgreSQL, um novo role ou uma senha alterada exige reexportar e redistribuir esse arquivo (ou delegar para LDAP/PAM), um passo operacional fácil de esquecer depois da gestão rotineira de usuários.
- **Livro vs. hoje**: o material de origem trata prepared statements como fundamentalmente incompatíveis com o pool_mode `transaction` ("we generally don't suggest using transaction mode while prepared statements... are present"). Desde o **PgBouncer 1.21** (2023), essa ressalva está em grande parte desatualizada para prepared statements em nível de protocolo: a configuração `max_prepared_statements` (padrão 200 nas versões recentes) permite ao PgBouncer acompanhar e guardar em cache os prepared statements de cada cliente entre conexões do pool, preparando-os de novo automaticamente em qualquer backend em que o cliente cair. Isso fecha exatamente a lacuna sobre a qual o livro alerta, no caso comum de consultas preparadas em nível de protocolo (não em nível de instrução SQL `PREPARE`).

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3ª edição (Packt, 2020): Capítulo 4, "Proxy and Pooling Resources"](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854): doc
- [HAProxy Configuration Manual](https://cbonte.github.io/haproxy-dconv/): doc
- [PgBouncer Configuration Reference](https://www.pgbouncer.org/config.html): doc
- [PgBouncer FAQ](https://www.pgbouncer.org/faq.html): doc
