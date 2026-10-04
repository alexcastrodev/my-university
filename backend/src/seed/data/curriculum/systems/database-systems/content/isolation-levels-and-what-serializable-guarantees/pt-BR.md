---
version: 1.0
updatedAt: 2026-09-07
title: "Níveis de Isolamento: O que o SERIALIZABLE de Fato Garante"
summary: "Os quatro níveis de isolamento do padrão SQL (READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE) são definidos aqui por exatamente qual anomalia cada um ainda permite, com um agendamento real trabalhado para cada uma: uma leitura suja (só no READ UNCOMMITTED), uma leitura não repetível (permitida abaixo do REPEATABLE READ) e uma leitura fantasma (uma nova linha que satisfaz o predicado de uma consulta anterior aparecendo ao consultar de novo, permitida abaixo do SERIALIZABLE). O conceito fecha com um enunciado honesto do que o SERIALIZABLE de fato promete (equivalência a alguma execução serial) contra o que ele custa em concorrência reduzida em relação aos níveis mais fracos."
---
## Objetivos de Aprendizagem

- Definir os quatro níveis de isolamento do padrão SQL por exatamente qual anomalia cada um ainda permite.
- Distinguir a leitura suja, a leitura não repetível e a leitura fantasma como três anomalias genuinamente diferentes, e não três nomes para o mesmo problema.
- Rastrear um agendamento real trabalhado que produz cada uma das três anomalias, e identificar o nível de isolamento mais fraco que a evita.
- Enunciar honestamente o que o SERIALIZABLE de fato promete, e o que ele custa em concorrência reduzida em relação aos níveis mais fracos.

## Contexto e Motivação

`deadlocks-in-two-phase-locking` completou a mecânica do 2PL Estrito (locking, detecção de deadlock e prevenção de deadlock) como um protocolo completo de controle de concorrência capaz de entregar a verdadeira serializabilidade. Mas sistemas reais raramente rodam toda transação no isolamento serializável completo, porque fazer isso custa concorrência real: mais bloqueio, mais espera, mais transações abortadas sob contenção. O padrão SQL, em vez disso, define quatro **níveis de isolamento**, cada um permitindo progressivamente menos anomalias (e custando correspondentemente mais em concorrência reduzida), deixando uma aplicação escolher exatamente quanto isolamento ela de fato precisa, em vez de sempre pagar pela garantia mais forte.

## Teoria Central

### Três anomalias, distinguidas com precisão

Antes de definir os níveis, três anomalias distintas precisam de definições precisas e separadas; os níveis de isolamento são definidos inteiramente em termos de quais dessas três eles ainda permitem:

- **Leitura suja** (dirty read): ler um valor escrito por uma transação que ainda não confirmou (já definida em `concurrency-anomalies-dirty-reads-and-lost-updates`).
- **Leitura não repetível** (non-repeatable read): uma transação lê a *mesma linha* duas vezes e obtém dois valores diferentes, porque uma transação diferente confirmou uma atualização nessa linha entre as duas leituras.
- **Leitura fantasma** (phantom read): uma transação roda de novo a *mesma consulta baseada num predicado* duas vezes e obtém um *conjunto de linhas* diferente na segunda vez, porque uma transação diferente confirmou uma inserção (ou remoção) de uma linha que casa com esse predicado no meio do caminho. Este é um problema genuinamente diferente de uma leitura não repetível: o valor de nenhuma linha lida anteriormente mudou; uma linha inteiramente nova apareceu (ou uma antiga sumiu) que o predicado da consulta agora casa.

### Os quatro níveis de isolamento

| Nível de Isolamento | Leitura Suja | Leitura Não Repetível | Leitura Fantasma |
|---|---|---|---|
| READ UNCOMMITTED | permitida | permitida | permitida |
| READ COMMITTED | evitada | permitida | permitida |
| REPEATABLE READ | evitada | evitada | permitida |
| SERIALIZABLE | evitada | evitada | evitada |

