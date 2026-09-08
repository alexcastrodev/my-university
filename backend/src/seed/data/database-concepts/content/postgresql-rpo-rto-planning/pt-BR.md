---
version: 1.0
updatedAt: 2026-07-27
title: "Planejamento de RPO e RTO para um Cluster PostgreSQL de Alta Disponibilidade"
summary: Como o Recovery Point Objective (tolerância a perda de dados) e o Recovery Time Objective (tolerância a indisponibilidade) conduzem decisões de arquitetura do PostgreSQL, e como o commit por quorum da replicação síncrona transforma uma meta de RPO em uma garantia aplicável.
---
## Objective

Entender Recovery Point Objective (RPO, quanto dado o negócio pode se dar ao luxo de perder em uma indisponibilidade) e Recovery Time Objective (RTO, por quanto tempo uma indisponibilidade pode durar) como os dois números que conduzem toda decisão subsequente em um cluster PostgreSQL de alta disponibilidade, e como a replicação síncrona do PostgreSQL transforma um RPO declarado em uma garantia aplicável em vez de uma esperança.

## Use Cases

- Justificar para stakeholders por que um único nó PostgreSQL com backups noturnos via `pg_dump` não atende a um requisito de "não podemos perder mais do que alguns segundos de dado": a lacuna entre o RPO declarado e a arquitetura real é onde indisponibilidades viram incidentes.
- Traduzir um SLA de negócio ("o checkout precisa se recuperar em 2 minutos") em uma escolha concreta de configuração do PostgreSQL: quantos standbys, replicação síncrona vs. assíncrona, e como o failover é disparado.
- Construir uma planilha de toda atividade que pode tirar o banco de dados do ar (upgrade menor, upgrade maior, reboot, switchover, failover) para pegar casos em que o tempo de recuperação realista *da camada de banco de dados* já ultrapassa o que o resto da stack de aplicação promete aos clientes.
- Decidir entre replicação síncrona baseada em quorum e baseada em prioridade quando existe mais de um standby, dependendo do que importa mais: previsibilidade ou tolerância a falhas.

## Deep Dive

### RPO: quanto dado você pode se dar ao luxo de perder

RPO descreve a quantidade de dado que pode ser perdida após uma indisponibilidade inesperada antes de o sistema voltar a operar. Não é uma medida técnica que você calcula; é uma decisão de negócio que você coleta de stakeholders (VP/C-level, gerentes de produto, arquitetos, líderes de infraestrutura) *antes* de escolher uma arquitetura, porque isso conduz a contagem de nós, o método de sincronização de dados e a tecnologia de backup. Perguntar "quanto dado podemos perder em uma indisponibilidade grande?" quase sempre recebe a resposta "nenhum!", que é exatamente por que essa conversa precisa acontecer cedo: uma arquitetura com RPO zero custa muito mais do que uma com RPO de dez segundos, e o negócio precisa ver essa troca em valores antes de se comprometer com ela.

### RTO: quanto tempo a recuperação pode levar, e a planilha que prova isso

RTO é o tempo que uma indisponibilidade da camada de banco de dados pode durar, muitas vezes escrito em um Service Level Agreement. O método do livro para fixar isso é uma planilha simples: uma linha por atividade que pode tirar o PostgreSQL do ar, com colunas para tempo por ocorrência e quantas vezes por ano isso acontece.

| Atividade | Tempo (s) | Contagem | Total (s) |
|---|---|---|---|
| Upgrade menor | 30 | 4 | 120 |
| Upgrade maior | 120 | 1 | 120 |
| Reboot | 300 | 1 | 300 |
| Switchover | 60 | 2 | 120 |

`Total = Tempo * Contagem`, somado em todas as linhas, dá uma contribuição anual acumulada de RTO só da camada de banco de dados. O ponto não são os números exatos: é que valores de RTO se amplificam entre camadas: se o RTO realista do banco de dados é maior do que o que uma camada acima dele promete, o RTO dessa camada silenciosamente também fica errado. Uma checagem de sanidade clássica para quão rígido um RTO declarado realmente é: "cinco noves" de uptime (99,999%) deixa apenas cerca de 5 minutos de indisponibilidade *total* por ano, mal o suficiente para um único reboot não planejado, quanto mais manutenção de rotina.

