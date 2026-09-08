---
version: 1.0
updatedAt: 2026-08-03
title: "Terminando Conexões Rebeldes: pg_cancel_backend, pg_terminate_backend e tcpkill"
summary: O caminho de escalonamento para expulsar um cliente PostgreSQL mal-comportado, desde consultar pg_stat_activity em busca de sessões de longa duração ou idle-in-transaction, passando pelo mais gentil pg_cancel_backend() e pelo mais contundente pg_terminate_backend(), até um tcpkill em nível de rede quando o cliente se recusa a reconhecer o encerramento; e como o argumento opcional de timeout do PostgreSQL 14 em pg_terminate_backend() agora deixa a própria função esperar pela confirmação em vez de exigir uma consulta manual de reconferência.
---
## Objective

Um único cliente mal-comportado pode comprometer um cluster PostgreSQL de alta disponibilidade: uma cláusula `WHERE` esquecida vira um scan sequencial de horas que satura uma CPU e a largura de banda de armazenamento, ou uma aplicação com bug abre uma transação e nunca a fecha, deixando locks retidos indefinidamente e outras sessões enfileiradas atrás deles. Expulsar esse cliente é um escalonamento, não um único comando: comece gentil (peça para a consulta parar), fique mais contundente (desconecte a sessão), e só recorra a uma morte de rede em nível de sistema operacional quando o próprio PostgreSQL não conseguir chamar a atenção do cliente.

## Use Cases

- Uma consulta de longa duração e sem índice está saturando CPU/disco e precisa ser parada sem reiniciar o servidor inteiro.
- Um bug de aplicação deixa uma transação aberta ("idle in transaction"), retendo locks de linha/tabela que bloqueiam toda outra sessão esperando pelas mesmas linhas.
- A conexão de rede de um cliente ficou obsoleta (um laptop foi hibernado no meio de uma consulta, um container foi morto sem um desligamento limpo) e o PostgreSQL ainda está esperando ele confirmar um sinal de encerramento que nunca vai chegar.

## Deep Dive

### Encontrando o culpado: pg_stat_activity

O ponto de partida para qualquer coisa disso é `pg_stat_activity`, que lista todo backend ativo junto com seu process ID, porta, estado e consulta em execução. Filtrar por qualquer coisa rodando há mais de alguns segundos e que não esteja ociosa reduz a lista a candidatos genuínos rapidamente:

```sql
SELECT pid, client_port, state,
       now() - query_start AS duration, query
  FROM pg_stat_activity
 WHERE now() - query_start > INTERVAL '2 seconds'
   AND state != 'idle'
 ORDER BY duration DESC;
```

O limiar de 2 segundos é arbitrário: é só o suficiente para filtrar a enxurrada de consultas normais e rápidas, deixando só as genuinamente longas para revisão. `pid` é o que todo passo de escalonamento abaixo tem como alvo; `client_port` só importa se o processo recorrer a uma morte em nível de rede.

### Passo um: pedir gentilmente com pg_cancel_backend

```sql
SELECT pg_cancel_backend(pid);
```

`pg_cancel_backend()` envia um sinal de cancelamento para o que quer que o backend alvo esteja fazendo no momento, equivalente a um cliente apertando Ctrl+C em uma consulta em execução. Só afeta um backend que está ativamente executando algo; uma sessão que está apenas "idle in transaction" (não executando uma consulta agora, só sentada em cima de uma transação aberta) não é tocada por um cancelamento, porque não há nenhuma consulta em voo para interromper. Depois de rodá-lo, rode de novo a consulta de `pg_stat_activity` acima para confirmar que o `pid` alvo de fato parou antes de decidir se escala mais.

### Passo dois: desconectar com pg_terminate_backend

```sql
SELECT pg_terminate_backend(pid);
```

Se a consulta ainda está rodando, ou se a sessão se acomodou em "idle in transaction" (que um cancelamento não consegue tocar), `pg_terminate_backend()` escala de "pare a consulta" para "encerre a sessão inteira": o equivalente aproximado de uma morte em nível de sistema operacional no processo cliente, mas emitido diretamente do SQL. Ele reverte qualquer transação em progresso e libera todo lock que a sessão estava segurando. Assim como no passo de cancelamento, reconfira `pg_stat_activity` depois: uma rede lenta ou não confiável ainda pode deixar a conexão tecnicamente viva mesmo depois de o PostgreSQL ter enviado o sinal de encerramento.

### Matando várias sessões rebeldes de uma vez

Ambas as funções aceitam um `pid` de qualquer fonte, incluindo uma subconsulta sobre `pg_stat_activity`, útil quando um bug de aplicação deixa muitas conexões idle in transaction simultaneamente em vez de só uma:

```sql
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE now() - state_change > INTERVAL '2 minutes'
   AND state = 'idle in transaction';
```

`pg_stat_activity` expõe colunas suficientes (endereço do cliente, nome da aplicação, horário de início da conexão) para direcionar uma varredura de encerramento por quase qualquer critério útil, não só duração, mas origem ou identidade do cliente também.

### O último recurso: tcpkill

