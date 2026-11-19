---
title: "Elle: inferindo anomalias de isolamento a partir de observações experimentais"
summary: O Elle verifica o isolamento de um banco de dados caixa-preta a partir do histórico observado pelos clientes. Ao gerar cargas com append em listas (e tipos mais fracos), ele infere um grafo de dependências no estilo de Adya, acha ciclos em tempo linear e reporta anomalias de forma sound, com bugs achados em TiDB, YugaByte DB, FaunaDB e Dgraph.
researchArea: Bancos de dados
keywords: isolamento de transações, verificação de isolamento, grafo de dependências de Adya, append em lista, rastreabilidade, recuperabilidade, Jepsen, teste caixa-preta
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Quem se importa com seus dados os guarda em bancos de dados, que (ao menos em princípio) garantem alguma forma de isolamento transacional. A experiência mostra, porém, que muitos bancos não oferecem o isolamento que declaram. Com a proliferação recente de bancos distribuídos novos, cresceu a demanda por verificadores que, gerando cargas de clientes e injetando falhas, produzam anomalias que testemunhem a violação de uma garantia declarada. Um verificador ideal seria sound (sem falsos positivos), eficiente (polinomial no tamanho do histórico e na concorrência), efetivo (achando violações em bancos reais), geral (analisando muitos padrões de transações) e informativo (justificando a anomalia com contraexemplos compreensíveis). Os autores não conhecem nenhum verificador que atenda a todos esses objetivos. Eles apresentam o Elle: um verificador que infere um grafo de dependências no estilo de Adya entre transações observadas pelos clientes. Para isso, escolhe com cuidado objetos e operações ao gerar os históricos, de modo que o resultado das leituras revele informação sobre o histórico de versões. O Elle detecta toda anomalia do formalismo de Adya et al. (exceto predicados), distingue uma da outra e explica cada uma de forma concisa. O artigo apresenta o Elle, demonstra sua soundness sobre tipos de dados específicos, mede sua eficiência contra o estado da arte e dá evidência de sua efetividade em um estudo de caso com quatro bancos reais.

## Visão geral

Um banco que diz "serializable" ou "snapshot isolation" pode não entregar isso. [A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels) é o argumento mais antigo de que esses nomes são fáceis de definir mal. Este artigo de Kyle Kingsbury (Jepsen) e Peter Alvaro (UC Santa Cruz), no Proceedings of the VLDB Endowment, volume 14, número 3 (páginas 268-280), pergunta como checar a promessa por fora. Adya, Liskov e O'Neil definem níveis de isolamento como ciclos proibidos em um grafo de dependências, mas esse grafo precisa da ordem de versões de cada objeto, que o cliente não enxerga. Segundo os autores, a ordem pode nem existir, e a ordem de tempo real não serve de substituta.

O verificador pertence à tradição do Jepsen de testar sob falhas. O catálogo tem dois estudos de falhas pelo mesmo ângulo, [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) e [Analysis of Network Partitioning Failures](/papers/analysis-of-network-partitioning-failures-in-cloud-systems), e o artigo usa a linearizabilidade como a base que supera ([Linearizability](/papers/linearizability-correctness-condition-concurrent-objects)). [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) trata de quais níveis de isolamento sobrevivem a partições, um pareamento do catálogo e não uma afirmação deste artigo. O artigo descreve três dos quatro bancos testados como baseados em papers do catálogo: TiDB no [Percolator](/papers/percolator-large-scale-incremental-processing) (veja também [TiDB](/papers/tidb-raft-based-htap-database)), YugaByte DB no [Spanner](/papers/spanner-globally-distributed-database) e FaunaDB no [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases).

## Contribuição

- **Inferência de dependências a partir de observações.** O Elle escolhe objetos e operações da carga para que as leituras revelem o histórico de versões. As dependências são recuperadas do que os clientes viram, não das entranhas do banco.
- **Duas propriedades.** Rastreabilidade: cada versão tem exatamente um rastro (caminho de escritas desde a versão inicial), então a leitura de uma lista entrega todas as versões anteriores. Recuperabilidade: cada versão observada mapeia para uma escrita de uma transação observada (argumentos únicos bastam para registradores e listas).
- **Soundness.** Uma anomalia reportada pelo Elle está presente em toda interpretação da observação (teorema do artigo, com a prova só resumida).
- **Variedade de anomalias.** G0, G1a, G1b, G1c, G-single e G2, além de dirty updates, leituras de lixo, escritas duplicadas, inconsistência interna e ciclos com ordem de processo e de tempo real. Predicados ficam de fora.
- **Verificação em tempo linear** e explicações legíveis de cada ciclo, implementadas no Jepsen.

## Metodologia

O Elle parte do modelo de Adya e generaliza os registradores para objetos cujas escritas são transições de estado, o que dá um grafo de versões por objeto e introduz o "dirty update" (versão não confirmada vazando para uma escrita confirmada). Uma observação é o registro do lado do cliente: operações, argumentos, valores de retorno quando conhecidos e commit, abort ou desconhecido para cada transação. Uma interpretação é qualquer histórico compatível com ela.