Cada nível descendo esta tabela acrescenta exatamente mais uma garantia em cima do nível acima dele, ao custo de locking adicional (ou, sob MVCC, o assunto do próximo conceito, validação adicional): o **READ UNCOMMITTED** não fornece garantia de isolamento alguma além da atomicidade básica de instruções individuais; o **READ COMMITTED** garante que uma transação nunca lê a escrita não confirmada de outra, mas a mesma linha lida duas vezes ainda pode mudar de valor entre as leituras; o **REPEATABLE READ** adicionalmente garante que, uma vez que uma transação leu uma linha específica, reler exatamente essa linha dentro da mesma transação sempre retorna o mesmo valor; o **SERIALIZABLE** é o único nível que adicionalmente evita fantasmas, porque é o único nível que exige isolamento sobre o conjunto de resultados de um *predicado* inteiro, e não só sobre linhas lidas individualmente.

## Exemplos Resolvidos

### Exemplo 1: uma leitura suja, evitada a partir do READ COMMITTED

Reutilizando o Exemplo 1 de `concurrency-anomalies-dirty-reads-and-lost-updates`: `T1` transfere `$100` de `A` (`$500`) para `B` (`$300`), escrevendo `A = 400` antes de confirmar. `T2`, rodando em **READ UNCOMMITTED**, lê o `400` não confirmado de `A` e (segundo o exemplo daquele conceito) calcula um total incorreto de `$700`. Rodar `T2` em **READ COMMITTED** ou em qualquer nível mais forte, em vez disso, força a leitura de `A` por `T2` a bloquear até que `T1` ou confirme (caso em que `T2` vê o `400` final e correto) ou aborte (caso em que `T2` vê o `500` restaurado). O valor intermediário sujo nunca fica visível, em nenhum nível de isolamento acima do READ UNCOMMITTED.

### Exemplo 2: uma leitura não repetível, evitada a partir do REPEATABLE READ

`T1`, rodando em READ COMMITTED, lê o saldo da conta `A` duas vezes dentro de uma transação (talvez calculando algo usando o valor em dois pontos diferentes da sua própria lógica): a primeira leitura retorna `A = 500`. Entre as duas leituras de `T1`, `T2` roda uma transação separada e completa que define `A = 400` e confirma. A segunda leitura de `T1` da *mesma linha* agora retorna `A = 400`: um valor diferente para a linha idêntica, lida duas vezes, dentro de uma única transação que nunca escreveu ela mesma em `A`. Isso é legal sob READ COMMITTED especificamente porque esse nível só garante que nenhum valor *não confirmado* seja jamais lido: a atualização de `T2` estava totalmente confirmada quando a segunda leitura de `T1` rodou, então nenhuma leitura suja ocorreu, e mesmo assim as duas leituras de `T1` discordam. Rodar `T1` em **REPEATABLE READ**, em vez disso, evita isso: uma vez que `T1` leu `A`, esse valor (ou, dependendo da implementação, um lock que impede qualquer outra transação de modificá-lo) é mantido por toda a duração de `T1`, garantindo que toda leitura subsequente dessa mesma linha dentro de `T1` retorne o valor idêntico.

### Exemplo 3: uma leitura fantasma, evitada só no SERIALIZABLE

`T1`, rodando em REPEATABLE READ, executa `SELECT * FROM Accounts WHERE balance > 400`, que retorna 3 linhas (digamos `B`, `C`, `D`). A garantia do REPEATABLE READ se aplica a essas 3 *linhas já lidas*: nenhuma delas pode mudar de valor pelo resto de `T1`. Mas `T2` agora roda uma transação separada inserindo uma linha novinha `E` com `balance = 600` e confirma. `T1` roda de novo a *consulta idêntica* (`SELECT * FROM Accounts WHERE balance > 400`) e agora recebe de volta 4 linhas: `B`, `C`, `D` e a nova `E`. O valor de nenhuma linha lida anteriormente mudou (satisfazendo a garantia real do REPEATABLE READ), mas o *conjunto* de linhas que satisfazem o predicado mudou: um fantasma. Evitar isso exige travar não só as linhas que uma consulta calhou de ler, mas o intervalo ou espaço de predicado inteiro que uma consulta examinou (para que nenhuma linha nova possa ser inserida em qualquer lugar que a teria casado), exatamente a garantia extra que só o **SERIALIZABLE** fornece.