Raramente, `pg_terminate_backend()` envia seu sinal com sucesso, mas a conexão do cliente sobrevive de qualquer jeito: não um bug do PostgreSQL, mas uma rede genuinamente não confiável: um socket travado no meio de uma escrita, um cliente que nunca confirma o recebimento, um sistema operacional que ainda não percebeu que a conexão está morta. O PostgreSQL então vai esperar indefinidamente que o cliente coopere. Nesse ponto o conserto precisa acontecer abaixo do PostgreSQL, na camada de rede, usando o utilitário `tcpkill` (do pacote `dsniff`):

```bash
sudo tcpkill -i eth0 -9 port client_port
```

`-i eth0` nomeia a interface de rede que o PostgreSQL está usando, `port` mira na conexão exata via o valor `client_port` obtido de `pg_stat_activity` antes, e `-9` diz ao `tcpkill` para bloquear todo tráfego nas duas direções sem ambiguidade. Isso força o sistema operacional a derrubar o socket, o que por sua vez faz o cliente PostgreSQL sair sozinho; pode levar um ou dois minutos de saída antes de a conexão de fato sumir, então paciência importa mais aqui do que em qualquer passo anterior.

## Trade-offs

- **`pg_cancel_backend()` e `pg_terminate_backend()` não são primeiras escolhas intercambiáveis.** Um cancelamento só interrompe uma consulta *ativamente em execução*; uma sessão ociosa em uma transação aberta precisa da chamada mais pesada de terminate desde o início, já que não há nada para um cancelamento interromper.
- **`pg_terminate_backend()` reverte a transação inteira e derruba todo lock que a sessão segurava**: correto e necessário para liberar um recurso preso, mas também destrutivo para qualquer trabalho que aquela sessão tivesse feito; não é uma parada graciosa, é mais parecido com puxar a tomada.
- **Um `tcpkill` em nível de rede é um último recurso genuíno, não um atalho.** Ele opera inteiramente abaixo do PostgreSQL, exige root e um utilitário separado, e arrisca perturbar outro tráfego na mesma interface/faixa de porta se usado descuidadamente; recorra a ele só depois que as duas opções dentro do banco já tiverem sido confirmadas (via `pg_stat_activity`) como não tendo funcionado.
- **Reconsultar manualmente `pg_stat_activity` depois de cada passo é overhead operacional real**: é a única forma de saber se um cancelamento ou terminate de fato surtiu efeito, já que o valor de retorno de nenhuma das funções (em versões mais antigas do PostgreSQL) diz se o cliente de fato se foi, só se o sinal foi enviado.
- **Livro vs. hoje: `pg_terminate_backend()` ganhou um parâmetro opcional `timeout` no PostgreSQL 14** (a assinatura passou a ser `pg_terminate_backend(pid, timeout bigint DEFAULT 0)`). Com um `timeout` positivo (em milissegundos), a própria função bloqueia até o processo alvo de fato terminar ou o timeout expirar, retornando `true` só se o encerramento foi confirmado, `false` (com um aviso) em caso de timeout. Confirmado pela documentação oficial atual. Isso substitui o loop manual da receita de "rode o terminate, depois rode de novo a consulta de status para checar" especificamente para o passo de terminate:
  ```sql
  -- waits up to 5 seconds for confirmed termination instead of a
  -- separate manual re-check
  SELECT pg_terminate_backend(pid, 5000);
  ```
  `pg_cancel_backend()` não ganhou um parâmetro de timeout equivalente; sua assinatura está inalterada, então a reconferência manual que o livro descreve ainda é a única forma de confirmar que um cancelamento de fato parou uma consulta.
- **Livro vs. hoje: timeouts declarativos podem evitar precisar dessa receita por completo para o caso "idle in transaction".** A própria seção "Getting ready" do livro já menciona `idle_in_transaction_session_timeout` (adicionado no PostgreSQL 9.6) como uma configuração de `postgresql.conf` que mata automaticamente sessões idle-in-transaction passado um limiar; desde o livro, o PostgreSQL 14 adicionou um `idle_session_timeout` paralelo (para conexões ociosas fora de qualquer transação), e o PostgreSQL 17 adicionou `transaction_timeout`, limitando a duração total de uma transação (explícita ou implícita) independentemente de quão ociosa ou ativa ela esteja dentro dessa janela. Configurar esses proativamente transforma boa parte dessa receita de escalonamento manual em um caminho raro de tratamento de exceção em vez de trabalho rotineiro de DBA.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 3, "Minimizing Downtime", recipe "Terminating rogue connections", p. 111-114] - doc
- [PostgreSQL Documentation: System Administration Functions (pg_cancel_backend, pg_terminate_backend)](https://www.postgresql.org/docs/current/functions-admin.html) - doc
- [PostgreSQL Documentation: The Cumulative Statistics System (pg_stat_activity)](https://www.postgresql.org/docs/current/monitoring-stats.html) - doc
- [PostgreSQL Documentation: Resource Consumption (statement_timeout, idle_in_transaction_session_timeout, idle_session_timeout, transaction_timeout)](https://www.postgresql.org/docs/current/runtime-config-client.html) - doc
