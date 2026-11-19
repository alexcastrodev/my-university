---
title: "Processamento incremental em larga escala com transações distribuídas e notificações"
summary: O Percolator acrescenta ao Bigtable transações com snapshot isolation entre várias linhas e observers disparados por mudanças, de modo que o Google pôde atualizar o índice da web um documento por vez, em vez de reconstruí-lo com cadeias de MapReduces.
researchArea: Sistemas distribuídos
keywords: percolator, processamento incremental, snapshot isolation, two-phase commit, bigtable, oráculo de timestamps, observers
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Atualizar um índice da web à medida que documentos são rastreados exige transformar continuamente um grande repositório de documentos existentes conforme novos documentos chegam. Essa tarefa é um exemplo de uma classe de tarefas de processamento de dados que transformam um grande repositório por meio de pequenas mutações independentes. Essas tarefas ficam numa lacuna entre as capacidades da infraestrutura existente. Os bancos de dados não atendem aos requisitos de armazenamento nem de throughput dessas tarefas: o sistema de indexação do Google armazena dezenas de petabytes e processa bilhões de atualizações por dia em milhares de máquinas. O MapReduce e outros sistemas de processamento em lote não conseguem processar pequenas atualizações individualmente, pois dependem da formação de grandes lotes para ter eficiência. Construímos o Percolator, um sistema para processar de forma incremental as atualizações de um grande conjunto de dados, e o implantamos para criar o índice de busca da web do Google. Ao substituir um sistema de indexação em lote por um baseado em processamento incremental com o Percolator, processamos o mesmo número de documentos por dia e reduzimos em 50% a idade média dos documentos nos resultados de busca do Google.

## Visão geral

Antes deste trabalho, o índice da web do Google era construído passando o rastreamento de cada dia, junto com o repositório existente, por uma série de 100 MapReduces ([MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters)). Isso funciona porque cada etapa em lote termina antes de a seguinte começar, e assim invariantes como "só a URL de maior PageRank entre as duplicatas fica no índice" são fáceis de manter. O custo é que uma pequena atualização obriga a reler tudo: a latência acompanha o tamanho do repositório, não o da atualização. Um SGBD convencional poderia atualizar documentos individuais com transações, mas não com dezenas de petabytes. Um armazenamento como o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) escala, mas não ajuda a manter invariantes sob atualizações concorrentes.

Este artigo do OSDI 2010, de Daniel Peng e Frank Dabek, do Google, descreve o Percolator, que fica entre os dois mundos. Ele roda sobre o Bigtable (que por sua vez guarda os dados no [Google File System](/papers/google-file-system)), acrescenta transações ACID entre linhas e tabelas com snapshot isolation e acrescenta observers, código que o sistema executa quando uma coluna muda. O sistema de indexação reconstruído sobre ele chama-se Caffeine, e o artigo afirma que o Percolator produz o índice de busca da web do Google desde abril de 2010.

Vale conhecer antes: snapshot isolation e por que ele admite write skew (veja [A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels)), two-phase commit, as transações de uma única linha do Bigtable com células versionadas por timestamp e o modelo em lote do MapReduce.

## Contribuição

- **Transações entre linhas como biblioteca de cliente.** O Percolator não tem servidor de transações. Qualquer cliente pode escrever direto no Bigtable, então os locks ficam em colunas do Bigtable e o cliente coordena um two-phase commit por meio das transações de linha do Bigtable.
- **Colunas de lock, write e data.** Cada coluna do Percolator é guardada como três colunas do Bigtable: `data` (o valor no timestamp de início), `lock` (um escritor não confirmado, com a localização do lock primário) e `write` (um ponteiro para o timestamp onde estão os dados confirmados). A transação é confirmada quando substitui o lock primário por um registro write.
- **Um oráculo de timestamps.** Um servidor entrega timestamps estritamente crescentes. Toda transação o consulta duas vezes, para obter o timestamp de início e o de commit, e a garantia de snapshot isolation depende dessa ordem.
- **Limpeza preguiçosa de locks.** Uma célula por transação é o lock primário, o único ponto em que commit e limpeza disputam. A transação que encontra um lock abandonado olha o primário para decidir entre desfazer e completar.
- **Observers e notificações.** Os observers rodam quando uma coluna observada muda, e uma coluna de acknowledgment por observer garante no máximo uma execução confirmada por mudança. As aplicações são cadeias de observers que escrevem na tabela, e o artigo diz que o sistema de indexação tem cerca de 10.

## Metodologia

Um cluster Percolator roda três binários em cada máquina: um worker (com todos os observers ligados a ele), um tablet server do Bigtable e um chunkserver do GFS, além de dois serviços pequenos: o oráculo de timestamps e um serviço de locks leve, usado para espalhar a varredura de notificações. O commit segue a Figura 6 do artigo. O prewrite verifica, em cada célula escrita, se há um registro `write` depois do timestamp de início ou qualquer `lock`, abortando em ambos os casos, e então grava lock e dado no timestamp de início, começando pelo primário. Depois o cliente obtém um timestamp de commit, troca o lock primário por um registro write (o ponto de commit) e termina os secundários. Um `Get` espera se encontra um lock em timestamp anterior ou igual ao seu início, e caso contrário lê o registro write mais recente.