## Equívocos Comuns e Armadilhas

- **"Uma leitura não repetível e uma leitura fantasma são a mesma anomalia com nomes diferentes."** O Exemplo 2 e o Exemplo 3 mostram uma diferença estrutural genuína: uma leitura não repetível trata de uma *linha específica, já identificada*, mudando de valor entre duas leituras, enquanto uma leitura fantasma trata do *conjunto de linhas que casam com um predicado* mudando. O locking no nível de linha do REPEATABLE READ conserta a primeira, mas é estruturalmente incapaz de consertar a segunda, já que ele nunca travou "toda linha que poderia jamais casar com este predicado", só as linhas que de fato calhou de ler.
- **"SERIALIZABLE só significa 'nenhuma anomalia, ponto final', sem nenhuma nuance adicional."** A garantia precisa do SERIALIZABLE, herdada da definição de Isolamento de `acid-properties-precisely-defined`, é a equivalência a *alguma* execução serial. Ela evita as três anomalias nomeadas como *consequência* dessa garantia mais forte, mas a própria garantia trata da equivalência do agendamento inteiro a uma ordem serial, e não de uma lista de três anomalias específicas a evitar; a tabela acima é uma caracterização conveniente, e não a definição de fato.
- **"Como o SERIALIZABLE evita toda anomalia, ele deveria simplesmente ser sempre usado por padrão."** A prevenção de fantasmas do SERIALIZABLE exige travar (ou validar contra) intervalos de predicado inteiros, e não só linhas tocadas individualmente. Cargas de trabalho de produção reais que não precisam de serializabilidade completa rotineiramente usam por padrão REPEATABLE READ ou READ COMMITTED (ou uma variante de isolamento por snapshot, o assunto do próximo conceito) especificamente porque a garantia mais forte do SERIALIZABLE custa concorrência real e mensurável de que os requisitos reais de corretude de muitas aplicações simplesmente não precisam.

## Resumo

Os quatro níveis de isolamento do padrão SQL são definidos por exatamente qual anomalia cada um ainda permite: o READ UNCOMMITTED permite as três (leituras sujas, leituras não repetíveis, fantasmas); o READ COMMITTED evita leituras sujas, mas permite as outras duas; o REPEATABLE READ adicionalmente evita leituras não repetíveis, mas ainda permite fantasmas, porque a sua garantia no nível de linha nunca cobre linhas que ainda não existiam no momento da leitura original; o SERIALIZABLE é o único nível que também evita fantasmas, garantindo que o agendamento inteiro seja equivalente a alguma execução serial, a mesma definição precisa de Isolamento que `acid-properties-precisely-defined` deu em abstrato. Essa garantia mais forte não é de graça: ela exige travar ou validar intervalos de predicado inteiros, e não só linhas lidas individualmente, e é exatamente por isso que sistemas reais deixam as aplicações escolherem um nível mais fraco quando os seus requisitos reais de corretude não o exigem.

## Documentation Links

- [Database System Concepts (Silberschatz, Korth, Sudarshan): Companion Site](https://www.db-book.com/): a fonte padrão de livro-texto das definições de níveis de isolamento do SQL e da taxonomia de anomalias leitura suja/leitura não repetível/leitura fantasma a partir da qual este conceito constrói.
- [CMU 15-445/645: Two-Phase Locking Concurrency Control Slides](https://15445.courses.cs.cmu.edu/fall2025/slides/18-twophaselocking.pdf): cobre como cada nível de isolamento mapeia para uma disciplina de locking específica (no nível de linha versus no nível de predicado/intervalo), sustentando o relato deste conceito sobre por que o SERIALIZABLE custa mais que os níveis mais fracos.