O artigo percorre os tipos de dados. Registradores perdem histórico numa escrita cega. Contadores dão ordem entre leituras, mas não recuperabilidade. Conjuntos recuperam algumas dependências, mas não ordenam dois adds. Listas com appends únicos dão as duas propriedades. Da maior leitura confirmada de cada chave o Elle tira um prefixo da ordem de versões, monta o grafo de serialização inferido (arestas ww, wr, rw) e soma as ordens de processo, tempo real, por chave e de metadados de versão quando existem. Os ciclos vêm dos componentes fortemente conexos de Tarjan mais busca em largura: G0 usa só arestas ww, G1c usa ww e wr, e G-single parte de uma aresta rw e fecha com ww e wr.

O estudo de caso rodou transações aleatórias de 1 a 10 operações, com 1 a 1024 escritas por objeto, 10 a 30 threads de cliente, 5 a 9 nós e injeção de falhas. O teste de desempenho compara o Elle ao Knossos em históricos de um banco simulado com serializable snapshot isolation.

## Resultados

- **TiDB (2.1.7 a 3.0.0-beta.1, declara snapshot isolation).** Anomalias frequentes mesmo sem falhas: G-single, observações inconsistentes que implicam leituras abortadas e lost updates, vindos de dois mecanismos de retry automático ligados por padrão. A versão 3.0.0-rc2 desligou os dois. G2, incluindo write skew, continuou possível com select ... for update, uma limitação documentada do lock em linhas ainda não criadas.
- **YugaByte DB 1.3.1.** Anomalias G2-item após queda ou pausa dos masters, por uma race depois da eleição de líder; corrigido na 1.3.1.2-b1. Nenhum G-single, G1 ou G0 observado.
- **FaunaDB 2.6.0.** Inconsistência interna, como uma transação não ver o próprio append, restrita a leituras de índice, e G2 inferido a partir dela.
- **Dgraph 1.1.1.** Inconsistência interna em operação normal e read skew por migração de shard retornando nil. Registradores, com ordens parciais de versão a partir do estado inicial, de write-follows-read e do tempo real por chave.
- **Resumo.** Anomalias nos quatro sistemas, quase todas desconhecidas. G0, G1b e G1c aparecem na suíte de testes do próprio Elle, não nesses bancos.
- **Desempenho.** O Knossos frequentemente estourava tempo ou memória após algumas centenas de transações, com limite de 100 segundos no experimento. Com 40 ou mais processos concorrentes, históricos de 5000 transações em geral não eram verificáveis por ele. O Elle checou históricos de centenas de milhares de transações em dezenas de segundos; segundo o artigo, é essencialmente linear no tamanho do histórico, com efeito leve da concorrência. Máquina: Xeon de 24 núcleos, 128 GB.

## Análise crítica

O que o artigo não afirma. Uma execução limpa não prova isolamento: o Elle só acha violações. A completude é provada apenas em casos especiais (observações determinadas e completamente recuperáveis); fora deles o artigo recorre a argumentos probabilísticos e ao estudo de caso. As anomalias sem ciclo que ele pega dependem da recuperabilidade. Predicados não são tratados, então o Elle não distingue repeatable read de serializability, e anomalias conhecidas como long fork aparecem só como G2. Ele não pretende substituir as demais verificações do Jepsen e só testa o isolamento dos padrões de transação que gera. Na seção de trabalhos relacionados, a versão do VLDB diz que o Knossos é mais geral (tipos de dados arbitrários) mas exponencial na concorrência, enquanto o Elle é constante.

Leitura minha, não do artigo:
- A afirmação de tempo linear cobre o trabalho com o grafo, e a prova de soundness é resumida, não apresentada. A soundness depende de o banco de fato expor o que a leitura de uma lista retorna.
- O Elle exige controle da carga: valores únicos e objetos tipo lista. Onde o cliente não escolhe isso, os resultados caem nas inferências mais fracas de registradores, que assumem coisas como linearizabilidade por chave (caso Dgraph).
- O gráfico de desempenho usa um banco simulado, não um real.

Literatura posterior: não verificada nesta entrada. Não li nem conferi nenhum trabalho posterior a 2020.

## Pesquisas futuras

- Estender o modelo a predicados, para distinguir repeatable read de serializability e detectar predicate-many-preceders (trabalho futuro dos próprios autores).
- Dicas mais específicas para anomalias marcadas como G2, como long fork, e dizer ao usuário exatamente quais níveis de isolamento um histórico satisfaz ou não.
- Ordens parciais de versão mais fracas para objetos não rastreáveis, que os autores deixam "como exercício".
- Trabalhos relacionados citados pelo artigo: Biswas e Enea (OOPSLA 2019) sobre a complexidade da verificação, e o formalismo centrado no cliente de Crooks et al. (PODC 2017). Não li nenhum dos dois.