A vitalidade do dono de um lock é avaliada com um token no [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) mais um horário de relógio gravado no lock. As notificações usam uma coluna `notify` em seu próprio locality group, varrida por threads que começam em posições aleatórias dos tablets. Quatro mecanismos reduzem o custo: mutações condicionais, agrupamento de RPCs em lotes, prefetch de colunas da mesma linha e milhares de threads bloqueantes por máquina.

A avaliação usa um subconjunto de servidores de um data center do Google. Tem três partes: a conversão do pipeline de indexação, um benchmark sintético de clusterização contra o MapReduce (240 máquinas, repositório de um bilhão de documentos, três chaves de clusterização) e microbenchmarks e uma carga parecida com o TPC-E contra o Bigtable puro.

## Resultados

Estes são os resultados relatados pelos autores.

- **Indexação em produção.** O sistema antigo rastreava vários bilhões de documentos por dia por meio de 100 MapReduces, e cada documento passava de 2 a 3 dias sendo indexado. O Caffeine processa o documento mediano mais de 100 vezes mais rápido, com uma coleção 3 vezes maior e cerca de o dobro de recursos. Usa 10 observers no lugar de 100 MapReduces e é descrito como praticamente imune aos stragglers que prejudicavam o sistema em lote. O documento médio nos resultados de busca fica quase 50% mais novo, número que inclui o atraso do rastreamento.
- **Benchmark de clusterização.** Com 1% de taxa de rastreamento, a sequência de MapReduces leva cerca de 20 minutos por execução e cerca de 30 minutos em média do rastreamento até a clusterização, enquanto o Percolator leva dois segundos em média, algo como 1000 vezes mais rápido. O Percolator deixa de acompanhar a 40% de taxa de rastreamento por hora, enquanto o MapReduce nessa configuração sustenta mais de 100%. Os autores esperam que o ponto de cruzamento favoreça o MapReduce em taxas altas.
- **Microbenchmark.** Contra um único tablet server, o Percolator lê 14.590 por segundo contra 15.513 do Bigtable (0,94) e escreve 7.232 contra 31.003 (0,23), um fator de cerca de quatro em escritas de uma só célula. O agrupamento em lotes estava desligado e o oráculo não foi exercitado.
- **Tipo TPC-E.** A taxa de transações cresce de forma essencialmente linear de 11 a 15.000 núcleos. Com 15.000 núcleos chega a 11.200 tps, contra 3.183 tpsE do sistema comercial mais rápido citado pelos autores. Eles estimam cerca de 30 vezes mais CPU por transação. A latência média é de 2 a 5 segundos, com casos extremos de vários minutos.
- **Outros números.** O oráculo serve cerca de 2 milhões de timestamps por segundo em uma máquina. Um documento exige cerca de 50 operações no Bigtable. Prefetch e cache cortam as leituras por um fator de 10. Depois de matar um terço dos tablet servers, o throughput cai e se recupera conforme os tablets são recarregados.

## Análise crítica

O artigo declara seus próprios limites. Snapshot isolation não é serializável. A limpeza preguiçosa pode atrasar um commit em dezenas de segundos, aceitável para indexação mas não para OLTP. Não há detector global de deadlock. A replicação entre data centers é limitada, pois a do Bigtable é consistente apenas por tablet. O custo de 30 vezes em CPU é chamado de preço das camadas. O agrupamento em lotes amplia a janela de conflitos, o que os autores dizem não ter sido problema num ambiente de baixa contenção. Na execução parecida com o TPC-E, os autores omitiram uma escrita que cairia numa célula quente (a comissão do corretor), observando que o uso real passaria por uma tabela auxiliar.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **O ganho de destaque tem duas bases.** O número de 100 vezes do Caffeine é dado sem gráfico, e o de 1000 vezes vem de um benchmark sintético cuja base de comparação reexecuta três MapReduces sobre o repositório inteiro. Os trabalhos relacionados citam MapReduces modificados e o DryadInc como pontos intermediários que não foram executados.
- **O caminho de falha é descrito, não medido.** O protocolo de limpeza e de roll-forward é explicado em detalhe, mas não há contagem de locks abandonados, de abortos por limpeza nem do tempo para destravar um commit parado. O único experimento de falha derruba tablet servers, que segundo o artigo não afetam a correção das transações.
- **Escrita de uma célula é o pior caso, não o típico.** O fator de quatro vem com lotes desligados e dados em cache, então diz pouco sobre o que o agrupamento ganha.

Literatura posterior, que não faz parte do artigo: o [TiDB](/papers/tidb-raft-based-htap-database) é descrito em seu próprio artigo como usando um two-phase commit baseado no Percolator, com timestamps pedidos ao componente PD, e oferecendo snapshot isolation. O [Spanner](/papers/spanner-globally-distributed-database) seguiu outro caminho para semânticas mais fortes, com TrueTime e commit wait, e com replicação entre data centers embutida. O [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) evita o two-phase commit por completo com ordenação determinística.

## Pesquisas futuras

- A questão em aberto com que os autores terminam: quanto do custo de 30 vezes é inerente a empilhar camadas sobre armazenamento distribuído e quanto pode ser otimizado?
- Tratamento de pontos quentes além de omitir escritas: notificações fracas e tabelas auxiliares são descritas, mas o artigo não dá números sobre o efeito.
- Replicar um repositório no estilo Percolator entre data centers sem quebrar invariantes entre as escritas de uma mesma transação.
- Uma comparação direta com uma base de MapReduce incremental mais forte, nos mesmos tamanhos de repositório.