### Transformando "RPO = 0" em uma garantia de verdade: replicação síncrona e commit por quorum

A intenção de negócio ("nenhuma perda de dado") só se torna real quando é apoiada por uma garantia de durabilidade que o PostgreSQL aplica em todo commit. `synchronous_standby_names` configura em quais standbys uma transação precisa esperar antes de o primário reportar sucesso:

```
# priority-based: waits specifically for s1, falls back to s2 if s1 is down
synchronous_standby_names = 'FIRST 1 (s1, s2, s3)'

# quorum-based: waits for ANY 2 of the three listed standbys
synchronous_standby_names = 'ANY 2 (s1, s2, s3)'
```

Com `synchronous_commit = on`, um commit espera até que seu registro de WAL seja confirmado como escrito em disco tanto no primário quanto no número exigido de standbys: dado só pode ser perdido se o primário e todo standby exigido travarem no mesmo instante. Isso é o que um RPO zero de verdade parece em um sistema rodando, não só um número em um slide.

### Livro vs. hoje: backup incremental costumava exigir ferramentas de terceiros

O livro (2020, visando o PostgreSQL 12) se apoia em ferramentas de terceiros como o pgBackRest para estratégias de backup eficientes e de RPO baixo; o próprio PostgreSQL não tinha como fazer um backup incremental (só o dado alterado desde o último backup) sem uma delas. O PostgreSQL 17 (2024) fechou essa lacuna nativamente: `pg_basebackup --incremental` faz um backup relativo ao manifesto de um backup anterior, e a ferramenta companheira `pg_combinebackup` reconstrói um backup completo e restaurável a partir de um backup completo mais sua cadeia de incrementos. O processo de planejamento de RPO/RTO que o livro descreve permanece inalterado, mas "como fazemos backup barato o suficiente para atingir nosso RPO" não força mais uma escolha entre uma ferramenta de terceiros e fazer isso do jeito lento.

## Trade-offs

- **Uma garantia de RPO zero custa latência de escrita, não só infraestrutura**: todo commit sob `synchronous_commit = on` espera por uma ida e volta de rede até os standbys exigidos; esse é o preço de "só perdido se primário e standby travarem juntos", e é pago em toda escrita, não só durante uma indisponibilidade.
- **`FIRST n` é previsível, `ANY n` é resiliente: escolha um de propósito**: `FIRST n` sempre espera pelos mesmos standbys nomeados, então a latência é consistente e fácil de raciocinar, mas se aquele standby específico atrasar, todo commit atrasa com ele. `ANY n` tolera um standby lento recorrendo aos outros, ao custo de quais dois standbys satisfizeram um dado commit ser não determinístico.
- **Nomear mais standbys elegíveis do que você tem rodando é uma armadilha silenciosa**: se `synchronous_standby_names` exige mais réplicas do que estão conectadas no momento, commits não falham, eles ficam pendurados indefinidamente; o planejamento de RPO/RTO precisa considerar "o que acontece quando um standby está fora do ar", não só o caminho feliz.
- **A planilha de RTO é uma ferramenta de comunicação tanto quanto uma técnica**: o livro é explícito que esse processo roda várias vezes: estimar, apresentar para tomadores de decisão, negociar, reestimar. Tratá-la como um cálculo de tiro único anula seu propósito real, que é fazer stakeholders não técnicos verem o custo do RTO que estão pedindo.

## Documentation Links

- [PostgreSQL 12 High Availability Cookbook, 3rd Edition (Packt, 2020), Chapter 1: "Architectural Considerations", p. 8-15](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) - doc
- [PostgreSQL Documentation: Synchronous Replication (synchronous_standby_names, quorum commit)](https://www.postgresql.org/docs/current/warm-standby.html#SYNCHRONOUS-REPLICATION) - doc
- [PostgreSQL 17 Release Notes: Incremental backup (pg_basebackup, pg_combinebackup)](https://www.postgresql.org/docs/17/release-17.html) - doc
